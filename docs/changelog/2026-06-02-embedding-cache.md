# Changelog: Embedding Cache (2026-06-02)

## Feature: Embedding Cache with Hybrid Search

Added optional embedding cache layer to the SQLite local index, enabling semantic similarity search alongside FTS5 BM25 keyword matching.

### New Files

| File | Purpose |
|------|---------|
| `src/embedding-provider.js` | Pluggable embedding provider interface (NoopProvider, MockProvider, OpenAI-compatible) |
| `src/embedding-cache.js` | Vector operations (cosine similarity, BLOB storage), embedding CRUD, hybrid scoring |
| `test/embedding-cache.test.js` | Cache module tests (cosine, BLOB round-trip, hybrid score) |
| `test/recall.test.js` | Recall command --mode flag tests |
| `tests/embedding-provider.test.js` | Provider interface tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/index-store.js` | +243 lines: embeddings table DDL, `rebuildIndexWithEmbeddings()`, `searchIndexHybrid()` |
| `src/commands/recall.js` | +55 lines: `--mode fts\|hybrid\|semantic` flag, hybrid search routing |
| `src/commands/index.js` | +16 lines: embedding cache status in `index status` |
| `tests/index-store.test.js` | +264 lines: embedding integration tests |
| `tests/cli-index.test.js` | +118 lines: status embedding display tests |

### Architecture

```
recall --mode hybrid
  → Phase 1: FTS5 BM25 candidates (limit × 3)
  → Phase 2: Cosine similarity re-ranking
  → Hybrid score = 0.4 × BM25 + 0.6 × cosine
```

### Configuration

Environment variables (no config file needed):
- `MEM_SYNC_EMBEDDING_PROVIDER=openai|mock|noop` (default: noop)
- `MEM_SYNC_OPENAI_API_KEY=sk-...`
- `MEM_SYNC_OPENAI_MODEL=text-embedding-3-small`
- `MEM_SYNC_OPENAI_BASE_URL=https://...`

### Design Decisions

- **Zero new dependencies** — Pure JS cosine similarity, better-sqlite3 BLOB storage, Node.js fetch
- **Optional/Pluggable** — NoopProvider by default, no behavioral change without configuration
- **Graceful degradation** — FTS index works standalone, embedding failures don't break recall
- **Backward compatible** — Existing sync API unchanged, new async functions alongside
- **`--mode` flag** — Extensible: fts (default), hybrid, semantic (future)

### Test Results

382 tests, 0 failures (45 new tests added)

### Cost

| Phase | Cost |
|-------|------|
| Explore (2 rounds) | $1.16 |
| Propose (Hermes direct) | $0.00 |
| Delegate Wave 1 (Tasks 1+2 parallel) | ~$0.60 |
| Delegate Wave 2 (Task 3) | $1.08 |
| Delegate Wave 3 (Tasks 4+5 parallel) | ~$0.80 |
| **Total** | **~$3.64** |

### Next Steps

- P2: MMR rerank (diversity-aware re-ranking)
- P2: LLM extractor/reranker
- P2: Encrypted repo support
