import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCanonicalKey,
  normalizeContent,
  normalizeMemoryInput,
  validateMemory,
  computeTrustTier
} from '../src/schema.js';

test('normalizeMemoryInput creates schema v1 memory defaults', () => {
  const memory = normalizeMemoryInput({
    content: '  用户偏好简洁中文回答。 ',
    kind: 'preference',
    scope: 'user',
    source: { type: 'manual', agent: 'codex' },
    now: new Date('2026-06-01T10:00:00.000Z')
  });

  assert.equal(memory.schemaVersion, 1);
  assert.equal(memory.kind, 'preference');
  assert.equal(memory.scope, 'user');
  assert.equal(memory.content, '用户偏好简洁中文回答。');
  assert.equal(memory.summary, '用户偏好简洁中文回答。');
  assert.equal(memory.confidence, 1);
  assert.equal(memory.veracity, 'stated');
  assert.equal(memory.importance, 0.5);
  assert.equal(memory.createdAt, '2026-06-01T10:00:00.000Z');
  assert.equal(memory.updatedAt, '2026-06-01T10:00:00.000Z');
  assert.equal(memory.validUntil, null);
  assert.equal(memory.deletedAt, null);
  assert.deepEqual(memory.evidence, []);
  assert.deepEqual(memory.supersedes, []);
  assert.deepEqual(memory.tags, []);
  assert.ok(memory.id.startsWith('mem_'));
  assert.ok(memory.canonicalKey.startsWith('preference:user:'));
});

test('normalizeMemoryInput preserves valid explicit metadata', () => {
  const memory = normalizeMemoryInput({
    content: ' 工具发现 Node 版本必须 >= 20。 ',
    summary: ' Node 20 requirement ',
    kind: 'project_fact',
    scope: 'project',
    projectId: 'mem-sync',
    agentId: 'codex',
    source: { type: 'tool', agent: 'codex', device: 'macbook' },
    evidence: [{ type: 'file', path: 'package.json' }],
    confidence: 0.8,
    veracity: 'tool',
    importance: 0.9,
    validUntil: '2027-01-01T00:00:00.000Z',
    deletedAt: null,
    supersedes: ['mem_old'],
    tags: ['runtime'],
    now: new Date('2026-06-01T10:00:00.000Z')
  });

  assert.equal(memory.content, '工具发现 Node 版本必须 >= 20。');
  assert.equal(memory.summary, 'Node 20 requirement');
  assert.equal(memory.projectId, 'mem-sync');
  assert.equal(memory.agentId, 'codex');
  assert.deepEqual(memory.source, { type: 'tool', agent: 'codex', device: 'macbook' });
  assert.deepEqual(memory.evidence, [{ type: 'file', path: 'package.json' }]);
  assert.equal(memory.confidence, 0.8);
  assert.equal(memory.veracity, 'tool');
  assert.equal(memory.importance, 0.9);
  assert.equal(memory.validUntil, '2027-01-01T00:00:00.000Z');
  assert.deepEqual(memory.supersedes, ['mem_old']);
  assert.deepEqual(memory.tags, ['runtime']);
});

test('createCanonicalKey is stable and includes scope', () => {
  const base = normalizeMemoryInput({
    content: 'Same content',
    kind: 'episode',
    scope: 'global',
    now: new Date('2026-06-01T10:00:00.000Z')
  });
  const same = createCanonicalKey({ ...base, content: '  Same   content  ' });
  const differentScope = createCanonicalKey({ ...base, scope: 'user' });

  assert.equal(same, base.canonicalKey);
  assert.notEqual(differentScope, base.canonicalKey);
});

test('validateMemory rejects unknown kind', () => {
  assert.throws(() => validateMemory({
    schemaVersion: 1,
    id: 'mem_x',
    canonicalKey: 'unknown:user:::x',
    kind: 'unknown',
    scope: 'user',
    content: 'x',
    summary: 'x',
    source: { type: 'manual' },
    evidence: [],
    confidence: 1,
    veracity: 'stated',
    importance: 0.5,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    tags: []
  }), /kind/);
});

test('validateMemory rejects invalid confidence range', () => {
  const memory = normalizeMemoryInput({ content: 'x', now: new Date('2026-06-01T10:00:00.000Z') });
  assert.throws(() => validateMemory({ ...memory, confidence: 1.2 }), /confidence/);
});

test('validateMemory rejects malformed arrays and timestamps', () => {
  const memory = normalizeMemoryInput({ content: 'x', now: new Date('2026-06-01T10:00:00.000Z') });

  assert.throws(() => validateMemory({ ...memory, evidence: {} }), /evidence/);
  assert.throws(() => validateMemory({ ...memory, supersedes: 'mem_old' }), /supersedes/);
  assert.throws(() => validateMemory({ ...memory, tags: 'tag' }), /tags/);
  assert.throws(() => validateMemory({ ...memory, updatedAt: 'not-a-date' }), /updatedAt/);
});

