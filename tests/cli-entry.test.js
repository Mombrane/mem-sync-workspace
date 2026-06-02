import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('no command prints help and exits zero', () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /mem-sync remember/);
});

test('unknown command prints help and exits one', () => {
  const result = run(['not-a-command']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage:/);
});

test('unknown index subcommand exits one with available subcommands', () => {
  const result = run(['index', 'wat']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown index subcommand: wat/);
  assert.match(result.stderr, /index rebuild \| index status \| index update/);
});

test('list formats string, object, and missing source through public CLI output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-entry-list-'));
  try {
    mkdirSync(dir, { recursive: true });
    const records = [
      { id: 'mem_string', scope: 'user', source: 'codex', content: 'string source' },
      { id: 'mem_agent', scope: 'user', source: { type: 'manual', agent: 'cursor' }, content: 'agent source' },
      { id: 'mem_unknown', scope: 'user', content: 'unknown source' }
    ];
    writeFileSync(join(dir, 'memories.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    const result = run(['list'], { MEM_SYNC_HOME: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mem_string\tuser\tcodex\tstring source/);
    assert.match(result.stdout, /mem_agent\tuser\tcursor\tagent source/);
    assert.match(result.stdout, /mem_unknown\tuser\tunknown\tunknown source/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
