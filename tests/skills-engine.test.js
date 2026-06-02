import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateSkills } from '../src/skills-engine.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
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

test('generates skills from workflow memories with tags', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['git'], content: 'Step 1: git init', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: ['git'], content: 'Step 2: git add', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: ['git'], content: 'Step 3: git commit', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'decision', tags: ['git'], content: 'Decided to use trunk-based workflow', confidence: 0.9, importance: 0.8 })
  ]);

  const result = await generateSkills({ repoPath: tmp, force: true });
  assert.equal(result.skills, 1);
  assert.ok(result.names.includes('git'));

  const skillFile = path.join(tmp, 'skills', 'git', 'SKILL.md');
  assert.ok(fs.existsSync(skillFile));

  const md = fs.readFileSync(skillFile, 'utf8');
  assert.ok(md.includes('---'), 'should have frontmatter');
  assert.ok(md.includes('name: git'), 'should have frontmatter name field');
  assert.ok(md.includes('# Git'), 'should have title');
  assert.ok(md.includes('## Steps / Pattern'), 'should have steps section');
  assert.ok(md.includes('## Related Decisions'), 'should have decisions section');
  assert.ok(md.includes('Step 1: git init'));
  assert.ok(md.includes('Decided to use trunk-based workflow'));
});

test('skips clusters below MIN_WORKFLOW_COUNT', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['deploy'], content: 'Deploy step', confidence: 0.9, importance: 0.8 })
  ]);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 0);
  assert.equal(result.skipped, 1);
});

test('force overwrites existing skills', async () => {
  const tmp = makeTmpDir();

  // Pre-create a skill file with old content
  const skillDir = path.join(tmp, 'skills', 'test');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'old content', 'utf8');

  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['test'], content: 'New workflow step 1', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: ['test'], content: 'New workflow step 2', confidence: 0.9, importance: 0.8 })
  ]);

  // Without force — should skip because file already exists
  const resultNoForce = await generateSkills({ repoPath: tmp, force: false });
  assert.equal(resultNoForce.skills, 0);
  const oldContent = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.equal(oldContent, 'old content');

  // With force — should overwrite
  const resultForce = await generateSkills({ repoPath: tmp, force: true });
  assert.equal(resultForce.skills, 1);

  const newContent = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(newContent.includes('New workflow step 1'));
  assert.ok(!newContent.includes('old content'));
});

test('handles memories with empty tags using kind fallback', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: [], content: 'Generic workflow step 1', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: [], content: 'Generic workflow step 2', confidence: 0.9, importance: 0.8 })
  ]);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 1);
  assert.ok(result.names.includes('workflow'));

  const skillFile = path.join(tmp, 'skills', 'workflow', 'SKILL.md');
  assert.ok(fs.existsSync(skillFile));
});

test('no skill-worthy memories returns empty result', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'preference', content: 'Prefers dark mode' }),
    makeMemory({ kind: 'episode', content: 'Had lunch' })
  ]);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 0);
  assert.deepEqual(result.names, []);
});

test('filters memories below confidence threshold', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['deploy'], content: 'Low confidence step', confidence: 0.79, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: ['deploy'], content: 'High confidence step', confidence: 0.80, importance: 0.8 })
  ]);

  // Only the 0.80 memory passes the confidence threshold (>= 0.8)
  // But cluster has only 1 workflow, below MIN_WORKFLOW_COUNT of 2, so skipped
  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 0);
  assert.equal(result.skipped, 1);
});

test('slugifies tag names for directories and title-cases for markdown', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['Git Workflow'], content: 'Step 1', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: ['Git Workflow'], content: 'Step 2', confidence: 0.9, importance: 0.8 })
  ]);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 1);
  assert.ok(result.names.includes('git-workflow'));

  // Directory should be slugified
  const skillDir = path.join(tmp, 'skills', 'git-workflow');
  assert.ok(fs.existsSync(skillDir));

  // Title in markdown should be title-cased
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(md.includes('# Git Workflow'));
});

test('caps steps at MAX_STEPS (10)', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  const memories = [];
  for (let i = 1; i <= 15; i++) {
    memories.push(makeMemory({
      kind: 'workflow',
      tags: ['process'],
      content: `Step ${i}: Do something ${i}`,
      confidence: 0.9,
      importance: 0.8
    }));
  }
  writeJSONLSync(globalFile, memories);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 1);

  const md = fs.readFileSync(path.join(tmp, 'skills', 'process', 'SKILL.md'), 'utf8');
  const stepMatches = md.match(/^\d+\. /gm);
  assert.ok(stepMatches !== null, 'should have numbered steps');
  assert.ok(stepMatches.length <= 10, `Expected at most 10 steps, got ${stepMatches.length}`);
  // Step 15 should not appear
  assert.ok(!md.includes('Step 15'));
});

test('mixed kinds in same cluster generate all sections', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['dev'], content: 'Code review step', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'workflow', tags: ['dev'], content: 'Test step', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'decision', tags: ['dev'], content: 'Chose Jest for testing', confidence: 0.9, importance: 0.8 }),
    makeMemory({ kind: 'correction', tags: ['dev'], content: 'Avoid using global state', confidence: 0.9, importance: 0.8 })
  ]);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 1);

  const md = fs.readFileSync(path.join(tmp, 'skills', 'dev', 'SKILL.md'), 'utf8');
  assert.ok(md.includes('## Steps / Pattern'));
  assert.ok(md.includes('## Related Decisions'));
  assert.ok(md.includes('## Corrections / Pitfalls'));
  assert.ok(md.includes('Chose Jest for testing'));
  assert.ok(md.includes('⚠️ Avoid using global state'));
});

test('filters memories below importance threshold', async () => {
  const tmp = makeTmpDir();
  const globalFile = path.join(tmp, 'memories', 'working', 'global.jsonl');
  writeJSONLSync(globalFile, [
    makeMemory({ kind: 'workflow', tags: ['low'], content: 'Low importance step 1', confidence: 0.9, importance: 0.2 }),
    makeMemory({ kind: 'workflow', tags: ['low'], content: 'Low importance step 2', confidence: 0.9, importance: 0.2 })
  ]);

  const result = await generateSkills({ repoPath: tmp });
  assert.equal(result.skills, 0);
});
