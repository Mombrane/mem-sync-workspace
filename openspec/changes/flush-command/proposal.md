# Proposal: Implement `flush` Command

## Why

The mem-sync lifecycle has three phases: `prepare` (sync + merge at session start), `retain` (extract memories during session), and `flush` (commit + push at session end). Currently, `prepare` handles sync and merge but does NOT commit or push changes to the remote repository. This means accumulated memories stay as local uncommitted changes, risking data loss and preventing multi-device sync.

The `flush` command completes the write path: merge pending records → commit → push → update index. It is the "save point" of the mem-sync lifecycle.

## What

Implement `memcli flush` that:
1. Merges pending records into the main store (reuse `mergePendingToStore`)
2. Syncs remote changes (git pull --rebase, same as prepare)
3. Commits merged changes with a descriptive message
4. Pushes to remote (non-blocking on failure)
5. Updates the local SQLite index

## Scope

- New file: `src/commands/flush.js`
- Modified: `src/git.js` (add `stageFile`, `commit`, `push`)
- Modified: `src/cli.js` (add flush routing)
- New test: `tests/cli-flush.test.js`
- Update: `docs/memcli-design.md` (mark step 8 as done)
- Update: `/tmp/mem-sync-cron-task.md` (mark step 8 complete)
