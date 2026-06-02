import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeRecord, setupMemSyncEnv, cleanupEnv, runCli } from './helpers.js';

test('forget soft-deletes record from JSONL', () => {
  const record = makeRecord({ id: 'mem_to_forget', content: '即将被遗忘的内容。' });
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: [record]
  });

  try {
    const result = runCli(env.dir, ['forget', 'mem_to_forget']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.forgotten, 'mem_to_forget');
    assert.equal(output.action, 'soft-deleted');

    // Verify the record has deletedAt set
    const jsonlPath = join(env.dir, 'memories.jsonl');
    const raw = readFileSync(jsonlPath, 'utf8');
    const lines = raw.trim().split('\n');
    assert.ok(lines.length > 0, 'JSONL should still have the record');

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.id, 'mem_to_forget');
    assert.ok(parsed.deletedAt, 'deletedAt should be set');
  } finally {
    cleanupEnv(env);
  }
});

test('forget removes record from pending', () => {
  const record = makeRecord({ id: 'mem_pending_forget', content: '待合并遗忘内容。' });
  const env = setupMemSyncEnv({
    withPending: true,
    pendingRecords: [record]
  });

  try {
    const result = runCli(env.dir, ['forget', 'mem_pending_forget']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.forgotten, 'mem_pending_forget');
    assert.equal(output.action, 'removed-from-pending');
  } finally {
    cleanupEnv(env);
  }
});

test('forget with --reason adds evidence', () => {
  const record = makeRecord({ id: 'mem_reason_forget', content: '带原因的遗忘。' });
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: [record]
  });

  try {
    const result = runCli(env.dir, ['forget', 'mem_reason_forget', '--reason', 'no longer needed']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.action, 'soft-deleted');

    // Verify evidence was added
    const jsonlPath = join(env.dir, 'memories.jsonl');
    const raw = readFileSync(jsonlPath, 'utf8');
    const parsed = JSON.parse(raw.trim().split('\n')[0]);
    assert.ok(Array.isArray(parsed.evidence));
    const userMsg = parsed.evidence.find(e => e.type === 'user_message');
    assert.ok(userMsg, 'evidence should contain user_message');
    assert.equal(userMsg.text, 'no longer needed');
  } finally {
    cleanupEnv(env);
  }
});

test('forget throws when id not found', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = runCli(env.dir, ['forget', 'nonexistent']);

    assert.notEqual(result.status, 0, 'should exit non-zero when id not found');
    assert.match(result.stderr, /Memory not found/);
  } finally {
    cleanupEnv(env);
  }
});

test('forget throws when no id provided', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = runCli(env.dir, ['forget']);

    assert.notEqual(result.status, 0, 'should exit non-zero when no id provided');
    assert.match(result.stderr, /requires a memory id/);
  } finally {
    cleanupEnv(env);
  }
});
