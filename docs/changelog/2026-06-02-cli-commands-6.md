# 2026-06-02: Implement 6 remaining CLI commands

## Summary
Implemented the 6 remaining CLI commands from design doc section 11: `init`, `sync`, `status`, `log`, `show`, `forget`.

## Changes

### New commands
| Command | Description | File |
|---------|-------------|------|
| `init` | Scaffold memory repo with directory skeleton and meta files | src/commands/init.js |
| `sync` | Fetch + pull rebase with stash protection and index update | src/commands/sync.js |
| `status` | Lightweight local state snapshot (no network I/O) | src/commands/status.js |
| `log` | Git log of memory changes with configurable --limit | src/commands/log.js |
| `show` | Search JSONL and pending files for record by ID | src/commands/show.js |
| `forget` | Soft-delete from store or remove from pending | src/commands/forget.js |

### Infrastructure
- `tests/helpers.js` — shared test utilities (makeRecord, initGitRepo, commitFile, setupMemSyncEnv, cleanupEnv, runCli)
- `src/cli.js` — wired all 6 commands, updated help text

### Tests
- 25 new tests across 6 test files
- All 337 tests passing (was 312)

## Design decisions
- `sync` vs `prepare`: sync does fetch+pull+index update without merging pending (prepare's job)
- `status` does NOT check remote connectivity (that's doctor's concern)
- `forget` does NOT auto-commit (flush handles that)
- `forget` does NOT cascade through supersedes chains
- `log` uses null byte (`%x00`) delimiter to avoid commit message parsing issues

## Cost
- Explore: $1.27 (2 rounds)
- Delegate: $2.11 (73 turns)
- Review/fix: $0 (manual patches)
- Total: ~$3.38

## Next steps
- P2 items: embedding cache, MMR rerank, LLM extractor/reranker, encrypted repo support, generated skills, interactive review UI
