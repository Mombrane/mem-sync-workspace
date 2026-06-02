# Tasks: Interactive Review UI

## Task 1: Extract shared pending functions (src/merge.js)
**Files:** `src/merge.js`, `src/commands/forget.js`
**Description:** Extract `findAndRemoveFromPending()` and `removeAllPending()` from forget.js pattern into merge.js. Refactor forget.js to use shared function.
**Tests:** Unit tests for findAndRemoveFromPending, removeAllPending
**Dependencies:** None

## Task 2: Implement review approve command (src/commands/review.js)
**Files:** `src/commands/review.js`
**Description:** Add `approveCommand(args)` with single ID and `--all` support. Parse args, find+remove from pending, normalize, append to memories.jsonl. JSON output.
**Tests:** Unit tests for approveCommand (single, bulk, error cases)
**Dependencies:** Task 1

## Task 3: Implement review reject command (src/commands/review.js)
**Files:** `src/commands/review.js`
**Description:** Add `rejectCommand(args)` with single ID and `--all` support. Parse args, find+remove from pending. JSON output.
**Tests:** Unit tests for rejectCommand (single, bulk, error cases)
**Dependencies:** Task 1

## Task 4: Update CLI routing and help (src/cli.js)
**Files:** `src/cli.js`
**Description:** Add `handleReviewCommand()` dispatcher. Update help text with approve/reject subcommands.
**Tests:** CLI entry test for review subcommands
**Dependencies:** Tasks 2, 3

## Task 5: E2E tests
**Files:** `tests-e2e/review-forget.test.js`
**Description:** Add e2e tests for approve/reject flows: retain → review pending → approve → verify, retain → review pending → reject → verify, bulk operations.
**Tests:** E2E test additions
**Dependencies:** Tasks 2, 3, 4
