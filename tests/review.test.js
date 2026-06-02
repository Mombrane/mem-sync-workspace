import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { reviewCommand, parseReviewArgs, formatTable } from '../src/commands/review.js';

/**
 * Helper: create a standard pending record.
 */
function makePendingRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    kind: overrides.kind ?? 'episode',
    scope: overrides.scope ?? 'global',
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content: overrides.content ?? 'Test memory content.',
    source: overrides.source ?? { type: 'manual' },
    confidence: overrides.confidence ?? 0.9,
    importance: overrides.importance ?? 0.5,
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    ...overrides
  };
}

// ─── parseReviewArgs ──────────────────────────────────────────────

test('parseReviewArgs throws when pending subcommand is missing', () => {
  assert.throws(
    () => parseReviewArgs([]),
    /review requires the "pending" subcommand/
  );
});

test('parseReviewArgs returns defaults with pending subcommand', () => {
  const opts = parseReviewArgs(['pending']);
  assert.equal(opts.kind, undefined);
  assert.equal(opts.full, false);
  assert.ok(opts.repo.endsWith('default'));
});

test('parseReviewArgs parses --kind', () => {
  const opts = parseReviewArgs(['pending', '--kind', 'preference']);
  assert.equal(opts.kind, 'preference');
});

test('parseReviewArgs parses --full', () => {
  const opts = parseReviewArgs(['pending', '--full']);
  assert.equal(opts.full, true);
});

test('parseReviewArgs parses --repo', () => {
  const opts = parseReviewArgs(['pending', '--repo', '/tmp/myrepo']);
  assert.equal(opts.repo, '/tmp/myrepo');
});

test('parseReviewArgs throws on unknown flag', () => {
  assert.throws(
    () => parseReviewArgs(['pending', '--unknown']),
    /unknown option: --unknown/
  );
});

// ─── formatTable ──────────────────────────────────────────────────

test('formatTable produces markdown table with headers', () => {
  const records = [makePendingRecord({ id: 'mem_1' })];
  const table = formatTable(records);
  assert.ok(table.startsWith('| id | kind | scope | confidence | content | source | createdAt |'));
  assert.ok(table.includes('mem_1'));
  assert.ok(table.includes('episode'));
  assert.ok(table.includes('global'));
});

test('formatTable with --full shows full content', () => {
  const longContent = 'A'.repeat(200);
  const records = [makePendingRecord({ content: longContent })];
  const table = formatTable(records, true);
  assert.ok(table.includes('A'.repeat(200)));
  assert.ok(!table.includes('…'));
});

test('formatTable truncates content > 120 chars in preview mode', () => {
  const longContent = 'B'.repeat(150);
  const records = [makePendingRecord({ content: longContent })];
  const table = formatTable(records, false);
  // Should contain truncated version with ellipsis
  assert.ok(table.includes('B'.repeat(120) + '…'));
  assert.ok(!table.includes('B'.repeat(150)));
});

test('formatTable preserves content <= 120 chars in preview mode', () => {
  const shortContent = 'Short content.';
  const records = [makePendingRecord({ content: shortContent })];
  const table = formatTable(records, false);
  assert.ok(table.includes(shortContent));
  assert.ok(!table.includes('…'));
});

// ─── reviewCommand (integration) ─────────────────────────────────

test('reviewCommand displays 3 pending records', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-test-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_1', content: 'First record' }),
    makePendingRecord({ id: 'mem_2', kind: 'preference', content: 'Second record' }),
    makePendingRecord({ id: 'mem_3', scope: 'user', content: 'Third record' }),
  ];

  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };
  try {
    await reviewCommand(['pending', '--repo', tmpDir]);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.ok(output.includes('mem_1'));
  assert.ok(output.includes('mem_2'));
  assert.ok(output.includes('mem_3'));
  assert.ok(output.includes('First record'));
  assert.ok(output.includes('Second record'));
  assert.ok(output.includes('Third record'));
});

test('reviewCommand filters by --kind', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-kind-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_1', kind: 'episode', content: 'An episode' }),
    makePendingRecord({ id: 'mem_2', kind: 'preference', content: 'A preference' }),
    makePendingRecord({ id: 'mem_3', kind: 'decision', content: 'A decision' }),
  ];

  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };
  try {
    await reviewCommand(['pending', '--kind', 'preference', '--repo', tmpDir]);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.ok(!output.includes('mem_1'));
  assert.ok(output.includes('mem_2'));
  assert.ok(!output.includes('mem_3'));
  assert.ok(output.includes('A preference'));
});

test('reviewCommand shows full content with --full', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-full-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const longContent = 'X'.repeat(200);
  const records = [makePendingRecord({ id: 'mem_1', content: longContent })];

  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };
  try {
    await reviewCommand(['pending', '--full', '--repo', tmpDir]);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.ok(output.includes('X'.repeat(200)));
  assert.ok(!output.includes('…'));
});

test('reviewCommand handles empty pending directory', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-empty-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };
  try {
    await reviewCommand(['pending', '--repo', tmpDir]);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.ok(output.includes('No pending records found.'));
});

test('reviewCommand handles non-existent pending directory', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-nodir-'));
  // Don't create pending dir

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };
  try {
    await reviewCommand(['pending', '--repo', tmpDir]);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  assert.ok(output.includes('No pending records found.'));
});

test('reviewCommand truncates content > 120 chars in default preview', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'review-truncate-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const longContent = 'Z'.repeat(250);
  const records = [makePendingRecord({ id: 'mem_1', content: longContent })];

  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };
  try {
    await reviewCommand(['pending', '--repo', tmpDir]);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Should be truncated
  assert.ok(output.includes('Z'.repeat(120) + '…'));
  assert.ok(!output.includes('Z'.repeat(250)));
});
