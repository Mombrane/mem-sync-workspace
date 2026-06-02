# Design: LLM Extractor/Reranker

## Architecture Overview

```
retain pipeline (with LLM):
  transcript ──┬──► rule engine (existing) ──► candidates_rule
               │
               └──► LLM extractor (--llm-extract) ──► candidates_llm
                                                          │
               ┌──────────────────────────────────────────┘
               ▼
          merge + dedup (by canonicalKey) ──► unified candidates

recall pipeline (with LLM rerank):
  FTS5 BM25 → embedding cosine → hybrid score → MMR → LLM Rerank → truncate
                                   (opt-in)    (opt-in)  (opt-in)
```

## Component Design

### 1. LLM Provider (`src/llm-provider.js`)

Follows `embedding-provider.js` pattern: factory functions, env-var resolution.

```js
// @typedef {Object} LLMProvider
// @property {string} name
// @property {string} model
// @property {function(object[], object?): Promise<string>} chat

// Implementations:
noopLLMProvider          // returns '{}', for when LLM is disabled
createMockLLMProvider()  // deterministic responses, for testing
createOpenAILLMProvider({ apiKey, model, baseUrl })  // OpenAI-compatible API
resolveLLMProvider()     // env-var resolution
```

**Environment Variables:**
- `MEM_SYNC_LLM_PROVIDER`: `noop` | `openai` | `mock`
- `MEM_SYNC_LLM_API_KEY`: API key
- `MEM_SYNC_LLM_MODEL`: model name (default `gpt-4o-mini`)
- `MEM_SYNC_LLM_BASE_URL`: base URL for local/Ollama

### 2. LLM Extractor (`src/llm-extract.js`)

**Two-pass CoT approach:**

**Pass 1 — Classify (cheap, batchable):**
- Input: transcript messages with indices
- Prompt: classify which messages contain memories, identify kind
- Output: `[{index, kind}, ...]`
- Skip for ≤5 user messages (go to single-pass)

**Pass 2 — Extract (kind-specific):**
- Input: classified message + context window (2 before/after)
- Kind-specific prompts for: preference, decision, project_fact, identity, workflow, correction, warning, episode
- Output: `{content, kind, confidence, veracity, scope, tags}`

**Single-pass (short transcripts):**
- Combined classify+extract in one prompt

**JSON parsing defense-in-depth:**
1. Strip markdown code fences
2. Direct `JSON.parse()`
3. Regex extract JSON array substring
4. Line-by-line parse
5. Per-item schema validation via `normalizeMemoryInput()`

**Transcript truncation:**
- `--max-tokens` (default 8000)
- Estimate: 4 chars per token
- Truncate from start (keep most recent)

### 3. LLM Reranker (`src/llm-rerank.js`)

**Scoring: Reciprocal Rank Fusion (RRF)**
```
fusedScore = alpha / (k + rank_llm) + (1 - alpha) / (k + rank_hybrid)
```
- `alpha` = `llmWeight` (default 0.7)
- `k` = `rrfK` (default 60)

**Variance guard:**
- If `stddev(llm_scores) < 0.01`, skip fusion (LLM didn't differentiate)
- Log warning to stderr

**LLM scoring prompt:**
```
Rate each memory for relevance to the query on a scale of 0.0-1.0.
Return ONLY a JSON array of scores.
```

### 4. CLI Integration

**retain command flags:**
- `--llm-extract`: boolean, default false
- `--max-tokens`: integer, default 8000

**recall command flags:**
- `--llm-rerank`: boolean, default false
- `--llm-weight`: float 0-1, default 0.7
- `--llm-top-n`: integer, default limit*3

**Pipeline order** (recall):
FTS → Hybrid → MMR → LLM Rerank → truncate

### 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| LLM API unavailable | Fall back to rule-based / FTS-only |
| LLM returns invalid JSON | Multi-stage parsing, partial results |
| LLM scores low variance | Skip fusion, return unmodified results |
| API rate limit | Exponential backoff (reuse pattern from embedding-cache.js) |
| Transcript too long | Truncate from start, log warning |
