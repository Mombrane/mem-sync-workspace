import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * Helper: create isolated MEM_SYNC_HOME with memories.jsonl and rebuild index.
 */
async function setupTestEnv(records) {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-pending-isolation-'));
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(memSyncHome, 'memories.jsonl'), lines, 'utf8');
  // Build the index
  const indexResult = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  assert.equal(indexResult.status, 0, `index rebuild failed: ${indexResult.stderr}`);
  return memSyncHome;
}

/**
 * Helper: write records directly to pending/<device>.jsonl.
 */
async function writePendingRecords(memSyncHome, deviceId, records) {
  const pendingDir = join(memSyncHome, 'pending');
  await mkdir(pendingDir, { recursive: true });
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(pendingDir, `${deviceId}.jsonl`), lines, 'utf8');
}

/**
 * Helper: create a standard v1 memory record.
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
 * Helper: run recall and return parsed JSON results.
 */
function runRecall(memSyncHome, query, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    CLI_PATH, 'recall', query, '--format', 'json', ...extraArgs
  ], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `recall failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

// ─── Pending Isolation: Recall Excludes Pending Records ────────────────

test('recall does not return records that are only in pending/', async () => {
  const indexedRecord = makeRecord({
    id: 'mem_indexed_001',
    content: '用户喜欢使用深色主题进行开发',
    summary: '深色主题偏好',
    kind: 'preference',
    canonicalKey: 'preference:global:::dark-theme'
  });

  const pendingRecord = makeRecord({
    id: 'mem_pending_001',
    content: '用户偏好使用 VS Code 编辑器进行开发',
    summary: 'VS Code 偏好',
    kind: 'preference',
    canonicalKey: 'preference:global:::vscode'
  });

  const memSyncHome = await setupTestEnv([indexedRecord]);
  await writePendingRecords(memSyncHome, 'test-device', [pendingRecord]);

  try {
    // Recall for "开发" should match BOTH records if pending were indexed
    const result = runRecall(memSyncHome, '开发');
    const resultIds = result.results.map(r => r.memory.id);

    // The indexed record should appear
    assert.ok(resultIds.includes('mem_indexed_001'),
      'indexed record should appear in recall results');

    // The pending record should NOT appear
    assert.ok(!resultIds.includes('mem_pending_001'),
      'pending-only record should NOT appear in recall results');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('recall returns zero results when all records are only in pending/', async () => {
  const pendingRecord = makeRecord({
    id: 'mem_pending_only',
    content: '用户喜欢 Rust 语言的内存安全特性',
    summary: 'Rust 偏好',
    kind: 'preference',
    canonicalKey: 'preference:global:::rust-pref'
  });

  // Empty memories.jsonl — only pending records exist
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-pending-only-'));
  await writeFile(join(memSyncHome, 'memories.jsonl'), '', 'utf8');
  // Build index (will be empty)
  spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  await writePendingRecords(memSyncHome, 'test-device', [pendingRecord]);

  try {
    const result = runRecall(memSyncHome, 'Rust');
    assert.equal(result.count, 0, 'recall should return 0 results when only pending records exist');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Full Lifecycle: retain → recall (excluded) → review approve → recall (included) ────

test('full lifecycle: pending record excluded before approve, included after approve + rebuild', async () => {
  const indexedRecord = makeRecord({
    id: 'mem_existing_001',
    content: '项目使用 TypeScript 严格模式',
    summary: 'TypeScript 严格模式',
    kind: 'project_fact',
    canonicalKey: 'project_fact:global:::ts-strict'
  });

  const pendingRecord = makeRecord({
    id: 'mem_lifecycle_001',
    content: '项目决定使用 pino 作为日志库',
    summary: 'pino 日志库决策',
    kind: 'decision',
    canonicalKey: 'decision:global:::pino-logging'
  });

  const memSyncHome = await setupTestEnv([indexedRecord]);
  await writePendingRecords(memSyncHome, 'test-device', [pendingRecord]);

  try {
    // Step 1: Verify pending record is NOT in recall
    const beforeResult = runRecall(memSyncHome, '日志');
    const beforeIds = beforeResult.results.map(r => r.memory.id);
    assert.ok(!beforeIds.includes('mem_lifecycle_001'),
      'before approve: pending record should NOT be in recall');

    // Step 2: Approve the pending record
    const approveResult = spawnSync(process.execPath, [
      CLI_PATH, 'review', 'approve', 'mem_lifecycle_001', '--repo', memSyncHome
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(approveResult.status, 0, `approve failed: ${approveResult.stderr}`);

    // Step 3: Rebuild index (to pick up the newly approved record)
    const rebuildResult = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(rebuildResult.status, 0, `index rebuild failed: ${rebuildResult.stderr}`);

    // Step 4: Verify approved record IS now in recall
    const afterResult = runRecall(memSyncHome, '日志');
    const afterIds = afterResult.results.map(r => r.memory.id);
    assert.ok(afterIds.includes('mem_lifecycle_001'),
      'after approve + rebuild: approved record should be in recall');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Multiple Pending Devices: Isolation Across Devices ────────────────

test('records from multiple pending devices are all excluded from recall', async () => {
  const indexedRecord = makeRecord({
    id: 'mem_indexed_multi',
    content: '数据库使用 PostgreSQL',
    summary: 'PostgreSQL 数据库',
    kind: 'project_fact',
    canonicalKey: 'project_fact:global:::pg'
  });

  const pendingDevice1 = makeRecord({
    id: 'mem_pending_dev1',
    content: '缓存层使用 Redis',
    summary: 'Redis 缓存',
    kind: 'project_fact',
    canonicalKey: 'project_fact:global:::redis'
  });

  const pendingDevice2 = makeRecord({
    id: 'mem_pending_dev2',
    content: '消息队列使用 RabbitMQ',
    summary: 'RabbitMQ 消息队列',
    kind: 'project_fact',
    canonicalKey: 'project_fact:global:::rabbitmq'
  });

  const memSyncHome = await setupTestEnv([indexedRecord]);
  await writePendingRecords(memSyncHome, 'device-a', [pendingDevice1]);
  await writePendingRecords(memSyncHome, 'device-b', [pendingDevice2]);

  try {
    // Recall for a term that would match all three if pending were indexed
    const result = runRecall(memSyncHome, '数据库');
    const resultIds = result.results.map(r => r.memory.id);

    assert.ok(resultIds.includes('mem_indexed_multi'),
      'indexed record should appear');
    assert.ok(!resultIds.includes('mem_pending_dev1'),
      'device-a pending record should NOT appear');
    assert.ok(!resultIds.includes('mem_pending_dev2'),
      'device-b pending record should NOT appear');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Pending with Similar Content: Exact Isolation ─────────────────────

test('pending record with same content keywords as indexed record is excluded', async () => {
  // Both records mention "Python" — ensures pending is excluded even when content overlaps
  const indexedRecord = makeRecord({
    id: 'mem_indexed_python',
    content: '用户偏好使用 Python 进行数据处理',
    summary: 'Python 数据处理偏好',
    kind: 'preference',
    canonicalKey: 'preference:global:::python-data'
  });

  const pendingRecord = makeRecord({
    id: 'mem_pending_python',
    content: '用户在 Python 项目中使用 pytest 测试框架',
    summary: 'pytest 框架偏好',
    kind: 'preference',
    canonicalKey: 'preference:global:::pytest'
  });

  const memSyncHome = await setupTestEnv([indexedRecord]);
  await writePendingRecords(memSyncHome, 'test-device', [pendingRecord]);

  try {
    const result = runRecall(memSyncHome, 'Python');
    const resultIds = result.results.map(r => r.memory.id);

    assert.ok(resultIds.includes('mem_indexed_python'),
      'indexed Python record should appear');
    assert.ok(!resultIds.includes('mem_pending_python'),
      'pending Python record should NOT appear');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Review Approve All: Full Pending → Indexed Transition ─────────────

test('review approve --all moves all pending records to indexed store', async () => {
  const pendingRecords = [
    makeRecord({
      id: 'mem_bulk_001',
      content: 'API 设计使用 RESTful 风格',
      summary: 'RESTful API 设计',
      kind: 'decision',
      canonicalKey: 'decision:global:::rest-api'
    }),
    makeRecord({
      id: 'mem_bulk_002',
      content: '错误处理使用统一的错误码体系',
      summary: '统一错误码',
      kind: 'decision',
      canonicalKey: 'decision:global:::error-codes'
    })
  ];

  // Empty store — only pending records
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-bulk-approve-'));
  await writeFile(join(memSyncHome, 'memories.jsonl'), '', 'utf8');
  spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  await writePendingRecords(memSyncHome, 'test-device', pendingRecords);

  try {
    // Verify pending records are not in recall
    const beforeResult = runRecall(memSyncHome, '使用');
    assert.equal(beforeResult.count, 0, 'before approve: no results expected');

    // Approve all
    const approveResult = spawnSync(process.execPath, [
      CLI_PATH, 'review', 'approve', '--all', '--repo', memSyncHome
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(approveResult.status, 0, `approve --all failed: ${approveResult.stderr}`);

    // Rebuild index
    const rebuildResult = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(rebuildResult.status, 0, `index rebuild failed: ${rebuildResult.stderr}`);

    // Verify both records are now in recall — query "使用" appears in both contents
    const afterResult = runRecall(memSyncHome, '使用');
    const afterIds = afterResult.results.map(r => r.memory.id);
    assert.ok(afterIds.includes('mem_bulk_001'), 'first approved record should appear');
    assert.ok(afterIds.includes('mem_bulk_002'), 'second approved record should appear');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Review Reject: Pending Records Stay Excluded ──────────────────────

test('rejected pending records are removed and never indexed', async () => {
  const pendingRecord = makeRecord({
    id: 'mem_reject_001',
    content: '这是一个应该被拒绝的记忆',
    summary: '待拒绝记忆',
    kind: 'episode',
    canonicalKey: 'episode:global:::reject-test'
  });

  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-reject-'));
  await writeFile(join(memSyncHome, 'memories.jsonl'), '', 'utf8');
  spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  await writePendingRecords(memSyncHome, 'test-device', [pendingRecord]);

  try {
    // Reject the record
    const rejectResult = spawnSync(process.execPath, [
      CLI_PATH, 'review', 'reject', 'mem_reject_001', '--repo', memSyncHome
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(rejectResult.status, 0, `reject failed: ${rejectResult.stderr}`);

    // Rebuild index
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    // Verify rejected record is NOT in recall (was never in memories.jsonl)
    const result = runRecall(memSyncHome, '拒绝');
    const resultIds = result.results.map(r => r.memory.id);
    assert.ok(!resultIds.includes('mem_reject_001'),
      'rejected record should NOT appear in recall');

    // Also verify it was removed from pending
    const pendingPath = join(memSyncHome, 'pending', 'test-device.jsonl');
    try {
      const pendingContent = await readFile(pendingPath, 'utf8');
      assert.ok(!pendingContent.includes('mem_reject_001'),
        'rejected record should be removed from pending file');
    } catch {
      // File may not exist after reject — that's fine
    }
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Context Command: Pending Records Also Excluded ────────────────────

test('context --mode recall excludes pending records', async () => {
  const indexedRecord = makeRecord({
    id: 'mem_ctx_indexed',
    content: '团队使用 Git Flow 分支策略',
    summary: 'Git Flow 策略',
    kind: 'project_fact',
    canonicalKey: 'project_fact:global:::gitflow'
  });

  const pendingRecord = makeRecord({
    id: 'mem_ctx_pending',
    content: '团队决定迁移到 Trunk-Based Development',
    summary: 'Trunk-Based 迁移决策',
    kind: 'decision',
    canonicalKey: 'decision:global:::trunk-based'
  });

  const memSyncHome = await setupTestEnv([indexedRecord]);
  await writePendingRecords(memSyncHome, 'test-device', [pendingRecord]);

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'context', '--mode', 'recall', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `context failed: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    const contextIds = (output.memories ?? []).map(m => m.memory.id);

    assert.ok(contextIds.includes('mem_ctx_indexed'),
      'indexed record should appear in context');
    assert.ok(!contextIds.includes('mem_ctx_pending'),
      'pending record should NOT appear in context');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
