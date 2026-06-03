import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore, mergeMemorySets } from '../src/memory-store.js';
import { resolveStorePath } from '../src/repo-store.js';

/**
 * 辅助函数：创建带隔离存储路径的 memory store。
 * 每个测试使用独立临时目录，避免持久化副作用相互污染。
 */
async function tempStore(name, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), `mem-sync-store-${name}-`));
  const storePath = resolveStorePath(dir);
  const store = createMemoryStore({ storePath, ...options });
  return { dir, storePath, store };
}

test('createMemoryStore normalizes text and assigns stable ids', async () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  const { dir, store } = await tempStore('stable-ids', { now });

  try {
    const memory = await store.add('  User prefers concise Chinese replies.  ', {
      scope: 'assistant',
      source: 'codex'
    });

    assert.equal(memory.id, 'mem_306e0d41d406');
    assert.equal(memory.content, 'User prefers concise Chinese replies.');
    assert.equal(memory.scope, 'agent');
    assert.deepEqual(memory.source, { type: 'manual', agent: 'codex' });
    assert.equal(memory.createdAt, '2026-06-01T10:00:00.000Z');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createMemoryStore.add returns schema v1-compatible memories', async () => {
  const now = new Date('2026-06-01T10:00:00.000Z');
  const logs = [];
  const { dir, store } = await tempStore('schema-v1', {
    now,
    logger: (message) => logs.push(message)
  });

  try {
    const memory = await store.add('  用户偏好简洁中文回答。 ', {
      kind: 'preference',
      scope: 'user',
      source: { type: 'manual', agent: 'codex' },
      tags: ['language']
    });

    assert.equal(memory.schemaVersion, 1);
    assert.equal(memory.content, '用户偏好简洁中文回答。');
    assert.equal(memory.summary, '用户偏好简洁中文回答。');
    assert.equal(memory.kind, 'preference');
    // 'user' scope is normalized to 'personal' by normalizeLegacyScope
    assert.equal(memory.scope, 'personal');
    assert.equal(memory.confidence, 1);
    assert.equal(memory.veracity, 'stated');
    assert.deepEqual(memory.tags, ['language']);
    assert.ok(memory.id.startsWith('mem_'));
    assert.ok(memory.canonicalKey.startsWith('preference:personal:'));
    assert.deepEqual(logs, [
      '[mem-sync:schema] normalize:start',
      '[mem-sync:schema] validate:ok',
      '[mem-sync:store] memory:accepted'
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createMemoryStore.add writes validation diagnostics to logger before throwing', async () => {
  const logs = [];
  const { dir, store } = await tempStore('validation-error', {
    logger: (message) => logs.push(message)
  });

  try {
    await assert.rejects(() => store.add('x', { kind: 'unknown' }), /kind/);
    assert.deepEqual(logs, [
      '[mem-sync:schema] normalize:start',
      '[mem-sync:schema] validate:error kind must be one of: preference, identity, project_fact, decision, workflow, correction, warning, episode.'
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test('createMemoryStore.add blocks content matching redaction rules', async () => {
  const { dir, store } = await tempStore('redaction-block');

  try {
    await assert.rejects(
      () => store.add('api_key="1234567890abcdef"', { source: 'codex' }),
      /content blocked by redaction rule: api-key/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createMemoryStore.add allows redacted-looking content when skipRedaction is true', async () => {
  const { dir, store } = await tempStore('redaction-skip');

  try {
    const memory = await store.add('api_key="1234567890abcdef"', {
      source: 'codex',
      skipRedaction: true
    });

    assert.equal(memory.content, 'api_key="1234567890abcdef"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
