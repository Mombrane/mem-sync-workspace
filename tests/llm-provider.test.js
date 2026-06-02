import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noopLLMProvider,
  createMockLLMProvider,
  createOpenAILLMProvider,
  resolveLLMProvider,
} from '../src/llm-provider.js';

// ─── noopLLMProvider ──────────────────────────────────────────────────

test('noopLLMProvider returns empty JSON object', async () => {
  const result = await noopLLMProvider.chat([{ role: 'user', content: 'hello' }]);
  assert.equal(result, '{}');
});

test('noopLLMProvider has correct metadata', () => {
  assert.equal(noopLLMProvider.name, 'noop');
  assert.equal(noopLLMProvider.model, 'none');
});

// ─── createMockLLMProvider ────────────────────────────────────────────

test('mock provider returns deterministic output for same input', async () => {
  const provider = createMockLLMProvider();
  const messages = [{ role: 'user', content: 'test input' }];

  const result1 = await provider.chat(messages);
  const result2 = await provider.chat(messages);

  assert.equal(result1, result2);
});

test('mock provider returns valid JSON', async () => {
  const provider = createMockLLMProvider();
  const result = await provider.chat([{ role: 'user', content: 'hello' }]);
  const parsed = JSON.parse(result);

  assert.equal(typeof parsed.seed, 'number');
  assert.equal(typeof parsed.input_length, 'number');
  assert.equal(typeof parsed.message_count, 'number');
});

test('mock provider produces different output for different input', async () => {
  const provider = createMockLLMProvider();

  const result1 = await provider.chat([{ role: 'user', content: 'short' }]);
  const result2 = await provider.chat([{ role: 'user', content: 'a much longer input message' }]);

  assert.notEqual(result1, result2);
});

test('mock provider has correct metadata', () => {
  const provider = createMockLLMProvider();
  assert.equal(provider.name, 'mock');
  assert.equal(provider.model, 'mock-llm');
});

// ─── createOpenAILLMProvider ──────────────────────────────────────────

test('OpenAI provider has correct metadata', () => {
  const provider = createOpenAILLMProvider({ apiKey: 'test-key', model: 'gpt-4o' });
  assert.equal(provider.name, 'openai');
  assert.equal(provider.model, 'gpt-4o');
});

test('OpenAI provider uses default model', () => {
  const provider = createOpenAILLMProvider({ apiKey: 'test-key' });
  assert.equal(provider.model, 'gpt-4o-mini');
});

// ─── resolveLLMProvider ───────────────────────────────────────────────

test('resolveLLMProvider returns noop by default', () => {
  const original = process.env.MEM_SYNC_LLM_PROVIDER;
  try {
    delete process.env.MEM_SYNC_LLM_PROVIDER;
    const provider = resolveLLMProvider();
    assert.equal(provider.name, 'noop');
  } finally {
    if (original !== undefined) {
      process.env.MEM_SYNC_LLM_PROVIDER = original;
    } else {
      delete process.env.MEM_SYNC_LLM_PROVIDER;
    }
  }
});

test('resolveLLMProvider returns mock when set', () => {
  const original = process.env.MEM_SYNC_LLM_PROVIDER;
  try {
    process.env.MEM_SYNC_LLM_PROVIDER = 'mock';
    const provider = resolveLLMProvider();
    assert.equal(provider.name, 'mock');
  } finally {
    if (original !== undefined) {
      process.env.MEM_SYNC_LLM_PROVIDER = original;
    } else {
      delete process.env.MEM_SYNC_LLM_PROVIDER;
    }
  }
});

test('resolveLLMProvider throws on unknown provider', () => {
  const original = process.env.MEM_SYNC_LLM_PROVIDER;
  try {
    process.env.MEM_SYNC_LLM_PROVIDER = 'nonexistent';
    assert.throws(() => resolveLLMProvider(), /Unknown LLM provider/);
  } finally {
    if (original !== undefined) {
      process.env.MEM_SYNC_LLM_PROVIDER = original;
    } else {
      delete process.env.MEM_SYNC_LLM_PROVIDER;
    }
  }
});

test('resolveLLMProvider openai requires API key', () => {
  const origProvider = process.env.MEM_SYNC_LLM_PROVIDER;
  const origKey = process.env.MEM_SYNC_LLM_API_KEY;
  try {
    process.env.MEM_SYNC_LLM_PROVIDER = 'openai';
    delete process.env.MEM_SYNC_LLM_API_KEY;
    assert.throws(() => resolveLLMProvider(), /MEM_SYNC_LLM_API_KEY is required/);
  } finally {
    if (origProvider !== undefined) {
      process.env.MEM_SYNC_LLM_PROVIDER = origProvider;
    } else {
      delete process.env.MEM_SYNC_LLM_PROVIDER;
    }
    if (origKey !== undefined) {
      process.env.MEM_SYNC_LLM_API_KEY = origKey;
    } else {
      delete process.env.MEM_SYNC_LLM_API_KEY;
    }
  }
});
