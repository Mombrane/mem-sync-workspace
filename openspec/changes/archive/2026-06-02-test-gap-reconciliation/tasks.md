## 1. Git Wrapper Test Gap And Safety

- [x] 1.1 Add direct `stageFile` tests in `tests/git.test.js` for staging an existing file and throwing on a missing file.
- [x] 1.2 Add direct `commit` tests in `tests/git.test.js` for creating a commit with the expected message and throwing when no staged changes exist.
- [x] 1.3 Add direct `push` tests in `tests/git.test.js` for returning `false` without a remote and successfully pushing to a local bare origin.
- [x] 1.4 Add quoted filename and quoted commit message regression coverage in `tests/git.test.js`.
- [x] 1.5 Replace user-controlled shell-string Git calls in `src/git.js` with argument-array process execution for `add`, `commit`, and `clone`.
- [x] 1.6 Add a concise implementation comment near the argument-array Git executor explaining that it avoids shell interpolation for file paths, commit messages, and remote URLs.
- [x] 1.7 Run `node --test tests/git.test.js` and confirm all Git wrapper tests pass.

## 2. Maintenance Command Test Gaps

- [x] 2.1 Create `tests/cli-compact.test.js` covering `parseCompactArgs` for `--older-than`, `--dry-run`, `--repo`, missing values, invalid values, and unknown flags.
- [x] 2.2 Add `compactCommand` and spawned CLI dry-run coverage that verifies JSON stdout and no file mutation.
- [x] 2.3 Tighten `src/commands/compact.js` integer parsing if tests show `parseInt` accepts invalid forms such as `1abc`.
- [x] 2.4 Create `tests/cli-summarize.test.js` covering `parseSummarizeArgs` for `--project`, `--force`, `--repo`, missing values, and unknown flags.
- [x] 2.5 Add `summarizeCommand` and spawned CLI coverage that verifies JSON stdout and summary file creation.
- [x] 2.6 Run `node --test tests/cli-compact.test.js tests/cli-summarize.test.js` and confirm both pass.

## 3. Redaction And Schema Boundary Coverage

- [x] 3.1 Add `createMemoryStore.add` redaction write-path tests in `tests/memory-store.test.js` for default blocking and `skipRedaction: true` bypass.
- [x] 3.2 Add custom redaction rule error tests in `tests/redaction-engine.test.js` for invalid regex, missing `name`, and missing `pattern`.
- [x] 3.3 Add public schema compatibility tests in `tests/schema.test.js` for legacy `text`, explicit `id`, non-manual source defaults, and project/agent canonical-key differences.
- [x] 3.4 Add invalid timestamp field tests in `tests/schema.test.js` that assert field-specific error messages.
- [x] 3.5 Run `node --test tests/memory-store.test.js tests/redaction-engine.test.js tests/schema.test.js` and confirm all pass.

## 4. CLI Entry And Index Coverage

- [x] 4.1 Create `tests/cli-entry.test.js` covering no-command help, unknown command exit code, and unknown `index` subcommand behavior.
- [x] 4.2 Add public `list` output coverage in `tests/cli-entry.test.js` for string source, object source, and missing source formatting.
- [x] 4.3 Add focused `searchIndex` filter tests in `tests/index-store.test.js` for `projectId`, `agentId`, `veracity`, `minImportance`, and combined filters.
- [x] 4.4 Add recursive JSONL indexing coverage in `tests/index-store.test.js`.
- [x] 4.5 Add logger diagnostic coverage in `tests/index-store.test.js` for invalid JSON and schema-skip messages.
- [x] 4.6 Implement any missing `searchIndex` filter support in `src/index-store.js` while keeping existing string-signature compatibility.
- [x] 4.7 Keep index diagnostics concise and route them through the existing logger callback rather than stdout.
- [x] 4.8 Run `node --test tests/cli-entry.test.js tests/index-store.test.js` and confirm both pass.

## 5. Low-Priority Boundary Tests

- [x] 5.1 Add `validateRange` tests in `tests/argparse.test.js` for `NaN` and string inputs.
- [x] 5.2 Add `resolveProjectId` fallback coverage in `tests/project-resolver.test.js` for `package.json` without a `name` field.
- [x] 5.3 Run `node --test tests/argparse.test.js tests/project-resolver.test.js` and confirm both pass.

## 6. Logging, Comments, And Final Verification

- [x] 6.1 Review new implementation comments and keep only comments explaining non-obvious safety, compatibility, or stdout/stderr boundaries.
- [x] 6.2 Verify command and Git diagnostics that were added or touched write to stderr, while JSON/human command results remain on stdout.
- [x] 6.3 Run the reconciled focused test set: `node --test tests/git.test.js tests/cli-compact.test.js tests/cli-summarize.test.js tests/memory-store.test.js tests/redaction-engine.test.js tests/cli-entry.test.js tests/schema.test.js tests/index-store.test.js tests/argparse.test.js tests/project-resolver.test.js`.
- [x] 6.4 Run `npm test` and confirm the full suite passes with no skipped or todo tests.
- [x] 6.5 Update `docs/superpowers/plans/2026-06-02-mem-sync-completion-plan.md` only if implementation discoveries change the planned order or accepted test-gap scope.
