# Changelog: Test Gap Reconciliation (2026-06-02)

## Feature: Test Gap Reconciliation

Reconciled external test-gap report against the existing test suite. Added focused tests for high-risk paths (Git wrapper, command parsers, redaction write-path, schema boundaries, index filtering) and hardened Git transport to use argument-array process calls instead of shell string interpolation.

### New Files

| File | Purpose |
|------|---------|
| `tests/cli-compact.test.js` | Compact command parser and dry-run tests |
| `tests/cli-summarize.test.js` | Summarize command parser and output tests |
| `tests/cli-entry.test.js` | CLI entry point behavior tests (help, unknown command, list output) |

### Modified Files

| File | Changes |
|------|---------|
| `src/git.js` | Argument-array process execution for `add`, `commit`, `clone` (shell interpolation safety) |
| `src/commands/compact.js` | Tightened integer parsing |
| `tests/git.test.js` | +110 lines: stageFile, commit, push, quoted filename/message tests |
| `tests/index-store.test.js` | +70 lines: searchIndex filter tests (projectId, agentId, veracity, minImportance, combined) |
| `tests/memory-store.test.js` | +28 lines: redaction write-path tests |
| `tests/redaction-engine.test.js` | +31 lines: custom rule error tests |
| `tests/schema.test.js` | +35 lines: legacy text, explicit id, source defaults, invalid timestamp tests |
| `tests/argparse.test.js` | +11 lines: validateRange NaN/string tests |
| `tests/project-resolver.test.js` | +15 lines: package.json without name fallback |

### Design Decisions

- **Public behavior over private helper tests** — Tests exercise `normalizeMemoryInput`, `createMemoryStore.add`, CLI commands, and `searchIndex` instead of exporting private helpers
- **Red-green ordering for Git hardening** — Tests added first to capture the shell-string limitation, then `src/git.js` switched to argument-array execution
- **Targeted command parser tests** — `compact` and `summarize` parser tests verify normal flags, missing values, unknown flags, and one CLI output path
- **Diagnostic log boundary** — JSON/human output on stdout, operational diagnostics on stderr

### Test Results

415 tests, 0 failures (33 new tests added across 10 test files)

### Cost

| Phase | Cost |
|-------|------|
| Explore | $0 (pre-existing OpenSpec artifacts) |
| Propose | $0 (pre-existing OpenSpec artifacts) |
| Delegate | $0 (already implemented) |
| Review + Verify | $0 |
| **Total** | **$0** (cron verification pass) |

### Next Steps

- P2: MMR rerank (diversity-aware re-ranking)
- P2: LLM extractor/reranker
- P2: Encrypted repo support
