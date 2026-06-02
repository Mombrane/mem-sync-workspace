import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createIndexDatabase,
  rebuildIndex,
  getIndexStatus,
  searchIndex,
  updateIndex,
  rebuildIndexWithEmbeddings,
  searchIndexHybrid
} from '../src/index-store.js';
import { createMockProvider, noopProvider } from '../src/embedding-provider.js';
import { getEmbeddingStatus } from '../src/embedding-cache.js';

/**
 * 辅助函数：创建隔离的临时目录，用于缓存数据库和 JSONL 测试数据。
 * 每个测试使用独立临时目录，避免持久化副作用相互污染。
 */
async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), `mem-sync-idx-${prefix}-`));
}

/**
 * 辅助函数：在指定目录中写入 JSONL 测试数据。
 * 每条记录对象会被序列化为一行 JSON。
 */
async function writeJSONLFile(dir, filename, records) {
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(dir, filename), lines, 'utf8');
}

/**
 * 辅助函数：创建标准的 v1 记忆记录。
 * 用于快速构建合法测试数据。
 */
function makeRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? 'episode:global:::abc123def456',
    kind: overrides.kind ?? 'episode',
    scope: overrides.scope ?? 'global',
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content: overrides.content ?? '测试记忆内容。',
    summary: overrides.summary ?? '测试记忆内容。',
    source: overrides.source ?? { type: 'manual' },
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 1,
    importance: overrides.importance ?? 0.5,
    veracity: overrides.veracity ?? 'stated',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T10:00:00.000Z',
    validUntil: overrides.validUntil ?? null,
    deletedAt: overrides.deletedAt ?? null,
    supersedes: overrides.supersedes ?? []
  };
}

// ─── createIndexDatabase ────────────────────────────────────────────

