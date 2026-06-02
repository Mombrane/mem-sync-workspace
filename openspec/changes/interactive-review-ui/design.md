# Design: Interactive Review UI

## Architecture

### Current State
```
cli.js → reviewCommand(args) → parseReviewArgs() → readPendingFiles() → formatTable()
```

### Target State
```
cli.js → handleReviewCommand(args)
  ├─ 'pending' → reviewCommand(rest)        # existing, unchanged
  ├─ 'approve' → approveCommand(rest)        # new
  ├─ 'reject'  → rejectCommand(rest)         # new
  └─ else → error message
```

## Key Design Decisions

### 1. Extract `findAndRemoveFromPending()` into `src/merge.js`

From forget.js pattern (lines 45-93), extract into reusable function:
- Scans both `.jsonl` and `.json` files in pending dir
- Finds record by ID, removes it from file
- Returns `{ found: boolean, record: object|null, filePath: string|null }`
- Empty files are preserved (not deleted)
- Refactor `forget.js` to use this shared function

### 2. Two-phase approve flow
```
1. Read pending record by ID (via findAndRemoveFromPending)
2. Normalize record via normalizeMemoryInput()
3. Append to memories.jsonl via appendJSONL()
4. Remove from pending file (already done in step 1)
```
Steps 1+4 happen atomically in `findAndRemoveFromPending()` — it reads AND removes in one pass. Step 2+3 happen after.

### 3. Lock strategy
- Single record approve/reject: no lock (fast O(1) operations)
- `--all` operations: acquire lock before write phase, release after

### 4. Output format
All commands output JSON to stdout for pipeline-friendly usage:
- `{"approved": "<id>"}` — single approve
- `{"approved": [...ids], "count": N}` -- bulk approve
- `{"rejected": "<id>"}` — single reject
- `{"rejected": [...ids], "count": N}` -- bulk reject
- `{"skipped": "<id>", "reason": "already exists"}` — ID conflict

## File Changes

### `src/merge.js` — Add shared functions
- `findAndRemoveFromPending(pendingDir, id)` → `{ found, record, filePath }`
- `removeAllPending(pendingDir)` → `{ count, ids }`
- Extract pattern from `forget.js` lines 45-93

### `src/commands/review.js` — Add approve/reject
- `approveCommand(args)` — single/bulk approve
- `rejectCommand(args)` — single/bulk reject
- `parseApproveArgs(args)` — parse approve flags
- `parseRejectArgs(args)` — parse reject flags

### `src/cli.js` — Add subcommand routing
- `handleReviewCommand(args)` — dispatch to pending/approve/reject
- Update help text

### `src/commands/forget.js` — Refactor to use shared function
- Replace inline pending scan with `findAndRemoveFromPending()`

## Test Strategy

### Unit tests (tests/review.test.js)
- `findAndRemoveFromPending` — finds and removes record
- `findAndRemoveFromPending` — returns null for missing ID
- `removeAllPending` — removes all records, returns count
- `approveCommand` — single approve: pending→store
- `approveCommand` — bulk approve: all pending→store
- `rejectCommand` — single reject: removed from pending
- `rejectCommand` — bulk reject: all pending removed
- Error: approve/reject non-existent ID
- Error: approve ID already in store

### E2E tests (tests-e2e/review-forget.test.js)
- Full flow: retain → review pending → review approve → verify in store
- Full flow: retain → review pending → review reject → verify removed
- Bulk approve/reject
- Empty pending handling
