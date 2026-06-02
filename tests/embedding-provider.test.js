import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noopProvider,
  createMockProvider,
  resolveEmbeddingProvider,
} from '../src/embedding-provider.js';

// ─── noopProvider ────────────────────────────────────────────────

test('noopProvider returns empty array for any input', async () => {
  const result = await noopProvider.embed(['hello', 'world']);
  assert.deepEqual(result, []);
});

// ─── createMockProvider ──────────────────────────────────────────

test('MockProvider produces deterministic vectors (same text → same vector)', async () => {
  const provider = createMockProvider();
  const a = await provider.embed(['hello world']);
  const b = await provider.embed(['hello world']);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.deepEqual(a[0], b[0]);
});

test('MockProvider vectors are unit-normalized (norm ≈ 1.0)', async () => {
  const provider = createMockProvider();
  const vectors = await provider.embed(['test text', 'another text']);
  for (const v of vectors) {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    assert.ok(
      Math.abs(norm - 1.0) < 1e-6,
      `expected norm ≈ 1.0, got ${norm}`
    );
  }
});

test('MockProvider respects custom dimensions', async () => {
  const provider = createMockProvider(64);
  const vectors = await provider.embed(['test']);
  assert.equal(vectors[0].length, 64);
  assert.equal(provider.dimensions, 64);
});

test('MockProvider produces different vectors for different texts', async () => {
  const provider = createMockProvider();
  const a = await provider.embed(['short']);
  const b = await provider.embed(['a much longer text string here']);
  assert.notDeepEqual(a[0], b[0]);
});

// ─── resolveEmbeddingProvider ────────────────────────────────────

test('resolveEmbeddingProvider returns noop by default (no env vars)', () => {
  const saved = process.env.MEM_SYNC_EMBEDDING_PROVIDER;
  try {
    delete process.env.MEM_SYNC_EMBEDDING_PROVIDER;
    const provider = resolveEmbeddingProvider();
    assert.equal(provider.name, 'none');
  } finally {
    if (saved !== undefined) {
      process.env.MEM_SYNC_EMBEDDING_PROVIDER = saved;
    }
  }
});

test('resolveEmbeddingProvider returns mock when MEM_SYNC_EMBEDDING_PROVIDER=mock', () => {
  const saved = process.env.MEM_SYNC_EMBEDDING_PROVIDER;
  try {
    process.env.MEM_SYNC_EMBEDDING_PROVIDER = 'mock';
    const provider = resolveEmbeddingProvider();
    assert.equal(provider.name, 'mock');
  } finally {
    if (saved !== undefined) {
      process.env.MEM_SYNC_EMBEDDING_PROVIDER = saved;
    } else {
      delete process.env.MEM_SYNC_EMBEDDING_PROVIDER;
    }
  }
});

test('resolveEmbeddingProvider throws when provider=openai but no API key', () => {
  const savedProvider = process.env.MEM_SYNC_EMBEDDING_PROVIDER;
  const savedKey = process.env.MEM_SYNC_OPENAI_API_KEY;
  try {
    process.env.MEM_SYNC_EMBEDDING_PROVIDER = 'openai';
    delete process.env.MEM_SYNC_OPENAI_API_KEY;
    assert.throws(
      () => resolveEmbeddingProvider(),
      /MEM_SYNC_OPENAI_API_KEY is required/
    );
  } finally {
    if (savedProvider !== undefined) {
      process.env.MEM_SYNC_EMBEDDING_PROVIDER = savedProvider;
    } else {
      delete process.env.MEM_SYNC_EMBEDDING_PROVIDER;
    }
    if (savedKey !== undefined) {
      process.env.MEM_SYNC_OPENAI_API_KEY = savedKey;
    }
  }
});
