import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, mergeMemorySets } from '../src/memory-store.js';

test('createMemoryStore normalizes text and assigns stable ids', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  const store = createMemoryStore({ now });

  const memory = store.add('  User prefers concise Chinese replies.  ', {
    scope: 'assistant',
    source: 'codex'
  });

  assert.equal(memory.id, 'mem_306e0d41d406');
  assert.equal(memory.content, 'User prefers concise Chinese replies.');
  assert.equal(memory.scope, 'agent');
  assert.deepEqual(memory.source, { type: 'manual', agent: 'codex' });
  assert.equal(memory.createdAt, '2026-06-01T10:00:00.000Z');
});

test('createMemoryStore.add returns schema v1-compatible memories', () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  const logs = [];
  const store = createMemoryStore({
    now,
    logger: (message) => logs.push(message)
  });

  const memory = store.add('  用户偏好简洁中文回答。 ', {
    kind: 'preference',
    scope: 'user',
    source: { type: 'manual', agent: 'codex' },
    tags: ['language']
  });

  assert.equal(memory.schemaVersion, 1);
  assert.equal(memory.content, '用户偏好简洁中文回答。');
  assert.equal(memory.summary, '用户偏好简洁中文回答。');
  assert.equal(memory.kind, 'preference');
  assert.equal(memory.scope, 'user');
  assert.equal(memory.confidence, 1);
  assert.equal(memory.veracity, 'stated');
  assert.deepEqual(memory.tags, ['language']);
  assert.ok(memory.id.startsWith('mem_'));
  assert.ok(memory.canonicalKey.startsWith('preference:user:'));
  assert.deepEqual(logs, [
    '[mem-sync:schema] normalize:start',
    '[mem-sync:schema] validate:ok',
    '[mem-sync:store] memory:accepted'
  ]);
});

test('createMemoryStore.add writes validation diagnostics to logger before throwing', () => {
  const logs = [];
  const store = createMemoryStore({ logger: (message) => logs.push(message) });

  assert.throws(() => store.add('x', { kind: 'unknown' }), /kind/);
  assert.deepEqual(logs, [
    '[mem-sync:schema] normalize:start',
    '[mem-sync:schema] validate:error kind must be one of: preference, identity, project_fact, decision, workflow, correction, warning, episode.'
  ]);
});

test('mergeMemorySets keeps newest version for matching ids', () => {
  const merged = mergeMemorySets([
    [{ id: 'mem_a', text: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }],
    [{ id: 'mem_a', text: 'new', updatedAt: '2026-02-01T00:00:00.000Z' }],
    [{ id: 'mem_b', text: 'other', updatedAt: '2026-01-15T00:00:00.000Z' }]
  ]);

  assert.deepEqual(merged.map((memory) => memory.id), ['mem_b', 'mem_a']);
  assert.equal(merged.find((memory) => memory.id === 'mem_a').text, 'new');
});
