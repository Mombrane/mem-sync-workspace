import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getQualityMultiplier, validateMemory } from './schema.js';
import { isEncrypted, decryptLineSync, loadEncryptionConfigSync } from './encryption.js';
import {
  cosineSimilarity,
  blobToFloat32,
  insertEmbeddings,
  queryEmbeddings,
  computeHybridScore,
  mmrRerank
} from './embedding-cache.js';

const DB_FILENAME = 'index.sqlite';

/**
 * 辅助函数：获取索引数据库的完整路径。
 * 数据库文件放在 cacheDir 下，与 JSONL 源数据分离，
 * 确保索引不会被误提交到 Git 仓库。
 */
function resolveDbPath(cacheDir) {
  return join(cacheDir, DB_FILENAME);
}

/**
 * 辅助函数：从 Git 仓库获取当前 HEAD 提交哈希。
 * 如果 repoDir 不是 Git 仓库或 git 命令不可用，返回 'unknown'。
 * 此函数用于增量更新检测——只有当 HEAD 变化时才触发重建。
 */
function getGitHead(repoDir) {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * 辅助函数：递归查找 repoDir 下所有 .jsonl 文件。
 * JSONL 格式允许按目录组织（如 memories/2026/01.jsonl），
 * 递归扫描确保所有子目录下的文件都被索引进 FTS。
 */
function findJSONLFilesSync(repoDir) {
  const results = [];
  try {
    const entries = readdirSync(repoDir, { recursive: true });
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        results.push(join(repoDir, entry));
      }
    }
  } catch {
    // 目录不存在或无法读取时返回空列表，调用方按空数据处理
  }
  return results;
}

/**
 * 辅助函数：将 JSONL 文本拆分为行，跳过空行。
 */
function splitLines(text) {
  return text.split('\n').filter(line => line.trim());
}

/**
 * 辅助函数：将 Schema v1 记录映射为数据库行参数。
 * JSON 数组/对象字段序列化为文本存储，保留原始结构不做范式化拆分。
 * 这是有意的设计选择：MVP 阶段这些字段作为透传元数据，
 * 不需要关系型查询；后续可按需迁移。
 */
function mapRecordToRow(record, filePath, lineNo, repoCommit) {
  return {
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    project_id: record.projectId ?? null,
    agent_id: record.agentId ?? null,
    content: record.content,
    summary: record.summary,
    // JSON 数组/对象字段序列化为文本列：
    // FTS5 的 tokenizer 会自动拆解 JSON 字符串中的词素，
    // 实现"透明"的标签和元数据搜索。
    source_json: JSON.stringify(record.source),
    evidence_json: JSON.stringify(record.evidence),
    tags_json: JSON.stringify(record.tags),
    confidence: record.confidence,
    importance: record.importance,
    veracity: record.veracity,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    valid_until: record.validUntil,
    deleted_at: record.deletedAt,
    supersedes_json: JSON.stringify(record.supersedes),
    file_path: filePath,
    line_no: lineNo,
    repo_commit: repoCommit
  };
}

/**
 * 辅助函数：将数据库行映射回 Schema v1 记录格式。
 * JSON 文本列反序列化为对象/数组，字段名从 snake_case 转为 camelCase。
 */
