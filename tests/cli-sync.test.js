import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { makeRecord, setupMemSyncEnv, cleanupEnv, runCli } from './helpers.js';

test('sync reports pulled count in JSON output', () => {
  const records = [makeRecord({ id: 'mem_001', content: '同步测试。' })];
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['sync']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(typeof output.pulled, 'number');
    assert.equal(typeof output.indexUpdated, 'boolean');
    assert.equal(typeof output.head, 'string');
    assert.notEqual(output.head, 'unknown');
  } finally {
    cleanupEnv(env);
  }
});

test('sync throws without git repository', () => {
  const env = setupMemSyncEnv({ withJSONL: false });
  // Remove .git to simulate no repo
  rmSync(join(env.dir, '.git'), { recursive: true, force: true });

  try {
    const result = runCli(env.dir, ['sync']);

    assert.notEqual(result.status, 0, 'should exit non-zero without git repo');
    assert.match(result.stderr, /Not a mem-sync repository/);
  } finally {
    cleanupEnv(env);
  }
});

test('sync works without remote', () => {
  const records = [makeRecord({ id: 'mem_001', content: '本地同步。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = runCli(env.dir, ['sync']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.pulled, 0);
    // head should still be valid
    assert.notEqual(output.head, 'unknown');
  } finally {
    cleanupEnv(env);
  }
});

test('sync with remote detects new commits', () => {
  const records = [makeRecord({ id: 'mem_001', content: '远程同步测试。' })];
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    // First sync — should be up to date
    let result = runCli(env.dir, ['sync']);
    assert.equal(result.status, 0);
    let output = JSON.parse(result.stdout.trim());
    assert.equal(output.pulled, 0);

    // Push a new commit to remote
    const tempClone = mkdtempSync(join(tmpdir(), 'mem-sync-sync-clone-'));
    try {
      execSync(`git clone "${env.bareDir}" "${tempClone}"`, { encoding: 'utf8' });
      execSync('git config user.email "test@test"', { cwd: tempClone, encoding: 'utf8' });
      execSync('git config user.name "Test"', { cwd: tempClone, encoding: 'utf8' });
      writeFileSync(join(tempClone, 'new-file.txt'), 'new content', 'utf8');
      execSync('git add new-file.txt', { cwd: tempClone, encoding: 'utf8' });
      execSync('git commit -m "remote new commit"', { cwd: tempClone, encoding: 'utf8' });
      execSync('git push origin main', { cwd: tempClone, encoding: 'utf8' });
    } finally {
      rmSync(tempClone, { recursive: true, force: true });
    }

    // Second sync — should pull the new commit
    result = runCli(env.dir, ['sync']);
    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);
    output = JSON.parse(result.stdout.trim());
    assert.ok(output.pulled > 0, `should have pulled commits, got pulled=${output.pulled}`);
  } finally {
    cleanupEnv(env);
  }
});
