## Context

The current `mem-sync` test suite is green, but external review highlighted gaps around high-risk wrappers and command boundaries. Some suggestions are already covered or target private helpers, so this change reconciles the report instead of copying it wholesale.

The highest-risk area is Git transport. `src/git.js` currently builds shell command strings for `add`, `commit`, and `clone`; those paths accept file paths, commit messages, or remote URLs and therefore need direct regression tests plus safer process execution. Command parser coverage is also uneven for newer maintenance commands (`compact`, `summarize`). Redaction and schema behavior are mostly covered, but the write path and compatibility boundaries need explicit public-API tests.

## Goals / Non-Goals

**Goals:**
- Add focused tests that cover public behavior not already covered by the current suite.
- Add direct Git wrapper tests before hardening shell-string execution.
- Keep tests deterministic and local-only, using temporary repositories and `node:test`.
- Keep implementation comments concise and focused on non-obvious compatibility or safety decisions.
- Preserve useful diagnostics by writing key command/Git logs to stderr and machine-readable output to stdout.

**Non-Goals:**
- Do not chase 100% coverage or test private helper functions by exporting them.
- Do not add new dependencies or a coverage tool.
- Do not implement deferred product features such as encryption, OAuth, GitHub API sync, or semantic conflict review.
- Do not change Memory Schema v1 fields or persisted data format.

## Decisions

### Public behavior over private helper tests

Tests will exercise `normalizeMemoryInput`, `createMemoryStore.add`, CLI commands, and `searchIndex` instead of exporting private helpers such as `normalizeSource`, `defaultConfidence`, `defaultVeracity`, `legacySourceName`, or `normalizeLegacyScope`.

Alternative considered: export private helpers for direct unit tests. Rejected because that would freeze internals and expand the public module surface only for tests.

### Red-green ordering for Git hardening

The Git wrapper task starts by adding tests for `stageFile`, `commit`, `push`, and quoted file/message inputs. The quoted-input test is expected to expose the current shell-string limitation, then `src/git.js` will switch user-controlled Git operations to argument-array process calls.

Alternative considered: harden `src/git.js` first. Rejected because this change is explicitly about reconciling test gaps and should capture the bug before fixing it.

### Targeted command parser tests

`compact` and `summarize` will get command-level tests because their engines are already covered but their parser/default/output boundaries are not. The tests should stay representative rather than exhaustive; they verify normal flags, missing values, unknown flags, and one CLI output path.

Alternative considered: only test through end-to-end CLI. Rejected because parser errors are easier to diagnose through direct parser tests while still keeping one CLI smoke path.

### Diagnostic log boundary

New or changed command behavior must keep JSON/human command output on stdout and operational diagnostics on stderr. Key logs should be concise and grep-friendly, matching the existing `[mem-sync:<command>] phase:detail` style where applicable.

Alternative considered: no additional log guidance. Rejected because this project relies on machine-readable stdout for automation and needs visible operator diagnostics during Git/index operations.

### Comments are explanatory, not decorative

Add comments only when code would otherwise be surprising: argument-array Git calls, intentional public-behavior test selection, branch-default compatibility, or stdout/stderr separation. Avoid restating obvious code.

Alternative considered: heavy comments throughout implementation. Rejected because verbose comments would make the small CLI modules harder to maintain.

## Risks / Trade-offs

- Git tests can be slow or environment-sensitive → Use local temporary repositories only and avoid network access.
- Permission/disk-full IO tests can be flaky across platforms → Defer broad IO failure simulation unless implemented through deterministic paths.
- Adding tests before implementation can temporarily fail the suite → Keep failures scoped to the paired task and resolve them before moving to the next task.
- Parser tests can over-specify internals → Test returned options and user-visible errors only, not parser implementation details.
- More diagnostic logs can break machine-readable consumers → Logs must go to stderr; stdout remains reserved for command results.

## Migration Plan

1. Add and run focused tests by module.
2. Patch only implementation gaps exposed by those tests.
3. Run each focused test file after its patch.
4. Run `npm test` before marking the change complete.
5. Rollback is simple: revert this change because it does not migrate persisted data or add dependencies.

## Open Questions

None. The change scope is limited to vetted test-gap reconciliation and the implementation fixes directly required by those tests.