function mapRowToRecord(row) {
  return {
    schemaVersion: 1,
    id: row.id,
    kind: row.kind,
    scope: row.scope,
    projectId: row.project_id ?? null,
    agentId: row.agent_id ?? null,
    content: row.content,
    summary: row.summary,
    source: safeParseJSON(row.source_json, { type: 'unknown' }),
    evidence: safeParseJSON(row.evidence_json, []),
    confidence: row.confidence,
    importance: row.importance,
    veracity: row.veracity,
    tags: safeParseJSON(row.tags_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    validUntil: row.valid_until ?? null,
    deletedAt: row.deleted_at ?? null,
    supersedes: safeParseJSON(row.supersedes_json, []),
    canonicalKey: null // 索引中不存储 canonicalKey，召回引擎可后续计算
  };
}

/**
 * 辅助函数：安全解析 JSON，失败时返回默认值。
 * 用于处理 source_json、evidence_json 等可能损坏的已存储数据。
 */
function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * 辅助函数：检查记录是否应跳过（已软删除或已过期）。
 * 软删除（deletedAt 非 null）和过期（validUntil 在过去）的记录
 * 不应出现在搜索结果中，但原始 JSONL 中保留它们用于审计。
 */
function shouldSkipRecord(record) {
  if (record.deletedAt) return true;
  if (record.validUntil && new Date(record.validUntil) < new Date()) return true;
  return false;
}

/**
 * Exclude memories that are superseded by other memories in the same result set.
 * If record A has supersedes=[B.id] and both A and B are in results, B is removed.
 */
function excludeSuperseded(results) {
  const resultIds = new Set(results.map(r => r.id));
  const supersededIds = new Set();
  for (const r of results) {
    if (Array.isArray(r.supersedes)) {
      for (const s of r.supersedes) {
        if (resultIds.has(s)) supersededIds.add(s);
      }
    }
  }
  if (supersededIds.size === 0) return results;
  return results.filter(r => !supersededIds.has(r.id));
}

// ─── 公开 API ───────────────────────────────────────────────────────

/**
 * 创建或打开索引数据库，设置 SQLite 编译选项和表结构。
 *
 * 关键决策：
 * - WAL 模式：允许并发读取和单一写入，适合 CLI 工具多进程场景。
 * - busy_timeout=5000ms：写入冲突时等待 5 秒而非立即报 SQLITE_BUSY，
 *   避免短时并发操作导致不必要的错误。
 * - External-Content FTS5：memories_fts 虚拟表通过 content_rowid
 *   引用 memories 表的 rowid，避免全文索引和结构化数据混合存储。
 *   FTS 重建时只需 'rebuild' 命令，从 content 表全量同步。
 */
export function createIndexDatabase(cacheDir) {
  // 确保缓存目录存在：better-sqlite3 不会自动创建父目录
  mkdirSync(cacheDir, { recursive: true });
  const dbPath = resolveDbPath(cacheDir);
  const db = new Database(dbPath);

  // WAL 模式：写操作写入 WAL 文件，读操作仍可直接读主数据库，
  // 实现"一写多读"的并发模型，适合 CLI 的多进程实例场景。
  db.pragma('journal_mode=WAL');
  // busy_timeout：遇到锁时等待最多 5 秒，避免短时并发导致操作失败。
  db.pragma('busy_timeout=5000');

  // memories 表是"内容表"（content table），存储每条记忆的完整字段。
  // rowid 作为 FTS5 外部内容关联的主键，AUTOINCREMENT 确保重建时不会
  // 意外复用旧 rowid（虽然全量重建会先 DELETE，但保留此约束更安全）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT,
      agent_id TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      source_json TEXT,
      evidence_json TEXT,
      confidence REAL DEFAULT 0.5,
      importance REAL DEFAULT 0.5,
      veracity TEXT DEFAULT 'unknown',
      tags_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      valid_until TEXT,
      deleted_at TEXT,
      supersedes_json TEXT,
      file_path TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      repo_commit TEXT NOT NULL
    );
  `);

  // FTS5 虚拟表（外部内容模式，trigram 分词器）：
  // - tokenize='trigram'：三元组分词器，对中文和混合语言搜索效果更好。
  //   默认 tokenizer 对 CJK 字符按单字分割，trigram 保留三字符窗口，
  //   提高中文短语匹配的精度和召回率。
  // - content='memories' 指定内容表名
  // - content_rowid='rowid' 指定关联的 rowid 列
  // - 索引 content, summary, tags_json 三列：
  //   tags_json 虽然存储 JSON 数组，但 FTS5 tokenizer 会拆解字符串，
  //   使标签搜索透明工作（如 ["python", "testing"] 可匹配 "python"）。
  // - 外部内容模式下，FTS 不存储数据副本，所有内容从 memories 表读取。
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, summary, tags_json,
      tokenize='trigram',
      content='memories',
      content_rowid='rowid'
    );
  `);

  // Enable foreign keys for ON DELETE CASCADE support
  db.pragma('foreign_keys = ON');

  // Embeddings table: stores precomputed embedding vectors for hybrid search.
  // Linked to memories via foreign key with CASCADE delete — when rebuildIndex
  // clears memories, embeddings are automatically cleaned up.
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      memory_rowid INTEGER PRIMARY KEY,
      vector BLOB NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_rowid) REFERENCES memories(rowid) ON DELETE CASCADE
    );
  `);

  // index_meta 表存储索引元数据，当前仅包含 repo_head。
  // repo_head 用于增量更新检测：如果当前 HEAD 与存储值相同，
  // 则索引无需重建，直接跳过。
  // 未来可扩展更多元数据键（如 last_rebuild_at、schema_version 等）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.close();
}

/**
 * 全量重建索引：扫描 repoDir 下所有 .jsonl 文件，验证每条记录，
 * 将有效、未删除、未过期的记录插入 memories 表，重建 FTS 索引，
 * 最后记录 repo_head 用于增量更新检测。
 *
 * 参数：
 * - repoDir: JSONL 源数据目录
 * - cacheDir: 索引数据库缓存目录
 * - options.repoHead: 显式指定 HEAD 提交（测试用），省略时从 Git 获取
 * - options.logger: 诊断日志回调函数，输出到 stderr
 *
 * 返回 { recordCount }，记录成功索引的数量。
 *
 * 跳过规则：
 * 1. JSON 解析失败的行 — 损坏数据不阻塞其他记录
 * 2. Schema 验证失败的记录 — 不合法数据不进入索引
 * 3. deletedAt 非 null 的记录 — 软删除记忆不在搜索结果中出现
 * 4. validUntil 在过去 — 已过期记忆视为不可用
 */
export function rebuildIndex(repoDir, cacheDir, options = {}) {
  const { logger, repoHead: explicitHead } = options;

  logger?.('[mem-sync:index] rebuild:start');

  // 确保数据库和表结构已创建
  createIndexDatabase(cacheDir);
  const dbPath = resolveDbPath(cacheDir);
  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  // 全量重建策略：先清空所有数据，再重新插入。
  // 对于 MVP 规模（数百到数千条记录），全量重建是最简单、最可靠的方式。
  // 'delete-all' 命令清空 FTS 索引，DELETE 清空内容表。
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('delete-all');");
  db.exec('DELETE FROM memories;');

  // 准备插入语句：使用命名参数提高可读性和列对应准确性。
  const insertStmt = db.prepare(`
    INSERT INTO memories (
      id, kind, scope, project_id, agent_id,
      content, summary, source_json, evidence_json,
      confidence, importance, veracity, tags_json,
      created_at, updated_at, valid_until, deleted_at, supersedes_json,
      file_path, line_no, repo_commit
    ) VALUES (
      @id, @kind, @scope, @project_id, @agent_id,
      @content, @summary, @source_json, @evidence_json,
      @confidence, @importance, @veracity, @tags_json,
      @created_at, @updated_at, @valid_until, @deleted_at, @supersedes_json,
      @file_path, @line_no, @repo_commit
    );
  `);

  // 获取或使用显式指定的 HEAD 提交哈希
  const head = explicitHead ?? getGitHead(repoDir);

  // 同步扫描 JSONL 文件（不使用异步迭代器，因为 better-sqlite3 是同步 API）
  const jsonlFiles = findJSONLFilesSync(repoDir);

  let recordCount = 0;
  let fileCount = 0;

  // 使用事务批量插入：每 500 条记录提交一次事务，
  // 平衡内存使用和写入性能。全部插入后再重建 FTS。
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(row);
      recordCount += 1;
    }
  });

  let batch = [];

  for (const filePath of jsonlFiles) {
    fileCount += 1;
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      logger?.(`[mem-sync:index] rebuild:skip cannot read file: ${filePath}`);
      continue;
    }

    const lines = splitLines(raw);

    // 加载加密配置（懒加载，每文件只加载一次）
    let encConfig = null;
    let encConfigLoaded = false;
    function getEncConfig() {
      if (!encConfigLoaded) {
        encConfigLoaded = true;
        // 从文件路径推导 repoPath：<repo>/memories/xxx.jsonl → <repo>
        const parts = filePath.split('/');
        const memoriesIdx = parts.lastIndexOf('memories');
        if (memoriesIdx > 0) {
          const repoPath = parts.slice(0, memoriesIdx).join('/');
          encConfig = loadEncryptionConfigSync(repoPath);
        }
      }
      return encConfig;
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
      let line = lines[lineIdx];

      // 步骤 0：解密（如果行是加密的）
      if (isEncrypted(line)) {
        const cfg = getEncConfig();
        if (cfg) {
          try {
            // 收集完整的 PEM 块（加密内容可能跨多行）
            if (line.trim().startsWith('-----BEGIN AGE ENCRYPTED FILE-----')) {
              let block = line;
              while (lineIdx + 1 < lines.length) {
                lineIdx += 1;
                block += '\n' + lines[lineIdx];
                if (lines[lineIdx].trim().startsWith('-----END AGE ENCRYPTED FILE-----')) break;
              }
              line = decryptLineSync(block, cfg);
            } else {
              line = decryptLineSync(line, cfg);
            }
          } catch (err) {
            logger?.(`[mem-sync:index] rebuild:skip decrypt failed at ${filePath}:${lineIdx + 1}: ${err.message}`);
            continue;
          }
        } else {
          // 无加密配置，无法解密，跳过
          logger?.(`[mem-sync:index] rebuild:skip encrypted line without config at ${filePath}:${lineIdx + 1}`);
          continue;
        }
      }

      // 步骤 1：JSON 解析
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        // 损坏的 JSONL 行静默跳过，不中断其他记录的索引
        logger?.(`[mem-sync:index] rebuild:skip invalid JSON at ${filePath}:${lineIdx + 1}`);
        continue;
      }

      // 步骤 2：Schema 验证
      try {
        validateMemory(record);
      } catch (err) {
        // Schema 验证失败：记录不符合 v1 规范，跳过并记录原因
        logger?.(`[mem-sync:index] rebuild:skip validation failed at ${filePath}:${lineIdx + 1}: ${err.message}`);
        continue;
      }

      // 步骤 3：跳过已删除或已过期的记录
      if (shouldSkipRecord(record)) {
        continue;
      }

      // 步骤 4：映射为数据库行并加入批量缓冲
      batch.push(mapRecordToRow(record, filePath, lineIdx + 1, head));

      // 批量提交：每 500 条记录执行一次事务写入
      if (batch.length >= 500) {
        insertBatch(batch);
        batch = [];
      }
    }
  }

  // 提交剩余批次
  if (batch.length > 0) {
    insertBatch(batch);
  }

  // 重建 FTS 索引：'rebuild' 命令从 memories 内容表全量读取
  // 并重建全文索引。这是外部内容 FTS5 的核心同步机制。
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild');");

  // 存储 repo_head：用于增量更新时检测是否需要重建
  db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)')
    .run('repo_head', head);

  db.close();

  logger?.(`[mem-sync:index] rebuild:complete indexed ${recordCount} records from ${fileCount} file(s)`);

  return { recordCount };
}

/**
 * Rebuild index with optional embedding computation.
 * Calls rebuildIndex() for FTS portion (sync, always succeeds),
 * then optionally computes and stores embeddings.
 *
 * @param {string} repoDir - JSONL 源数据目录
 * @param {string} cacheDir - 索引数据库缓存目录
 * @param {object} [options={}]
 * @param {EmbeddingProvider} [options.embeddingProvider] - Embedding provider
 * @param {function} [options.logger] - 诊断日志回调
 * @param {string} [options.repoHead] - 显式指定 HEAD 提交
 * @returns {Promise<{recordCount: number, embeddingsGenerated: number, embeddingsFailed: number}>}
 */
export async function rebuildIndexWithEmbeddings(repoDir, cacheDir, options = {}) {
  const { embeddingProvider, logger } = options;

  // Phase 1: FTS index (sync, always succeeds)
  const result = rebuildIndex(repoDir, cacheDir, options);

  // Phase 2: Embeddings (async, best-effort)
  if (!embeddingProvider || embeddingProvider.dimensions === 0) {
    return { ...result, embeddingsGenerated: 0, embeddingsFailed: 0 };
  }

  const dbPath = resolveDbPath(cacheDir);
  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');
  db.pragma('foreign_keys = ON');

  let generated = 0;
  let failed = 0;

  try {
    // Get all memory rowids and content
    const allRows = db.prepare('SELECT rowid, content, summary FROM memories').all();

    if (allRows.length === 0) {
      return { ...result, embeddingsGenerated: 0, embeddingsFailed: 0 };
    }

    // Batch embed in groups of 20
    const BATCH_SIZE = 20;
    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);
      const texts = batch.map(r => `${r.summary ?? ''}\n${r.content}`.trim());

      let retries = 0;
      const MAX_RETRIES = 3;

      while (retries <= MAX_RETRIES) {
        try {
          const vectors = await embeddingProvider.embed(texts);
          insertEmbeddings(db, batch.map(r => r.rowid), vectors, embeddingProvider.name, embeddingProvider.dimensions);
          generated += batch.length;
          break;
        } catch (err) {
          retries++;
          if (retries > MAX_RETRIES) {
            failed += batch.length;
            logger?.(`[mem-sync:index] embed:batch-failed records=${batch.length} error=${err.message}`);
          } else {
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries - 1)));
          }
        }
      }
    }

    // Store embedding metadata
    const now = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('embedding_model', ?)").run(embeddingProvider.name);
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('embedding_dimensions', ?)").run(String(embeddingProvider.dimensions));
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('embeddings_count', ?)").run(String(generated));
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('embeddings_generated_at', ?)").run(now);

    logger?.(`[mem-sync:index] embed:complete generated=${generated} failed=${failed}`);
  } finally {
    db.close();
  }

  return { ...result, embeddingsGenerated: generated, embeddingsFailed: failed };
}

/**
 * Hybrid search: FTS5 BM25 candidates + embedding cosine re-ranking.
 *
 * @param {string} cacheDir - 索引数据库缓存目录
 * @param {object} [options={}]
 * @param {EmbeddingProvider} [options.embeddingProvider] - Embedding provider
 * @param {string} [options.query] - FTS5 查询字符串
 * @param {number} [options.embeddingWeight=0.4] - BM25 weight in hybrid score [0, 1]
 * @param {number} [options.limit=20] - 最大返回条数
 * @param {string} [options.scope] - 按 scope 过滤
 * @param {string} [options.kind] - 按 kind 过滤
 * @param {string[]} [options.tags] - 按标签过滤
 * @param {string} [options.projectId] - 按 project_id 过滤
 * @param {string} [options.agentId] - 按 agent_id 过滤
 * @param {number} [options.minConfidence=0] - 最小置信度阈值
 * @param {number} [options.minImportance=0] - 最小重要性阈值
 * @param {string} [options.veracity] - 按 veracity 过滤
 * @param {boolean} [options.excludeDeleted=true] - 是否排除已删除记录
 * @param {boolean} [options.excludeExpired=true] - 是否排除已过期记录
 * @param {boolean} [options.mmr=false] - 是否启用 MMR 多样性重排序
 * @param {number} [options.mmrLambda=0.7] - MMR 相关性权重 λ ∈ [0, 1]
 * @returns {Promise<object[]>} Schema v1 格式的记录数组，按 hybrid score 降序排列
 */
export async function searchIndexHybrid(cacheDir, options = {}) {
  const { embeddingProvider, embeddingWeight = 0.4, limit = 20, mmr = false, mmrLambda = 0.7 } = options;

  // Phase 1: Get FTS5 BM25 candidates (3x limit for re-ranking pool)
  let ftsResults = searchIndex(cacheDir, { ...options, limit: limit * 3 });

  // If no embedding provider or no FTS results, fall back
  if (!embeddingProvider || embeddingProvider.dimensions === 0) {
    return ftsResults.slice(0, limit);
  }

  if (ftsResults.length === 0) {
    // FTS returned nothing — optionally do full vector scan for small indexes
    const dbPath = resolveDbPath(cacheDir);
    if (!existsSync(dbPath)) return [];

    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    db.pragma('busy_timeout=5000');

    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM embeddings').get()?.c ?? 0;
      if (count === 0 || count > 1000) return [];

      // Full vector scan fallback
      const queryText = options.query ?? '';
      const queryVectors = await embeddingProvider.embed([queryText]);
      if (!queryVectors[0]) return [];

      const queryVec = queryVectors[0];
      const allEmbeddings = db.prepare('SELECT memory_rowid, vector FROM embeddings').all();

      const scored = [];
      for (const row of allEmbeddings) {
        const vec = blobToFloat32(row.vector);
        const sim = cosineSimilarity(queryVec, vec);
        if (sim > 0) {
          scored.push({ rowid: row.memory_rowid, similarity: sim });
        }
      }

      scored.sort((a, b) => b.similarity - a.similarity);
      const topRowids = scored.slice(0, limit).map(s => s.rowid);

      if (topRowids.length === 0) return [];

      // Fetch full records
      const placeholders = topRowids.map(() => '?').join(', ');
      const rows = db.prepare(`SELECT * FROM memories WHERE rowid IN (${placeholders})`).all(...topRowids);

      // Map and sort by score
      const rowidToScore = new Map(scored.map(s => [s.rowid, s.similarity]));
      return rows.map(row => {
        const record = mapRowToRecord(row);
        record._rank = -(rowidToScore.get(row.rowid) ?? 0); // Negative = better (consistent with BM25)
        return record;
      }).sort((a, b) => a._rank - b._rank);
    } finally {
      db.close();
    }
  }

  // Phase 2: Re-rank FTS candidates with embeddings
  const dbPath = resolveDbPath(cacheDir);
  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  try {
    // Get query embedding
    const queryText = options.query ?? '';
    const queryVectors = await embeddingProvider.embed([queryText]);
    if (!queryVectors[0]) return ftsResults.slice(0, limit);
    const queryVec = queryVectors[0];

    // Get candidate rowids (need to map from id to rowid)
    const candidateIds = ftsResults.map(r => r.id);
    const placeholders = candidateIds.map(() => '?').join(', ');
    const idToRowid = new Map();
    const rowidRows = db.prepare(`SELECT rowid, id FROM memories WHERE id IN (${placeholders})`).all(...candidateIds);
    for (const row of rowidRows) {
      idToRowid.set(row.id, row.rowid);
    }

    // Load embeddings for candidates
    const candidateRowids = candidateIds.map(id => idToRowid.get(id)).filter(Boolean);
    const embeddings = queryEmbeddings(db, candidateRowids);

    // Compute hybrid scores
    for (const result of ftsResults) {
      const rowid = idToRowid.get(result.id);
      const vec = rowid != null ? embeddings.get(rowid) : null;

      // 附加 _rowid 供 MMR 通过 embeddings Map 查找嵌入向量
      result._rowid = rowid;

      if (vec) {
        const sim = cosineSimilarity(queryVec, vec);
        const quality = getQualityMultiplier(result);
        result._hybridScore = computeHybridScore(result._rank ?? 0, sim, embeddingWeight, quality);
        result._cosineSim = sim;
      } else {
        // No embedding for this record — use BM25 only
        const quality = getQualityMultiplier(result);
        const bm25Normalized = 1 / (1 + Math.abs(result._rank ?? 0));
        result._hybridScore = embeddingWeight * bm25Normalized * quality;
        result._cosineSim = null;
      }
    }

    // Re-sort by hybrid score (higher = better)
    ftsResults.sort((a, b) => (b._hybridScore ?? 0) - (a._hybridScore ?? 0));

    ftsResults = excludeSuperseded(ftsResults);

    // Phase 3: MMR diversity reranking (opt-in)
    if (mmr) {
      const mmrResults = mmrRerank(ftsResults, {
        lambda: mmrLambda,
        k: limit,
        embeddings
      });
      return mmrResults;
    }

    return ftsResults.slice(0, limit);
  } finally {
    db.close();
  }
}

/**
 * 获取索引状态信息。
 * 返回 { recordCount, repoHead, dbPath, exists }。
 * - exists=false 表示数据库文件不存在或未创建
 * - recordCount=0 且 exists=true 表示索引为空
 */
export function getIndexStatus(cacheDir) {
  const dbPath = resolveDbPath(cacheDir);

  // 数据库文件不存在时直接返回，避免 better-sqlite3 自动创建空文件
  if (!existsSync(dbPath)) {
    return { recordCount: 0, repoHead: null, dbPath, exists: false };
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  let recordCount = 0;
  let repoHead = null;
  let exists = true;

  try {
    // 检查表是否存在（处理数据库文件存在但表未创建的情况）
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories';"
    ).get();

    if (tableCheck) {
      const countResult = db.prepare('SELECT COUNT(*) as count FROM memories;').get();
      recordCount = countResult.count;

      const metaResult = db.prepare(
        "SELECT value FROM index_meta WHERE key = 'repo_head';"
      ).get();
      repoHead = metaResult?.value ?? null;
    } else {
      exists = false;
    }
  } finally {
    db.close();
  }

  return { recordCount, repoHead, dbPath, exists };
}

/**
 * FTS5 全文搜索：使用 BM25 排序返回匹配记录。
 *
 * ## 新签名（推荐）
 *
 * @param {string} cacheDir - 索引数据库缓存目录
 * @param {object} options - 搜索选项对象
 * @param {string} options.query - 必填 — FTS5 查询字符串
 * @param {number} [options.limit=20] - 最大返回条数
 * @param {string} [options.scope] - 按 scope 枚举值过滤
 * @param {string} [options.kind] - 按 kind 枚举值过滤
 * @param {string[]} [options.tags] - 按标签过滤（AND 语义，JS 后过滤）
 * @param {string} [options.projectId] - 按 project_id 过滤
 * @param {string} [options.agentId] - 按 agent_id 过滤
 * @param {number} [options.minConfidence=0] - 最小置信度阈值（0–1）
 * @param {number} [options.minImportance=0] - 最小重要性阈值（0–1）
 * @param {string} [options.veracity] - 按 veracity 枚举值过滤
 * @param {boolean} [options.excludeDeleted=true] - 是否排除已删除记录
 * @param {boolean} [options.excludeExpired=true] - 是否排除已过期记录
 * @param {boolean} [options.mmr=false] - 是否启用 MMR 多样性重排序
 * @param {number} [options.mmrLambda=0.7] - MMR 相关性权重 λ ∈ [0, 1]
 * @returns {object[]} Schema v1 格式的记录数组，按 BM25 相关性降序排列
 *
 * ## 旧签名（已弃用，向后兼容）
 *
 * @deprecated 自 v0.2 起。请使用 options 对象形式。
 * 仍接受 `searchIndex(cacheDir, query: string, limit?: number)`，
 * 并调用新的 options 对象形式。
 */
export function searchIndex(cacheDir, optionsOrQuery, legacyLimit) {
  // 向后兼容检测：如果第二个参数是字符串，则是旧的 (cacheDir, query, limit) 签名。
  // 将旧参数包装为新的 options 对象形状。
  const options = typeof optionsOrQuery === 'string'
    ? { query: optionsOrQuery, limit: legacyLimit }
    : optionsOrQuery;

  const {
    query,
    limit,
    scope,
    kind,
    tags,
    projectId,
    agentId,
    minConfidence,
    minImportance,
    veracity,
    excludeDeleted,
    excludeExpired,
    mmr,
    mmrLambda
  } = options;

  const effectiveLimit = limit ?? 20;
  const dbPath = resolveDbPath(cacheDir);

  // 索引文件不存在时返回空结果
  if (!existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  let results = [];

  try {
    // 检查 FTS 表是否存在
    const ftsCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts';"
    ).get();

    if (!ftsCheck) {
      return [];
    }

    // 动态构建 SQL WHERE 子句：仅当对应选项提供时才添加过滤条件。
    // 使用 @param IS NULL OR column = @param 模式，
    // 使 SQLite 在参数为 NULL 时跳过该条件。
    // SQL 拼接使用三元条件将固定过滤合并到同一条语句中。

    // 构建排除已删除/已过期记录的子句：
    // - excludeDeleted: 默认 true（使用 AND deleted_at IS NULL）
    // - excludeExpired: 默认 true（使用 AND (valid_until IS NULL OR valid_until >= @nowIso)）
    const excludeDeletedClause = (excludeDeleted !== false)
      ? 'AND m.deleted_at IS NULL'
      : '';
    const excludeExpiredClause = (excludeExpired !== false)
      ? 'AND (m.valid_until IS NULL OR m.valid_until >= @nowIso)'
      : '';

    // 当前 UTC 时间，用于过期检查
    const nowIso = new Date().toISOString();

    // FTS5 MATCH 查询使用 BM25 排序：
    // - JOIN memories_fts ON memories.rowid = memories_fts.rowid 建立关联
    // - WHERE memories_fts MATCH @query 执行全文匹配
    // - 结构化过滤条件仅在选项提供时激活（@param IS NULL OR ... 模式）
    // - ORDER BY rank 按 BM25 相关性降序（rank 值越小越相关）
    // - LIMIT 限制返回数量，避免结果集过大
    const rows = db.prepare(`
      SELECT m.*, f.rank
      FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @query
        AND (@scope IS NULL OR m.scope = @scope)
        AND (@kind IS NULL OR m.kind = @kind)
        AND (@projectId IS NULL OR m.project_id = @projectId)
        AND (@agentId IS NULL OR m.agent_id = @agentId)
        AND (@veracity IS NULL OR m.veracity = @veracity)
        AND m.confidence >= @minConfidence
        AND m.importance >= @minImportance
        ${excludeDeletedClause}
        ${excludeExpiredClause}
      ORDER BY rank
      LIMIT @effectiveLimit
    `).all({
      query,
      scope: scope ?? null,
      kind: kind ?? null,
      projectId: projectId ?? null,
      agentId: agentId ?? null,
      veracity: veracity ?? null,
      minConfidence: minConfidence ?? 0,
      minImportance: minImportance ?? 0,
      nowIso,
      effectiveLimit
    });

    results = rows.map(row => {
      const record = mapRowToRecord(row);
      // 附加 FTS5 BM25 排名到记录（用于 recall 输出格式化）
      record._rank = row.rank;
      return record;
    });

    results = excludeSuperseded(results);

    // 质量加权排序：将 BM25 rank 乘以质量乘数（confidence + importance + veracity），
    // 使高质量记忆在纯 FTS 路径中也获得更高排名。
    results.sort((a, b) => {
      const scoreA = Math.abs(a._rank ?? 0) * getQualityMultiplier(a);
      const scoreB = Math.abs(b._rank ?? 0) * getQualityMultiplier(b);
      return scoreB - scoreA; // 降序，高分在前
    });

    // 标签后过滤（AND 语义）：在 JS 中过滤，避免依赖 SQLite JSON1 扩展。
    // FTS + SQL 过滤后的结果集很小（≤ effectiveLimit），JS 过滤开销可忽略。
    if (tags && tags.length > 0) {
      results = results.filter(r => tags.every(t => r.tags.includes(t)));
    }

    // MMR 多样性重排序（可选）：仅当 mmr=true 时启用。
    // FTS-only 模式下没有嵌入向量可用，MMR 使用 trigram Jaccard 作为相似度度量。
    if (mmr && results.length > 0) {
      results = mmrRerank(results, {
        lambda: mmrLambda ?? 0.7,
        k: effectiveLimit
      });
    }
  } catch (error) {
    // FTS5 查询语法错误或表不存在时返回空结果，
    // 不中断调用方流程
  } finally {
    db.close();
  }

  return results;
}

/**
 * 增量索引更新：检查 repo_head 是否变化，如有变化则重建。
 *
 * 当前实现为简化版本：如果存储的 repo_head 与当前 HEAD 匹配，
 * 则跳过（返回 { skipped: true }）；否则执行全量重建。
 *
 * 这是 MVP 阶段的务实选择——在数百条记录的规模下，
 * 全量重建耗时不到一秒，增量 diff 的复杂性不值得。
 * 未来规模增长后可以在不改变 API 的情况下实现真正的增量更新。
 */
export function updateIndex(repoDir, cacheDir, options = {}) {
  const { logger, repoHead: explicitHead } = options;
  const head = explicitHead ?? getGitHead(repoDir);

  const status = getIndexStatus(cacheDir);

  // 索引尚未创建或 repo_head 缺失时回退到全量重建
  if (!status.exists || !status.repoHead) {
    logger?.('[mem-sync:index] update:fallback no prior index, performing full rebuild');
    const result = rebuildIndex(repoDir, cacheDir, options);
    return { rebuilt: true, recordCount: result.recordCount };
  }

  // repo_head 与当前 HEAD 一致，索引已是最新，跳过
  if (status.repoHead === head) {
    logger?.('[mem-sync:index] update:uptodate index already matches HEAD');
    return { skipped: true };
  }

  // repo_head 不匹配，执行全量重建
  logger?.('[mem-sync:index] update:fallback HEAD changed, performing full rebuild');
  const result = rebuildIndex(repoDir, cacheDir, options);
  return { rebuilt: true, recordCount: result.recordCount };
}

// ─── 同步文件 I/O 辅助函数（已在上方定义）──────────────────────────
// findJSONLFilesSync 使用同步 API 扫描 JSONL 文件，
// 与 better-sqlite3 的同步调用模型保持一致。
