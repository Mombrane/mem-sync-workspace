import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  createIndexDatabase,
  rebuildIndex,
  updateIndex,
  searchIndex,
  getIndexStatus
} from '../src/index-store.js';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Minimal valid Schema v1 record as a JSONL line */
function makeRecord(overrides = {}) {
  const content = overrides.content ?? 'test content';
  // Build a valid record matching schema v1 validation requirements
  return JSON.stringify({
    schemaVersion: 1,
    id: overrides.id ?? `mem-${Math.random().toString(36).slice(2, 14)}`,
    canonicalKey: overrides.canonicalKey ?? `episode:personal:::${content.slice(0, 12)}`,
    kind: overrides.kind ?? 'episode',
    scope: overrides.scope ?? 'personal',
    projectId: null,
    agentId: null,
    content,
    summary: overrides.summary ?? content.slice(0, 120),
    source: { type: 'manual' },
    evidence: [],
    confidence: overrides.confidence ?? 0.9,
    importance: overrides.importance ?? 0.8,
    veracity: overrides.veracity ?? 'stated',
    tags: [],
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2025-01-01T00:00:00Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    author: null,
    session: null,
    device: null,
    reviewer: null,
    reviewedAt: null,
    trustTier: null,
    ...overrides
  });
}

/**
 * Create a git repo with JSONL files, suitable for incremental update testing.
 * Returns { repoDir, cacheDir, tmpDir, getHead, commit, writeJsonl }.
 */
