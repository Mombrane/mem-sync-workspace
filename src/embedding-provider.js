/**
 * Embedding provider interface and implementations.
 *
 * @typedef {Object} EmbeddingProvider
 * @property {string} name - Provider name
 * @property {number} dimensions - Vector dimensions
 * @property {function(string[]): Promise<Float32Array[]>} embed - Batch embed
 */

/**
 * No-op embedding provider that returns empty arrays.
 * @type {EmbeddingProvider}
 */
export const noopProvider = {
  name: 'none',
  dimensions: 0,
  async embed() {
    return [];
  },
};

/**
 * Create a mock embedding provider with deterministic pseudo-embeddings.
 * Uses sin/cos hash of text length to produce repeatable unit vectors.
 *
 * @param {number} [dimensions=32] - Vector dimensions
 * @returns {EmbeddingProvider}
 */
export function createMockProvider(dimensions = 32) {
  return {
    name: 'mock',
    dimensions,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Float32Array(dimensions);
        for (let i = 0; i < dimensions; i++) {
          v[i] = Math.sin((text.length + 1) * (i + 1) * 0.1);
        }
        // Normalize to unit vector
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        for (let i = 0; i < dimensions; i++) v[i] /= norm;
        return v;
      });
    },
  };
}

/**
 * Create an OpenAI embedding provider using the built-in fetch API.
 *
 * @param {Object} options
 * @param {string} options.apiKey - OpenAI API key
 * @param {string} [options.baseUrl='https://api.openai.com'] - API base URL
 * @param {string} [options.model='text-embedding-3-small'] - Model name
 * @returns {EmbeddingProvider}
 */
export function createOpenAIProvider({
  apiKey,
  baseUrl = 'https://api.openai.com',
  model = 'text-embedding-3-small',
} = {}) {
  return {
    name: 'openai',
    dimensions: 0, // Unknown until first call
    async embed(texts) {
      const res = await fetch(`${baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `OpenAI embeddings failed with status ${res.status}: ${body}`
        );
      }

      const json = await res.json();
      return json.data.map((item) => Float32Array.from(item.embedding));
    },
  };
}

/**
 * Resolve an embedding provider from environment variables.
 *
 * @returns {EmbeddingProvider}
 */
export function resolveEmbeddingProvider() {
  const provider = process.env.MEM_SYNC_EMBEDDING_PROVIDER || 'noop';

  switch (provider) {
    case 'noop':
      return noopProvider;
    case 'mock':
      return createMockProvider();
    case 'openai': {
      const apiKey = process.env.MEM_SYNC_OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'MEM_SYNC_OPENAI_API_KEY is required for openai embedding provider'
        );
      }
      return createOpenAIProvider({
        apiKey,
        model: process.env.MEM_SYNC_OPENAI_MODEL,
        baseUrl: process.env.MEM_SYNC_OPENAI_BASE_URL,
      });
    }
    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
