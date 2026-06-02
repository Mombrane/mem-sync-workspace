# MMR Rerank — Technical Design

## Pipeline Integration

MMR is a **post-scoring, pre-truncation** reranking step. It operates on the already-scored candidate pool (size = 3× limit) and reorders results to balance relevance and diversity.

### FTS-only mode (`--mode fts --mmr`)
```
FTS5 query → BM25 rank → tag filter → MMR (trigram Jaccard inter-doc sim) → truncate to limit
```

### Hybrid mode (`--mode hybrid --mmr`)
```
FTS5 query (3× limit) → embed query → cosine → hybrid score → MMR (embedding cosine inter-doc sim) → truncate to limit
```

## Core Algorithm

```
For each candidate d:
  MMR(d) = λ * relevance(d) - (1-λ) * max(similarity(d, already_selected))

Where:
  - relevance(d) = _hybridScore (hybrid mode) or normalized BM25 (FTS mode)
  - similarity(d, selected) = cosine similarity of embeddings (hybrid) or trigram Jaccard (FTS)
  - λ ∈ [0, 1], default 0.7
```

Select iteratively: first pick the highest-relevance document, then greedily pick documents that maximize MMR score.

## Inter-Document Similarity

**Primary (embeddings available):** Cosine similarity between candidate document vectors using `cosineSimilarity()` from `embedding-cache.js`.

**Fallback (FTS-only):** Trigram Jaccard similarity — tokenize content+summary into character trigrams, compute Jaccard intersection/union. This captures surface-level overlap for keyword-oriented BM25 results.

## λ Parameter

Default 0.7 (standard from original MMR paper, Carbonell & Goldstein 1998). This prioritizes relevance while providing meaningful diversity. λ=1.0 is pure relevance (no diversity penalty), λ=0.0 is pure diversity.

## Performance

O(n·k·d) where n = candidates (≤60), k = limit (≤20), d = embedding dimensions (≤1536). Worst case ~1.8M float ops, <1ms in JS. Negligible compared to embedding API calls.

## CLI Surface

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--mmr` | boolean flag | `false` | Enable MMR diversity reranking |
| `--mmr-lambda` | float 0–1 | `0.7` | Relevance weight |

## Score Annotation

Results get `_mmrScore` and `_mmrLambda` fields appended, following the existing pattern for `_hybridScore`/`_cosineSim`.

## Backward Compatibility

All changes are opt-in via `--mmr` flag. Default behavior is identical when `--mmr` is not specified.
