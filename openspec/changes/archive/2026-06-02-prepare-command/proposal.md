## Why

The current `mem-sync` CLI has `remember` and `recall` commands for writing and querying memories, plus `index rebuild/status/update` for maintaining the local SQLite/FTS5 index. But every session starts in an unknown state:

- Is the local `.mem-sync` repository up to date with the remote?
- Are there local pending changes from a previous session that need to be merged?
- Is the FTS5 index consistent with the current JSONL data?

Agents and users must manually run `git pull`, resolve conflicts, and `mem-sync index update` before each session. This is error-prone and breaks the zero-friction memory experience. The `prepare` command automates this initialization sequence, ensuring the repository and index are synchronized before an agent starts.

## What Changes

- Add `mem-sync prepare` command that runs a 6-step initialization sequence: clone check → repo lock → git fetch/pull/rebase → deterministic merge → index update/rebuild → unlock.
- Implement a file-based atomic lock (`src/lock.js`) using `fs.openSync` with `O_EXCL|O_CREAT`, PID-based expiration detection, and a 10-second timeout.
- Implement Git operation wrappers (`src/git.js`) for clone, fetch, pull, rebase with stash protection for local pending changes.
- Implement deterministic merge (`src/merge.js`) that deduplicates pending changes by canonicalKey and keeps the record with the most recent `updatedAt`.
- Add `src/commands/prepare.js` as the command entry point, orchestrating the 6-step sequence.
- Update `src/cli.js` to register the `prepare` route.
- Output structured JSON result to stdout: `{ git: { skipped, pulled, conflicts }, merge: { pending, merged, total }, index: { rebuilt, records } }`.

## Capabilities

### New Capabilities

- `prepare-command`: Initialize the local memory repository and FTS5 index before agent startup, ensuring a consistent state for subsequent `remember`, `recall`, and `index` operations.

### Modified Capabilities

- None. Existing `remember`, `recall`, `index`, `list`, and `export` commands are unchanged. `prepare` is a new command that composes existing sub-operations (git operations, index rebuild) into a single initialization sequence.

## Impact

- Affected code: new `src/lock.js`, new `src/git.js`, new `src/merge.js`, new `src/commands/prepare.js`, modified `src/cli.js`.
- Affected tests: new `tests/cli-prepare.test.js`, new `tests/lock.test.js`, new `tests/git.test.js`, new `tests/merge.test.js`.
- Affected docs: OpenSpec gains `prepare-command` requirements; CLI help updated.
- No existing JSONL files, schema validation, memory store, or index store behavior is changed.
- `.mem-sync` directory is itself a Git repository; `prepare` operates inside it, located via `MEM_SYNC_HOME` environment variable (consistent with existing `src/repo-store.js` pattern).
