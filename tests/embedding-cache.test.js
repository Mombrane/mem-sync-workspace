import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  trigramJaccard,
  mmrRerank,
  float32ToBlob,
  blobToFloat32,
  getEmbeddingStatus
} from '../src/embedding-cache.js';
import { createMockProvider } from '../src/embedding-provider.js';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── trigramJaccard ──────────────────────────────────────────────────

test('trigramJaccard with identical strings returns 1.0', () => {
  const result = trigramJaccard('hello world', 'hello world');
  assert.ok(result > 0.99, `expected ~1.0, got ${result}`);
});

test('trigramJaccard with completely different strings returns low value', () => {
  const result = trigramJaccard('abcdefghij', 'klmnopqrst');
  // No trigrams in common between these strings
  assert.equal(result, 0, `expected 0 for non-overlapping strings, got ${result}`);
});

test('trigramJaccard with empty strings returns 0', () => {
  assert.equal(trigramJaccard('', ''), 0);
  assert.equal(trigramJaccard('', 'hello'), 0);
  assert.equal(trigramJaccard('hello', ''), 0);
});

test('trigramJaccard with strings shorter than 3 chars returns 0', () => {
  // "ab" 只有 2 个字符，无法生成三元组
  assert.equal(trigramJaccard('ab', 'ab'), 0);
  assert.equal(trigramJaccard('ab', 'hello'), 0);
});

test('trigramJaccard with null/undefined returns 0', () => {
  assert.equal(trigramJaccard(null, 'hello'), 0);
  assert.equal(trigramJaccard('hello', undefined), 0);
  assert.equal(trigramJaccard(null, null), 0);
});

test('trigramJaccard with partial overlap returns value in (0, 1)', () => {
  const result = trigramJaccard('hello world', 'hello there');
  assert.ok(result > 0, `expected > 0 for partial overlap, got ${result}`);
  assert.ok(result < 1, `expected < 1 for partial overlap, got ${result}`);
  // "hel", "ell", "llo", "lo " 等应部分重叠
});

// ─── mmrRerank ───────────────────────────────────────────────────────

test('mmrRerank with empty results returns empty array', () => {
  const result = mmrRerank([], { k: 10 });
  assert.deepEqual(result, []);
});

test('mmrRerank with single result returns that result annotated', () => {
  const results = [
    { id: 'mem_a', content: 'hello world', _rank: -1.5 }
  ];
  const reranked = mmrRerank(results, { k: 10 });
  assert.equal(reranked.length, 1);
  assert.equal(reranked[0].id, 'mem_a');
  assert.ok(typeof reranked[0]._mmrScore === 'number', 'should have _mmrScore');
  assert.equal(reranked[0]._mmrLambda, 0.7, 'default lambda should be 0.7');
});

test('mmrRerank with lambda=1.0 preserves pure relevance order', () => {
  const results = [
    { id: 'mem_a', content: 'Python scripting language', _rank: -3.0 },
    { id: 'mem_b', content: 'JavaScript development', _rank: -2.0 },
    { id: 'mem_c', content: 'Rust systems programming', _rank: -1.0 },
    { id: 'mem_d', content: 'Also about Python', _rank: -0.5 }
  ];
  const reranked = mmrRerank(results, { lambda: 1.0, k: 4 });
  // λ=1.0 时纯粹按相关性排序，mem_a (rank=-3.0) 最相关
  assert.equal(reranked[0].id, 'mem_a');
  assert.equal(reranked[1].id, 'mem_b');
  assert.equal(reranked[2].id, 'mem_c');
  assert.equal(reranked[3].id, 'mem_d');
  for (const r of reranked) {
    assert.equal(r._mmrLambda, 1.0);
  }
});

