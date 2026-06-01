# Tasks: `retain --pending`

## Task 1: Create `src/retain-engine.js`

**Files:** CREATE `src/retain-engine.js`

- [ ] Implement `extractCandidates(transcript, options)` — pure function
- [ ] Define RULES array with data-driven extraction patterns:
  - explicit-remember: 记住/remember/请记住/记一下 → preference, user, 0.95, stated
  - preference-pattern: 以后/默认/不要/总是/always/never/default → preference, user, 0.85, stated
  - decision-pattern: 决定/采用/选择/decided/chose/adopted → decision, project, 0.8, stated
  - project-fact-pattern: 架构/命令/坑点/constraint/architecture/pitfall → project_fact, project, 0.6, inferred
  - (implicit) fallback: user messages with no rule match → episode, global, 0.3, inferred
- [ ] Implement `extractSentence(content, pattern)` helper — extracts the meaningful part after trigger word
- [ ] Each candidate includes: content, kind, scope, confidence, veracity, evidence, source
- [ ] Only process user messages (skip assistant/system messages)
- [ ] Validate transcript is array, each entry has role/content

## Task 2: Create `tests/retain-engine.test.js`

**Files:** CREATE `tests/retain-engine.test.js`

- [ ] Test: explicit "记住" extraction → preference, user, 0.95, stated
- [ ] Test: "以后/默认" patterns → preference, user, 0.85, stated
- [ ] Test: "决定/采用" patterns → decision, project (when projectId given), 0.8, stated
- [ ] Test: architecture keywords → project_fact, project, 0.6, inferred
- [ ] Test: English patterns (remember, always, decided)
- [ ] Test: empty transcript → empty array
- [ ] Test: assistant messages skipped
- [ ] Test: multiple candidates from one message
- [ ] Test: fallback episode for unmatched user messages
- [ ] Run: `node --test tests/retain-engine.test.js`

## Task 3: Create `src/commands/retain.js`

**Files:** CREATE `src/commands/retain.js`

- [ ] Implement `parseRetainArgs(args)` following remember.js pattern
  - Required: `--pending`, `--transcript-file`, `--device`
  - Optional: `--project-id`, `--agent-id`
- [ ] Implement `retainCommand(args)`:
  1. Parse args
  2. Validate --pending present (throw if missing)
  3. Read transcript file (readFile + JSON.parse)
  4. Call extractCandidates(transcript, options)
  5. Normalize each candidate via normalizeMemoryInput
  6. Dedup against existing pending file using createCanonicalKey
  7. Append new records via appendJSONL
  8. Print new record count to stdout

## Task 4: Create `tests/cli-retain.test.js`

**Files:** CREATE `tests/cli-retain.test.js`

- [ ] Test: writes candidates to `pending/<device>.jsonl`
- [ ] Test: prints candidate count to stdout
- [ ] Test: rejects without --pending flag
- [ ] Test: rejects without --transcript-file
- [ ] Test: rejects without --device
- [ ] Test: handles nonexistent transcript file
- [ ] Test: handles invalid JSON transcript
- [ ] Test: empty transcript writes nothing, prints 0
- [ ] Test: dedup — running twice on same transcript doesn't duplicate
- [ ] Run: `node --test tests/cli-retain.test.js`

## Task 5: Wire into `src/cli.js`

**Files:** MODIFY `src/cli.js`

- [ ] Import `retainCommand` from `./commands/retain.js`
- [ ] Add `retain` branch to command router
- [ ] Add `retain` to help text
- [ ] Run: `npm test` — all tests pass
