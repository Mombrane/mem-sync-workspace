# Tasks: compact, summarize, review pending

## Task 1: compact-engine.js + tests (independent)
**Files**: src/compact-engine.js, tests/compact-engine.test.js
**Dependencies**: none

### Sub-tasks:
1.1. Create `src/compact-engine.js` with `compactMemories(opts)` function
1.2. Implement age filtering (updatedAt < now - olderThanDays)
1.3. Implement confidence filtering (>= 0.8, not deleted, not expired)
1.4. Implement canonicalKey dedup (keep latest updatedAt)
1.5. Implement .bak backup before write
1.6. Implement dryRun mode (return stats without modifying files)
1.7. Create `tests/compact-engine.test.js` with all test cases
1.8. Export function and integrate with module system

## Task 2: summarize-engine.js + tests (independent)
**Files**: src/summarize-engine.js, tests/summarize-engine.test.js
**Dependencies**: none

### Sub-tasks:
2.1. Create `src/summarize-engine.js` with `summarizeMemories(opts)` function
2.2. Implement profile.md generation (user scope, preference/identity)
2.3. Implement summary.md generation (global scope, all kinds)
2.4. Implement project summary generation (--project flag)
2.5. Implement force/skip logic for existing files
2.6. Implement threshold filtering (confidence >= 0.6, importance >= 0.3)
2.7. Add metadata (generated timestamp, memory count)
2.8. Create `tests/summarize-engine.test.js` with all test cases

## Task 3: CLI commands + tests (depends on Task 1, 2)
**Files**: src/commands/compact.js, src/commands/summarize.js, src/commands/review.js, tests/review.test.js
**Dependencies**: Task 1 (compact-engine), Task 2 (summarize-engine)

### Sub-tasks:
3.1. Create `src/commands/compact.js` — CLI wrapper for compactMemories
3.2. Create `src/commands/summarize.js` — CLI wrapper for summarizeMemories
3.3. Create `src/commands/review.js` — review pending command
3.4. Implement review pending: read pending files, format output
3.5. Implement kind filtering for review
3.6. Implement --full flag for review
3.7. Update `src/cli.js` to dispatch compact/summarize/review commands
3.8. Create `tests/review.test.js` with all test cases

## Task 4: flush --compact integration (depends on Task 1)
**Files**: src/commands/flush.js
**Dependencies**: Task 1 (compact-engine)

### Sub-tasks:
4.1. Add --compact flag parsing to flush command
4.2. Import compactMemories from compact-engine.js
4.3. Call compactMemories after merge, before commit (only if --compact)
4.4. Add compact stats to flush result object
4.5. Add tests for flush --compact behavior

## Execution Order

**Wave 1** (parallel): Task 1 + Task 2
**Wave 2** (sequential): Task 3 + Task 4 (after Wave 1 completes)

Total estimated: ~250 lines new code, ~220 lines tests