test('mmrRerank with lambda=0.0 prefers diversity', () => {
  // 第一条记忆始终是相关性最高的，后续按多样性选择
  const results = [
    { id: 'mem_a', content: 'Python scripting language guide', _rank: -3.0 },
    { id: 'mem_b', content: 'Python scripting language tutorial', _rank: -2.5 },
    { id: 'mem_c', content: 'Rust systems programming memory', _rank: -2.0 },
    { id: 'mem_d', content: 'JavaScript web development framework', _rank: -1.5 }
  ];
  // mem_a 和 mem_b 内容非常相似，λ=0.0 时第二个应选择与 mem_a 最不相似的
  const reranked = mmrRerank(results, { lambda: 0.0, k: 4 });
  assert.equal(reranked.length, 4);
  // 第一条：相关性最高的 mem_a
  assert.equal(reranked[0].id, 'mem_a');
  // mem_b 与 mem_a 非常相似（trigram Jaccard 高），λ=0.0 时惩罚最重
  // mem_d 或 mem_c 应该比 mem_b 更靠前
  assert.notEqual(reranked[1].id, 'mem_b', 'mem_b should not be second due to high similarity to mem_a');
});

test('mmrRerank uses _hybridScore when available', () => {
  const results = [
    { id: 'mem_a', content: 'Python scripting', _hybridScore: 0.9, _rank: -1.0 },
    { id: 'mem_b', content: 'Python scripting tutorial', _hybridScore: 0.85, _rank: -2.0 },
    { id: 'mem_c', content: 'Rust systems', _hybridScore: 0.7, _rank: -3.0 }
  ];
  const reranked = mmrRerank(results, { lambda: 1.0, k: 3 });
  // λ=1.0 时按 _hybridScore 排序
  assert.equal(reranked[0].id, 'mem_a');
  assert.equal(reranked[1].id, 'mem_b');
  assert.equal(reranked[2].id, 'mem_c');
});

test('mmrRerank with embeddings uses cosine similarity for inter-doc sim', async () => {
  // Mock provider generates embeddings based on text length: Math.sin((text.length + 1) * (i + 1) * 0.1).
  // Use texts with very different lengths to produce clearly distinct embeddings.
  // mem_a and mem_b have identical lengths (same embedding) to guarantee high cosine similarity.
  const mockProvider = createMockProvider(32);
  const textA = 'A'.repeat(20); // 20 chars
  const textB = 'B'.repeat(20); // 20 chars — same length as A → identical mock embedding
  const textC = 'C'.repeat(50); // 50 chars — very different length → different embedding
  const textD = 'D'.repeat(80); // 80 chars — very different length → different embedding

  const vectors = await mockProvider.embed([textA, textB, textC, textD]);

  const results = [
    { id: 'mem_a', content: textA, _rowid: 1, _hybridScore: 0.95 },
    { id: 'mem_b', content: textB, _rowid: 2, _hybridScore: 0.90 },
    { id: 'mem_c', content: textC, _rowid: 3, _hybridScore: 0.80 },
    { id: 'mem_d', content: textD, _rowid: 4, _hybridScore: 0.75 }
  ];

  const embeddings = new Map();
  results.forEach((r, i) => embeddings.set(r._rowid, vectors[i]));

  // mem_a and mem_b have identical mock embeddings (cosine = 1.0),
  // so with λ=0.0, mem_b should be heavily penalized and pushed down.
  const reranked = mmrRerank(results, { lambda: 0.0, k: 4, embeddings });
  assert.equal(reranked.length, 4);
  assert.equal(reranked[0].id, 'mem_a', 'first pick is highest relevance');
  // mem_b has cosine=1.0 with mem_a (identical embeddings), so λ=0.0 penalizes it maximally
  assert.notEqual(reranked[1].id, 'mem_b',
    'mem_b should not be second when using cosine similarity due to identical embedding to mem_a');
});

test('mmrRerank without embeddings falls back to trigram Jaccard', () => {
  const results = [
    { id: 'mem_a', content: 'ABCD EFGH IJKL MNOP', _hybridScore: 0.9 },
    { id: 'mem_b', content: 'ABCD EFGH IJKL MNOP', _hybridScore: 0.85 },
    { id: 'mem_c', content: 'UVWX YZ12 3456 7890', _hybridScore: 0.80 }
  ];
  const reranked = mmrRerank(results, { lambda: 0.3, k: 3 });
  assert.equal(reranked.length, 3);
  // mem_a 和 mem_b 完全相同（trigram Jaccard = 1.0），λ=0.3 时 mem_b 应被严重惩罚
  // mem_c 内容完全不同（trigram Jaccard ≈ 0），应排在 mem_b 前面
  assert.equal(reranked[0].id, 'mem_a');
  assert.equal(reranked[1].id, 'mem_c',
    'mem_c should be second because mem_b is identical to mem_a (Jaccard=1.0)');
});

