import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCandidatesWithLLM,
  rerankWithLLM,
} from '../src/llm-rerank.js';
import { createMockLLMProvider } from '../src/llm-provider.js';

// ─── scoreCandidatesWithLLM ───────────────────────────────────────────

test('scoreCandidatesWithLLM returns empty for empty candidates', async () => {
  const provider = createMockLLMProvider();
  const result = await scoreCandidatesWithLLM([], 'test query', provider);
  assert.deepEqual(result, []);
});

test('scoreCandidatesWithLLM returns empty for non-array candidates', async () => {
  const provider = createMockLLMProvider();
  const result = await scoreCandidatesWithLLM(null, 'test query', provider);
  assert.deepEqual(result, []);
});

test('scoreCandidatesWithLLM respects llmTopN', async () => {
  // Create a provider that returns scores for all items
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      return JSON.stringify([
        { index: 0, score: 0.9 },
        { index: 1, score: 0.5 },
      ]);
    },
  };

  const candidates = [
    { id: 'a', kind: 'preference', content: 'prefers dark mode' },
    { id: 'b', kind: 'decision', content: 'chose React' },
    { id: 'c', kind: 'project_fact', content: 'uses Node.js' },
  ];

  const result = await scoreCandidatesWithLLM(candidates, 'dark mode', provider, { llmTopN: 2 });
  assert.equal(result.length, 2);
});

// ─── rerankWithLLM ────────────────────────────────────────────────────

test('rerankWithLLM returns empty for empty candidates', async () => {
  const provider = createMockLLMProvider();
  const result = await rerankWithLLM([], 'test query', provider);
  assert.deepEqual(result, []);
});

test('rerankWithLLM returns empty for non-array candidates', async () => {
  const provider = createMockLLMProvider();
  const result = await rerankWithLLM(null, 'test query', provider);
  assert.deepEqual(result, []);
});

test('rerankWithLLM attaches _llmScore to candidates', async () => {
  // Provider that returns distinct scores
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      return JSON.stringify([
        { index: 0, score: 0.9 },
        { index: 1, score: 0.3 },
        { index: 2, score: 0.7 },
      ]);
    },
  };

  const candidates = [
    { id: 'a', kind: 'preference', content: 'prefers dark mode', _hybridScore: 0.8 },
    { id: 'b', kind: 'decision', content: 'chose React', _hybridScore: 0.5 },
    { id: 'c', kind: 'project_fact', content: 'uses Node.js', _hybridScore: 0.6 },
  ];

  const result = await rerankWithLLM(candidates, 'dark mode', provider);

  assert.equal(result.length, 3);
  // All candidates should have _llmScore
  for (const c of result) {
    assert.equal(typeof c._llmScore, 'number');
    assert.ok(c._llmScore >= 0 && c._llmScore <= 1);
  }
});

test('rerankWithLLM attaches _llmRank and _fusedScore', async () => {
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      return JSON.stringify([
        { index: 0, score: 0.9 },
        { index: 1, score: 0.3 },
      ]);
    },
  };

  const candidates = [
    { id: 'a', content: 'test1', _hybridScore: 0.8 },
    { id: 'b', content: 'test2', _hybridScore: 0.5 },
  ];

  const result = await rerankWithLLM(candidates, 'query', provider);

  for (const c of result) {
    assert.equal(typeof c._llmRank, 'number');
    assert.equal(typeof c._fusedScore, 'number');
  }
});

test('rerankWithLLM skips fusion when variance is too low', async () => {
  // All scores are the same — variance = 0
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      return JSON.stringify([
        { index: 0, score: 0.5 },
        { index: 1, score: 0.5 },
        { index: 2, score: 0.5 },
      ]);
    },
  };

  const candidates = [
    { id: 'a', content: 'test1', _hybridScore: 0.8 },
    { id: 'b', content: 'test2', _hybridScore: 0.5 },
    { id: 'c', content: 'test3', _hybridScore: 0.6 },
  ];

  const result = await rerankWithLLM(candidates, 'query', provider);

  // Should keep original input order since variance is 0
  assert.equal(result[0].id, 'a');
  assert.equal(result[1].id, 'b');
  assert.equal(result[2].id, 'c');
});

test('rerankWithLLM reorders by fused score when variance is sufficient', async () => {
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      return JSON.stringify([
        { index: 0, score: 0.1 },  // low LLM score
        { index: 1, score: 0.95 }, // high LLM score
      ]);
    },
  };

  const candidates = [
    { id: 'a', content: 'test1', _hybridScore: 0.9 },  // high hybrid
    { id: 'b', content: 'test2', _hybridScore: 0.1 },  // low hybrid
  ];

  const result = await rerankWithLLM(candidates, 'query', provider);

  // With high LLM weight (0.7), the candidate with high LLM score should rank higher
  // even though it has low hybrid score
  assert.equal(result[0].id, 'b'); // high LLM score wins
});

test('rerankWithLLM handles LLM returning fewer scores than candidates', async () => {
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      // Only returns score for first item
      return JSON.stringify([{ index: 0, score: 0.9 }]);
    },
  };

  const candidates = [
    { id: 'a', content: 'test1', _hybridScore: 0.8 },
    { id: 'b', content: 'test2', _hybridScore: 0.5 },
    { id: 'c', content: 'test3', _hybridScore: 0.6 },
  ];

  const result = await rerankWithLLM(candidates, 'query', provider);
  assert.equal(result.length, 3);
  // Missing scores default to 0
  const bResult = result.find(c => c.id === 'b');
  assert.equal(bResult._llmScore, 0);
});

test('rerankWithLLM respects llmWeight parameter', async () => {
  const provider = {
    name: 'test',
    model: 'test',
    async chat() {
      return JSON.stringify([
        { index: 0, score: 0.1 },
        { index: 1, score: 0.9 },
      ]);
    },
  };

  const candidates = [
    { id: 'a', content: 'test1', _hybridScore: 0.9 },
    { id: 'b', content: 'test2', _hybridScore: 0.1 },
  ];

  // With low LLM weight, hybrid score should dominate
  const result = await rerankWithLLM(candidates, 'query', provider, { llmWeight: 0.1 });
  assert.equal(result[0].id, 'a'); // high hybrid wins with low LLM weight
});
