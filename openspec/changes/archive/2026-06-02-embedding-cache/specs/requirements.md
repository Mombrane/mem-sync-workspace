# Requirements: Embedding Cache

## R1: Embedding Provider Interface

The system MUST provide a pluggable embedding provider interface:
- Duck-typed object with `name`, `dimensions`, and `embed(texts[])` properties
- `embed()` MUST be async (returns Promise<Float32Array[]>)
- MUST include NoopProvider (name='none', dimensions=0, embed returns [])
- MUST include MockProvider (deterministic pseudo-embeddings for testing)
- SHOULD include OpenAI-compatible provider (configurable base URL, model, API key)

## R2: Embeddings Table

The system MUST store embedding vectors in SQLite:
- Separate `embeddings` table linked to `memories` via foreign key
- BLOB storage for Float32Array vectors (little-endian IEEE 754)
- Columns: memory_rowid (PK), vector (BLOB), model (TEXT), dimensions (INTEGER), created_at (TEXT)
- ON DELETE CASCADE when parent memory is deleted
- PRAGMA foreign_keys=ON must be set before table creation

## R3: Embedding Cache Population

The system MUST support computing and storing embeddings during index rebuild:
- New async function `rebuildIndexWithEmbeddings()` alongside existing sync `rebuildIndex()`
- FTS index MUST complete successfully regardless of embedding outcomes
- Embedding computation MUST be batched (20 records per API call)
- MUST retry failed batches with exponential backoff (max 3 retries)
- MUST gracefully degrade on permanent errors (skip embeddings, log warning)
- MUST store embedding model/dimensions in index_meta for cache invalidation

## R4: Hybrid Search

The system MUST support hybrid search combining BM25 and embedding similarity:
- New async function `searchIndexHybrid()` alongside existing sync `searchIndex()`
- Phase 1: FTS5 BM25 candidate retrieval (limit × 3 candidates)
- Phase 2: Cosine similarity re-ranking with hybrid score
- Hybrid score: α × normalizedBM25 + (1-α) × cosineSimilarity (default α=0.4)
- Fallback: Full vector scan when FTS5 returns 0 results and record count < 1000
- MUST return results in Schema v1 format with `_rank` field

## R5: Recall Command Integration

The recall command MUST support a `--mode` flag:
- `--mode fts` — FTS5 BM25 only (default, current behavior)
- `--mode hybrid` — BM25 + cosine re-rank (requires embedding provider)
- `--mode semantic` — Cosine only (future, may not be implemented in this iteration)
- When `--mode hybrid` is used without a configured provider, MUST print warning and fall back to FTS

## R6: Provider Configuration

The system MUST resolve embedding providers from environment variables:
- `MEM_SYNC_EMBEDDING_PROVIDER` — Provider name: openai, mock, noop (default: noop)
- `MEM_SYNC_OPENAI_API_KEY` — API key for OpenAI-compatible provider
- `MEM_SYNC_OPENAI_MODEL` — Model name (default: text-embedding-3-small)
- `MEM_SYNC_OPENAI_BASE_URL` — Base URL for proxies (default: https://api.openai.com)

## R7: Index Status

The `index status` command MUST report embedding cache status:
- Number of cached embeddings
- Embedding model name
- Embedding dimensions
- Whether embeddings match current provider configuration

## R8: Testing

All new code MUST have tests:
- MockProvider MUST produce deterministic vectors (same text → same vector)
- BLOB round-trip MUST preserve exact float values (within float32 precision)
- Hybrid search MUST rank semantically similar results higher than BM25-only
- Graceful degradation MUST be tested (provider failure → FTS-only fallback)
- ON DELETE CASCADE MUST be verified
