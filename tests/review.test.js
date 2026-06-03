import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { reviewCommand, parseReviewArgs, formatTable, approveCommand, rejectCommand, parseApproveArgs, parseRejectArgs } from '../src/commands/review.js';
import { findAndRemoveFromPending, removeAllPending } from '../src/merge.js';

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

test('parseReviewArgs returns defaults when called with empty args', () => {
  const opts = parseReviewArgs([]);
  assert.equal(opts.kind, undefined);
  assert.equal(opts.full, false);
  assert.ok(typeof opts.repo === 'string' && opts.repo.length > 0);
});

test('parseReviewArgs returns defaults with pending subcommand', () => {
  const opts = parseReviewArgs(['pending']);
  assert.equal(opts.kind, undefined);
  assert.equal(opts.full, false);
  assert.ok(typeof opts.repo === 'string' && opts.repo.length > 0);
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

// ─── findAndRemoveFromPending ──────────────────────────────────────

test('findAndRemoveFromPending finds and removes record from .jsonl', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'far-jsonl-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_a' }),
    makePendingRecord({ id: 'mem_b' }),
    makePendingRecord({ id: 'mem_c' }),
  ];
  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  try {
    const result = findAndRemoveFromPending(pendingDir, 'mem_b');
    assert.equal(result.found, true);
    assert.equal(result.record.id, 'mem_b');

    // Verify the file no longer contains mem_b
    const remaining = readFileSync(join(pendingDir, 'batch.jsonl'), 'utf8');
    assert.ok(!remaining.includes('mem_b'));
    assert.ok(remaining.includes('mem_a'));
    assert.ok(remaining.includes('mem_c'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('findAndRemoveFromPending finds and removes record from .json', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'far-json-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_x' }),
    makePendingRecord({ id: 'mem_y' }),
  ];
  writeFileSync(
    join(pendingDir, 'data.json'),
    JSON.stringify(records, null, 2) + '\n'
  );

  try {
    const result = findAndRemoveFromPending(pendingDir, 'mem_x');
    assert.equal(result.found, true);
    assert.equal(result.record.id, 'mem_x');

    // After 2→1 items, write maintains single-object format (matching forget.js)
    const remaining = JSON.parse(readFileSync(join(pendingDir, 'data.json'), 'utf8'));
    assert.equal(remaining.id, 'mem_y');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('findAndRemoveFromPending returns not found for missing ID', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'far-miss-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    JSON.stringify(makePendingRecord({ id: 'mem_1' })) + '\n'
  );

  try {
    const result = findAndRemoveFromPending(pendingDir, 'mem_nonexistent');
    assert.equal(result.found, false);
    assert.equal(result.record, null);
    assert.equal(result.filePath, null);

    // File should remain unchanged
    const content = readFileSync(join(pendingDir, 'batch.jsonl'), 'utf8');
    assert.ok(content.includes('mem_1'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('findAndRemoveFromPending handles non-existent pending dir', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'far-nodir-'));
  // Don't create pending dir

  try {
    const result = findAndRemoveFromPending(join(tmpDir, 'pending'), 'mem_x');
    assert.equal(result.found, false);
    assert.equal(result.record, null);
    assert.equal(result.filePath, null);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── removeAllPending ──────────────────────────────────────────────

test('removeAllPending removes all records and returns count', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rap-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  writeFileSync(
    join(pendingDir, 'a.jsonl'),
    [
      JSON.stringify(makePendingRecord({ id: 'mem_1' })),
      JSON.stringify(makePendingRecord({ id: 'mem_2' })),
    ].join('\n') + '\n'
  );
  writeFileSync(
    join(pendingDir, 'b.jsonl'),
    JSON.stringify(makePendingRecord({ id: 'mem_3' })) + '\n'
  );

  try {
    const result = removeAllPending(pendingDir);
    assert.equal(result.count, 3);
    assert.deepStrictEqual(result.ids.sort(), ['mem_1', 'mem_2', 'mem_3']);

    // Verify files are emptied
    assert.equal(readFileSync(join(pendingDir, 'a.jsonl'), 'utf8'), '');
    assert.equal(readFileSync(join(pendingDir, 'b.jsonl'), 'utf8'), '');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('removeAllPending handles non-existent pending dir', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rap-nodir-'));

  try {
    const result = removeAllPending(join(tmpDir, 'pending'));
    assert.equal(result.count, 0);
    assert.deepStrictEqual(result.ids, []);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── parseApproveArgs ──────────────────────────────────────────────

test('parseApproveArgs parses id and defaults', () => {
  const opts = parseApproveArgs(['mem_test123']);
  assert.equal(opts.id, 'mem_test123');
  assert.equal(opts.all, false);
  assert.ok(typeof opts.repo === 'string' && opts.repo.length > 0);
});

test('parseApproveArgs parses --all', () => {
  const opts = parseApproveArgs(['--all']);
  assert.equal(opts.id, undefined);
  assert.equal(opts.all, true);
});

test('parseApproveArgs parses --repo', () => {
  const opts = parseApproveArgs(['mem_x', '--repo', '/tmp/my']);
  assert.equal(opts.repo, '/tmp/my');
});

test('parseApproveArgs throws when no id or --all', () => {
  assert.throws(
    () => parseApproveArgs([]),
    /approve requires a memory id or --all flag/
  );
});

// ─── parseRejectArgs ───────────────────────────────────────────────

test('parseRejectArgs parses id and defaults', () => {
  const opts = parseRejectArgs(['mem_test456']);
  assert.equal(opts.id, 'mem_test456');
  assert.equal(opts.all, false);
  assert.ok(typeof opts.repo === 'string' && opts.repo.length > 0);
});

test('parseRejectArgs parses --all', () => {
  const opts = parseRejectArgs(['--all']);
  assert.equal(opts.id, undefined);
  assert.equal(opts.all, true);
});

test('parseRejectArgs throws when no id or --all', () => {
  assert.throws(
    () => parseRejectArgs([]),
    /reject requires a memory id or --all flag/
  );
});

// ─── approveCommand ────────────────────────────────────────────────

test('approveCommand single approve moves record to memories.jsonl', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'approve-1-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const record = makePendingRecord({ id: 'mem_test001', kind: 'episode', content: 'Test approve content.' });
  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    JSON.stringify(record) + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };

  try {
    await approveCommand(['mem_test001', '--repo', tmpDir]);

    // Check output
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.approved, 'mem_test001');

    // Check pending record is gone
    const pendingContent = readFileSync(join(pendingDir, 'batch.jsonl'), 'utf8');
    assert.equal(pendingContent, '');

    // Check memories.jsonl has the record
    const memoriesPath = join(tmpDir, 'memories.jsonl');
    assert.ok(existsSync(memoriesPath));
    const memoriesRaw = readFileSync(memoriesPath, 'utf8');
    const line = memoriesRaw.trim();
    const approved = JSON.parse(line);
    assert.equal(approved.id, 'mem_test001');
    assert.equal(approved.content, 'Test approve content.');
    assert.ok(approved.canonicalKey);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('approveCommand --all moves all pending records', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'approve-all-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_a', content: 'First' }),
    makePendingRecord({ id: 'mem_b', content: 'Second' }),
    makePendingRecord({ id: 'mem_c', content: 'Third' }),
  ];
  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };

  try {
    await approveCommand(['--all', '--repo', tmpDir]);

    const parsed = JSON.parse(output.trim());
    assert.deepStrictEqual(parsed.approved.sort(), ['mem_a', 'mem_b', 'mem_c']);
    assert.equal(parsed.count, 3);

    // Check all pending records are cleared
    const pendingContent = readFileSync(join(pendingDir, 'batch.jsonl'), 'utf8');
    assert.equal(pendingContent, '');

    // Check memories.jsonl has all 3 records
    const memoriesPath = join(tmpDir, 'memories.jsonl');
    const memoriesRaw = readFileSync(memoriesPath, 'utf8');
    const approvedIds = memoriesRaw.trim().split('\n').map(l => JSON.parse(l).id);
    assert.deepStrictEqual(approvedIds.sort(), ['mem_a', 'mem_b', 'mem_c']);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('approveCommand error on non-existent ID', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'approve-err-'));
  mkdirSync(join(tmpDir, 'pending'), { recursive: true });

  let errorOutput = '';
  const originalError = console.error;
  console.error = (msg) => { errorOutput += msg + '\n'; };
  const origExitCode = process.exitCode;

  try {
    process.exitCode = 0;
    await approveCommand(['mem_noexist', '--repo', tmpDir]);

    assert.equal(process.exitCode, 1);
    assert.ok(errorOutput.includes('mem-sync: no pending record with id: mem_noexist'));
  } finally {
    console.error = originalError;
    process.exitCode = origExitCode;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── rejectCommand ─────────────────────────────────────────────────

test('rejectCommand single reject removes from pending', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'reject-1-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_x' }),
    makePendingRecord({ id: 'mem_y' }),
  ];
  writeFileSync(
    join(pendingDir, 'batch.jsonl'),
    records.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };

  try {
    rejectCommand(['mem_x', '--repo', tmpDir]);

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.rejected, 'mem_x');

    // Check mem_x is gone, mem_y remains
    const pendingContent = readFileSync(join(pendingDir, 'batch.jsonl'), 'utf8');
    assert.ok(!pendingContent.includes('mem_x'));
    assert.ok(pendingContent.includes('mem_y'));

    // Check no memories.jsonl was created
    const memoriesPath = join(tmpDir, 'memories.jsonl');
    assert.equal(existsSync(memoriesPath), false);
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rejectCommand --all removes all pending', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'reject-all-'));
  const pendingDir = join(tmpDir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makePendingRecord({ id: 'mem_1' }),
    makePendingRecord({ id: 'mem_2' }),
  ];
  writeFileSync(
    join(pendingDir, 'a.jsonl'),
    JSON.stringify(records[0]) + '\n'
  );
  writeFileSync(
    join(pendingDir, 'b.jsonl'),
    JSON.stringify(records[1]) + '\n'
  );

  let output = '';
  const originalLog = console.log;
  console.log = (msg) => { output += msg + '\n'; };

  try {
    rejectCommand(['--all', '--repo', tmpDir]);

    const parsed = JSON.parse(output.trim());
    assert.deepStrictEqual(parsed.rejected.sort(), ['mem_1', 'mem_2']);
    assert.equal(parsed.count, 2);

    // Verify files are emptied
    assert.equal(readFileSync(join(pendingDir, 'a.jsonl'), 'utf8'), '');
    assert.equal(readFileSync(join(pendingDir, 'b.jsonl'), 'utf8'), '');
  } finally {
    console.log = originalLog;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('rejectCommand error on non-existent ID', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'reject-err-'));
  mkdirSync(join(tmpDir, 'pending'), { recursive: true });

  let errorOutput = '';
  const originalError = console.error;
  console.error = (msg) => { errorOutput += msg + '\n'; };
  const origExitCode = process.exitCode;

  try {
    process.exitCode = 0;
    rejectCommand(['mem_noexist', '--repo', tmpDir]);

    assert.equal(process.exitCode, 1);
    assert.ok(errorOutput.includes('mem-sync: no pending record with id: mem_noexist'));
  } finally {
    console.error = originalError;
    process.exitCode = origExitCode;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
