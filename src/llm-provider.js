/**
 * LLM provider interface and implementations.
 *
 * @typedef {Object} LLMProvider
 * @property {string} name - Provider name
 * @property {string} model - Model identifier
 * @property {function(object[], object?): Promise<string>} chat - Send messages to the LLM
 */

/**
 * No-op LLM provider that returns an empty JSON object.
 * Used when no LLM is configured — all extraction/reranking is a no-op.
 *
 * @type {LLMProvider}
 */
export const noopLLMProvider = {
  name: 'noop',
  model: 'none',
  async chat() {
    return '{}';
  },
};

/**
 * Create a mock LLM provider with deterministic JSON output.
 * Uses a simple hash of the input messages to produce repeatable results.
 * Useful for testing without API calls.
 *
 * @returns {LLMProvider}
 */
export function createMockLLMProvider() {
  return {
    name: 'mock',
    model: 'mock-llm',
    async chat(messages) {
      // 确定性输出：基于输入消息的简单哈希
      const inputStr = JSON.stringify(messages);
      let hash = 0;
      for (let i = 0; i < inputStr.length; i++) {
        const char = inputStr.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
      }
      const seed = Math.abs(hash) % 1000;

      // 返回一个包含 hash 信息的确定性 JSON
      return JSON.stringify({
        seed,
        input_length: inputStr.length,
        message_count: messages.length,
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    },
  };
}

/**
 * Create an OpenAI-compatible LLM provider using the built-in fetch API.
 * Calls POST /v1/chat/completions with the given messages.
 *
 * @param {Object} options
 * @param {string} options.apiKey - API key
 * @param {string} [options.model='gpt-4o-mini'] - Model name
 * @param {string} [options.baseUrl='https://api.openai.com'] - API base URL
 * @returns {LLMProvider}
 */
export function createOpenAILLMProvider({
  apiKey,
  model = 'gpt-4o-mini',
  baseUrl = 'https://api.openai.com',
} = {}) {
  return {
    name: 'openai',
    model,
    /**
     * Send chat messages to the OpenAI-compatible API with retry and exponential backoff.
     *
     * @param {object[]} messages - Array of chat messages
     * @param {object} [options] - Extra request options
     * @param {number} [options.temperature] - Sampling temperature
     * @param {number} [options.maxTokens] - Max completion tokens
     * @returns {Promise<string>} - The LLM response text content
     */
    async chat(messages, options = {}) {
      const MAX_RETRIES = 3;
      let retries = 0;

      while (retries <= MAX_RETRIES) {
        try {
          const body = {
            model,
            messages,
          };
          if (options.temperature !== undefined) {
            body.temperature = options.temperature;
          }
          if (options.maxTokens !== undefined) {
            body.max_tokens = options.maxTokens;
          }

          const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(
              `OpenAI chat failed with status ${res.status}: ${text}`
            );
          }

          const json = await res.json();
          return json.choices?.[0]?.message?.content ?? '';
        } catch (err) {
          retries++;
          if (retries > MAX_RETRIES) {
            throw err;
          }
          // Exponential backoff: 1s, 2s, 4s
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, retries - 1)));
        }
      }
    },
  };
}

/**
 * Resolve an LLM provider from environment variables.
 *
 * Environment variables:
 *   MEM_SYNC_LLM_PROVIDER  — 'noop' | 'openai' | 'mock' (default 'noop')
 *   MEM_SYNC_LLM_API_KEY   — API key for the provider
 *   MEM_SYNC_LLM_MODEL     — Model name (default 'gpt-4o-mini')
 *   MEM_SYNC_LLM_BASE_URL  — API base URL (for openai provider)
 *
 * @returns {LLMProvider}
 */
export function resolveLLMProvider() {
  const provider = process.env.MEM_SYNC_LLM_PROVIDER || 'noop';

  switch (provider) {
    case 'noop':
      return noopLLMProvider;
    case 'mock':
      return createMockLLMProvider();
    case 'openai': {
      const apiKey = process.env.MEM_SYNC_LLM_API_KEY;
      if (!apiKey) {
        throw new Error(
          'MEM_SYNC_LLM_API_KEY is required for openai LLM provider'
        );
      }
      return createOpenAILLMProvider({
        apiKey,
        model: process.env.MEM_SYNC_LLM_MODEL,
        baseUrl: process.env.MEM_SYNC_LLM_BASE_URL,
      });
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
