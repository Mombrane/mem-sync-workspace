# Tasks: Embedding Cache Implementation

## Task 1: Embedding Provider Interface
**File:** `src/embedding-provider.js` (NEW)

- [ ] Define `EmbeddingProvider` JSDoc typedef (name, dimensions, embed)
- [ ] Implement `noopProvider` (name='none', dimensions=0, embed returns [])
- [ ] Implement `createMockProvider(dimensions=32)` — deterministic sin/cos hash, normalized unit vectors
- [ ] Implement `createOpenAIProvider({apiKey, baseUrl, model})` — fetch /v1/embeddings, parse response
- [ ] Implement `resolveEmbeddingProvider()` — read env vars, return appropriate provider
- [ ] Write `test/embedding-provider.test.js`:
  - [ ] NoopProvider returns empty array
  - [ ] MockProvider produces deterministic vectors (same text → same vector)
  - [ ] MockProvider vectors are unit-normalized
  - [ ] MockProvider respects custom dimensions
  - [ ] resolveEmbeddingProvider returns noop by default
  - [ ] resolveEmbeddingProvider returns mock when MEM_SYNC_EMBEDDING_PROVIDER=mock

## Task 2: Embedding Cache Module
**File:** `src/embedding-cache.js` (NEW)

- [ ] Implement `cosineSimilarity(a, b)` — pure JS, Float32Array input, returns [-1, 1]
- [ ] Implement `float32ToBlob(vec)` — safe Buffer.from with byteOffset/byteLength
- [ ] Implement `blobToFloat32(buffer)` — safe Float32Array construction from Buffer
- [ ] Implement `insertEmbeddings(db, records, vectors, model, dimensions)` — batch INSERT OR REPLACE
- [ ] Implement `queryEmbeddings(db, memoryRowids)` — load vectors for given rowids, return Map
- [ ] Implement `computeHybridScore(bm25Rank, cosineSim, weight)` — weighted combination
- [ ] Implement `getEmbeddingStatus(cacheDir)` — return count, model, dimensions from index_meta
- [ ] Write `test/embedding-cache.test.js`:
  - [ ] cosineSimilarity with identical vectors returns 1.0
  - [ ] cosineSimilarity with orthogonal vectors returns 0.0
  - [ ] cosineSimilarity with opposite vectors returns -1.0
  - [ ] float32ToBlob/blobToFloat32 round-trip preserves exact values
  - [ ] Round-trip works with subarray/offset views
  - [ ] insertEmbeddings and queryEmbeddings round-trip correctly
  - [ ] computeHybridScore with weight=0 returns pure cosine
  - [ ] computeHybridScore with weight=1 returns pure BM25

## Task 3: Index Store Modifications
**File:** `src/index-store.js` (MODIFY)

- [ ] Add `embeddings` table DDL to `createIndexDatabase()` (with PRAGMA foreign_keys=ON)
- [ ] Add embedding metadata entries to index_meta schema
- [ ] Implement `rebuildIndexWithEmbeddings(repoDir, cacheDir, options)`:
  - [ ] Call existing `rebuildIndex()` for FTS portion (sync, always succeeds)
  - [ ] If no provider or noop provider, return early with embeddingsGenerated=0
  - [ ] Query all memory rowids and content from memories table
  - [ ] Batch embed in groups of 20 (with retry on transient errors)
  - [ ] Insert embeddings via INSERT OR REPLACE
  - [ ] Store embedding_model, embedding_dimensions, embeddings_count in index_meta
  - [ ] Return { recordCount, embeddingsGenerated, embeddingsFailed }
- [ ] Implement `searchIndexHybrid(cacheDir, options)`:
  - [ ] Call existing `searchIndex()` for FTS5 candidates (limit × 3)
  - [ ] If no embeddings table or empty, fall back to FTS-only results
  - [ ] Compute query embedding via provider
  - [ ] Load candidate embeddings from embeddings table
  - [ ] Compute cosine similarity for each candidate
  - [ ] Apply hybrid score: α × normalizedBM25 + (1-α) × cosineSim
  - [ ] Re-sort by hybrid score, return top `limit`
  - [ ] Fallback: full vector scan if FTS returns 0 and count < 1000
- [ ] Write tests in `test/index-store.test.js`:
  - [ ] createIndexDatabase creates embeddings table
  - [ ] ON DELETE CASCADE removes embeddings when memory deleted
  - [ ] rebuildIndexWithEmbeddings populates embeddings table
  - [ ] rebuildIndexWithEmbeddings with noop provider skips embeddings
  - [ ] rebuildIndexWithEmbeddings gracefully handles provider failure
  - [ ] searchIndexHybrid returns hybrid-scored results
  - [ ] searchIndexHybrid falls back to FTS-only when no embeddings

## Task 4: Recall Command Integration
**File:** `src/commands/recall.js` (MODIFY)

- [ ] Add `MODES` constant: `['fts', 'hybrid', 'semantic']`
- [ ] Add `--mode` flag parsing in `parseRecallArgs()`
- [ ] Modify `recallCommand()`:
  - [ ] If mode='hybrid', resolve embedding provider from env
  - [ ] If mode='hybrid' and provider is noop, print warning, fall back to fts
  - [ ] Call `searchIndexHybrid()` for hybrid mode
  - [ ] Call existing `searchIndex()` for fts mode
  - [ ] Mode='semantic' throws "not yet implemented" error
- [ ] Write tests in `test/recall.test.js`:
  - [ ] --mode fts uses searchIndex (existing behavior)
  - [ ] --mode hybrid uses searchIndexHybrid
  - [ ] --mode hybrid without provider falls back to fts with warning
  - [ ] --mode semantic throws not-implemented error
  - [ ] Invalid --mode value throws error

## Task 5: Index Status Enhancement
**File:** `src/commands/index.js` (MODIFY)

- [ ] Import `getEmbeddingStatus` from embedding-cache.js
- [ ] In `statusCommand()`, query and display embedding cache info:
  - [ ] Embedding count
  - [ ] Embedding model
  - [ ] Embedding dimensions
  - [ ] Whether embeddings match current provider config
- [ ] Write tests for embedding status display

## Dependencies Between Tasks

```
Task 1 (Provider) ──┐
                     ├──► Task 3 (Index Store) ──► Task 4 (Recall)
Task 2 (Cache)   ──┘                              Task 5 (Status)
```

Tasks 1 and 2 can be done in parallel. Task 3 depends on both. Tasks 4 and 5 depend on Task 3.