test('normalizeContent rejects non-string and empty values', () => {
  assert.equal(normalizeContent('  a\n\tb  '), 'a b');
  assert.throws(() => normalizeContent(null), /content/);
  assert.throws(() => normalizeContent('   '), /content/);
});

test('normalizeMemoryInput accepts legacy text field and explicit id', () => {
  const memory = normalizeMemoryInput({
    id: 'mem_explicit',
    text: ' Legacy text body ',
    now: '2026-06-02T00:00:00.000Z'
  });

  assert.equal(memory.id, 'mem_explicit');
  assert.equal(memory.content, 'Legacy text body');
});

test('createCanonicalKey changes when projectId or agentId changes', () => {
  const base = normalizeMemoryInput({ content: 'Scoped fact', kind: 'project_fact', scope: 'project', projectId: 'a', agentId: 'agent-1' });
  const differentProject = normalizeMemoryInput({ content: 'Scoped fact', kind: 'project_fact', scope: 'project', projectId: 'b', agentId: 'agent-1' });
  const differentAgent = normalizeMemoryInput({ content: 'Scoped fact', kind: 'project_fact', scope: 'project', projectId: 'a', agentId: 'agent-2' });

  assert.notEqual(base.canonicalKey, differentProject.canonicalKey);
  assert.notEqual(base.canonicalKey, differentAgent.canonicalKey);
});

test('normalizeMemoryInput applies defaults for non-manual source through public API', () => {
  const memory = normalizeMemoryInput({ content: 'Imported fact', source: { type: 'imported' } });

  assert.equal(memory.confidence, 0.5);
  assert.equal(memory.veracity, 'unknown');
});

// ─── REQ-013: Provenance fields ──────────────────────────────────────

test('provenance fields default to null when not provided', () => {
  const memory = normalizeMemoryInput({
    content: 'test content',
    now: new Date('2026-06-01T10:00:00.000Z')
  });

  assert.equal(memory.author, null);
  assert.equal(memory.device, null);
  assert.equal(memory.session, null);
  assert.equal(memory.reviewer, null);
  assert.equal(memory.reviewedAt, null);
  assert.equal(memory.trustTier, null);
});

test('provenance fields are preserved when explicitly provided', () => {
  const memory = normalizeMemoryInput({
    content: 'test content',
    author: 'huguangyao',
    device: 'macbook-pro',
    session: 'sess_abc123',
    reviewer: 'reviewer1',
    reviewedAt: '2026-06-02T10:00:00.000Z',
    trustTier: 'high',
    now: new Date('2026-06-01T10:00:00.000Z')
  });

  assert.equal(memory.author, 'huguangyao');
  assert.equal(memory.device, 'macbook-pro');
  assert.equal(memory.session, 'sess_abc123');
  assert.equal(memory.reviewer, 'reviewer1');
  assert.equal(memory.reviewedAt, '2026-06-02T10:00:00.000Z');
  assert.equal(memory.trustTier, 'high');
});

test('validateMemory accepts old records without provenance fields', () => {
  // Old record missing provenance fields should still pass validation
  const oldRecord = {
    schemaVersion: 1,
    id: 'mem_oldrecord',
    canonicalKey: 'episode:global:::oldrecord',
    kind: 'episode',
    scope: 'global',
    content: 'old content',
    summary: 'old summary',
    source: { type: 'manual' },
    evidence: [],
    confidence: 1,
    veracity: 'stated',
    importance: 0.5,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    tags: []
    // No author, device, session, reviewer, reviewedAt, trustTier
  };

  assert.doesNotThrow(() => validateMemory(oldRecord));
});

test('validateMemory accepts records with provenance fields', () => {
  const record = {
    schemaVersion: 1,
    id: 'mem_newrecord',
    canonicalKey: 'episode:global:::newrecord',
    kind: 'episode',
    scope: 'global',
    content: 'new content',
    summary: 'new summary',
    source: { type: 'manual' },
    evidence: [],
    confidence: 1,
    veracity: 'stated',
    importance: 0.5,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    tags: [],
    author: 'huguangyao',
    device: 'laptop',
    session: 'sess_1',
    reviewer: 'reviewer1',
    reviewedAt: '2026-06-02T10:00:00.000Z',
    trustTier: 'high'
  };

  assert.doesNotThrow(() => validateMemory(record));
});

// ─── computeTrustTier ───────────────────────────────────────────────