test('mmrRerank with k smaller than results returns truncated array', () => {
  const results = [
    { id: 'mem_a', content: 'First memory content', _hybridScore: 0.9 },
    { id: 'mem_b', content: 'Second memory content', _hybridScore: 0.8 },
    { id: 'mem_c', content: 'Third memory content', _hybridScore: 0.7 },
    { id: 'mem_d', content: 'Fourth memory content', _hybridScore: 0.6 }
  ];
  const reranked = mmrRerank(results, { lambda: 0.7, k: 2 });
  assert.equal(reranked.length, 2);
  assert.equal(reranked[0].id, 'mem_a');
});

test('mmrRerank preserves all original record fields', () => {
  const results = [
    { id: 'mem_a', kind: 'episode', scope: 'global', content: 'hello world',
      summary: 'hello', tags: ['test'], confidence: 0.9, _rank: -2.0 }
  ];
  const reranked = mmrRerank(results, { k: 1 });
  assert.equal(reranked[0].id, 'mem_a');
  assert.equal(reranked[0].kind, 'episode');
  assert.equal(reranked[0].scope, 'global');
  assert.equal(reranked[0].content, 'hello world');
  assert.equal(reranked[0].summary, 'hello');
  assert.deepEqual(reranked[0].tags, ['test']);
  assert.equal(reranked[0].confidence, 0.9);
  assert.equal(reranked[0]._rank, -2.0);
});

test('mmrRerank with all identical content and lambda 0.5 produces deterministic order', () => {
  // 所有结果内容完全相同，MMR 应退化为相关性排序
  const results = [
    { id: 'mem_a', content: 'same content everywhere', _hybridScore: 0.9 },
    { id: 'mem_b', content: 'same content everywhere', _hybridScore: 0.8 },
    { id: 'mem_c', content: 'same content everywhere', _hybridScore: 0.7 }
  ];
  const reranked = mmrRerank(results, { lambda: 0.5, k: 3 });
  assert.equal(reranked.length, 3);
  // 内容相同时 trigram Jaccard = 1.0，所有候选的 MMR 分数为
  // λ·rel - (1-λ)·1.0，仍按相关性排序
  assert.equal(reranked[0].id, 'mem_a');
  assert.equal(reranked[1].id, 'mem_b');
  assert.equal(reranked[2].id, 'mem_c');
});

// ─── float32ToBlob / blobToFloat32 round-trip ───────────────────────

test('float32ToBlob and blobToFloat32 round-trip preserves data', () => {
  const original = new Float32Array([1.5, -2.0, 3.14, 0.0]);
  const blob = float32ToBlob(original);
  const restored = blobToFloat32(blob);
  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.ok(
      Math.abs(restored[i] - original[i]) < 1e-6,
      `index ${i}: expected ${original[i]}, got ${restored[i]}`
    );
  }
});

// ─── cosineSimilarity ────────────────────────────────────────────────

test('cosineSimilarity of identical vectors is 1.0', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([1, 2, 3]);
  const result = cosineSimilarity(a, b);
  assert.ok(Math.abs(result - 1.0) < 1e-6, `expected 1.0, got ${result}`);
});

test('cosineSimilarity of orthogonal vectors is 0', () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  const result = cosineSimilarity(a, b);
  assert.ok(Math.abs(result) < 1e-6, `expected 0, got ${result}`);
});

test('cosineSimilarity of opposite vectors is -1.0', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([-1, -2, -3]);
  const result = cosineSimilarity(a, b);
  assert.ok(Math.abs(result - (-1.0)) < 1e-6, `expected -1.0, got ${result}`);
});

test('cosineSimilarity of zero vectors returns 0', () => {
  const a = new Float32Array([0, 0, 0]);
  const b = new Float32Array([1, 2, 3]);
  assert.equal(cosineSimilarity(a, b), 0);
});

test('cosineSimilarity throws on dimension mismatch', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([1, 2]);
  assert.throws(() => cosineSimilarity(a, b), /same length/);
});
