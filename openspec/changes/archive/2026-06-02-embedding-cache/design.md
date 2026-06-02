# Design: Embedding Cache

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 recall command                    │
│  --mode fts│hybrid│semantic                      │
└──────────┬──────────────────┬────────────────────┘
           │                  │
     ┌─────▼─────┐    ┌──────▼──────┐
     │ searchIndex│    │searchIndex  │
     │  (sync)    │    │  Hybrid     │
     │  FTS5 BM25 │    │  (async)    │
     └────────────┘    └──────┬──────┘
                              │
                    ┌─────────▼─────────┐
                    │ Phase 1: FTS5     │
                    │ BM25 candidates   │
                    │ (limit × 3)       │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Phase 2: Cosine   │
                    │ re-rank with      │
                    │ embedding vectors  │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Hybrid score      │
                    │ α×BM25 + (1-α)×cos│
                    └───────────────────┘
```

## Decision Log

### D1: Async/Sync Boundary — Option C

Keep existing sync functions unchanged. Add new async functions alongside:
- `rebuildIndexWithEmbeddings()` — async, calls `rebuildIndex()` internally for FTS, then batches embedding API calls
- `searchIndexHybrid()` — async, calls `searchIndex()` for FTS5 candidates, then enriches with embeddings

**Rationale:** The sync nature of better-sqlite3 was a deliberate design choice. Making everything async would break all callers for no benefit on the FTS-only path.

### D2: BLOB Storage with byteOffset/byteLength Safety

Store Float32Array as BLOB using the safe triplet form:
```js
// Write
const bytes = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
Buffer.from(bytes)

// Read  
new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)
```

**Rationale:** `Float32Array.buffer` may return the underlying ArrayBuffer which is larger than the view if the array was created via `.subarray()` or offset construction.

### D3: Foreign Keys with PRAGMA

Add `PRAGMA foreign_keys=ON` before creating the embeddings table. Required for ON DELETE CASCADE to work — SQLite parses FK constraints but doesn't enforce them without the pragma.

### D4: Batch Size 20

Embedding API calls batched at 20 records per request. Safe payload size, 25 calls for 500 records, ~5-10 seconds total.

### D5: `--mode` Flag Design

```
--mode fts       # FTS5 BM25 only (default)
--mode hybrid    # BM25 + cosine re-rank
--mode semantic  # Cosine only (future)
```

Extensible, avoids boolean trap, default can evolve over time.

### D6: Env Var Provider Resolution

```
MEM_SYNC_EMBEDDING_PROVIDER=openai|mock|noop
MEM_SYNC_OPENAI_API_KEY=sk-...
MEM_SYNC_OPENAI_MODEL=text-embedding-3-small
MEM_SYNC_OPENAI_BASE_URL=https://...
```

Runtime configuration via env vars. Index metadata (embedding_model, embedding_dimensions, embeddings_count) stored in index_meta for cache invalidation.

### D7: Graceful Degradation

Error handling tiers:
1. 401/403 (auth) → Skip embeddings entirely, log warning
2. 429 (rate limit) → Retry with exponential backoff (1s, 2s, 4s), max 3 retries
3. 4xx (bad request) → Skip batch, continue
4. 5xx/network → Retry, then graceful degradation
5. FTS index always completes successfully regardless of embedding failures

### D8: FTS5-Empty Fallback

When FTS5 returns 0 results in hybrid mode:
- < 1000 records: Full vector scan (brute-force cosine)
- ≥ 1000 records: Return empty, suggest different query terms

## Files to Create/Modify

### New Files
- `src/embedding-provider.js` — Provider interface, NoopProvider, MockProvider, OpenAIProvider
- `src/embedding-cache.js` — cosineSimilarity, insertEmbeddings, queryEmbeddings, getEmbeddingStatus
- `test/embedding-provider.test.js` — Provider tests
- `test/embedding-cache.test.js` — Cache and similarity tests

### Modified Files
- `src/index-store.js` — Add embeddings table DDL, add rebuildIndexWithEmbeddings, modify searchIndex for hybrid mode
- `src/commands/recall.js` — Add `--mode` flag, resolve provider, pass to searchIndex
- `src/commands/index.js` — Show embedding status in index status
- `test/index-store.test.js` — Add embedding integration tests
- `test/recall.test.js` — Add --mode flag tests

## Embeddings Table Schema

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  memory_rowid INTEGER PRIMARY KEY,
  vector BLOB NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_rowid) REFERENCES memories(rowid) ON DELETE CASCADE
);
```

## Provider Interface

```js
/**
 * @typedef {Object} EmbeddingProvider
 * @property {string} name - Provider name (e.g. "openai", "mock", "none")
 * @property {number} dimensions - Vector dimensions (e.g. 1536)
 * @property {function(string[]): Promise<Float32Array[]>} embed - Batch embed texts
 */
```

## Hybrid Score Formula

```
hybridScore = α × normalizedBM25 + (1-α) × max(0, cosineSimilarity)

where:
  α = 0.4 (embeddingWeight parameter)
  normalizedBM25 = 1 / (1 + |bm25_rank|)
  cosineSimilarity ∈ [-1, 1], clamped to [0, 1]
```