function createGitRepo() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'idx-test-'));
  const repoDir = join(tmpDir, 'repo');
  const cacheDir = join(tmpDir, 'cache');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  // Init git repo
  execSync('git init -b main', { cwd: repoDir });
  execSync('git config user.email "test@test.com"', { cwd: repoDir });
  execSync('git config user.name "Test"', { cwd: repoDir });

  function getHead() {
    return execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
  }

  function commit(msg) {
    execSync('git add -A', { cwd: repoDir });
    execSync(`git commit -m "${msg}"`, { cwd: repoDir });
  }

  function writeJsonl(relPath, lines) {
    const absPath = join(repoDir, relPath);
    mkdirSync(join(repoDir, ...relPath.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(absPath, lines.join('\n') + '\n', 'utf8');
  }

  return { repoDir, cacheDir, tmpDir, getHead, commit, writeJsonl };
}

// ─── T1: Incremental update basic functionality ───────────────────────

describe('updateIndex — incremental basic (T1)', () => {
  let ctx;

  beforeEach(() => {
    ctx = createGitRepo();
  });

  afterEach(() => {
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it('only re-indexes changed files on HEAD change', () => {
    const { repoDir, cacheDir, getHead, commit, writeJsonl } = ctx;

    // Initial: two JSONL files
    writeJsonl('memories/a.jsonl', [
      makeRecord({ id: 'mem-a1', content: 'alpha one' })
    ]);
    writeJsonl('memories/b.jsonl', [
      makeRecord({ id: 'mem-b1', content: 'beta one' })
    ]);
    commit('initial');

    // Full rebuild to establish baseline
    const head1 = getHead();
    const result1 = rebuildIndex(repoDir, cacheDir, { repoHead: head1 });
    assert.equal(result1.recordCount, 2);

    // Modify only file a.jsonl
    writeJsonl('memories/a.jsonl', [
      makeRecord({ id: 'mem-a2', content: 'alpha two' })
    ]);
    commit('update a');

    const head2 = getHead();
    const result2 = updateIndex(repoDir, cacheDir, { repoHead: head2 });

    // Should be incremental, not full rebuild
    assert.equal(result2.updated, true, 'should return updated:true for incremental');
    assert.equal(result2.recordCount, 1, 'should re-index 1 record from changed file');

    // Verify the old record is gone and new one exists
    const searchA2 = searchIndex(cacheDir, { query: 'alpha two' });
    assert.ok(searchA2.some(r => r.id === 'mem-a2'), 'new record should be found');

    const searchA1 = searchIndex(cacheDir, { query: 'alpha one' });
    assert.ok(!searchA1.some(r => r.id === 'mem-a1'), 'old record should be gone');

    // Verify unchanged file b.jsonl still has its record
    const searchB1 = searchIndex(cacheDir, { query: 'beta one' });
    assert.ok(searchB1.some(r => r.id === 'mem-b1'), 'unchanged file record should persist');

    // Total should be 2 (1 from a, 1 from b)
    const status = getIndexStatus(cacheDir);
    assert.equal(status.recordCount, 2, 'total record count should be 2');
  });
});

// ─── T2: File deletion handling ───────────────────────────────────────

describe('updateIndex — file deletion (T2)', () => {
  let ctx;

  beforeEach(() => {
    ctx = createGitRepo();
  });

  afterEach(() => {
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it('removes records for deleted JSONL files', () => {
    const { repoDir, cacheDir, getHead, commit, writeJsonl } = ctx;

    // Initial: two JSONL files
    writeJsonl('memories/a.jsonl', [
      makeRecord({ id: 'mem-a1', content: 'alpha data' })
    ]);
    writeJsonl('memories/b.jsonl', [
      makeRecord({ id: 'mem-b1', content: 'beta data' })
    ]);
    commit('initial');

    const head1 = getHead();
    rebuildIndex(repoDir, cacheDir, { repoHead: head1 });

    // Delete a.jsonl (write empty file to remove content, then git rm)
    execSync('git rm memories/a.jsonl', { cwd: repoDir });
    execSync('git commit -m "remove a"', { cwd: repoDir });

    const head2 = getHead();
    const result = updateIndex(repoDir, cacheDir, { repoHead: head2 });

    assert.equal(result.updated, true);

    // a.jsonl records should be gone
    const status = getIndexStatus(cacheDir);
    assert.equal(status.recordCount, 1, 'only b.jsonl record should remain');

    const searchA = searchIndex(cacheDir, { query: 'alpha data' });
    assert.equal(searchA.length, 0, 'deleted file record should not be found');

    const searchB = searchIndex(cacheDir, { query: 'beta data' });
    assert.ok(searchB.some(r => r.id === 'mem-b1'), 'remaining file record should persist');
  });
});

// ─── T3: Fallback to full rebuild ─────────────────────────────────────

describe('updateIndex — fallback to full rebuild (T3)', () => {
  let ctx;

  beforeEach(() => {
    ctx = createGitRepo();
  });

  afterEach(() => {
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it('falls back when index does not exist', () => {
    const { repoDir, cacheDir } = ctx;

    // No index created yet — updateIndex should fall back to full rebuild
    const result = updateIndex(repoDir, cacheDir, { repoHead: 'abc123' });
    assert.equal(result.rebuilt, true, 'should return rebuilt:true when no prior index');
  });

  it('falls back when repo_head is missing', () => {
    const { repoDir, cacheDir } = ctx;

    // Create the database structure but without repo_head
    createIndexDatabase(cacheDir);
    // Don't insert repo_head — this triggers fallback

    const result = updateIndex(repoDir, cacheDir, { repoHead: 'abc123' });
    assert.equal(result.rebuilt, true, 'should return rebuilt:true when repo_head is missing');
  });
});

// ─── T4: git diff failure fallback ────────────────────────────────────

describe('updateIndex — git diff failure fallback (T4)', () => {
  let ctx;

  beforeEach(() => {
    ctx = createGitRepo();
  });

  afterEach(() => {
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it('falls back to full rebuild when git diff fails (invalid old head)', () => {
    const { repoDir, cacheDir, getHead, commit, writeJsonl } = ctx;

    writeJsonl('memories/a.jsonl', [
      makeRecord({ id: 'mem-a1', content: 'test content' })
    ]);
    commit('initial');

    const head = getHead();
    rebuildIndex(repoDir, cacheDir, { repoHead: head });

    // Manually set a bad repo_head in the DB that will make git diff fail
    const dbPath = join(cacheDir, 'index.sqlite');
    const db = new Database(dbPath);
    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)")
      .run('repo_head', '0000000000000000000000000000000000000000');
    db.close();

    // Make another commit so HEAD changes
    writeJsonl('memories/b.jsonl', [
      makeRecord({ id: 'mem-b1', content: 'second content' })
    ]);
    commit('second');

    const newHead = getHead();
    const result = updateIndex(repoDir, cacheDir, { repoHead: newHead });

    // Should fall back to full rebuild since git diff will fail with the bad old head
    assert.equal(result.rebuilt, true, 'should fall back to full rebuild on git diff failure');
  });
});

// ─── T5: FTS rebuild verification ─────────────────────────────────────

describe('updateIndex — FTS rebuild after incremental (T5)', () => {
  let ctx;

  beforeEach(() => {
    ctx = createGitRepo();
  });

  afterEach(() => {
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  it('FTS search works correctly after incremental update', () => {
    const { repoDir, cacheDir, getHead, commit, writeJsonl } = ctx;

    writeJsonl('memories/a.jsonl', [
      makeRecord({ id: 'mem-a1', content: 'quantum computing basics' })
    ]);
    commit('initial');

    const head1 = getHead();
    rebuildIndex(repoDir, cacheDir, { repoHead: head1 });

    // Verify FTS works before incremental
    const before = searchIndex(cacheDir, { query: 'quantum' });
    assert.ok(before.some(r => r.id === 'mem-a1'), 'FTS should find record before incremental');

    // Add a new record via incremental update
    writeJsonl('memories/b.jsonl', [
      makeRecord({ id: 'mem-b1', content: 'machine learning algorithms' })
    ]);
    commit('add b');

    const head2 = getHead();
    updateIndex(repoDir, cacheDir, { repoHead: head2 });

    // FTS should find both old and new records
    const searchQuantum = searchIndex(cacheDir, { query: 'quantum' });
    assert.ok(searchQuantum.some(r => r.id === 'mem-a1'), 'FTS should still find old record');

    const searchML = searchIndex(cacheDir, { query: 'machine learning' });
    assert.ok(searchML.some(r => r.id === 'mem-b1'), 'FTS should find new record');

    // Verify repo_head was updated
    const status = getIndexStatus(cacheDir);
    assert.equal(status.repoHead, head2, 'repo_head should be updated after incremental');
  });
});
