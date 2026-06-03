import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function runImport(dir, extraArgs = []) {
  return spawnSync(process.execPath, [CLI, 'import', 'legacy', ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, MEM_SYNC_HOME: dir }
  });
}

test('import legacy migrates .mem-sync/memories.json to JSONL schema v1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-import-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memories.json'), JSON.stringify({
      memories: [
        { text: 'Legacy preference', scope: 'user', source: 'codex', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }
      ]
    }));

    const result = runImport(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { imported: 1, skipped: 0, total: 1 });

    const record = JSON.parse(readFileSync(join(dir, 'memories.jsonl'), 'utf8').trim());
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.content, 'Legacy preference');
    assert.equal(record.scope, 'user');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('import legacy is idempotent by canonical key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-import-idempotent-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memories.json'), JSON.stringify({ memories: [{ text: 'Same item' }] }));

    assert.equal(runImport(dir).status, 0);
    const second = runImport(dir);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), { imported: 0, skipped: 1, total: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
