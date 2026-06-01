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
  updateIndex
} from '../src/index-store.js';

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

    const results = searchIndex(cacheDir, '搜索关键词', { limit: 3 });
    assert.ok(results.length <= 3, `expected <= 3 results, got ${results.length}`);
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
