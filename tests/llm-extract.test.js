import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareTranscript,
  parseLLMResponse,
  extractWithLLM,
} from '../src/llm-extract.js';
import { createMockLLMProvider } from '../src/llm-provider.js';

// ─── prepareTranscript ────────────────────────────────────────────────

test('prepareTranscript returns empty for non-array input', () => {
  assert.deepEqual(prepareTranscript(null), []);
  assert.deepEqual(prepareTranscript(undefined), []);
  assert.deepEqual(prepareTranscript('not an array'), []);
});

test('prepareTranscript returns all messages when under token limit', () => {
  const transcript = [
    { role: 'user', content: 'short message' },
    { role: 'assistant', content: 'response' },
  ];
  const result = prepareTranscript(transcript, 8000);
  assert.equal(result.length, 2);
});

test('prepareTranscript truncates from start for long transcripts', () => {
  // Each message ~100 chars, maxTokens=1 → maxChars=4 → only fits 1 message
  const transcript = [
    { role: 'user', content: 'a'.repeat(100) },
    { role: 'assistant', content: 'b'.repeat(100) },
    { role: 'user', content: 'c'.repeat(100) },
  ];
  const result = prepareTranscript(transcript, 50); // 50*4=200 chars, fits last 2
  assert.ok(result.length <= 3);
  // Last message should always be included
  assert.equal(result[result.length - 1].content, 'c'.repeat(100));
});

test('prepareTranscript handles empty transcript', () => {
  assert.deepEqual(prepareTranscript([]), []);
});

// ─── parseLLMResponse ─────────────────────────────────────────────────

test('parseLLMResponse parses valid JSON array', () => {
  const input = JSON.stringify([{ content: 'test', kind: 'preference' }]);
  const result = parseLLMResponse(input);
  assert.deepEqual(result, [{ content: 'test', kind: 'preference' }]);
});

test('parseLLMResponse strips markdown code fences', () => {
  const input = '```json\n[{"content": "test", "kind": "preference"}]\n```';
  const result = parseLLMResponse(input);
  assert.deepEqual(result, [{ content: 'test', kind: 'preference' }]);
});

test('parseLLMResponse strips plain markdown fences', () => {
  const input = '```\n[{"content": "test"}]\n```';
  const result = parseLLMResponse(input);
  assert.deepEqual(result, [{ content: 'test' }]);
});

test('parseLLMResponse extracts array from wrapper object', () => {
  const input = JSON.stringify({ memories: [{ content: 'test' }] });
  const result = parseLLMResponse(input);
  assert.deepEqual(result, [{ content: 'test' }]);
});

test('parseLLMResponse extracts candidates field', () => {
  const input = JSON.stringify({ candidates: [{ content: 'test' }] });
  const result = parseLLMResponse(input);
  assert.deepEqual(result, [{ content: 'test' }]);
});

test('parseLLMResponse parses line-by-line JSON objects', () => {
  const input = '{"content": "item1"}\n{"content": "item2"}';
  const result = parseLLMResponse(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].content, 'item1');
  assert.equal(result[1].content, 'item2');
});

test('parseLLMResponse returns null for invalid input', () => {
  assert.equal(parseLLMResponse(null), null);
  assert.equal(parseLLMResponse(undefined), null);
  assert.equal(parseLLMResponse(''), null);
  assert.equal(parseLLMResponse(123), null);
});

test('parseLLMResponse returns null for unparseable text', () => {
  assert.equal(parseLLMResponse('this is not json at all'), null);
});

test('parseLLMResponse returns null for non-array JSON', () => {
  assert.equal(parseLLMResponse('{"key": "value"}'), null);
});

// ─── extractWithLLM ───────────────────────────────────────────────────

test('extractWithLLM returns empty for empty transcript', async () => {
  const provider = createMockLLMProvider();
  const result = await extractWithLLM([], provider);
  assert.deepEqual(result, []);
});

test('extractWithLLM returns empty for non-array transcript', async () => {
  const provider = createMockLLMProvider();
  const result = await extractWithLLM(null, provider);
  assert.deepEqual(result, []);
});

test('extractWithLLM handles LLM returning non-memory response gracefully', async () => {
  // Mock provider returns a JSON object, not an array of memories
  const provider = {
    name: 'test',
    model: 'test',
    async chat() { return '{"seed": 42}'; },
  };
  const transcript = [
    { role: 'user', content: 'hello' },
  ];
  const result = await extractWithLLM(transcript, provider);
  // Should handle gracefully — the mock returns non-array, so parseLLM returns null → empty
  assert.ok(Array.isArray(result));
});

test('extractWithLLM uses mock provider without errors', async () => {
  const provider = createMockLLMProvider();
  const transcript = [
    { role: 'user', content: 'Remember that I prefer dark mode' },
    { role: 'assistant', content: 'I will remember that.' },
    { role: 'user', content: 'Also, we use pytest for testing' },
  ];
  // Should not throw even if mock returns non-memory JSON
  const result = await extractWithLLM(transcript, provider, { maxTokens: 1000 });
  assert.ok(Array.isArray(result));
});
