# Proposal: Embedding Cache for mem-sync

## Why

The current recall engine uses FTS5 BM25 keyword matching only. This works well for exact term matches but misses semantic relationships — "user preference for response style" won't match a memory stored as "用户偏好简洁中文回答". An embedding cache adds semantic similarity search, enabling hybrid recall that combines keyword precision with semantic understanding.

## What

Add an optional embedding cache layer to the existing SQLite local index:

1. **Embedding Provider Interface** — Pluggable abstraction for embedding computation (NoopProvider, MockProvider, OpenAI-compatible)
2. **Embeddings Table** — BLOB storage for Float32 vectors in SQLite, linked to memories via foreign key
3. **Hybrid Search** — Two-phase search: FTS5 BM25 candidates → cosine similarity re-ranking
4. **`--mode` flag** — `fts` (default), `hybrid`, `semantic` modes for recall command

## Design Principles

- **Zero new npm dependencies** — Pure JS cosine similarity, better-sqlite3 BLOB storage, Node.js fetch for API calls
- **Optional/Pluggable** — NoopProvider by default; no behavioral change without explicit configuration
- **Rebuildable** — Embeddings are a cache, not source of truth; deleted on rebuild, recomputed from JSONL
- **Graceful degradation** — FTS index works standalone; embedding failures don't break recall
- **Backward compatible** — Existing sync API unchanged; new async functions added alongside

## Scope

### In Scope
- Embedding provider interface (NoopProvider, MockProvider, OpenAI-compatible)
- Embeddings table in SQLite (BLOB Float32Array storage)
- `rebuildIndexWithEmbeddings()` async function
- `searchIndexHybrid()` async function
- `--mode fts|hybrid|semantic` flag in recall command
- Provider resolution from environment variables
- Tests using MockProvider

### Out of Scope
- MMR rerank (next P2 item)
- LLM extractor/reranker
- Local embedding models (@xenova/transformers)
- Config file for provider settings (env vars sufficient for P2)
