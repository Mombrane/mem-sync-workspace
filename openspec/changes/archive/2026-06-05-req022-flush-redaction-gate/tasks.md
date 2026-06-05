# REQ-022 Tasks

## Task 1: LLM Redaction in retain.js
**File:** `src/commands/retain.js`
**Scope:** Lines 101-105 — add `redactContent()` check inside LLM records loop
**Dependencies:** None
**Estimated effort:** Small (5 lines)

## Task 2: Pre-Commit Redaction Gate in flush.js
**File:** `src/commands/flush.js`
**Scope:** 
- Import `redactContent` from `../redaction-engine.js`
- Import `readJSONL` (if not already imported)
- After merge (Step 4, line 138), add redaction scan block
- Add `--skip-redaction` flag to arg parser
**Dependencies:** None
**Estimated effort:** Medium (~25 lines)

## Task 3: Test Coverage
**File:** `tests/cli-redact.test.js`
**Scope:**
- Test: flush with secret in pending → blocked before commit
- Test: flush with `--skip-redaction` → commit proceeds
- Test: retain with LLM-extracted secret → blocked
- Test: clean records → flush succeeds normally
**Dependencies:** Task 1, Task 2
**Estimated effort:** Medium (~40 lines)