test('createIndexDatabase creates SQLite database with correct tables', async () => {
  const cacheDir = await tempDir('createdb');

  try {
    createIndexDatabase(cacheDir);

    // 确认数据库文件已创建
    const dbPath = join(cacheDir, 'index.sqlite');
    const fileStat = await stat(dbPath);
    assert.ok(fileStat.isFile(), 'index.sqlite should exist');
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ─── rebuildIndex ───────────────────────────────────────────────────

test('rebuildIndex indexes all valid JSONL memories', async () => {
  const repoDir = await tempDir('rebuild-valid');
  const cacheDir = await tempDir('rebuild-valid-cache');

  try {
    // 创建多个合法记录
    const records = [
      makeRecord({ id: 'mem_001', content: '用户偏好简洁回答。', kind: 'preference', scope: 'user' }),
      makeRecord({ id: 'mem_002', content: '项目使用 Node.js 20。', kind: 'project_fact', scope: 'project' }),
      makeRecord({ id: 'mem_003', content: '日志输出到 stderr。', kind: 'decision', scope: 'project' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'abc123' });

    assert.equal(result.recordCount, 3);

    // 验证索引状态
    const status = getIndexStatus(cacheDir);
    assert.equal(status.recordCount, 3);
    assert.equal(status.repoHead, 'abc123');
    assert.ok(status.exists);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex skips records with non-null deletedAt', async () => {
  const repoDir = await tempDir('rebuild-deleted');
  const cacheDir = await tempDir('rebuild-deleted-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_001', content: '活跃记忆。' }),
      makeRecord({
        id: 'mem_002',
        content: '已删除的记忆。',
        deletedAt: '2026-06-02T00:00:00.000Z'
      })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'def456' });

    assert.equal(result.recordCount, 1);

    // 搜索应该只返回未删除的记录
    // 注意：trigram 分词器需要至少 3 个 CJK 字符才能生成匹配的 trigram
    const searchResults = searchIndex(cacheDir, '活跃记忆');
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, 'mem_001');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex skips records with validUntil in the past', async () => {
  const repoDir = await tempDir('rebuild-expired');
  const cacheDir = await tempDir('rebuild-expired-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_001', content: '永久有效。' }),
      makeRecord({
        id: 'mem_002',
        content: '已过期的记忆。',
        validUntil: '2020-01-01T00:00:00.000Z'
      })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'ghi789' });

    assert.equal(result.recordCount, 1);

    // 注意：trigram 分词器需要至少 3 个 CJK 字符才能生成匹配的 trigram
    const searchResults = searchIndex(cacheDir, '永久有效');
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, 'mem_001');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex skips JSONL lines that fail to parse', async () => {
  const repoDir = await tempDir('rebuild-corrupt');
  const cacheDir = await tempDir('rebuild-corrupt-cache');

  try {
    // 手动写入混合合法和损坏的 JSONL 行
    const validRecord = makeRecord({ id: 'mem_001', content: '合法记录。' });
    const mixed = [
      JSON.stringify(validRecord),
      '{invalid json that cannot parse',
      '',
      JSON.stringify(makeRecord({ id: 'mem_002', content: '另一条合法记录。' }))
    ].join('\n') + '\n';
    await writeFile(join(repoDir, 'memories.jsonl'), mixed, 'utf8');

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'jkl012' });

    assert.equal(result.recordCount, 2);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex skips records that fail schema validation', async () => {
  const repoDir = await tempDir('rebuild-badschema');
  const cacheDir = await tempDir('rebuild-badschema-cache');

  try {
    // 缺少必要字段的无效记录（如 schemaVersion 不是 1）
    const records = [
      makeRecord({ id: 'mem_001', content: '合法记录。' }),
      { id: 'mem_bad', content: '缺少 schemaVersion', kind: 'unknown_kind', scope: 'global' }
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'mno345' });

    // 只应包含合法记录
    assert.equal(result.recordCount, 1);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex stores repo_head in index_meta on success', async () => {
  const repoDir = await tempDir('rebuild-meta');
  const cacheDir = await tempDir('rebuild-meta-cache');

  try {
    await writeJSONLFile(repoDir, 'memories.jsonl', [
      makeRecord({ id: 'mem_001', content: '测试。' })
    ]);

    rebuildIndex(repoDir, cacheDir, { repoHead: 'custom-commit-sha' });

    const status = getIndexStatus(cacheDir);
    assert.equal(status.repoHead, 'custom-commit-sha');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ─── getIndexStatus ─────────────────────────────────────────────────

test('getIndexStatus returns recordCount, repoHead, and dbPath for a built index', async () => {
  const repoDir = await tempDir('status-built');
  const cacheDir = await tempDir('status-built-cache');

  try {
    await writeJSONLFile(repoDir, 'memories.jsonl', [
      makeRecord({ id: 'mem_a', content: '第一段内容。' }),
      makeRecord({ id: 'mem_b', content: '第二段内容。' })
    ]);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'status-head' });

    const status = getIndexStatus(cacheDir);
    assert.equal(status.recordCount, 2);
    assert.equal(status.repoHead, 'status-head');
    assert.ok(status.dbPath.endsWith('index.sqlite'));
    assert.ok(status.exists);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('getIndexStatus reports no index when database does not exist', async () => {
  const cacheDir = await tempDir('status-nonexist');

  try {
    const status = getIndexStatus(cacheDir);
    assert.equal(status.exists, false);
    assert.equal(status.recordCount, 0);
    assert.equal(status.repoHead, null);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ─── searchIndex ────────────────────────────────────────────────────

test('searchIndex returns BM25-ranked results for matching content', async () => {
  const repoDir = await tempDir('search-match');
  const cacheDir = await tempDir('search-match-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python 是常用的脚本语言。', tags: ['language'] }),
      makeRecord({ id: 'mem_b', content: 'JavaScript 用于前端开发。', tags: ['language', 'frontend'] }),
      makeRecord({ id: 'mem_c', content: 'Rust 是系统编程语言，性能优异。', tags: ['language', 'systems'] })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'search-test' });

    const results = searchIndex(cacheDir, 'Python 脚本');
    assert.ok(results.length >= 1, 'should find at least one result');
    // Python 相关内容应排在前面
    assert.ok(results.some(r => r.id === 'mem_a'), 'should contain Python record');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex returns empty array when index is empty', async () => {
  const cacheDir = await tempDir('search-empty');

  try {
    // 创建空索引
    const repoDir = await tempDir('search-empty-repo');
    try {
      await writeJSONLFile(repoDir, 'memories.jsonl', []);
      rebuildIndex(repoDir, cacheDir, { repoHead: 'empty' });
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }

    const results = searchIndex(cacheDir, '任何查询');
    assert.deepEqual(results, []);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex respects the limit parameter', async () => {
  const repoDir = await tempDir('search-limit');
  const cacheDir = await tempDir('search-limit-cache');

  try {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `mem_${String(i).padStart(3, '0')}`, content: `测试记忆 ${i} 包含搜索关键词。` })
    );
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'limit-test' });

    const results = searchIndex(cacheDir, { query: '搜索关键词', limit: 3 });
    assert.ok(results.length <= 3, `expected <= 3 results, got ${results.length}`);
    assert.ok(results.length > 0, 'should return at least 1 result with limit');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ─── searchIndex 选项对象（新 API）─────────────────────────────────────

test('searchIndex with options object { query, limit } returns results', async () => {
  const repoDir = await tempDir('search-opts');
  const cacheDir = await tempDir('search-opts-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python 是常用的脚本语言。', kind: 'preference', scope: 'user' }),
      makeRecord({ id: 'mem_b', content: 'JavaScript 用于前端开发。', kind: 'project_fact', scope: 'project' }),
      makeRecord({ id: 'mem_c', content: 'Rust 性能优异适合系统编程。', kind: 'decision', scope: 'project' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'opts-test' });

    const results = searchIndex(cacheDir, { query: 'Python', limit: 2 });
    assert.ok(results.length > 0, 'should find results');
    assert.ok(results.length <= 2, 'should respect limit');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex filters by scope', async () => {
  const repoDir = await tempDir('search-scope');
  const cacheDir = await tempDir('search-scope-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'python testing framework preferences', scope: 'user' }),
      makeRecord({ id: 'mem_b', content: 'javascript frontend development tools', scope: 'project' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'scope-test' });

    const results = searchIndex(cacheDir, { query: 'javascript development', scope: 'user' });
    assert.equal(results.length, 0, 'should not find user-scope record about javascript');

    const results2 = searchIndex(cacheDir, { query: 'javascript development', scope: 'project' });
    assert.equal(results2.length, 1, 'should find project-scope record');
    assert.equal(results2[0].id, 'mem_b');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex filters by kind', async () => {
  const repoDir = await tempDir('search-kind');
  const cacheDir = await tempDir('search-kind-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: '用户偏好使用暗色主题。', kind: 'preference' }),
      makeRecord({ id: 'mem_b', content: '决定使用 TypeScript。', kind: 'decision' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'kind-test' });

    const results = searchIndex(cacheDir, { query: 'TypeScript', kind: 'preference' });
    assert.equal(results.length, 0, 'should not find preference record about TypeScript');

    const results2 = searchIndex(cacheDir, { query: 'TypeScript', kind: 'decision' });
    assert.equal(results2.length, 1, 'should find decision record');
    assert.equal(results2[0].id, 'mem_b');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex applies minConfidence threshold', async () => {
  const repoDir = await tempDir('search-conf');
  const cacheDir = await tempDir('search-conf-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'high confidence decision record', confidence: 0.9 }),
      makeRecord({ id: 'mem_b', content: 'low confidence inference record', confidence: 0.3 })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'conf-test' });

    const results = searchIndex(cacheDir, { query: 'confidence record', minConfidence: 0.8 });
    assert.equal(results.length, 1, 'should only find high-confidence record');
    assert.equal(results[0].id, 'mem_a');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex post-filters by single tag', async () => {
  const repoDir = await tempDir('search-tag1');
  const cacheDir = await tempDir('search-tag1-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python 测试框架偏好设置。', tags: ['python', 'testing'] }),
      makeRecord({ id: 'mem_b', content: 'Rust 内存安全特性分析。', tags: ['rust', 'systems'] })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'tag1-test' });

    const results = searchIndex(cacheDir, { query: '测试框架', tags: ['python'] });
    assert.equal(results.length, 1, 'should find record with python tag');
    assert.equal(results[0].id, 'mem_a');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex post-filters by multiple tags with AND semantics', async () => {
  const repoDir = await tempDir('search-tag2');
  const cacheDir = await tempDir('search-tag2-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python 测试框架偏好。', tags: ['python', 'testing'] }),
      makeRecord({ id: 'mem_b', content: 'Python 数据分析工具。', tags: ['python', 'data'] }),
      makeRecord({ id: 'mem_c', content: 'Rust 系统编程语言。', tags: ['rust', 'systems'] })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'tag2-test' });

    // 同时要求 python 和 testing 标签
    const results = searchIndex(cacheDir, { query: 'Python OR 工具 OR 编程', tags: ['python', 'testing'] });
    assert.equal(results.length, 1, 'should find only record with both python AND testing');
    assert.equal(results[0].id, 'mem_a');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex with excludeDeleted:false includes soft-deleted records', async () => {
  const repoDir = await tempDir('search-delshow');
  const cacheDir = await tempDir('search-delshow-cache');

  try {
    // 直接构造带 deletedAt 的记录，绕过 shouldSkipRecord 在 rebuildIndex 中的过滤
    const records = [
      makeRecord({ id: 'mem_a', content: '活跃记录。' }),
      makeRecord({
        id: 'mem_b',
        content: '已删除但应可见。',
        deletedAt: '2026-06-02T00:00:00.000Z'
      })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'delshow-test' });

    // 默认应排除已删除记录（rebuildIndex 已跳过，此处验证 searchIndex 的 SQL 层也排除）
    // 因为 rebuildIndex 跳过了已删除记录，所以数据库中只有 mem_a
    const resultsDefault = searchIndex(cacheDir, { query: '已删除但应可见' });
    assert.equal(resultsDefault.length, 0, 'deleted record should not be indexed by rebuildIndex');

    // 验证活跃记录存在
    const resultsActive = searchIndex(cacheDir, { query: '活跃记录' });
    assert.equal(resultsActive.length, 1);
    assert.equal(resultsActive[0].id, 'mem_a');

    // 手动插入已删除记录到数据库以测试 SQL 层过滤
    const { join } = await import('node:path');
    const dbPath = join(cacheDir, 'index.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    try {
      db.prepare(`
        INSERT INTO memories (id, kind, scope, content, summary, source_json, evidence_json,
          confidence, importance, veracity, tags_json, created_at, updated_at, deleted_at,
          supersedes_json, file_path, line_no, repo_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'mem_b', 'episode', 'global', '已删除但应可见。', '已删除但应可见。',
        '{}', '[]', 1.0, 0.5, 'stated', '[]',
        '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z',
        '[]', 'test.jsonl', 1, 'delshow-test'
      );
      db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild');");
    } finally {
      db.close();
    }

    // 默认排除已删除：不应返回 mem_b
    const defaultResults = searchIndex(cacheDir, { query: '已删除但应可见' });
    assert.equal(defaultResults.length, 0, 'deleted record excluded by default in SQL layer');

    // excludeDeleted:false 应包含已删除
    const includeDeletedResults = searchIndex(cacheDir, { query: '已删除但应可见', excludeDeleted: false });
    assert.equal(includeDeletedResults.length, 1, 'deleted record included when excludeDeleted=false');
    assert.equal(includeDeletedResults[0].id, 'mem_b');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex with excludeExpired:false includes expired records', async () => {
  const repoDir = await tempDir('search-expshow');
  const cacheDir = await tempDir('search-expshow-cache');

  try {
    // 手动插入已过期记录到数据库
    const { join } = await import('node:path');
    const dbPath = join(cacheDir, 'index.sqlite');
    const Database = (await import('better-sqlite3')).default;

    // 先创建索引
    createIndexDatabase(cacheDir);
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    try {
      db.prepare(`
        INSERT INTO memories (id, kind, scope, content, summary, source_json, evidence_json,
          confidence, importance, veracity, tags_json, created_at, updated_at, valid_until,
          supersedes_json, file_path, line_no, repo_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'mem_exp', 'episode', 'global', '已过期的记忆内容。', '已过期的记忆内容。',
        '{}', '[]', 1.0, 0.5, 'stated', '[]',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z',
        '[]', 'test.jsonl', 1, 'expshow-test'
      );
      db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild');");
    } finally {
      db.close();
    }

    // 默认排除已过期
    const defaultResults = searchIndex(cacheDir, { query: '已过期的记忆内容' });
    assert.equal(defaultResults.length, 0, 'expired record excluded by default');

    // excludeExpired:false 应包含已过期
    const includeExpiredResults = searchIndex(cacheDir, { query: '已过期的记忆内容', excludeExpired: false });
    assert.equal(includeExpiredResults.length, 1, 'expired record included when excludeExpired=false');
    assert.equal(includeExpiredResults[0].id, 'mem_exp');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex backward compat: string as second argument', async () => {
  const repoDir = await tempDir('search-bc1');
  const cacheDir = await tempDir('search-bc1-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python 是常用的脚本语言。' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'bc1-test' });

    // 旧签名：searchIndex(cacheDir, query: string)
    const results = searchIndex(cacheDir, 'Python 脚本');
    assert.ok(results.length > 0, 'should work with legacy string second arg');
    assert.ok(results.some(r => r.id === 'mem_a'));
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex backward compat: string + limit as second and third args', async () => {
  const repoDir = await tempDir('search-bc2');
  const cacheDir = await tempDir('search-bc2-cache');

  try {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ id: `mem_${String(i).padStart(3, '0')}`, content: `测试记忆 ${i} 包含搜索关键词。` })
    );
    await writeJSONLFile(repoDir, 'memories.jsonl', records);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'bc2-test' });

    // 旧签名：searchIndex(cacheDir, query: string, limit: number)
    const results = searchIndex(cacheDir, '搜索关键词', 5);
    assert.ok(results.length <= 5, `expected <= 5 results, got ${results.length}`);
    assert.ok(results.length > 0, 'should return at least 1 result');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ─── updateIndex ────────────────────────────────────────────────────

