import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSummarizeArgs, summarizeCommand } from '../src/commands/summarize.js';
import { normalizeMemoryInput } from '../src/schema.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('parseSummarizeArgs parses --project, --force, and --repo', () => {
  const opts = parseSummarizeArgs(['--project', 'proj-a', '--force', '--repo', '/tmp/mem-sync-repo']);
  assert.deepEqual(opts, { projectId: 'proj-a', force: true, repoPath: '/tmp/mem-sync-repo' });
});

test('parseSummarizeArgs rejects missing values and unknown flags', () => {
  assert.throws(() => parseSummarizeArgs(['--project']), /--project requires a value/);
  assert.throws(() => parseSummarizeArgs(['--repo']), /--repo requires a value/);
  assert.throws(() => parseSummarizeArgs(['--unknown']), /unknown option: --unknown/);
});

test('summarizeCommand outputs JSON and writes summary files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-summarize-'));
  try {
    mkdirSync(dir, { recursive: true });
    const records = [
      normalizeMemoryInput({ kind: 'preference', scope: 'user', content: 'User prefers concise Chinese replies', importance: 0.9, confidence: 0.9 }),
      normalizeMemoryInput({ kind: 'project_fact', scope: 'project', projectId: 'proj-a', content: 'Project uses Node test runner', importance: 0.9, confidence: 0.9 })
    ];
    writeFileSync(join(dir, 'memories.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    let output = '';
    const originalLog = console.log;
    console.log = (message) => { output += message; };
    try {
      await summarizeCommand(['--repo', dir, '--project', 'proj-a', '--force']);
    } finally {
      console.log = originalLog;
    }

    const result = JSON.parse(output);
    assert.equal(result.profile, true);
    assert.equal(result.project, true);
    assert.equal(existsSync(join(dir, 'profile.md')), true);
    assert.equal(existsSync(join(dir, 'projects', 'proj-a', 'summary.md')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summarize command works through CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-summarize-spawn-'));
  try {
    mkdirSync(dir, { recursive: true });
    const record = normalizeMemoryInput({ kind: 'preference', scope: 'user', content: 'CLI summary memory', importance: 0.9, confidence: 0.9 });
    writeFileSync(join(dir, 'memories.jsonl'), JSON.stringify(record) + '\n', 'utf8');

    const result = spawnSync(process.execPath, [CLI, 'summarize', '--repo', dir, '--force'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).profile, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
