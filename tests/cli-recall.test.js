import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：创建隔离的 MEM_SYNC_HOME 临时目录并写入 JSONL 测试数据。
 */
async function setupTestEnv(records) {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-recall-'));
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(memSyncHome, 'memories.jsonl'), lines, 'utf8');
  return memSyncHome;
}

/**
 * 辅助函数：创建标准的 v1 记忆记录。
 */
function makeRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? 'episode:global:::abc123',
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

/**
 * 辅助函数：在指定目录中创建索引（调用 CLI index rebuild）。
 */
function rebuildIndex(memSyncHome) {
  return spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
}

/**
 * 构建标准测试数据：4 条活跃记录，含不同 kind/scope/tags/confidence/importance。
 */
async function setupStandardIndex() {
  const records = [
    makeRecord({
      id: 'mem_001',
      content: 'Python 是常用的脚本语言，适合快速开发',
      summary: 'Python 脚本语言快速开发',
      kind: 'preference',
      scope: 'user',
      tags: ['python', 'language'],
      confidence: 1.0,
      importance: 0.8
    }),
    makeRecord({
      id: 'mem_002',
      content: 'JavaScript 用于前端开发，适合快速开发脚本',
      summary: 'JavaScript 前端开发快速脚本',
      kind: 'project_fact',
      scope: 'project',
      tags: ['javascript', 'frontend'],
      confidence: 0.9,
      importance: 0.7,
      projectId: 'myproject'
    }),
    makeRecord({
      id: 'mem_003',
      content: 'Rust 是系统编程语言，注重内存安全',
      summary: 'Rust 系统编程内存安全',
      kind: 'decision',
      scope: 'project',
      tags: ['rust', 'systems'],
      confidence: 0.7,
      importance: 0.9
    }),
    makeRecord({
      id: 'mem_004',
      content: 'TypeScript 严格模式开发提高代码质量',
      summary: 'TypeScript 严格模式代码质量',
      kind: 'decision',
      scope: 'project',
      tags: ['typescript', 'strict'],
      confidence: 0.5,
      importance: 0.6
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);
  return memSyncHome;
}

// ─── JSON 格式输出测试 ────────────────────────────────────────────────

test('recall with --format json returns valid JSON with query and results', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python 脚本', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.query, 'Python 脚本');
    assert.ok(output.count >= 1, 'should find at least 1 result');
    assert.ok(Array.isArray(output.results));
    assert.equal(typeof output.results[0].rank, 'number');
    assert.ok(typeof output.results[0].memory === 'object');
    assert.equal(output.results[0].memory.id, 'mem_001');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 默认 Markdown 格式测试 ──────────────────────────────────────────

test('recall with default format outputs readable markdown', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python 脚本'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 验证 Markdown 结构
    assert.match(result.stdout, /# Recall: "Python 脚本"/);
    assert.match(result.stdout, /## \d+\. \[preference\]/);
    assert.match(result.stdout, /\*\*Score:\*\*/);
    assert.match(result.stdout, /\*\*ID:\*\*/);
    assert.match(result.stdout, /\*\*Scope:\*\*/);
    assert.match(result.stdout, /^\> /m, 'should contain blockquoted content');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── memories 格式测试 ────────────────────────────────────────────────

test('recall with --format memories outputs agent prompt injection blocks', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python 脚本', '--format', 'memories'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 验证 memories 格式结构
    assert.match(result.stdout, /\[MEMORY /);
    assert.match(result.stdout, /id=mem_001/);
    assert.match(result.stdout, /rank=/);
    assert.match(result.stdout, /kind=preference/);
    assert.match(result.stdout, /scope=user/);
    assert.match(result.stdout, /\[\/MEMORY\]/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --limit 测试 ─────────────────────────────────────────────────────

test('recall with --limit respects the limit', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '脚本语言 OR 快速开发', '--limit', '1', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.count <= 1, `expected <= 1 results, got ${output.count}`);
    assert.ok(output.count > 0, 'should have at least 1 result');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --scope 过滤测试 ─────────────────────────────────────────────────

test('recall with --scope filters by scope', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '脚本语言 OR 快速开发', '--scope', 'user', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    // 只有 mem_001 的 scope 是 user
    assert.equal(output.count, 1);
    assert.equal(output.results[0].memory.scope, 'user');
    assert.equal(output.results[0].memory.id, 'mem_001');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --kind 过滤测试 ──────────────────────────────────────────────────

test('recall with --kind filters by kind', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '脚本语言 OR 快速开发', '--kind', 'preference', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    // 只有 mem_001 的 kind 是 preference
    assert.equal(output.count, 1);
    assert.equal(output.results[0].memory.kind, 'preference');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --tag 过滤测试（AND 语义）────────────────────────────────────────

test('recall with --tag filters by all tags (AND semantics)', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    // mem_003 has tags: ['rust', 'systems']
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '系统编程', '--tag', 'rust', '--tag', 'systems', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.count >= 1, 'should find record with both rust AND systems tags');
    assert.equal(output.results[0].memory.id, 'mem_003');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --min-confidence 阈值测试 ────────────────────────────────────────

test('recall with --min-confidence filters by confidence threshold', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '脚本语言 OR 快速开发', '--min-confidence', '0.8', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    // mem_001 (1.0) and mem_002 (0.9) pass threshold >= 0.8; mem_003 (0.7) and mem_004 (0.5) don't
    assert.ok(output.count >= 1, 'should have at least 1 result above threshold');
    for (const r of output.results) {
      assert.ok(r.memory.confidence >= 0.8, `record ${r.memory.id} confidence ${r.memory.confidence} should be >= 0.8`);
    }
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --min-importance 阈值测试 ────────────────────────────────────────

test('recall with --min-importance filters by importance threshold', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '脚本语言 OR 快速开发', '--min-importance', '0.8', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    // mem_001 (0.8) and mem_003 (0.9) pass threshold >= 0.8
    for (const r of output.results) {
      assert.ok(r.memory.importance >= 0.8, `record ${r.memory.id} importance ${r.memory.importance} should be >= 0.8`);
    }
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 无匹配结果测试 ───────────────────────────────────────────────────

test('recall with no matching query shows empty results message', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '不存在的查询XYZ123'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, 'empty results should still exit 0');
    assert.match(result.stdout, /No matching memories found/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 缺少查询错误测试 ─────────────────────────────────────────────────

test('recall with no query exits with code 1', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /query is required/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 无效格式错误测试 ─────────────────────────────────────────────────

test('recall with invalid --format exits with code 1', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python', '--format', 'invalid'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be one of/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 索引未构建测试 ───────────────────────────────────────────────────

test('recall with no index built shows index not built message', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-recall-noidx-'));

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, 'no index should still exit 0');
    assert.match(result.stdout, /Index not built/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --include-deleted 测试 ──────────────────────────────────────────

test('recall with --include-deleted includes soft-deleted records', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    // 手动插入已删除记录到索引数据库（rebuildIndex 会跳过它们）
    const dbPath = join(memSyncHome, '.cache', 'index.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    try {
      db.prepare(`
        INSERT INTO memories (id, kind, scope, content, summary, source_json, evidence_json,
          confidence, importance, veracity, tags_json, created_at, updated_at, deleted_at,
          supersedes_json, file_path, line_no, repo_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'mem_deleted', 'episode', 'global', '已删除的记忆内容测试', '已删除的记忆内容测试',
        '{}', '[]', 1.0, 0.5, 'stated', '[]',
        '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z',
        '[]', join(memSyncHome, 'memories.jsonl'), 10, 'deleted-test'
      );
      db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild');");
    } finally {
      db.close();
    }

    // 默认情况下不应包含已删除记录
    const defaultResult = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '已删除的记忆', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(defaultResult.status, 0);
    const defaultOutput = JSON.parse(defaultResult.stdout.trim());
    const hasDeleted = defaultOutput.results.some(r => r.memory.id === 'mem_deleted');
    assert.equal(hasDeleted, false, 'deleted records excluded by default');

    // --include-deleted 应包含已删除记录
    const includeResult = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '已删除的记忆', '--include-deleted', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(includeResult.status, 0);
    const includeOutput = JSON.parse(includeResult.stdout.trim());
    const foundDeleted = includeOutput.results.some(r => r.memory.id === 'mem_deleted');
    assert.ok(foundDeleted, 'deleted records included with --include-deleted');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --include-expired 测试 ──────────────────────────────────────────

test('recall with --include-expired includes expired records', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    // 手动插入已过期记录到索引数据库
    const dbPath = join(memSyncHome, '.cache', 'index.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    try {
      db.prepare(`
        INSERT INTO memories (id, kind, scope, content, summary, source_json, evidence_json,
          confidence, importance, veracity, tags_json, created_at, updated_at, valid_until,
          supersedes_json, file_path, line_no, repo_commit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'mem_expired', 'episode', 'global', '已过期的记忆内容测试', '已过期的记忆内容测试',
        '{}', '[]', 1.0, 0.5, 'stated', '[]',
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z',
        '[]', join(memSyncHome, 'memories.jsonl'), 10, 'expired-test'
      );
      db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild');");
    } finally {
      db.close();
    }

    // 默认情况下不应包含已过期记录
    const defaultResult = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '已过期的记忆', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(defaultResult.status, 0);
    const defaultOutput = JSON.parse(defaultResult.stdout.trim());
    const hasExpired = defaultOutput.results.some(r => r.memory.id === 'mem_expired');
    assert.equal(hasExpired, false, 'expired records excluded by default');

    // --include-expired 应包含已过期记录
    const includeResult = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '已过期的记忆', '--include-expired', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(includeResult.status, 0);
    const includeOutput = JSON.parse(includeResult.stdout.trim());
    const foundExpired = includeOutput.results.some(r => r.memory.id === 'mem_expired');
    assert.ok(foundExpired, 'expired records included with --include-expired');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── --project-id 过滤测试 ────────────────────────────────────────────

test('recall with --project-id filters by project', async () => {
  const memSyncHome = await setupStandardIndex();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '脚本语言 OR 快速开发', '--project-id', 'myproject', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.count >= 1, 'should find records with projectId=myproject');
    for (const r of output.results) {
      assert.equal(r.memory.projectId, 'myproject');
    }
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
