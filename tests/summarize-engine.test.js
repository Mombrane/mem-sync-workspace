import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { summarizeMemories } from '../src/summarize-engine.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'summarize-test-'));
}

function writeJSONLSync(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines, 'utf8');
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
    veracity: 'stated',
    importance: overrides.importance ?? 0.5,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    validUntil: null,
    deletedAt: overrides.deletedAt ?? null,
    supersedes: [],
    tags: [],
    ...overrides
  };
}

test('generates profile.md with user-scope preference/identity memories', async () => {
  const tmp = makeTmpDir();
  const userFile = path.join(tmp, 'memories', 'user.jsonl');
  writeJSONLSync(userFile, [
    makeMemory({ kind: 'preference', scope: 'user', content: 'Prefers concise answers', confidence: 0.95 }),
    makeMemory({ kind: 'identity', scope: 'user', content: 'Senior developer', confidence: 0.9 }),
    makeMemory({ kind: 'episode', scope: 'user', content: 'Should not appear' })
  ]);

  const result = await summarizeMemories({ repoPath: tmp });
  assert.equal(result.profile, true);

  const md = fs.readFileSync(path.join(tmp, 'profile.md'), 'utf8');
  assert.ok(md.includes('# User Profile'));
  assert.ok(md.includes('Prefers concise answers'));
  assert.ok(md.includes('Senior developer'));
  assert.ok(md.includes('Preferences'));
  assert.ok(md.includes('Identity'));
  // episode kind should not appear in profile
  assert.ok(!md.includes('Should not appear'));
});

test('generates summary.md with global-scope memories', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'project_fact', scope: 'global', content: 'Uses JSONL for storage', importance: 0.8 }),
    makeMemory({ kind: 'decision', scope: 'global', content: 'Chose deterministic merge', importance: 0.9 })
  ]);

  const result = await summarizeMemories({ repoPath: tmp });
  assert.equal(result.summary, true);

  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.ok(md.includes('# Memory Summary'));
  assert.ok(md.includes('Uses JSONL for storage'));
  assert.ok(md.includes('Chose deterministic merge'));
  assert.ok(md.includes('Project Facts'));
  assert.ok(md.includes('Decisions'));
});

test('generates project summary', async () => {
  const tmp = makeTmpDir();
  const projectFile = path.join(tmp, 'memories', 'projects', 'myproj.jsonl');
  writeJSONLSync(projectFile, [
    makeMemory({ kind: 'project_fact', scope: 'project', content: 'Uses SQLite FTS5', importance: 0.8 })
  ]);

  const result = await summarizeMemories({ repoPath: tmp, projectId: 'myproj' });
  assert.equal(result.project, true);

  const md = fs.readFileSync(path.join(tmp, 'projects', 'myproj', 'summary.md'), 'utf8');
  assert.ok(md.includes('# Project Summary: myproj'));
  assert.ok(md.includes('Uses SQLite FTS5'));
});

test('force overwrites existing files', async () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, 'summary.md'), 'old content', 'utf8');
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'episode', content: 'New memory' })
  ]);

  const result = await summarizeMemories({ repoPath: tmp, force: true });
  assert.equal(result.summary, true);
  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.ok(md.includes('New memory'));
  assert.ok(!md.includes('old content'));
});

test('skips existing files without force', async () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, 'summary.md'), 'existing', 'utf8');

  const result = await summarizeMemories({ repoPath: tmp });
  assert.equal(result.summary, false);
  const content = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.equal(content, 'existing');
});

test('filters low confidence and importance', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ content: 'High conf', confidence: 0.8, importance: 0.5 }),
    makeMemory({ content: 'Low conf', confidence: 0.3, importance: 0.5 }),
    makeMemory({ content: 'Low imp', confidence: 0.8, importance: 0.1 }),
    makeMemory({ content: 'Deleted', confidence: 0.9, importance: 0.9, deletedAt: new Date().toISOString() })
  ]);

  const result = await summarizeMemories({ repoPath: tmp });
  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.ok(md.includes('High conf'));
  assert.ok(!md.includes('Low conf'));
  assert.ok(!md.includes('Low imp'));
  assert.ok(!md.includes('Deleted'));
  assert.equal(result.memoryCount, 1);
});

test('includes timestamp and count in headers', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ content: 'Memory one' }),
    makeMemory({ content: 'Memory two' })
  ]);

  await summarizeMemories({ repoPath: tmp });
  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.ok(md.includes('Generated:'));
  assert.ok(md.includes('Sources: 2 memories'));
});

test('empty memories produce minimal output', async () => {
  const tmp = makeTmpDir();
  const result = await summarizeMemories({ repoPath: tmp });
  assert.equal(result.memoryCount, 0);

  const profile = fs.readFileSync(path.join(tmp, 'profile.md'), 'utf8');
  assert.ok(profile.includes('# User Profile'));
  assert.ok(profile.includes('Sources: 0 memories'));

  const summary = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.ok(summary.includes('# Memory Summary'));
  assert.ok(summary.includes('Sources: 0 memories'));
});

test('groups records by kind correctly', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'project_fact', content: 'Fact one' }),
    makeMemory({ kind: 'decision', content: 'Decision one' }),
    makeMemory({ kind: 'project_fact', content: 'Fact two' })
  ]);

  await summarizeMemories({ repoPath: tmp });
  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  // Both facts should be under Project Facts
  const factIdx = md.indexOf('## Project Facts');
  const decIdx = md.indexOf('## Decisions');
  assert.ok(factIdx >= 0);
  assert.ok(decIdx >= 0);
  assert.ok(factIdx < decIdx);
  assert.ok(md.indexOf('Fact one') > factIdx);
  assert.ok(md.indexOf('Fact two') > factIdx);
  assert.ok(md.indexOf('Decision one') > decIdx);
});

test('higher importance sorted first', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  const now = new Date().toISOString();
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'episode', content: 'Low importance', importance: 0.4, updatedAt: now }),
    makeMemory({ kind: 'episode', content: 'High importance', importance: 0.9, updatedAt: now })
  ]);

  await summarizeMemories({ repoPath: tmp });
  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  const highIdx = md.indexOf('High importance');
  const lowIdx = md.indexOf('Low importance');
  assert.ok(highIdx < lowIdx, 'Higher importance should appear first');
});

test('filters expired memories via validUntil', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ content: 'Still valid', validUntil: '2099-01-01T00:00:00.000Z' }),
    makeMemory({ content: 'Expired', validUntil: '2020-01-01T00:00:00.000Z' })
  ]);

  await summarizeMemories({ repoPath: tmp });
  const md = fs.readFileSync(path.join(tmp, 'summary.md'), 'utf8');
  assert.ok(md.includes('Still valid'));
  assert.ok(!md.includes('Expired'));
});

test('reads working project memories alongside project memories', async () => {
  const tmp = makeTmpDir();
  writeJSONLSync(path.join(tmp, 'memories', 'projects', 'p1.jsonl'), [
    makeMemory({ kind: 'project_fact', content: 'From project file', importance: 0.8 })
  ]);
  writeJSONLSync(path.join(tmp, 'memories', 'working', 'projects', 'p1.jsonl'), [
    makeMemory({ kind: 'decision', content: 'From working file', importance: 0.7 })
  ]);

  const result = await summarizeMemories({ repoPath: tmp, projectId: 'p1' });
  assert.equal(result.project, true);
  const md = fs.readFileSync(path.join(tmp, 'projects', 'p1', 'summary.md'), 'utf8');
  assert.ok(md.includes('From project file'));
  assert.ok(md.includes('From working file'));
});
