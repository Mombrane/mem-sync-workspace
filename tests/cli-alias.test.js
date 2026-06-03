import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('add command works as alias for remember', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-alias-'));
  try {
    const memSyncDir = join(dir, '.mem-sync');
    mkdirSync(memSyncDir, { recursive: true });
    const result = spawnSync(process.execPath, [CLI, 'add', 'Test alias content'], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, MEM_SYNC_HOME: '.mem-sync' }
    });
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout.trim();
    assert.ok(output.startsWith('mem_'), `Expected ID starting with 'mem_', got: ${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add command passes through --kind and --scope flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-alias-flags-'));
  try {
    const memSyncDir = join(dir, '.mem-sync');
    mkdirSync(memSyncDir, { recursive: true });
    const result = spawnSync(process.execPath, [CLI, 'add', 'Flag test', '--kind', 'preference', '--scope', 'user'], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, MEM_SYNC_HOME: '.mem-sync' }
    });
    assert.equal(result.status, 0, result.stderr);
    // The remember command only outputs the memory ID on stdout
    const id = result.stdout.trim();
    assert.ok(id.startsWith('mem_'), `Expected ID starting with 'mem_', got: ${id}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
