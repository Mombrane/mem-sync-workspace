import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compactCommand, parseCompactArgs } from '../src/commands/compact.js';
import { normalizeMemoryInput } from '../src/schema.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('parseCompactArgs parses --older-than, --dry-run, and --repo', () => {
  const opts = parseCompactArgs(['--older-than', '14', '--dry-run', '--repo', '/tmp/mem-sync-repo']);
  assert.equal(opts.olderThanDays, 14);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.storePath, join('/tmp/mem-sync-repo', 'memories.jsonl'));
});

test('parseCompactArgs rejects missing and invalid --older-than values', () => {
  assert.throws(() => parseCompactArgs(['--older-than']), /--older-than requires a value/);
  assert.throws(() => parseCompactArgs(['--older-than', 'abc']), /--older-than must be a non-negative integer/);
  assert.throws(() => parseCompactArgs(['--older-than', '1abc']), /--older-than must be a non-negative integer/);
  assert.throws(() => parseCompactArgs(['--older-than', '-1']), /--older-than must be a non-negative integer/);
});

test('parseCompactArgs rejects unknown flags', () => {
  assert.throws(() => parseCompactArgs(['--unknown']), /unknown option: --unknown/);
});

test('compactCommand dry-run outputs JSON and does not modify store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-compact-'));
  try {
    mkdirSync(dir, { recursive: true });
    const oldRecord = normalizeMemoryInput({
      content: 'Old high confidence memory',
      confidence: 0.95,
      now: '2026-01-01T00:00:00.000Z'
    });
    const storePath = join(dir, 'memories.jsonl');
    writeFileSync(storePath, JSON.stringify(oldRecord) + '\n', 'utf8');
    const before = readFileSync(storePath, 'utf8');

    let output = '';
    const originalLog = console.log;
    console.log = (message) => { output += message; };
    try {
      await compactCommand(['--repo', dir, '--dry-run', '--older-than', '1']);
    } finally {
      console.log = originalLog;
    }

    const result = JSON.parse(output);
    assert.equal(result.total, 1);
    assert.equal(readFileSync(storePath, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compact command works through CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-compact-spawn-'));
  try {
    mkdirSync(dir, { recursive: true });
    const record = normalizeMemoryInput({ content: 'Spawn compact memory', confidence: 0.95, now: '2026-01-01T00:00:00.000Z' });
    writeFileSync(join(dir, 'memories.jsonl'), JSON.stringify(record) + '\n', 'utf8');

    const result = spawnSync(process.execPath, [CLI, 'compact', '--repo', dir, '--dry-run'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
