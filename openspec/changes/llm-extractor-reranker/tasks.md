# Tasks: LLM Extractor/Reranker

## Task 1: LLM Provider Infrastructure
**Files:** Create `src/llm-provider.js`, Create `tests/llm-provider.test.js`
**Dependencies:** None

- [ ] Create `src/llm-provider.js`:
  - Define `LLMProvider` interface (`name`, `model`, `chat`)
  - Implement `noopLLMProvider`
  - Implement `createMockLLMProvider()` — deterministic responses based on input hash
  - Implement `createOpenAILLMProvider({ apiKey, model, baseUrl })` — OpenAI-compatible `/v1/chat/completions`
  - Implement `resolveLLMProvider()` — env-var resolution (`MEM_SYNC_LLM_PROVIDER`, `MEM_SYNC_LLM_API_KEY`, `MEM_SYNC_LLM_MODEL`, `MEM_SYNC_LLM_BASE_URL`)
  - Add exponential backoff retry (reuse pattern from `embedding-cache.js:449-466`)

- [ ] Create `tests/llm-provider.test.js`:
  - Test noop provider returns `'{}'`
  - Test mock provider returns deterministic JSON for same input
  - Test OpenAI provider sends correct request format
  - Test OpenAI provider handles HTTP errors
  - Test `resolveLLMProvider()` with various env-var combinations
  - Test retry logic on transient failures

## Task 2: LLM Extractor
**Files:** Create `src/llm-extract.js`, Create `tests/llm-extract.test.js`
**Dependencies:** Task 1

- [ ] Create `src/llm-extract.js`:
  - Implement `extractWithLLM(transcript, llmProvider, options)`
  - Implement `singlePassExtract()` for short transcripts (≤5 user messages)
  - Implement `classifyPass()` for long transcripts (Pass 1)
  - Implement `extractPass()` for classified messages (Pass 2)
  - Implement `prepareTranscript()` — truncation from start, `--max-tokens` (default 8000)
  - Implement `parseLLMResponse()` — multi-stage JSON parsing defense:
    1. Strip markdown fences
    2. Direct JSON.parse
    3. Regex extract JSON array
    4. Line-by-line parse
  - Implement kind-specific extraction prompts for all 8 memory kinds
  - All candidates flow through `normalizeMemoryInput()` for schema validation

- [ ] Create `tests/llm-extract.test.js`:
  - Test single-pass extraction for short transcripts
  - Test two-pass extraction for long transcripts
  - Test JSON parsing with valid JSON
  - Test JSON parsing with markdown-fenced JSON
  - Test JSON parsing with trailing commas
  - Test JSON parsing with truncated output
  - Test transcript truncation (long transcript)
  - Test transcript no-truncation (short transcript)
  - Test schema validation of extracted candidates
  - Test empty transcript handling
  - Test LLM API failure graceful degradation

## Task 3: LLM Reranker
**Files:** Create `src/llm-rerank.js`, Create `tests/llm-rerank.test.js`
**Dependencies:** Task 1

- [ ] Create `src/llm-rerank.js`:
  - Implement `rerankWithLLM(candidates, query, llmProvider, options)`
  - Implement `scoreCandidatesWithLLM()` — send query + candidates to LLM, get relevance scores
  - Implement `computeRRF()` — Reciprocal Rank Fusion
  - Implement variance guard: skip fusion if `stddev(scores) < 0.01`
  - Scoring prompt: "Rate each memory for relevance to the query on a scale of 0.0-1.0. Return ONLY a JSON array of scores."
  - Output: candidates with `_llmScore`, `_llmRank`, `_fusedScore` fields
  - Parameters: `llmWeight` (default 0.7), `llmTopN`, `rrfK` (default 60)

- [ ] Create `tests/llm-rerank.test.js`:
  - Test RRF calculation with known scores
  - Test variance guard triggers when scores are uniform
  - Test LLM score integration with hybrid scores
  - Test empty candidates handling
  - Test LLM API failure graceful degradation
  - Test `llmTopN` limits candidates sent to LLM
  - Test output fields (`_llmScore`, `_llmRank`, `_fusedScore`)

## Task 4: CLI Integration — retain command
**Files:** Modify `src/commands/retain.js`
**Dependencies:** Task 2

- [ ] Add `--llm-extract` flag to `parseRetainArgs()`:
  - Boolean flag, default false
  - Add to help text

- [ ] Add `--max-tokens` flag:
  - Integer, default 8000
  - Validate positive integer

- [ ] Modify retain flow:
  - When `--llm-extract` is set, resolve `LLMProvider` and call `extractWithLLM()`
  - Merge LLM candidates with rule-based candidates
  - Dedup by canonicalKey (automatic via `normalizeMemoryInput()`)

## Task 5: CLI Integration — recall command
**Files:** Modify `src/commands/recall.js`
**Dependencies:** Task 3

- [ ] Add `--llm-rerank` flag to recall args parser:
  - Boolean flag, default false
  - Add to help text

- [ ] Add `--llm-weight` flag:
  - Float 0-1, default 0.7
  - Validate range

- [ ] Add `--llm-top-n` flag:
  - Positive integer, default limit*3
  - Validate positive integer

- [ ] Modify recall flow:
  - After hybrid/MMR processing, if `--llm-rerank` is set:
    - Resolve `LLMProvider`
    - Call `rerankWithLLM()` on results
  - Update output to show `_llmScore` when present

## Task 6: Full Test Suite Verification
**Files:** None (verification only)
**Dependencies:** Tasks 1-5

- [ ] Run `npm test` — all existing 484 tests must pass
- [ ] Run all new test files individually
- [ ] Verify no import errors or circular dependencies
- [ ] Verify CLI help text includes new flags
- [ ] Verify `--help` output for retain and recall commands
