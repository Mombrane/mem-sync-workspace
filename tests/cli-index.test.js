import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
