import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseGenerateArgs, parseListArgs, parseShowArgs } from '../src/commands/skills.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function writeJSONLSync(filePath, records) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(filePath, lines, 'utf8');
}

function makeMemory(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: overrides.id || `mem_${Math.random().toString(36).slice(2, 14)}`,
    canonicalKey: 'test:key',
    kind: overrides.kind || 'episode',
    scope: overrides.scope || 'global',
    projectId: overrides.projectId ?? null,
    agentId: null,
    content: overrides.content || 'Test content',
    summary: overrides.summary || 'Test content',
    source: { type: 'manual' },
    evidence: [],
    confidence: overrides.confidence ?? 1,
    importance: overrides.importance ?? 0.5,
    veracity: 'stated',
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    validUntil: null,
    deletedAt: overrides.deletedAt ?? null,
    supersedes: [],
    tags: [],
    ...overrides
  };
}

// --- Argument parser tests ---

test('parseGenerateArgs parses --project, --force, and --repo', () => {
  const opts = parseGenerateArgs(['--project', 'proj-a', '--force', '--repo', '/tmp/test-repo']);
  assert.deepEqual(opts, { projectId: 'proj-a', force: true, repoPath: '/tmp/test-repo' });
});

test('parseGenerateArgs has sensible defaults', () => {
  const opts = parseGenerateArgs([]);
  assert.equal(opts.force, false);
  assert.ok(opts.repoPath);
});

test('parseGenerateArgs rejects missing values and unknown flags', () => {
  assert.throws(() => parseGenerateArgs(['--project']), /--project requires a value/);
  assert.throws(() => parseGenerateArgs(['--repo']), /--repo requires a value/);
  assert.throws(() => parseGenerateArgs(['--unknown']), /unknown option: --unknown/);
});

test('parseListArgs parses --repo', () => {
  const opts = parseListArgs(['--repo', '/custom/repo']);
  assert.deepEqual(opts, { repoPath: '/custom/repo' });
});

test('parseListArgs rejects unknown flags', () => {
  assert.throws(() => parseListArgs(['--unknown']), /unknown option: --unknown/);
});

test('parseShowArgs parses name and --repo', () => {
  const { name, opts } = parseShowArgs(['my-skill', '--repo', '/custom/repo']);
  assert.equal(name, 'my-skill');
  assert.deepEqual(opts, { repoPath: '/custom/repo' });
});

test('parseShowArgs requires a skill name', () => {
  assert.throws(() => parseShowArgs([]), /requires a skill name/);
});

// --- CLI integration tests ---

test('skills generate creates SKILL.md files via CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-sync-cli-skills-'));
  try {
    const globalFile = path.join(dir, 'memories', 'working', 'global.jsonl');
    writeJSONLSync(globalFile, [
      makeMemory({ kind: 'workflow', tags: ['git'], content: 'Git init repo', confidence: 0.9, importance: 0.8 }),
      makeMemory({ kind: 'workflow', tags: ['git'], content: 'Git add changes', confidence: 0.9, importance: 0.8 })
    ]);

    const result = spawnSync(process.execPath, [CLI, 'skills', 'generate', '--repo', dir, '--force'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.skills, 1);
    assert.ok(output.names.includes('git'));

    assert.equal(existsSync(path.join(dir, 'skills', 'git', 'SKILL.md')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills generate --force overwrites existing skills via CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-sync-cli-skills-force-'));
  try {
    // Pre-create a skill file
    const skillDir = path.join(dir, 'skills', 'test');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), 'old content', 'utf8');

    const globalFile = path.join(dir, 'memories', 'working', 'global.jsonl');
    writeJSONLSync(globalFile, [
      makeMemory({ kind: 'workflow', tags: ['test'], content: 'New step one', confidence: 0.9, importance: 0.8 }),
      makeMemory({ kind: 'workflow', tags: ['test'], content: 'New step two', confidence: 0.9, importance: 0.8 })
    ]);

    // Generate with --force
    const result = spawnSync(process.execPath, [CLI, 'skills', 'generate', '--repo', dir, '--force'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.skills, 1);

    const newContent = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    assert.ok(newContent.includes('New step one'));
    assert.ok(!newContent.includes('old content'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills list returns JSON array via CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-sync-cli-skills-list-'));
  try {
    // Pre-create a skill
    const skillDir = path.join(dir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: "A test skill"\n---\n# My Skill\n', 'utf8');

    const result = spawnSync(process.execPath, [CLI, 'skills', 'list', '--repo', dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.ok(Array.isArray(output));
    assert.equal(output.length, 1);
    assert.equal(output[0].name, 'my-skill');
    assert.ok(output[0].description.includes('test skill'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills show outputs markdown content via CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-sync-cli-skills-show-'));
  try {
    const skillDir = path.join(dir, 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    const content = '---\nname: my-skill\ndescription: "A test skill"\n---\n# My Skill\n\nStep by step guide.\n';
    writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');

    const result = spawnSync(process.execPath, [CLI, 'skills', 'show', 'my-skill', '--repo', dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('# My Skill'));
    assert.ok(result.stdout.includes('Step by step guide'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skills with no subcommand outputs help text via CLI', () => {
  const result = spawnSync(process.execPath, [CLI, 'skills'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Usage:'));
  assert.ok(result.stdout.includes('generate'));
  assert.ok(result.stdout.includes('list'));
  assert.ok(result.stdout.includes('show'));
});

test('skills generate with no memories returns zero via CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-sync-cli-skills-empty-'));
  try {
    const result = spawnSync(process.execPath, [CLI, 'skills', 'generate', '--repo', dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.skills, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
