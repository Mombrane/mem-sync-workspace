import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

test('remember emits schema diagnostics to stderr and export remains JSON-only', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-'));

  try {
    const rememberResult = spawnSync(process.execPath, [
      CLI_PATH,
      'remember',
      '用户偏好简洁中文回答。',
      '--scope',
      'personal'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(rememberResult.status, 0);
    assert.match(rememberResult.stderr, /\[mem-sync:schema\] normalize:start/);
    assert.match(rememberResult.stderr, /\[mem-sync:schema\] validate:ok/);
    assert.match(rememberResult.stderr, /\[mem-sync:store\] memory:accepted/);
    assert.match(rememberResult.stdout, /mem_/);

    const listResult = spawnSync(process.execPath, [CLI_PATH, 'list'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(listResult.status, 0);
    assert.equal(listResult.stderr, '');
    assert.match(listResult.stdout, /\tpersonal\tmanual\t用户偏好简洁中文回答。/);
    assert.doesNotMatch(listResult.stdout, /undefined|\[object Object\]/);

    const exportResult = spawnSync(process.execPath, [CLI_PATH, 'export'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(exportResult.status, 0);
    assert.equal(exportResult.stderr, '');
    assert.doesNotThrow(() => JSON.parse(exportResult.stdout));
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
