import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, setupMemSyncEnv, cleanupEnv, runCli } from './helpers.js';

test('show finds record by id in JSONL', () => {
  const record = makeRecord({ id: 'mem_showtest', content: '查找测试内容。' });
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: [record]
  });

  try {
    const result = runCli(env.dir, ['show', 'mem_showtest']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.id, 'mem_showtest');
    assert.equal(output.content, '查找测试内容。');
    assert.equal(output.scope, 'global');
    assert.equal(output.kind, 'episode');
  } finally {
    cleanupEnv(env);
  }
});

test('show finds record in pending', () => {
  const record = makeRecord({ id: 'mem_pending_show', content: '待合并查找。' });
  const env = setupMemSyncEnv({
    withPending: true,
    pendingRecords: [record]
  });

  try {
    const result = runCli(env.dir, ['show', 'mem_pending_show']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.id, 'mem_pending_show');
    assert.equal(output.content, '待合并查找。');
  } finally {
    cleanupEnv(env);
  }
});

test('show prefers JSONL over pending', () => {
  const jsonlRecord = makeRecord({ id: 'mem_duplicate', content: 'JSONL中的内容。' });
  const pendingRecord = makeRecord({ id: 'mem_duplicate', content: 'pending中的内容。' });

  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: [jsonlRecord],
    withPending: true,
    pendingRecords: [pendingRecord]
  });

  try {
    const result = runCli(env.dir, ['show', 'mem_duplicate']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.id, 'mem_duplicate');
    // Should find the JSONL record (searched first)
    assert.equal(output.content, 'JSONL中的内容。');
  } finally {
    cleanupEnv(env);
  }
});

test('show throws when id not found', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = runCli(env.dir, ['show', 'nonexistent']);

    assert.notEqual(result.status, 0, 'should exit non-zero when id not found');
    assert.match(result.stderr, /Memory not found/);
  } finally {
    cleanupEnv(env);
  }
});

test('show throws when no id provided', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = runCli(env.dir, ['show']);

    assert.notEqual(result.status, 0, 'should exit non-zero when no id provided');
    assert.match(result.stderr, /requires a memory id/);
  } finally {
    cleanupEnv(env);
  }
});
