## Purpose

Define the `mem-sync prepare` CLI command: synchronize the local `.mem-sync` Git repository and rebuild/update the FTS5 index before agent startup.

## ADDED Requirements

### Requirement: Initialize Repository and Index Before Agent Startup

The system SHALL execute a 6-step initialization sequence that ensures the local memory repository is synchronized with remote and the FTS5 index is consistent with JSONL data.

#### Scenario: Prepare on a fresh clone

- **WHEN** the user runs `mem-sync prepare` on a system where `.mem-sync` does not exist
- **THEN** the repository is cloned from the configured remote
- **AND** the FTS5 index is rebuilt from JSONL data
- **AND** stdout contains `{ "git": { "skipped": false, "pulled": ..., "conflicts": 0 }, "merge": { "pending": 0, "merged": 0, "total": 0 }, "index": { "rebuilt": true, "records": ... } }`

#### Scenario: Prepare on an existing up-to-date clone

- **WHEN** the user runs `mem-sync prepare` on a system where `.mem-sync` exists and is current with remote
- **THEN** git fetch is executed but no new commits are pulled
- **AND** no merge is needed (pending directory is empty)
- **AND** the index is updated incrementally (HEAD unchanged, no full rebuild)
- **AND** stdout contains `{ "git": { "skipped": false, "pulled": 0, "conflicts": 0 }, "merge": { "pending": 0, "merged": 0, "total": 0 }, "index": { "rebuilt": false, "records": ... } }`

#### Scenario: Prepare with remote changes to pull

- **WHEN** the user runs `mem-sync prepare` and the remote has new commits
- **THEN** git fetch succeeds and new commits are pulled via rebase
- **AND** stashed local changes are reapplied after rebase
- **AND** stdout reports `pulled > 0`

#### Scenario: Prepare with local pending changes to merge

- **WHEN** the user runs `mem-sync prepare` and the `pending/` directory contains JSON files from a previous session
- **THEN** pending changes are deterministically merged into JSONL (latest `updatedAt` wins per canonicalKey)
- **AND** stdout reports `merged > 0` and `pending` count
- **AND** merged files are removed from `pending/`

#### Scenario: Prepare when HEAD changed requires full index rebuild

- **WHEN** the user runs `mem-sync prepare` and the Git HEAD has changed since the last index build
- **THEN** a full index rebuild is triggered (not incremental update)
- **AND** stdout reports `"rebuilt": true`

#### Scenario: Prepare when HEAD unchanged allows incremental index update

- **WHEN** the user runs `mem-sync prepare` and the Git HEAD is identical to the last indexed commit
- **THEN** an incremental index update is performed
- **AND** stdout reports `"rebuilt": false`

### Requirement: Atomic File Lock for Repository Operations

The system SHALL acquire an exclusive file lock before performing any git or merge operations, using an atomic file lock with PID expiration detection and a 10-second timeout.

#### Scenario: Lock acquired successfully

- **WHEN** no other process holds the lock
- **THEN** `fs.openSync(path, O_EXCL|O_CREAT)` succeeds
- **AND** the PID is written to the lock file
- **AND** the lock is released (file deleted) after prepare completes

#### Scenario: Lock held by another live process

- **WHEN** a lock file exists and its PID corresponds to a running process
- **THEN** the system retries for up to 10 seconds
- **AND** if the lock is still held after timeout, the command exits with a fatal error and non-zero exit code

#### Scenario: Stale lock from dead process

- **WHEN** a lock file exists but its PID does not correspond to any running process
- **THEN** the stale lock is detected via `process.kill(pid, 0)` returning an error
- **AND** the stale lock file is removed
- **AND** a new lock is acquired immediately

#### Scenario: Lock released on error

- **WHEN** prepare encounters a fatal error after acquiring the lock
- **THEN** the lock file is removed before the process exits

### Requirement: Git Operations with Remote

The system SHALL fetch, pull, and rebase from the configured remote, with stash protection for local pending changes.

#### Scenario: No remote configured

- **WHEN** the repository has no remote origin
- **THEN** git operations are skipped
- **AND** stdout reports `"skipped": true`
- **AND** the prepare sequence continues to merge and index steps

