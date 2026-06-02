import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  cosineSimilarity,
  float32ToBlob,
  blobToFloat32,
  insertEmbeddings,
  queryEmbeddings,
  computeHybridScore,
  getEmbeddingStatus
} from '../src/embedding-cache.js';

// ─── cosineSimilarity ────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3, 4, 5]);
    const b = new Float32Array([1, 2, 3, 4, 5]);
    assert.ok(Math.abs(cosineSimilarity(a, b) - 1.0) < 1e-6);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b) - 0.0) < 1e-6);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b) - (-1.0)) < 1e-6);
  });

  it('returns 0 for zero vector', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    assert.equal(cosineSimilarity(a, b), 0);
  });
});

// ─── float32ToBlob / blobToFloat32 ──────────────────────────────────

describe('float32ToBlob / blobToFloat32', () => {
  it('round-trip preserves exact values', () => {
    const original = new Float32Array([0.1, 0.2, 0.3, -0.5, 1.0]);
    const blob = float32ToBlob(original);
    const restored = blobToFloat32(blob);

    assert.equal(restored.length, original.length);
    for (let i = 0; i < original.length; i++) {
      assert.equal(restored[i], original[i]);
    }
  });

  it('works correctly with Float32Array subarray/offset views', () => {
    // Create a larger buffer and take a subarray (which has a non-zero byteOffset)
    const full = new Float32Array([10, 20, 30, 40, 50, 60]);
    const sub = full.subarray(2, 5); // [30, 40, 50] with byteOffset=8

    const blob = float32ToBlob(sub);
    const restored = blobToFloat32(blob);

    assert.equal(restored.length, 3);
    assert.equal(restored[0], 30);
    assert.equal(restored[1], 40);
    assert.equal(restored[2], 50);
  });
});

// ─── insertEmbeddings / queryEmbeddings ──────────────────────────────

describe('insertEmbeddings / queryEmbeddings', () => {
  it('stores vectors that can be retrieved by queryEmbeddings', () => {
    const db = new Database(':memory:');

    try {
      const vec1 = new Float32Array([0.1, 0.2, 0.3]);
      const vec2 = new Float32Array([0.4, 0.5, 0.6]);

      insertEmbeddings(db, [1, 2], [vec1, vec2], 'test-model', 3);

      const result = queryEmbeddings(db, [1, 2]);

      assert.equal(result.size, 2);
      assert.ok(result.has(1));
      assert.ok(result.has(2));

      const r1 = result.get(1);
      assert.equal(r1.length, 3);
      assert.ok(Math.abs(r1[0] - 0.1) < 1e-7);
      assert.ok(Math.abs(r1[1] - 0.2) < 1e-7);
      assert.ok(Math.abs(r1[2] - 0.3) < 1e-7);

      const r2 = result.get(2);
      assert.ok(Math.abs(r2[0] - 0.4) < 1e-7);
      assert.ok(Math.abs(r2[1] - 0.5) < 1e-7);
      assert.ok(Math.abs(r2[2] - 0.6) < 1e-7);
    } finally {
      db.close();
    }
  });

  it('returns empty Map for non-existent rowids', () => {
    const db = new Database(':memory:');

    try {
      insertEmbeddings(db, [1], [new Float32Array([1, 2, 3])], 'test-model', 3);

      const result = queryEmbeddings(db, [999, 1000]);
      assert.equal(result.size, 0);
    } finally {
      db.close();
    }
  });

  it('returns empty Map for empty input', () => {
    const db = new Database(':memory:');

    try {
      const result = queryEmbeddings(db, []);
      assert.equal(result.size, 0);
    } finally {
      db.close();
    }
  });
});

// ─── computeHybridScore ──────────────────────────────────────────────

describe('computeHybridScore', () => {
  it('with weight=0 returns pure cosine similarity', () => {
    // weight=0: 0 * bm25 + 1 * max(0, cos)
    const score = computeHybridScore(-5, 0.8, 0);
    assert.ok(Math.abs(score - 0.8) < 1e-9);
  });

  it('with weight=1 returns pure normalized BM25', () => {
    // weight=1: 1 * (1/(1+|bm25|)) + 0 * cos
    const bm25Rank = -3;
    const expected = 1 / (1 + Math.abs(bm25Rank));
    const score = computeHybridScore(bm25Rank, 0.8, 1);
    assert.ok(Math.abs(score - expected) < 1e-9);
  });

  it('with default weight=0.4 returns correct blend', () => {
    const bm25Rank = -2;
    const cosineSim = 0.6;
    // weight=0.4: 0.4 * (1/(1+2)) + 0.6 * max(0, 0.6)
    const expected = 0.4 * (1 / 3) + 0.6 * 0.6;
    const score = computeHybridScore(bm25Rank, cosineSim);
    assert.ok(Math.abs(score - expected) < 1e-9);
  });
});
