## 1. Extract Shared Argument Parsing Helpers

- [ ] 1.1 Create `src/argparse.js` with `requireValue`, `validateEnum`, `validateRange`, `validatePositiveInt` functions.
- [ ] 1.2 Create `tests/argparse.test.js` with 9 test cases covering: basic functionality, missing-value errors, flag-as-value rejection, enum validation (happy path + error), range validation with boundary values, out-of-range errors, positive int validation, rejection of 0/negative/float.

## 2. Refactor searchIndex to Options Object

- [ ] 2.1 Change `searchIndex(cacheDir, query, limit)` to `searchIndex(cacheDir, options)` with backward-compat detection (`typeof optionsOrQuery === 'string'`).
- [ ] 2.2 Implement SQL generation for structured filters: scope, kind, projectId, agentId, minConfidence, minImportance, veracity, excludeDeleted, excludeExpired.
- [ ] 2.3 Implement JS post-filter for tags (AND semantics, `Array.every`).
- [ ] 2.4 Add JSDoc for both the new options shape and the deprecated positional signature.
- [ ] 2.5 Verify backward compat: `searchIndex(cacheDir, 'legacy query')` and `searchIndex(cacheDir, 'legacy query', 10)` both work.

## 3. Fix searchIndex Limit Bug in Existing Tests

- [ ] 3.1 Locate and fix the test at `tests/index-store.test.js:330` (or equivalent) that passes `{ limit: 3 }` as the third positional argument.
- [ ] 3.2 Verify the test actually validates limit behavior (not vacuously passing because of the catch block).

## 4. Add searchIndex Options Object Tests

- [ ] 4.1 Add 10 test cases to `tests/index-store.test.js`: new options object works, scope filter, kind filter, minConfidence threshold, tag post-filter (single + multi AND), excludeDeleted:false, excludeExpired:false, backward compat with string as second arg, backward compat with string + limit.

## 5. Implement remember Command Module

- [ ] 5.1 Create `src/commands/remember.js` with `rememberCommand(args)` and `parseRememberArgs(args)`.
- [ ] 5.2 Implement flag parsing for: `--kind`, `--scope`, `--tag` (repeatable), `--confidence`, `--importance`, `--project-id`, `--agent-id`, `--source-type`, `--source-agent`, `--valid-until`, `--summary`, `--supersedes` (repeatable).
- [ ] 5.3 Use shared argparse helpers for all validation (enum, range, positive int).
- [ ] 5.4 Content is collected from positional args not starting with `--`, joined with spaces.
- [ ] 5.5 Empty content triggers error: "content cannot be empty." with exit code 1.
- [ ] 5.6 Unknown flags trigger error: "unknown option: <flag>" with exit code 1.
- [ ] 5.7 Call `memoryStore.add(content, options)` and write the resulting memory ID to stdout.
- [ ] 5.8 Ensure schema diagnostics (normalize/validate messages) go to stderr.

## 6. Implement recall Command Module

- [ ] 6.1 Create `src/commands/recall.js` with `recallCommand(args)` and `parseRecallArgs(args)`.
- [ ] 6.2 Implement flag parsing for: `--format`, `--limit`, `--scope`, `--kind`, `--tag` (repeatable), `--min-confidence`, `--min-importance`, `--project-id`, `--agent-id`, `--veracity`, `--include-deleted`, `--include-expired`.
- [ ] 6.3 Use shared argparse helpers for all validation.
- [ ] 6.4 Missing query triggers error: "query is required." with exit code 1.
- [ ] 6.5 Implement no-index detection: call `getIndexStatus()` before searching.
- [ ] 6.6 Implement markdown output format (default): header, per-result sections with score/ID/metadata/blockquoted content, `---` separators, empty-result message, no-index message.
- [ ] 6.7 Implement json output format: `{ query, count, results: [{ rank, memory }] }`.
- [ ] 6.8 Implement memories output format: `[MEMORY]...[/MEMORY]` blocks with normalized rank (0–1), escaped `[/MEMORY]` sequences in content.
- [ ] 6.9 Ensure all output goes through controlled write paths (markdown structural characters are ASCII; content passed through as-is).

## 7. Update cli.js Routing

- [ ] 7.1 Replace `add` case with `remember` case, routing to `rememberCommand(args)`.
- [ ] 7.2 Add `recall` case, routing to `recallCommand(args)`.
- [ ] 7.3 Keep `list`, `export`, and `index` cases unchanged.
- [ ] 7.4 Update `printHelp()` to document `remember` and `recall` usage.
- [ ] 7.5 Remove the inline `parseAddArgs` function (replaced by `src/commands/remember.js`).
- [ ] 7.6 Remove the inline `requireValue` function (replaced by `src/argparse.js`).

## 8. CLI Integration Tests: remember

- [ ] 8.1 Create `tests/cli-remember.test.js` with 17 test cases covering: defaults, explicit kind/scope, repeatable --tag, numeric --confidence/--importance, --project-id/--agent-id, --source-type/--source-agent, --valid-until, --summary override, --supersedes (repeatable), empty content error, invalid kind error, out-of-range confidence error, non-numeric confidence error, unknown flag error, schema diagnostics to stderr, result in JSONL file, content normalization.
- [ ] 8.2 Each test uses `MEM_SYNC_HOME` for test isolation (existing pattern).
- [ ] 8.3 Verify exit codes: 0 for success, 1 for errors.

## 9. CLI Integration Tests: recall

- [ ] 9.1 Create `tests/cli-recall.test.js` with 16 test cases: JSON format with indexed data, default markdown format, memories format, --limit respect, --scope filter, --kind filter, --tag filter (AND), --min-confidence threshold, --min-importance threshold, no-matching-results message, missing query error, invalid format error, no-index message, --include-deleted, --include-expired, --project-id filter.
- [ ] 9.2 Each test sets up a temporary index with controlled test data.
- [ ] 9.3 Verify exit codes: 0 for success/empty-results/no-index, 1 for errors.

## 10. Integration and Documentation

- [ ] 10.1 Run `npm test` and confirm all tests pass (existing + new).
- [ ] 10.2 Verify no regressions in existing `cli-index.test.js`, `index-store.test.js`, `memory-store.test.js`, `schema.test.js`.
- [ ] 10.3 Update `README.md` with `mem-sync remember` and `mem-sync recall` usage examples and option reference.
- [ ] 10.4 Review implementation against `openspec/changes/remember-recall-commands/design.md` decisions: options-object backward compat, argparse extraction, output format fidelity, error message consistency, test isolation.
