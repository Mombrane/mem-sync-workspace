# MMR Rerank — Tasks

## Task 1: Core MMR Functions (src/embedding-cache.js)
**Files:** `src/embedding-cache.js`
**Dependencies:** None

Add two new exported functions:

1. `trigramJaccard(textA, textB)` — Compute Jaccard similarity of character trigram sets
   - Input: two strings (typically content+summary)
   - Output: number in [0, 1]
   - Handle edge cases: empty strings, strings shorter than 3 chars

2. `mmrRerank(results, options)` — Maximal Marginal Relevance reranker
   - Input: array of scored results (with `_rank` or `_hybridScore`), options `{ lambda, k, embeddings, contentField }`
   - Output: reordered array with `_mmrScore` and `_mmrLambda` annotated
   - Algorithm: greedy iterative selection maximizing λ·relevance - (1-λ)·maxSim
   - Relevance source: `_hybridScore` if present, else `1/(1+abs(_rank))`
   - Inter-doc sim: embedding cosine if `embeddings` map provided, else trigram Jaccard

## Task 2: Unit Tests for MMR Core (tests/)
**Files:** New test file or add to existing embedding-cache tests
**Dependencies:** Task 1

Test cases:
- `mmrRerank` with empty results → returns empty
- `mmrRerank` with single result → returns that result
- `mmrRerank` with λ=1.0 → pure relevance order (no diversity)
- `mmrRerank` with λ=0.0 → pure diversity (most different selected first after initial)
- `mmrRerank` with all-identical content → deterministic order
- `mmrRerank` with embeddings → uses cosine similarity
- `mmrRerank` without embeddings → uses trigram Jaccard
- `trigramJaccard` with identical strings → 1.0
- `trigramJaccard` with completely different strings → ~0
- `trigramJaccard` with empty strings → 0
- `trigramJaccard` with strings shorter than 3 chars → 0

## Task 3: Integrate MMR into searchIndexHybrid (src/index-store.js)
**Files:** `src/index-store.js`
**Dependencies:** Task 1

In `searchIndexHybrid()`:
- Accept `mmr` (boolean) and `mmrLambda` (number) from options
- After hybrid scoring (line ~610), before truncation:
  - If `mmr=true`, call `mmrRerank(ftsResults, { lambda: mmrLambda, k: limit, embeddings })`
  - The `embeddings` map is already built during the hybrid scoring phase (candidateRowids → vectors)
- Ensure embeddings Map is accessible to MMR (currently only used inline for cosine computation)

## Task 4: Integrate MMR into searchIndex (src/index-store.js)
**Files:** `src/index-store.js`
**Dependencies:** Task 1

In `searchIndex()`:
- Accept `mmr` and `mmrLambda` from options
- After tag post-filter (line ~800), before returning:
  - If `mmr=true`, call `mmrRerank(results, { lambda: mmrLambda, k: effectiveLimit })`
  - No embeddings available in FTS-only mode → uses trigram Jaccard fallback

## Task 5: CLI Flags (src/commands/recall.js)
**Files:** `src/commands/recall.js`
**Dependencies:** Tasks 3, 4

In `parseRecallArgs()`:
- Add `--mmr` boolean flag (sets `searchOptions.mmr = true`)
- Add `--mmr-lambda` float flag (validates 0–1 range, sets `searchOptions.mmrLambda`)
- Default `mmrLambda` to 0.7 when `--mmr` is used without `--mmr-lambda`

Pass `mmr` and `mmrLambda` through to search functions (they already spread `searchOptions`).

## Task 6: Integration Tests (tests/)
**Files:** Existing test files for index-store and CLI recall
**Dependencies:** Tasks 2-5

- `searchIndex` with `mmr: true` returns results in MMR order
- `searchIndexHybrid` with `mmr: true` returns results with `_mmrScore` annotated
- CLI `recall --mmr` works end-to-end
- CLI `recall --mmr --mmr-lambda 0.5` works
- CLI `recall --mode hybrid --mmr` works
- MMR results are different from non-MMR results (diversity is observable)

## Task 7: Output Format Updates (src/commands/recall.js)
**Files:** `src/commands/recall.js`
**Dependencies:** Task 5

In output formatters:
- `outputMarkdown`: Show MMR score when `_mmrScore` is present (alongside existing hybrid/BM25 score)
- `outputJSON`: Include `_mmrScore` and `_mmrLambda` in the memory object (already included via spread)
- `outputMemories`: Show MMR rank when present
