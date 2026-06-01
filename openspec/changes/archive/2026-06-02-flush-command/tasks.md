# Tasks: `flush` Command

## Task 1: Add git helper functions to `src/git.js`

**Files:** MODIFY `src/git.js`

- [ ] Add `stageFile(cwd, filePath)` — calls `execGit('add ${filePath}', cwd)`
- [ ] Add `commit(cwd, message)` — calls `execGit('commit -m "${message}"', cwd)`, returns short hash via `rev-parse --short HEAD`
- [ ] Add `push(cwd)` — calls `execGit('push origin main', cwd)`, returns true/false (non-blocking)
- [ ] Export all three functions

## Task 2: Create `src/commands/flush.js`

**Files:** CREATE `src/commands/flush.js`

- [ ] Import dependencies: mergePendingToStore, git helpers, index-store, lock, repo-store
- [ ] Implement `flushCommand(args)`:
  1. Parse `--remote` arg
  2. Resolve paths (memSyncHome, lockPath, pendingDir, storePath, cacheDir)
  3. Ensure repo exists via `ensureClone`
  4. Acquire lock via `acquireLock`
  5. Git sync: if hasRemote → fetch → stashSave → pullRebase → stashPop
  6. Merge: `mergePendingToStore(pendingDir, storePath)`
  7. If merged > 0: stageFile → commit → push (if remote)
  8. Update index: check HEAD → rebuild or incremental
  9. Build and output JSON result to stdout
  10. Release lock in finally block
- [ ] Handle errors: LockTimeoutError, RebaseConflictError, push failures
- [ ] Diagnostic logging to stderr (same pattern as prepare)

## Task 3: Wire into `src/cli.js`

**Files:** MODIFY `src/cli.js`

- [ ] Import `flushCommand` from `./commands/flush.js`
- [ ] Add `flush` branch to command router
- [ ] Add `flush` to help text

## Task 4: Create `tests/cli-flush.test.js`

**Files:** CREATE `tests/cli-flush.test.js`

- [ ] Test: merges pending records and commits (no remote)
- [ ] Test: skips commit when no pending records (idempotent)
- [ ] Test: pushes to remote when configured
- [ ] Test: push failure is non-blocking
- [ ] Test: lock timeout handled gracefully
- [ ] Test: rebase conflict is fatal
- [ ] Test: JSON output has correct structure
- [ ] Test: pending files deleted after merge
- [ ] Test: index updated after commit
- [ ] Run: `node --test tests/cli-flush.test.js`

## Task 5: Run full test suite

- [ ] Run `npm test` — all tests pass (existing + new)
- [ ] Verify no regressions
