# MMR Rerank — Requirements

## Functional Requirements

### FR-1: MMR Core Algorithm
- `mmrRerank(results, options)` is a pure function that takes scored results and returns MMR-reranked results
- Options: `lambda` (0–1, default 0.7), `k` (max results), `embeddings` (Map<rowid, Float32Array>), `contentField`
- First selected document is always the highest-relevance one
- Subsequent documents maximize `λ * relevance(d) - (1-λ) * max(similarity(d, selected))`

### FR-2: Inter-Document Similarity
- When embeddings are available: cosine similarity between document vectors
- When embeddings are not available: trigram Jaccard similarity on content+summary
- `trigramJaccard(a, b)` returns a value in [0, 1]

### FR-3: Integration with searchIndexHybrid
- Accept `mmr` (boolean) and `mmrLambda` (number) in options
- When `mmr=true`, apply MMR after hybrid scoring, before truncation
- When `mmr=false` (default), behavior is unchanged

### FR-4: Integration with searchIndex (FTS-only)
- Accept `mmr` and `mmrLambda` in options
- When `mmr=true`, apply MMR using trigram Jaccard after tag filtering, before returning
- When `mmr=false` (default), behavior is unchanged

### FR-5: CLI Flags
- `--mmr` boolean flag enables MMR reranking
- `--mmr-lambda` float (0–1) sets λ parameter
- Both flags work with any `--mode` (fts, hybrid)
- `--mmr-lambda` without `--mmr` is silently ignored (or could be an error — TBD)

### FR-6: Output
- MMR-reranked results get `_mmrScore` and `_mmrLambda` fields
- Output formatters (markdown, json, memories) handle new fields gracefully
- Score display in markdown output shows MMR score when present

## Non-Functional Requirements

### NFR-1: Backward Compatibility
- Default behavior (no `--mmr` flag) is identical to current
- No changes to existing test expectations

### NFR-2: Performance
- MMR adds <1ms overhead for typical candidate pools (≤60 items)
- No additional embedding API calls — reuses vectors from hybrid search

### NFR-3: Test Coverage
- Unit tests for `mmrRerank()` with edge cases (empty, single, all-identical, λ extremes)
- Unit tests for `trigramJaccard()`
- Integration tests for `searchIndex` and `searchIndexHybrid` with MMR
- CLI integration tests for `--mmr` and `--mmr-lambda` flags
