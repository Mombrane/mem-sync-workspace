## Why

External review identified useful test gaps around Git sync, CLI command parsing, redaction, schema boundaries, and index filtering. The current suite is green, but several high-risk paths are only indirectly covered; adding focused tests now will make the June 2 completion work safer, especially the planned Git wrapper hardening.

## What Changes

- Add a test-gap reconciliation pass that accepts non-duplicative, public-behavior tests from the external report and rejects low-value private-function testing.
- Add direct tests for Git wrapper helpers (`stageFile`, `commit`, `push`) and regression coverage for quoted file names / commit messages.
- Harden Git wrapper execution so user-controlled paths, commit messages, and remote URLs use argument-array process calls instead of shell string interpolation.
- Add focused command-layer tests for `compact` and `summarize` parsers and representative command output.
- Add write-path redaction tests, custom redaction rule error tests, CLI entry behavior tests, schema boundary tests, and focused index filter/logger tests.
- Require implementation comments only where they explain non-obvious safety or compatibility decisions, and require key diagnostic logs where command behavior needs operator visibility.
- No breaking CLI changes are introduced.

## Capabilities

### New Capabilities
- `test-gap-reconciliation`: Defines the accepted test-gap reconciliation behavior, including public-behavior test selection, regression coverage, and verification expectations.

### Modified Capabilities
- `github-sync`: Git transport helpers must safely handle user-controlled arguments and support diagnostic visibility for sync-related commands.
- `memory-records`: Schema boundary behavior must be covered through public normalization and validation APIs, without exposing private helper functions solely for tests.

## Impact

- Affected tests: `tests/git.test.js`, `tests/cli-compact.test.js`, `tests/cli-summarize.test.js`, `tests/cli-entry.test.js`, `tests/memory-store.test.js`, `tests/redaction-engine.test.js`, `tests/schema.test.js`, `tests/index-store.test.js`, `tests/argparse.test.js`, `tests/project-resolver.test.js`.
- Affected implementation: likely `src/git.js`, `src/commands/compact.js`, `src/index-store.js`, and small CLI/help paths only when tests expose real gaps.
- Dependencies: no new runtime dependencies.
- Logs/comments: key Git and command operations should keep concise diagnostics on stderr; comments should document why shell-string Git calls are avoided and why tests cover public behavior instead of private helpers.
