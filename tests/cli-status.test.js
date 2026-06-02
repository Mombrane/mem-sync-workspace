import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, setupMemSyncEnv, cleanupEnv, runCli } from './helpers.js';

test('status reports repo state', () => {
  const records = [makeRecord({ id: 'mem_001', content: '状态测试。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['status']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());

    // Repo
    assert.equal(output.repo.initialized, true);
    assert.equal(typeof output.repo.head, 'string');
    assert.equal(output.repo.branch, 'main');

    // Remote
    assert.equal(output.remote.configured, false);

    // Pending
    assert.equal(typeof output.pending.files, 'number');
    assert.equal(typeof output.pending.records, 'number');

    // Index
    assert.equal(typeof output.index.exists, 'boolean');
    assert.equal(typeof output.index.records, 'number');

    // Rebase
    assert.equal(typeof output.rebaseInProgress, 'boolean');
    assert.equal(output.rebaseInProgress, false);
  } finally {
    cleanupEnv(env);
  }
});

test('status reports pending records count', () => {
  const existing = [makeRecord({ id: 'mem_existing', content: '已有记忆。' })];
  const pending = [
    makeRecord({ id: 'mem_pending_1', content: '待合并记忆一。' }),
    makeRecord({ id: 'mem_pending_2', content: '待合并记忆二。' })
  ];

  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: existing,
    withPending: true,
    pendingRecords: pending
  });

  try {
    const result = runCli(env.dir, ['status']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());

    assert.equal(output.pending.files, 1);
    assert.equal(output.pending.records, 2);
  } finally {
    cleanupEnv(env);
  }
});

test('status with remote configured', () => {
  const records = [makeRecord({ id: 'mem_001', content: '远程状态测试。' })];
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['status']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.remote.configured, true);
  } finally {
    cleanupEnv(env);
  }
});

test('status with index reports index status', () => {
  const records = [makeRecord({ id: 'mem_001', content: '索引状态测试。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records,
    withIndex: true
  });

  try {
    const result = runCli(env.dir, ['status']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.index.exists, true);
    assert.equal(output.index.records, 1);
    assert.equal(output.index.stale, false);
  } finally {
    cleanupEnv(env);
  }
});
