import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeRecord, setupMemSyncEnv, cleanupEnv, runCli } from './helpers.js';

test('log shows recent commits', () => {
  const records = [makeRecord({ id: 'mem_001', content: '日志测试。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['log']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(Array.isArray(output.entries));
    assert.ok(output.entries.length > 0, 'should have at least one entry');

    // Each entry should have hash, message, date
    for (const entry of output.entries) {
      assert.equal(typeof entry.hash, 'string');
      assert.equal(typeof entry.message, 'string');
      assert.equal(typeof entry.date, 'string');
      assert.ok(entry.hash.length > 0, 'hash should not be empty');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('log respects --limit flag', () => {
  const records = [makeRecord({ id: 'mem_001', content: '限制测试。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['log', '--limit', '1']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(Array.isArray(output.entries));
    assert.ok(output.entries.length <= 1, `should have at most 1 entry, got ${output.entries.length}`);
  } finally {
    cleanupEnv(env);
  }
});

test('log throws without git repository', () => {
  const env = setupMemSyncEnv({ withJSONL: false });
  rmSync(join(env.dir, '.git'), { recursive: true, force: true });

  try {
    const result = runCli(env.dir, ['log']);

    assert.notEqual(result.status, 0, 'should exit non-zero without git repo');
    assert.match(result.stderr, /Not a mem-sync repository/);
  } finally {
    cleanupEnv(env);
  }
});

test('log throws on invalid --limit', () => {
  const records = [makeRecord({ id: 'mem_001', content: '无效限制。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['log', '--limit', 'abc']);

    assert.notEqual(result.status, 0, 'should exit non-zero for invalid limit');
    assert.match(result.stderr, /positive integer/);
  } finally {
    cleanupEnv(env);
  }
});