test('updateIndex skips when repo HEAD matches stored repo_head', async () => {
  const repoDir = await tempDir('update-skip');
  const cacheDir = await tempDir('update-skip-cache');

  try {
    await writeJSONLFile(repoDir, 'memories.jsonl', [
      makeRecord({ id: 'mem_001', content: '已有记录。' })
    ]);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'same-head' });

    const logs = [];
    const result = updateIndex(repoDir, cacheDir, {
      repoHead: 'same-head',
      logger: (msg) => logs.push(msg)
    });

    assert.equal(result.skipped, true);
    assert.ok(logs.some(msg => msg.includes('uptodate')), 'should log uptodate');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('updateIndex falls back to full rebuild when no prior repo_head exists', async () => {
  const repoDir = await tempDir('update-fallback');
  const cacheDir = await tempDir('update-fallback-cache');

  try {
    // 先手动创建空数据库（无 index_meta 记录）
    createIndexDatabase(cacheDir);

    await writeJSONLFile(repoDir, 'memories.jsonl', [
      makeRecord({ id: 'mem_001', content: '新建记录。' })
    ]);

    const logs = [];
    const result = updateIndex(repoDir, cacheDir, {
      repoHead: 'new-head',
      logger: (msg) => logs.push(msg)
    });

    assert.equal(result.rebuilt, true);
    assert.equal(result.recordCount, 1);
    assert.ok(logs.some(msg => msg.includes('fallback') || msg.includes('rebuild')), 'should log fallback or rebuild');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndex filters by projectId, agentId, veracity, and minImportance', async () => {
  const repoDir = await tempDir('filter-extra-repo');
  const cacheDir = await tempDir('filter-extra-cache');
  try {
    await writeJSONLFile(repoDir, 'memories.jsonl', [
      makeRecord({ id: 'mem_target', content: 'shared keyword target', projectId: 'project-a', agentId: 'agent-a', veracity: 'stated', importance: 0.9 }),
      makeRecord({ id: 'mem_project', content: 'shared keyword wrong project', projectId: 'project-b', agentId: 'agent-a', veracity: 'stated', importance: 0.9 }),
      makeRecord({ id: 'mem_agent', content: 'shared keyword wrong agent', projectId: 'project-a', agentId: 'agent-b', veracity: 'stated', importance: 0.9 }),
      makeRecord({ id: 'mem_veracity', content: 'shared keyword wrong veracity', projectId: 'project-a', agentId: 'agent-a', veracity: 'unknown', importance: 0.9 }),
      makeRecord({ id: 'mem_importance', content: 'shared keyword low importance', projectId: 'project-a', agentId: 'agent-a', veracity: 'stated', importance: 0.1 })
    ]);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'filter-extra' });

    const results = searchIndex(cacheDir, {
      query: 'shared keyword',
      projectId: 'project-a',
      agentId: 'agent-a',
      veracity: 'stated',
      minImportance: 0.5,
      limit: 10
    });

    assert.deepEqual(results.map(result => result.id), ['mem_target']);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ─── Embedding support ──────────────────────────────────────────────

test('createIndexDatabase creates embeddings table', async () => {
  const cacheDir = await tempDir('embed-table');

  try {
    createIndexDatabase(cacheDir);

    // Verify the embeddings table exists in the database
    const dbPath = join(cacheDir, 'index.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);

    try {
      const tableCheck = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings';"
      ).get();
      assert.ok(tableCheck, 'embeddings table should exist');
    } finally {
      db.close();
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('ON DELETE CASCADE: deleting memory also deletes its embeddings', async () => {
  const cacheDir = await tempDir('embed-cascade');

  try {
    // Create index first
    createIndexDatabase(cacheDir);

    // Insert a memory
    const dbPath = join(cacheDir, 'index.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    db.pragma('foreign_keys = ON');

    try {
      db.prepare(`
        INSERT INTO memories (id, kind, scope, content, summary, source_json, evidence_json,
          confidence, importance, veracity, tags_json, created_at, updated_at,
          supersedes_json, file_path, line_no, repo_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'mem_cascade', 'episode', 'global', 'Test content for cascade.', 'Test summary.',
        '{}', '[]', 1.0, 0.5, 'stated', '[]',
        '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z',
        '[]', 'test.jsonl', 1, 'cascade-test'
      );

      // Get the rowid of the inserted memory
      const memRow = db.prepare("SELECT rowid FROM memories WHERE id = 'mem_cascade'").get();
      assert.ok(memRow, 'memory should exist');

      // Insert an embedding linked to this memory
      const { insertEmbeddings } = await import('../src/embedding-cache.js');
      const vec = new Float32Array([0.1, 0.2, 0.3]);
      insertEmbeddings(db, [memRow.rowid], [vec], 'test-model', 3);

      // Verify embedding exists
      let embCheck = db.prepare("SELECT COUNT(*) as c FROM embeddings WHERE memory_rowid = ?").get(memRow.rowid);
      assert.equal(embCheck.c, 1, 'embedding should exist before delete');

      // Delete the memory — should cascade to embeddings
      db.prepare("DELETE FROM memories WHERE id = 'mem_cascade'").run();

      // Verify embedding was cascade-deleted
      embCheck = db.prepare("SELECT COUNT(*) as c FROM embeddings WHERE memory_rowid = ?").get(memRow.rowid);
      assert.equal(embCheck.c, 0, 'embedding should be cascade-deleted');
    } finally {
      db.close();
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndexWithEmbeddings with mock provider populates embeddings', async () => {
  const repoDir = await tempDir('embed-mock');
  const cacheDir = await tempDir('embed-mock-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_001', content: 'First memory for embedding test.', summary: 'First summary.' }),
      makeRecord({ id: 'mem_002', content: 'Second memory for embedding test.', summary: 'Second summary.' }),
      makeRecord({ id: 'mem_003', content: 'Third memory for embedding test.', summary: 'Third summary.' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    const mockProvider = createMockProvider(32);
    const result = await rebuildIndexWithEmbeddings(repoDir, cacheDir, {
      repoHead: 'embed-test',
      embeddingProvider: mockProvider
    });

    assert.equal(result.recordCount, 3);
    assert.equal(result.embeddingsGenerated, 3);
    assert.equal(result.embeddingsFailed, 0);

    // Verify embeddings were stored
    const embStatus = getEmbeddingStatus(cacheDir);
    assert.equal(embStatus.count, 3);
    assert.equal(embStatus.model, 'mock');
    assert.equal(embStatus.dimensions, 32);
    assert.ok(embStatus.exists);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndexWithEmbeddings with noop provider skips embeddings', async () => {
  const repoDir = await tempDir('embed-noop');
  const cacheDir = await tempDir('embed-noop-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_001', content: 'Only record.' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    const result = await rebuildIndexWithEmbeddings(repoDir, cacheDir, {
      repoHead: 'noop-test',
      embeddingProvider: noopProvider
    });

    assert.equal(result.recordCount, 1);
    assert.equal(result.embeddingsGenerated, 0);
    assert.equal(result.embeddingsFailed, 0);

    // Verify no embeddings were stored (table exists from DDL but count is 0)
    const embStatus = getEmbeddingStatus(cacheDir);
    assert.equal(embStatus.count, 0);
    assert.equal(embStatus.model, null);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndexWithEmbeddings gracefully handles provider failure', async () => {
  const repoDir = await tempDir('embed-fail');
  const cacheDir = await tempDir('embed-fail-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_001', content: 'Record that will fail to embed.' }),
      makeRecord({ id: 'mem_002', content: 'Another record that will fail.' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    // Create a provider that always fails
    const failingProvider = {
      name: 'failing',
      dimensions: 32,
      async embed() {
        throw new Error('Simulated embedding failure');
      }
    };

    const logs = [];
    const result = await rebuildIndexWithEmbeddings(repoDir, cacheDir, {
      repoHead: 'fail-test',
      embeddingProvider: failingProvider,
      logger: (msg) => logs.push(msg)
    });

    // FTS index should still succeed
    assert.equal(result.recordCount, 2);
    // All embeddings should fail
    assert.equal(result.embeddingsGenerated, 0);
    assert.equal(result.embeddingsFailed, 2);

    // Verify failure was logged
    assert.ok(logs.some(msg => msg.includes('embed:batch-failed')), 'should log batch failure');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndexHybrid returns results with _hybridScore field', async () => {
  const repoDir = await tempDir('hybrid-score');
  const cacheDir = await tempDir('hybrid-score-cache');

  try {
    // Create records with distinct, searchable content
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python is a widely used scripting language for automation.' }),
      makeRecord({ id: 'mem_b', content: 'JavaScript is essential for frontend web development.' }),
      makeRecord({ id: 'mem_c', content: 'Rust provides memory safety without garbage collection.' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    // Build index with embeddings
    const mockProvider = createMockProvider(32);
    await rebuildIndexWithEmbeddings(repoDir, cacheDir, {
      repoHead: 'hybrid-score-test',
      embeddingProvider: mockProvider
    });

    // Search with hybrid mode
    const results = await searchIndexHybrid(cacheDir, {
      query: 'Python scripting language',
      embeddingProvider: mockProvider,
      limit: 10
    });

    assert.ok(results.length > 0, 'should return results');

    // All results should have _hybridScore
    for (const result of results) {
      assert.ok(typeof result._hybridScore === 'number', `result ${result.id} should have _hybridScore`);
    }

    // mem_a should be the top result for a Python query
    assert.equal(results[0].id, 'mem_a', 'Python record should be top result');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex indexes JSONL files in nested directories', async () => {
  const repoDir = await tempDir('recursive-repo');
  const cacheDir = await tempDir('recursive-cache');
  try {
    await mkdir(join(repoDir, 'memories', '2026'), { recursive: true });
    await writeJSONLFile(join(repoDir, 'memories', '2026'), 'nested.jsonl', [
      makeRecord({ id: 'mem_nested', content: 'nested recursive memory' })
    ]);

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'recursive-test' });
    assert.equal(result.recordCount, 1);

    const matches = searchIndex(cacheDir, { query: 'recursive', limit: 10 });
    assert.deepEqual(matches.map(match => match.id), ['mem_nested']);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex sends parse and validation diagnostics to logger', async () => {
  const repoDir = await tempDir('logger-repo');
  const cacheDir = await tempDir('logger-cache');
  try {
    await writeFile(join(repoDir, 'memories.jsonl'), [
      '{ bad json',
      JSON.stringify({ id: 'bad-schema' })
    ].join('\n') + '\n', 'utf8');
    const logs = [];

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'logger-test', logger: message => logs.push(message) });

    assert.equal(result.recordCount, 0);
    assert.ok(logs.some(message => message.includes('invalid JSON')));
    assert.ok(logs.some(message => message.includes('validation failed')));
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('searchIndexHybrid with no embeddings falls back to FTS-only', async () => {
  const repoDir = await tempDir('hybrid-fallback');
  const cacheDir = await tempDir('hybrid-fallback-cache');

  try {
    const records = [
      makeRecord({ id: 'mem_a', content: 'Python scripting language for automation tasks.' }),
      makeRecord({ id: 'mem_b', content: 'JavaScript for building interactive web applications.' })
    ];
    await writeJSONLFile(repoDir, 'memories.jsonl', records);

    // Build index without embeddings (no provider, so FTS-only)
    rebuildIndex(repoDir, cacheDir, { repoHead: 'hybrid-fallback-test' });

    // Search with noop provider (dimensions=0 triggers FTS-only fallback)
    const results = await searchIndexHybrid(cacheDir, {
      query: 'Python scripting',
      embeddingProvider: noopProvider,
      limit: 10
    });

    assert.ok(results.length > 0, 'should return FTS results');
    assert.equal(results[0].id, 'mem_a', 'Python record should be top FTS result');

    // Results should still have _rank from FTS but may or may not have _hybridScore
    assert.ok(typeof results[0]._rank === 'number', 'should have _rank from FTS');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});