test('computeTrustTier returns high when reviewer present and confidence >= 0.7', () => {
  const record = { reviewer: 'alice', confidence: 0.8, source: { type: 'manual' } };
  assert.equal(computeTrustTier(record), 'high');
});

test('computeTrustTier returns medium when reviewer present but confidence < 0.7', () => {
  const record = { reviewer: 'alice', confidence: 0.5, source: { type: 'manual' } };
  assert.equal(computeTrustTier(record), 'medium');
});

test('computeTrustTier returns medium when source is manual with confidence >= 0.5 (no reviewer)', () => {
  const record = { reviewer: null, confidence: 0.6, source: { type: 'manual' } };
  assert.equal(computeTrustTier(record), 'medium');
});

test('computeTrustTier returns low when source is inferred (no reviewer)', () => {
  const record = { reviewer: null, confidence: 0.8, source: { type: 'inferred' } };
  assert.equal(computeTrustTier(record), 'low');
});

test('computeTrustTier returns low when source is imported (no reviewer)', () => {
  const record = { reviewer: null, confidence: 0.9, source: { type: 'imported' } };
  assert.equal(computeTrustTier(record), 'low');
});

test('computeTrustTier returns untrusted when confidence < 0.3 and no reviewer', () => {
  const record = { reviewer: null, confidence: 0.1, source: { type: 'manual' } };
  assert.equal(computeTrustTier(record), 'untrusted');
});

test('computeTrustTier returns medium for manual source with confidence < 0.5, no reviewer', () => {
  const record = { reviewer: null, confidence: 0.4, source: { type: 'manual' } };
  assert.equal(computeTrustTier(record), 'medium');
});

test('computeTrustTier handles empty string reviewer as no reviewer', () => {
  const record = { reviewer: '', confidence: 0.8, source: { type: 'manual' } };
  assert.equal(computeTrustTier(record), 'medium');
});

// ─── REQ-014: Scope bank model — personal and team scopes ───────────

test('personal scope is valid and passes validateMemory', () => {
  const memory = normalizeMemoryInput({
    content: '个人偏好设置',
    scope: 'personal',
    now: new Date('2026-06-03T10:00:00.000Z')
  });

  assert.equal(memory.scope, 'personal');
  // validateMemory is called internally by normalizeMemoryInput; no throw means it passed
  assert.ok(memory.canonicalKey.startsWith('episode:personal:'));
});

test('team scope is valid and passes validateMemory', () => {
  const memory = normalizeMemoryInput({
    content: 'Team coding standards',
    scope: 'team',
    now: new Date('2026-06-03T10:00:00.000Z')
  });

  assert.equal(memory.scope, 'team');
  assert.ok(memory.canonicalKey.startsWith('episode:team:'));
});

test('validateMemory accepts personal scope directly', () => {
  const record = {
    schemaVersion: 1,
    id: 'mem_personal',
    canonicalKey: 'episode:personal:::x',
    kind: 'episode',
    scope: 'personal',
    content: 'personal content',
    summary: 'personal summary',
    source: { type: 'manual' },
    evidence: [],
    confidence: 1,
    veracity: 'stated',
    importance: 0.5,
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    tags: []
  };
  assert.doesNotThrow(() => validateMemory(record));
});

test('validateMemory accepts team scope directly', () => {
  const record = {
    schemaVersion: 1,
    id: 'mem_team',
    canonicalKey: 'episode:team:::x',
    kind: 'episode',
    scope: 'team',
    content: 'team content',
    summary: 'team summary',
    source: { type: 'manual' },
    evidence: [],
    confidence: 1,
    veracity: 'stated',
    importance: 0.5,
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: [],
    tags: []
  };
  assert.doesNotThrow(() => validateMemory(record));
});

test('user scope is still valid for backward compatibility', () => {
  const memory = normalizeMemoryInput({
    content: 'legacy user scoped content',
    scope: 'user',
    now: new Date('2026-06-03T10:00:00.000Z')
  });

  assert.equal(memory.scope, 'user');
  assert.ok(memory.canonicalKey.startsWith('episode:user:'));
});

test('normalizeMemoryInput rejects invalid scope', () => {
  assert.throws(() => normalizeMemoryInput({
    content: 'test',
    scope: 'invalid-scope',
    now: new Date('2026-06-03T10:00:00.000Z')
  }), /scope/);
});

test('normalizeMemoryInput rejects invalid timestamp fields with field names', () => {
  assert.throws(() => normalizeMemoryInput({ content: 'x', now: 'not-date' }), /now must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', createdAt: 'not-date' }), /createdAt must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', updatedAt: 'not-date' }), /updatedAt must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', validUntil: 'not-date' }), /validUntil must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', deletedAt: 'not-date' }), /deletedAt must be a valid ISO timestamp/);
});
