import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { insertEmbeddings } from '../src/embedding-cache.js';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：创建临时 MEM_SYNC_HOME 目录并写入 JSONL 测试数据。
 */
async function setupTestEnv(records) {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-index-'));
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

// ─── index rebuild ────────────────────────────────────────────────────

test('index rebuild creates index and outputs { indexed: N }', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: '第一条记忆。' }),
    makeRecord({ id: 'mem_002', content: '第二条记忆。' })
  ]);

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.indexed, 2);
    // 诊断日志应输出到 stderr
    assert.match(result.stderr, /rebuild/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('index rebuild handles empty repo directory', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-index-empty-'));

  try {
    // 不创建任何 JSONL 文件
    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.indexed, 0);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── index status ─────────────────────────────────────────────────────

test('index status outputs JSON with --format json', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: '状态测试内容。' })
  ]);

  try {
    // 先构建索引
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'status', '--format', 'json'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.recordCount, 1);
    assert.equal(output.exists, true);
    assert.ok(typeof output.dbPath === 'string');
    assert.ok(output.dbPath.endsWith('index.sqlite'));
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('index status reports no index when not built', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-index-noidx-'));

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'status', '--format', 'json'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.exists, false);
    assert.equal(output.recordCount, 0);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── index update ─────────────────────────────────────────────────────

test('index update performs rebuild when index does not exist', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: '更新测试内容。' })
  ]);

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'update'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    // rebuild 时返回 { rebuilt: true, recordCount: N }
    assert.equal(output.rebuilt, true);
    assert.equal(output.recordCount, 1);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('index update skips when already up to date', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: '跳过测试内容。' })
  ]);

  try {
    // 先构建索引
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    // 再次更新应跳过（repo_head 未变化，因为都不是 git 仓库，HEAD 都是 'unknown'）
    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'update'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.skipped, true);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── index status embedding cache ──────────────────────────────────────

test('status shows embedding cache info when embeddings exist', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: 'embedding test record.' })
  ]);

  try {
    // Build index
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    // Insert embeddings directly into the SQLite database
    const dbPath = join(memSyncHome, '.cache', 'index.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');

    // Insert a row into memories table so we have a valid rowid
    const memRow = db.prepare('SELECT rowid FROM memories LIMIT 1').get();
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    insertEmbeddings(db, [memRow.rowid], [vec], 'test-model', 3);

    // Store metadata
    db.exec(`CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT)`);
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('embedding_model', 'test-model')").run();
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('embedding_dimensions', '3')").run();
    db.close();

    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'status', '--format', 'json'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.embeddingCache, 'should have embeddingCache field');
    assert.equal(output.embeddingCache.exists, true);
    assert.equal(output.embeddingCache.count, 1);
    assert.equal(output.embeddingCache.model, 'test-model');
    assert.equal(output.embeddingCache.dimensions, 3);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('status shows "empty" when embeddings table exists but has no rows', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: 'empty embedding test.' })
  ]);

  try {
    // Build index
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    // Create the embeddings table without inserting any rows
    const dbPath = join(memSyncHome, '.cache', 'index.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        memory_rowid INTEGER PRIMARY KEY,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.close();

    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'status'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Embedding Cache: empty/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('status shows "not created" when no embeddings table', async () => {
  const memSyncHome = await setupTestEnv([
    makeRecord({ id: 'mem_001', content: 'no embedding test.' })
  ]);

  try {
    // Build index then drop the embeddings table to simulate "not created"
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    const dbPath = join(memSyncHome, '.cache', 'index.sqlite');
    const db = new Database(dbPath);
    db.pragma('journal_mode=WAL');
    db.exec('DROP TABLE IF EXISTS embeddings');
    db.close();

    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'status'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Embedding Cache: not created/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
