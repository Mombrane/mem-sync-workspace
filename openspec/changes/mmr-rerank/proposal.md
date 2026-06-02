# Proposal: MMR Rerank for Recall Engine

## Why

The current recall engine returns results purely by relevance (BM25 or hybrid score). When multiple memories cover similar topics, the top-K results may cluster around the same theme, missing relevant-but-different memories. MMR (Maximal Marginal Relevance) diversifies results by penalizing candidates that are too similar to already-selected ones.

## What

Add opt-in MMR reranking to the recall pipeline via `--mmr` and `--mmr-lambda` CLI flags. MMR operates as a post-scoring step: it takes the already-scored candidate pool and reorders results to balance relevance and diversity.

## Scope

- Core `mmrRerank()` function and `trigramJaccard()` helper in `embedding-cache.js`
- Integration into `searchIndexHybrid()` and `searchIndex()` in `index-store.js`
- CLI flag parsing in `commands/recall.js`
- Unit and integration tests

## Non-goals

- MMR is not a new search mode — it composes with existing `--mode fts|hybrid`
- No changes to embedding generation or storage
- No changes to output formatters (they already handle `_hybridScore`/`_cosineSim`)
