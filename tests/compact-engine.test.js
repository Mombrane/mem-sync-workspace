import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compactMemories } from '../src/compact-engine.js';
import { writeJSONL, readJSONL } from '../src/repo-store.js';

/**
 * Helper: create a standard v1 memory record for testing.
 */
function makeRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? null,
    kind: overrides.kind ?? 'episode',
    scope: overrides.scope ?? 'global',
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content: overrides.content ?? '测试记忆内容。',
    summary: overrides.summary ?? '测试记忆内容。',
    source: overrides.source ?? { type: 'manual' },
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 1,
    importance: overrides.importance ?? 0.5,
    veracity: overrides.veracity ?? 'stated',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T10:00:00.000Z',
    validUntil: overrides.validUntil ?? null,
    deletedAt: overrides.deletedAt ?? null,
    supersedes: overrides.supersedes ?? [],
  };
}

/**
 * Helper: set up a temp dir with a JSONL store containing given records.
 * Returns { dir, storePath } — caller must rmSync(dir, ...) in finally.
 */
async function setupStore(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-test-'));
  const storePath = path.join(dir, 'memories.jsonl');
  await writeJSONL(records, storePath);
  return { dir, storePath };
}

// ─── Test: age filtering ────────────────────────────────────────────

test('records older than threshold are candidates', async () => {
  const old = makeRecord({
    id: 'mem_old',
    content: 'old content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([old]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 1);
    assert.equal(result.total, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('records newer than threshold are non-candidates', async () => {
  // Use a very recent timestamp to ensure it's within threshold
  const recent = makeRecord({
    id: 'mem_recent',
    content: 'recent content',
    updatedAt: new Date().toISOString(),
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([recent]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 0);
    assert.equal(result.total, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: confidence filtering ─────────────────────────────────────

test('high confidence (0.9) records are candidates when old enough', async () => {
  const highConf = makeRecord({
    id: 'mem_high',
    content: 'high confidence',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 0.9,
  });
  const { dir, storePath } = await setupStore([highConf]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('low confidence (0.5) records are not candidates', async () => {
  const lowConf = makeRecord({
    id: 'mem_low',
    content: 'low confidence',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 0.5,
  });
  const { dir, storePath } = await setupStore([lowConf]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: deleted record exclusion ────────────────────────────────

test('deleted records (deletedAt != null) are excluded from candidates', async () => {
  const deleted = makeRecord({
    id: 'mem_deleted',
    content: 'deleted content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
    deletedAt: '2026-03-01T00:00:00.000Z',
  });
  const { dir, storePath } = await setupStore([deleted]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: expired record exclusion ─────────────────────────────────

test('expired records (validUntil < now) are excluded from candidates', async () => {
  const expired = makeRecord({
    id: 'mem_expired',
    content: 'expired content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
    validUntil: '2026-03-01T00:00:00.000Z', // expired in the past
  });
  const { dir, storePath } = await setupStore([expired]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('records with validUntil in the future are candidates', async () => {
  const futureValid = makeRecord({
    id: 'mem_future',
    content: 'future valid content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
    validUntil: '2099-12-31T23:59:59.000Z',
  });
  const { dir, storePath } = await setupStore([futureValid]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(result.candidates, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: dedup by canonicalKey ────────────────────────────────────

test('dedup keeps record with latest updatedAt', async () => {
  const older = makeRecord({
    id: 'mem_old',
    content: 'shared content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
  });
  const newer = makeRecord({
    id: 'mem_new',
    content: 'shared content',
    updatedAt: '2026-02-01T00:00:00.000Z',
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([older, newer]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });

    assert.equal(result.candidates, 2);
    assert.equal(result.duplicates, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.kept, 1);

    // Verify the newer record is kept
    const remaining = await readJSONL(storePath);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'mem_new');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: dryRun mode ──────────────────────────────────────────────

test('dryRun returns stats but does not modify file', async () => {
  const older = makeRecord({
    id: 'mem_old',
    content: 'shared content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
  });
  const newer = makeRecord({
    id: 'mem_new',
    content: 'shared content',
    updatedAt: '2026-02-01T00:00:00.000Z',
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([older, newer]);

  try {
    const beforeContent = fs.readFileSync(storePath, 'utf8');
    const result = await compactMemories({
      storePath,
      olderThanDays: 30,
      dryRun: true,
    });

    // Stats returned
    assert.equal(result.candidates, 2);
    assert.equal(result.duplicates, 1);

    // File unchanged
    const afterContent = fs.readFileSync(storePath, 'utf8');
    assert.equal(beforeContent, afterContent);

    // No .bak created
    assert.equal(fs.existsSync(`${storePath}.bak`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: .bak backup creation ─────────────────────────────────────

test('backup file is created when not dryRun', async () => {
  const record = makeRecord({
    id: 'mem_1',
    content: 'some content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([record]);

  try {
    await compactMemories({ storePath, olderThanDays: 30 });
    assert.equal(fs.existsSync(`${storePath}.bak`), true);

    // Backup has original content
    const backupContent = fs.readFileSync(`${storePath}.bak`, 'utf8');
    const originalContent = fs.readFileSync(storePath, 'utf8');
    // Content should match since no duplicates
    assert.equal(backupContent, originalContent);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: stats correctness ────────────────────────────────────────

test('stats are returned correctly with mixed records', async () => {
  const now = new Date();
  const old1 = makeRecord({
    id: 'old1',
    content: 'alpha content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
  });
  const old1dup = makeRecord({
    id: 'old1dup',
    content: 'alpha content',
    updatedAt: '2026-01-15T00:00:00.000Z',
    confidence: 1,
  });
  const recent = makeRecord({
    id: 'recent',
    content: 'recent content',
    updatedAt: now.toISOString(),
    confidence: 1,
  });
  const lowConf = makeRecord({
    id: 'low',
    content: 'low conf content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 0.3,
  });

  const { dir, storePath } = await setupStore([old1, old1dup, recent, lowConf]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });

    assert.equal(result.total, 4);
    assert.equal(result.candidates, 2); // old1 and old1dup
    assert.equal(result.duplicates, 1); // one duplicate removed
    assert.equal(result.removed, 1);
    assert.equal(result.kept, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: empty store ──────────────────────────────────────────────

test('empty store returns zero stats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-empty-'));
  const storePath = path.join(dir, 'memories.jsonl');
  fs.writeFileSync(storePath, '', 'utf8');

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });

    assert.equal(result.candidates, 0);
    assert.equal(result.duplicates, 0);
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 0);
    assert.equal(result.total, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: no candidates (all records too new) ──────────────────────

test('no candidates when all records are too new', async () => {
  const recent1 = makeRecord({
    id: 'r1',
    content: 'recent one',
    updatedAt: new Date().toISOString(),
    confidence: 1,
  });
  const recent2 = makeRecord({
    id: 'r2',
    content: 'recent two',
    updatedAt: new Date().toISOString(),
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([recent1, recent2]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });

    assert.equal(result.candidates, 0);
    assert.equal(result.duplicates, 0);
    assert.equal(result.removed, 0);
    assert.equal(result.kept, 0);
    assert.equal(result.total, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Test: non-candidates are preserved ─────────────────────────────

test('non-candidate records are preserved alongside compacted ones', async () => {
  const oldDup1 = makeRecord({
    id: 'dup1',
    content: 'duplicate content',
    updatedAt: '2026-01-01T00:00:00.000Z',
    confidence: 1,
  });
  const oldDup2 = makeRecord({
    id: 'dup2',
    content: 'duplicate content',
    updatedAt: '2026-02-01T00:00:00.000Z',
    confidence: 1,
  });
  const recent = makeRecord({
    id: 'recent_keep',
    content: 'recent keep',
    updatedAt: new Date().toISOString(),
    confidence: 1,
  });
  const { dir, storePath } = await setupStore([oldDup1, oldDup2, recent]);

  try {
    const result = await compactMemories({ storePath, olderThanDays: 30 });

    assert.equal(result.total, 3);
    assert.equal(result.candidates, 2);
    assert.equal(result.removed, 1);

    // Verify the remaining records
    const remaining = await readJSONL(storePath);
    assert.equal(remaining.length, 2);

    const ids = remaining.map((r) => r.id).sort();
    assert.deepEqual(ids, ['dup2', 'recent_keep']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
