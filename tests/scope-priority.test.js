import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchIndex, rebuildIndex } from '../src/index-store.js';
import { normalizeMemoryInput } from '../src/schema.js';

function makeRecord(overrides = {}) {
  return normalizeMemoryInput({
    content: overrides.content ?? 'test memory content',
    kind: overrides.kind ?? 'episode',
    scope: overrides.scope ?? 'global',
    confidence: overrides.confidence ?? 0.8,
    importance: overrides.importance ?? 0.5,
    ...overrides,
  });
}

describe('Scope Priority Weighting', () => {
  let cacheDir;
  let repoDir;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'scope-priority-'));
    cacheDir = join(base, 'cache');
    repoDir = join(base, 'repo');
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  function setupRepoWithScopes(records) {
    const jsonlPath = join(repoDir, 'memories.jsonl');
    writeFileSync(jsonlPath, records.map(m => JSON.stringify(m)).join('\n') + '\n');
    rebuildIndex(repoDir, cacheDir);
  }

  it('personal scope ranks higher than global scope for same quality', () => {
    // Use shared content tokens to ensure all records match the query
    const records = [
      makeRecord({ id: 'mem_global', content: 'prefers dark theme for code editor', scope: 'global', confidence: 0.8, importance: 0.5 }),
      makeRecord({ id: 'mem_personal', content: 'prefers dark theme for terminal', scope: 'personal', confidence: 0.8, importance: 0.5 }),
    ];
    setupRepoWithScopes(records);

    const results = searchIndex(cacheDir, { query: 'prefers dark theme' });
    assert.ok(results.length >= 2, `Expected at least 2 results, got ${results.length}`);

    const personalIdx = results.findIndex(r => r.id === 'mem_personal');
    const globalIdx = results.findIndex(r => r.id === 'mem_global');
    assert.ok(personalIdx >= 0, 'personal result not found');
    assert.ok(globalIdx >= 0, 'global result not found');
    assert.ok(personalIdx < globalIdx, `personal (${personalIdx}) should rank higher than global (${globalIdx})`);
  });

  it('project scope ranks higher than global scope for same quality', () => {
    const records = [
      makeRecord({ id: 'mem_global', content: 'uses TypeScript for all services', scope: 'global', confidence: 0.8, importance: 0.5 }),
      makeRecord({ id: 'mem_project', content: 'uses TypeScript for backend services', scope: 'project', confidence: 0.8, importance: 0.5 }),
    ];
    setupRepoWithScopes(records);

    const results = searchIndex(cacheDir, { query: 'uses TypeScript' });
    assert.ok(results.length >= 2, `Expected at least 2 results, got ${results.length}`);

    const projectIdx = results.findIndex(r => r.id === 'mem_project');
    const globalIdx = results.findIndex(r => r.id === 'mem_global');
    assert.ok(projectIdx >= 0, `project result not found in ${results.map(r => r.id)}`);
    assert.ok(globalIdx >= 0, `global result not found in ${results.map(r => r.id)}`);
    assert.ok(projectIdx < globalIdx, `project (${projectIdx}) should rank higher than global (${globalIdx})`);
  });

  it('scope filter still works alongside priority', () => {
    const records = [
      makeRecord({ id: 'mem_global', content: 'Python is a programming language used globally', scope: 'global' }),
      makeRecord({ id: 'mem_personal', content: 'Python is my favorite programming language', scope: 'personal' }),
    ];
    setupRepoWithScopes(records);

    const results = searchIndex(cacheDir, { query: 'Python programming language', scope: 'personal' });
    assert.ok(results.length >= 1, 'Expected at least 1 result');
    assert.ok(results.every(r => r.scope === 'personal'), 'All results should have personal scope');
  });

  it('scope weight does not override quality — high quality global beats low quality personal', () => {
    const records = [
      makeRecord({ id: 'mem_global_high', content: 'expert knowledge about algorithms', scope: 'global', confidence: 0.95, importance: 0.9, veracity: 'tool' }),
      makeRecord({ id: 'mem_personal_low', content: 'expert knowledge about algorithms', scope: 'personal', confidence: 0.2, importance: 0.1, veracity: 'unknown' }),
    ];
    setupRepoWithScopes(records);

    const results = searchIndex(cacheDir, { query: 'expert knowledge algorithms' });
    assert.ok(results.length >= 2, `Expected at least 2 results, got ${results.length}`);

    // High quality global: quality(0.95*0.9≈0.86) * scope(0.4) = 0.34
    // Low quality personal: quality(0.3*0.2≈0.06) * scope(1.0) = 0.06
    const globalIdx = results.findIndex(r => r.id === 'mem_global_high');
    const personalIdx = results.findIndex(r => r.id === 'mem_personal_low');
    assert.ok(globalIdx >= 0, `global not found in ${results.map(r => r.id)}`);
    assert.ok(personalIdx >= 0, `personal not found in ${results.map(r => r.id)}`);
    assert.ok(globalIdx < personalIdx, `High quality global (${globalIdx}) should beat low quality personal (${personalIdx})`);
  });
});
