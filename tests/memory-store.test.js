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
  assert.equal(memory.text, 'User prefers concise Chinese replies.');
  assert.equal(memory.scope, 'assistant');
  assert.equal(memory.source, 'codex');
  assert.equal(memory.createdAt, '2026-06-01T10:00:00.000Z');
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