#### Scenario: Fetch fails with network error

- **WHEN** `git fetch` fails due to network unavailability
- **THEN** a warning is written to stderr
- **AND** the prepare sequence continues with the existing local state

#### Scenario: Rebase conflict after pull

- **WHEN** `git rebase` encounters a merge conflict
- **THEN** the rebase is aborted with `git rebase --abort`
- **AND** the command exits with a fatal error and non-zero exit code
- **AND** the lock is released before exit

#### Scenario: Stash protects local pending changes during rebase

- **WHEN** rebase is about to start and there are uncommitted local changes
- **THEN** changes are stashed before rebase
- **AND** stash is popped after rebase completes

### Requirement: Deterministic Merge of Pending Changes

The system SHALL merge pending change files from `pending/` into `memories.jsonl` using deterministic deduplication: records with the same canonicalKey keep the one with the most recent `updatedAt`.

#### Scenario: Single pending file merged

- **WHEN** `pending/` contains one JSON file with 3 memory records
- **THEN** records are merged into `memories.jsonl`
- **AND** duplicate records (same canonicalKey, older `updatedAt`) are dropped
- **AND** the pending file is removed after successful merge
- **AND** stdout reports `"merged": 3`

#### Scenario: Multiple pending files with overlapping records

- **WHEN** `pending/` contains two JSON files with overlapping records (same canonicalKey, different `updatedAt`)
- **THEN** only the record with the most recent `updatedAt` is kept
- **AND** stdout reports correct merged and pending counts

#### Scenario: Merge write fails

- **WHEN** writing merged records to `memories.jsonl` fails
- **THEN** the command exits with a fatal error and non-zero exit code
- **AND** the lock is released before exit

#### Scenario: No pending directory

- **WHEN** `pending/` does not exist
- **THEN** the merge step is skipped
- **AND** stdout reports `"pending": 0, "merged": 0`

### Requirement: Index Update or Rebuild Based on HEAD Change

The system SHALL compare the current Git HEAD with the stored index HEAD to decide between incremental update and full rebuild.

#### Scenario: HEAD matches — incremental update

- **WHEN** the current Git HEAD matches the `repo_commit` stored during the last index build
- **THEN** `updateCommand()` is called for incremental update
- **AND** only new or changed JSONL records since the last build are reindexed

#### Scenario: HEAD differs — full rebuild

- **WHEN** the current Git HEAD differs from the stored `repo_commit`
- **THEN** `rebuildCommand()` is called for a full index rebuild
- **AND** all JSONL records are reindexed from scratch

#### Scenario: Index update fails

- **WHEN** incremental index update encounters an error
- **THEN** a warning is written to stderr
- **AND** the prepare sequence continues (index is stale but operational)

### Requirement: Structured JSON Output

The system SHALL write a single JSON object to stdout summarizing the prepare result, with all diagnostic messages going to stderr.

#### Scenario: JSON output structure

- **WHEN** prepare completes successfully
- **THEN** stdout contains exactly one JSON object with keys:
  - `git`: `{ skipped: boolean, pulled: number, conflicts: number }`
  - `merge`: `{ pending: number, merged: number, total: number }`
  - `index`: `{ rebuilt: boolean, records: number }`

#### Scenario: Fatal error output

- **WHEN** prepare encounters a fatal error (lock timeout, rebase conflict, merge write failure)
- **THEN** an error message is written to stderr
- **AND** exit code is non-zero
- **AND** stdout may contain a partial JSON object or be empty

### Requirement: Command Registration via cli.js

The system SHALL register `prepare` as a top-level command in `src/cli.js` following the existing command routing pattern.

#### Scenario: prepare command routing

- **WHEN** the user runs `mem-sync prepare`
- **THEN** `cli.js` routes to `prepareCommand(args)` from `src/commands/prepare.js`
- **AND** the existing command routing structure (`switch` on command name) is preserved

#### Scenario: Help text includes prepare

- **WHEN** the user runs `mem-sync` with no command or `mem-sync --help`
- **THEN** the help output includes `mem-sync prepare`
