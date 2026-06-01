import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildCanonicalKey,
  mergeByCanonicalKey,
  readPendingFiles,
  mergePendingToStore
} from '../src/merge.js';

/**
 * 辅助函数：创建标准 v1 记忆记录。
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
    supersedes: overrides.supersedes ?? []
  };
}

// ─── buildCanonicalKey ──────────────────────────────────────────────

test('buildCanonicalKey produces scope:kind:contentHash', () => {
  const record = makeRecord({
    kind: 'preference',
    scope: 'user',
    content: '用户偏好简洁的中文回答。'
  });

  const key = buildCanonicalKey(record);

  assert.match(key, /^user:preference:[a-f0-9]{12}$/);
});

test('buildCanonicalKey is deterministic', () => {
  const record = makeRecord({ content: 'same content' });
  const key1 = buildCanonicalKey(record);
  const key2 = buildCanonicalKey(record);
  assert.equal(key1, key2);
});

test('buildCanonicalKey normalizes whitespace', () => {
  const record1 = makeRecord({ content: 'hello   world\n\ttest' });
  const record2 = makeRecord({ content: 'hello world test' });
  assert.equal(buildCanonicalKey(record1), buildCanonicalKey(record2));
});

test('buildCanonicalKey different content produces different keys', () => {
  const key1 = buildCanonicalKey(makeRecord({ content: 'alpha' }));
  const key2 = buildCanonicalKey(makeRecord({ content: 'beta' }));
  assert.notEqual(key1, key2);
});

// ─── mergeByCanonicalKey ───────────────────────────────────────────

test('mergeByCanonicalKey deduplicates by canonicalKey', () => {
  const records = [
    makeRecord({ id: 'mem_a', content: 'unique A' }),
    makeRecord({ id: 'mem_b', content: 'unique B' }),
    makeRecord({ id: 'mem_a2', content: 'unique A' }) // same key as mem_a
  ];

  const merged = mergeByCanonicalKey(records);
  assert.equal(merged.length, 2);
});

test('mergeByCanonicalKey keeps latest updatedAt', () => {
  const records = [
    makeRecord({
      id: 'mem_old',
      content: 'shared content',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }),
    makeRecord({
      id: 'mem_new',
      content: 'shared content',
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
  ];

  const merged = mergeByCanonicalKey(records);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'mem_new');
});

test('mergeByCanonicalKey handles empty array', () => {
  const merged = mergeByCanonicalKey([]);
  assert.equal(merged.length, 0);
});

test('mergeByCanonicalKey preserves unique records', () => {
  const records = [
    makeRecord({ id: 'a', content: 'alpha' }),
    makeRecord({ id: 'b', content: 'beta' }),
    makeRecord({ id: 'c', content: 'gamma' })
  ];

  const merged = mergeByCanonicalKey(records);
  assert.equal(merged.length, 3);
});

// ─── readPendingFiles ───────────────────────────────────────────────

test('readPendingFiles reads JSON array from pending directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-pending-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  try {
    const records = [
      makeRecord({ id: 'p1', content: 'pending one' }),
      makeRecord({ id: 'p2', content: 'pending two' })
    ];
    writeFileSync(
      join(pendingDir, 'device-1.json'),
      JSON.stringify(records),
      'utf8'
    );

    const result = readPendingFiles(pendingDir);
    assert.equal(result.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readPendingFiles reads JSONL files from pending directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-pending-jsonl-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  try {
    const r1 = makeRecord({ id: 'l1', content: 'line one' });
    const r2 = makeRecord({ id: 'l2', content: 'line two' });
    writeFileSync(
      join(pendingDir, 'device-1.jsonl'),
      JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n',
      'utf8'
    );

    const result = readPendingFiles(pendingDir);
    assert.equal(result.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readPendingFiles returns empty array for missing directory', () => {
  const result = readPendingFiles('/nonexistent/path/pending');
  assert.deepEqual(result, []);
});

test('readPendingFiles skips non-JSON files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-nonjson-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  try {
    writeFileSync(join(pendingDir, 'notes.txt'), 'not json', 'utf8');
    writeFileSync(join(pendingDir, 'README.md'), '# readme', 'utf8');

    const result = readPendingFiles(pendingDir);
    assert.equal(result.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── mergePendingToStore ────────────────────────────────────────────

test('mergePendingToStore merges single pending file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-store-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });
  const storePath = join(dir, 'memories.jsonl');

  try {
    // 写入现有存储
    const existing = [
      makeRecord({ id: 'e1', content: 'existing one' })
    ];
    writeFileSync(storePath, JSON.stringify(existing[0]) + '\n', 'utf8');

    // 写入 pending 文件
    const pending = [
      makeRecord({ id: 'p1', content: 'pending one' }),
      makeRecord({ id: 'p2', content: 'pending two' })
    ];
    writeFileSync(join(pendingDir, 'device.json'), JSON.stringify(pending), 'utf8');

    const result = mergePendingToStore(pendingDir, storePath);

    assert.equal(result.pending, 2);
    assert.equal(result.merged, 2);
    assert.equal(result.total, 3);

    // 验证存储内容
    const stored = readFileSync(storePath, 'utf8').trim().split('\n');
    assert.equal(stored.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergePendingToStore deduplicates overlapping records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-overlap-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });
  const storePath = join(dir, 'memories.jsonl');

  try {
    // 已有一条记录
    const existing = makeRecord({
      id: 'e1', content: 'shared content',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    writeFileSync(storePath, JSON.stringify(existing) + '\n', 'utf8');

    // pending 中有同 canonicalKey 但更新的记录
    const pending = makeRecord({
      id: 'p_newer', content: 'shared content',
      updatedAt: '2026-06-01T00:00:00.000Z'
    });
    writeFileSync(join(pendingDir, 'device.json'), JSON.stringify([pending]), 'utf8');

    const result = mergePendingToStore(pendingDir, storePath);

    // pending record 应被合并（虽然在 total 中它替换了 existing）
    assert.equal(result.pending, 1);
    assert.equal(result.merged, 1);
    assert.equal(result.total, 1);

    // 验证更新的记录在存储中
    const stored = readFileSync(storePath, 'utf8').trim().split('\n');
    assert.equal(stored.length, 1);
    const parsed = JSON.parse(stored[0]);
    assert.equal(parsed.id, 'p_newer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergePendingToStore handles empty pending directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-empty-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });
  const storePath = join(dir, 'memories.jsonl');

  try {
    // 有现有记录
    writeFileSync(
      storePath,
      JSON.stringify(makeRecord({ id: 'e1' })) + '\n',
      'utf8'
    );

    const result = mergePendingToStore(pendingDir, storePath);

    assert.equal(result.pending, 0);
    assert.equal(result.merged, 0);
    assert.equal(result.total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergePendingToStore handles missing pending directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-nopending-'));

  try {
    const storePath = join(dir, 'memories.jsonl');
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, '', 'utf8');

    const result = mergePendingToStore(join(dir, 'nonexistent'), storePath);

    assert.equal(result.pending, 0);
    assert.equal(result.merged, 0);
    assert.equal(result.total, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergePendingToStore removes merged pending files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-remove-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });
  const storePath = join(dir, 'memories.jsonl');
  writeFileSync(storePath, '', 'utf8');

  try {
    const pendingFile = join(pendingDir, 'device.json');
    writeFileSync(
      pendingFile,
      JSON.stringify([makeRecord({ id: 'p1', content: 'to merge' })]),
      'utf8'
    );

    mergePendingToStore(pendingDir, storePath);

    // 文件应已删除
    assert.equal(existsSync(pendingFile), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mergePendingToStore handles multi-file merge with overlaps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-merge-multi-'));
  const pendingDir = join(dir, 'pending');
  mkdirSync(pendingDir, { recursive: true });
  const storePath = join(dir, 'memories.jsonl');

  try {
    writeFileSync(storePath, '', 'utf8');

    // 两个 pending 文件，有重叠
    const common = makeRecord({
      id: 'common', content: 'common content',
      updatedAt: '2026-06-01T00:00:00.000Z'
    });
    const olderCommon = makeRecord({
      id: 'common_old', content: 'common content',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    const unique1 = makeRecord({ id: 'u1', content: 'unique one' });
    const unique2 = makeRecord({ id: 'u2', content: 'unique two' });

    writeFileSync(
      join(pendingDir, 'device-a.json'),
      JSON.stringify([common, unique1]),
      'utf8'
    );
    writeFileSync(
      join(pendingDir, 'device-b.json'),
      JSON.stringify([olderCommon, unique2]),
      'utf8'
    );

    const result = mergePendingToStore(pendingDir, storePath);

    assert.equal(result.pending, 4);
    // 只有 3 个唯一 canonicalKey（common/olderCommon 去重后只剩 1 个）
    assert.equal(result.merged, 3);
    assert.equal(result.total, 3);

    // 验证最新版本被保留
    const stored = readFileSync(storePath, 'utf8').trim().split('\n');
    const parsed = stored.map(l => JSON.parse(l));
    const commonRecord = parsed.find(r => r.content === 'common content');
    assert.ok(commonRecord);
    assert.equal(commonRecord.id, 'common');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
