import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCanonicalKey,
  normalizeContent,
  normalizeMemoryInput,
  validateMemory
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

test('normalizeMemoryInput rejects invalid timestamp fields with field names', () => {
  assert.throws(() => normalizeMemoryInput({ content: 'x', now: 'not-date' }), /now must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', createdAt: 'not-date' }), /createdAt must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', updatedAt: 'not-date' }), /updatedAt must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', validUntil: 'not-date' }), /validUntil must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', deletedAt: 'not-date' }), /deletedAt must be a valid ISO timestamp/);
});
