import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQualityMultiplier } from './schema.js';

const DB_FILENAME = 'index.sqlite';

/**
 * Compute cosine similarity between two Float32Array vectors.
 * Returns a number in [-1, 1]. Returns 0 for zero-vectors.
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length.');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Convert Float32Array to Buffer for SQLite BLOB storage.
 * Uses safe form to avoid including extra bytes from underlying ArrayBuffer.
 */
export function float32ToBlob(vec) {
  return Buffer.from(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength));
}

/**
 * Convert Buffer (from SQLite BLOB) back to Float32Array.
 * Uses safe form accounting for Buffer's byteOffset and byteLength.
 */
export function blobToFloat32(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/**
 * Insert embeddings into the embeddings table.
 * Uses INSERT OR REPLACE wrapped in a transaction for performance.
 */
export function insertEmbeddings(db, memoryRowids, vectors, model, dimensions) {
  // Ensure the embeddings table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      memory_rowid INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO embeddings (memory_rowid, model, dimensions, vector, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  const insertAll = db.transaction((rowids, vecs) => {
    for (let i = 0; i < rowids.length; i++) {
      stmt.run(rowids[i], model, dimensions, float32ToBlob(vecs[i]), now);
    }
  });

  insertAll(memoryRowids, vectors);
}

/**
 * Query embeddings by memory rowids.
 * Returns Map<number, Float32Array> — rowid → vector.
 * Missing rowids are simply not in the map.
 */
export function queryEmbeddings(db, memoryRowids) {
  const result = new Map();

  if (memoryRowids.length === 0) return result;

  // Check if the embeddings table exists
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings';"
  ).get();

  if (!tableCheck) return result;

  const placeholders = memoryRowids.map(() => '?').join(', ');
  const stmt = db.prepare(
    `SELECT memory_rowid, vector FROM embeddings WHERE memory_rowid IN (${placeholders})`
  );

  const rows = stmt.all(...memoryRowids);
  for (const row of rows) {
    result.set(row.memory_rowid, blobToFloat32(row.vector));
  }

  return result;
}

/**
 * Compute a hybrid search score combining BM25 rank and cosine similarity.
 *
 * @param {number} bm25Rank — negative = better (from FTS5)
 * @param {number} cosineSim — [-1, 1]
 * @param {number} [weight=0.4] — weight for BM25 component [0, 1]
 * @returns {number}
 */
export function computeHybridScore(bm25Rank, cosineSim, weight = 0.4, qualityMultiplier = 1.0) {
  const bm25Component = 1 / (1 + Math.abs(bm25Rank));
  const cosineComponent = Math.max(0, cosineSim);
  return (weight * bm25Component + (1 - weight) * cosineComponent) * qualityMultiplier;
}

/**
 * Get embedding status from the index database.
 * Returns { count, model, dimensions, exists }.
 */
export function getEmbeddingStatus(cacheDir) {
  const dbPath = join(cacheDir, DB_FILENAME);

  if (!existsSync(dbPath)) {
    return { count: 0, model: null, dimensions: null, exists: false };
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  let count = 0;
  let model = null;
  let dimensions = null;
  let exists = true;

  try {
    // Check if embeddings table exists
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings';"
    ).get();

    if (!tableCheck) {
      exists = false;
    } else {
      // Count actual rows
      const countResult = db.prepare('SELECT COUNT(*) as count FROM embeddings;').get();
      count = countResult.count;

      // Read metadata from index_meta
      const modelResult = db.prepare(
        "SELECT value FROM index_meta WHERE key = 'embedding_model';"
      ).get();
      model = modelResult?.value ?? null;

      const dimResult = db.prepare(
        "SELECT value FROM index_meta WHERE key = 'embedding_dimensions';"
      ).get();
      dimensions = dimResult?.value ? Number(dimResult.value) : null;
    }
  } finally {
    db.close();
  }

  return { count, model, dimensions, exists };
}

/**
 * 计算两个字符串的字符三元组 Jaccard 相似度。
 *
 * 将每个字符串拆分为字符三元组集合，计算交集大小与并集大小的比值。
 * 用于 MMR 中近似衡量文档间的表面重叠度，作为无嵌入向量时的回退相似度。
 *
 * @param {string} textA - 第一个字符串（通常为 content+summary）
 * @param {string} textB - 第二个字符串
 * @returns {number} Jaccard 相似度，范围 [0, 1]
 */
export function trigramJaccard(textA, textB) {
  const a = textA ?? '';
  const b = textB ?? '';

  /** @type {Set<string>} */
  const trigramsA = new Set();
  /** @type {Set<string>} */
  const trigramsB = new Set();

  for (let i = 0; i <= a.length - 3; i++) {
    trigramsA.add(a.slice(i, i + 3));
  }
  for (let i = 0; i <= b.length - 3; i++) {
    trigramsB.add(b.slice(i, i + 3));
  }

  // 两个字符串都没有足够的字符生成三元组时，返回 0
  if (trigramsA.size === 0 && trigramsB.size === 0) return 0;

  // 计算交集大小
  let intersection = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) {
      intersection += 1;
    }
  }

  // 并集大小 = |A| + |B| - |A ∩ B|
  const union = trigramsA.size + trigramsB.size - intersection;

  return union === 0 ? 0 : intersection / union;
}

/**
 * 最大边际相关性（Maximal Marginal Relevance, MMR）重排序算法。
 *
 * 贪心迭代选择候选文档：第一个选择相关性最高的文档，
 * 后续文档最大化 λ·relevance(d) - (1-λ)·max(similarity(d, 已选文档))。
 * 平衡相关性和多样性，避免前 K 个结果在内容上过度重叠。
 *
 * @param {object[]} results - 已评分的搜索结果数组
 * @param {object} [options={}] - MMR 选项
 * @param {number} [options.lambda=0.7] - 相关性权重 λ ∈ [0, 1]
 * @param {number} [options.k] - 返回的最大结果数，默认为 results.length
 * @param {Map<number, Float32Array>} [options.embeddings] - rowid → 嵌入向量的映射，
 *   提供时使用余弦相似度，否则回退到 trigram Jaccard
 * @returns {object[]} 带有 _mmrScore 和 _mmrLambda 注释的重排序结果
 */
export function mmrRerank(results, options = {}) {
  const { lambda = 0.7, k = results.length, embeddings = null } = options;

  if (results.length === 0) return [];

  // 步骤 1：计算每条结果的相关性分数
  // _hybridScore 存在时直接使用（已在 [0, 1] 范围，越高越好）
  // 否则将 BM25 rank 归一化到 [0, 1]：更负的 rank 表示更匹配，
  // 使用 |rank| / (1 + |rank|) 映射到更高分数
  const relevance = results.map(r => {
    if (typeof r._hybridScore === 'number') {
      // _hybridScore already includes quality from searchIndexHybrid
      return r._hybridScore;
    }
    // BM25-only fallback: normalize rank and apply quality
    const absRank = Math.abs(r._rank ?? 0);
    const base = absRank / (1 + absRank);
    const quality = getQualityMultiplier(r);
    return base * quality;
  });

  // 步骤 2：辅助函数 — 计算两条结果之间的相似度
  function interDocSim(i, j) {
    if (embeddings) {
      const vecA = embeddings.get(results[i]._rowid);
      const vecB = embeddings.get(results[j]._rowid);
      if (vecA && vecB) {
        return cosineSimilarity(vecA, vecB);
      }
    }
    // 回退：trigram Jaccard
    const textA = (results[i].summary ?? '') + '\n' + (results[i].content ?? '');
    const textB = (results[j].summary ?? '') + '\n' + (results[j].content ?? '');
    return trigramJaccard(textA, textB);
  }

  // 步骤 3：贪心选择
  const remaining = results.map((_, i) => i);
  const selected = [];

  // 选择第一个：相关性最高
  const firstIdx = remaining.reduce((best, i) =>
    relevance[i] > relevance[best] ? i : best, 0);
  selected.push({ idx: firstIdx, mmrScore: relevance[firstIdx] });
  remaining.splice(remaining.indexOf(firstIdx), 1);

  // 迭代选择后续文档
  const effectiveK = Math.min(k, results.length);
  while (selected.length < effectiveK && remaining.length > 0) {
    let bestIdx = -1;
    let bestMmr = -Infinity;

    for (const i of remaining) {
      // 计算与所有已选中文档的最大相似度
      let maxSim = 0;
      for (const s of selected) {
        const sim = interDocSim(i, s.idx);
        if (sim > maxSim) maxSim = sim;
      }

      const mmr = lambda * relevance[i] - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push({ idx: bestIdx, mmrScore: bestMmr });
      remaining.splice(remaining.indexOf(bestIdx), 1);
    } else {
      break;
    }
  }

  // 步骤 4：按选择顺序构建结果，附加 _mmrScore 和 _mmrLambda
  return selected.map(s => {
    const record = { ...results[s.idx] };
    record._mmrScore = s.mmrScore;
    record._mmrLambda = lambda;
    return record;
  });
}
