## 1. Implement Lock Module (src/lock.js)

- [ ] 1.1 Create `src/lock.js` with `acquireLock(lockPath, options)` function using `fs.openSync` with `O_EXCL|O_CREAT` for atomic lock creation.
- [ ] 1.2 Implement PID-based stale lock detection: read PID from existing lock file, check with `process.kill(pid, 0)`, remove stale lock if process is dead.
- [ ] 1.3 Implement retry loop with configurable timeout (default 10000ms) and poll interval (default 100ms).
- [ ] 1.4 Implement `releaseLock(lockPath)` to remove the lock file, with error suppression for already-removed files.
- [ ] 1.5 Export `LockTimeoutError` class for distinguishing timeout from other errors.
- [ ] 1.6 Create `tests/lock.test.js` covering: successful acquire, lock held by another process, stale lock detection, timeout exceeded, release after success, release after error.

## 2. Implement Git Operations Module (src/git.js)

- [ ] 2.1 Create `src/git.js` with `execGit(command, cwd)` internal helper that wraps `execSync` with consistent encoding and error handling.
- [ ] 2.2 Implement `hasRemote(cwd)` — checks `git remote get-url origin`; returns false if no remote.
- [ ] 2.3 Implement `getHead(cwd)` — returns current HEAD commit hash, or 'unknown' if not a Git repo.
- [ ] 2.4 Implement `fetch(cwd)` — runs `git fetch origin`, catches network errors as non-fatal, returns pull count.
- [ ] 2.5 Implement `pullRebase(cwd)` — runs `git pull --rebase origin main`, counts pulled commits via `rev-list`.
- [ ] 2.6 Implement stash-protected rebase: `stashSave(cwd)` before rebase, `stashPop(cwd)` after, `rebaseAbort(cwd)` on conflict.
- [ ] 2.7 Implement `ensureClone(remoteUrl, cwd)` — clones repo if directory doesn't exist or has no `.git`.
- [ ] 2.8 Create `tests/git.test.js` using temporary Git repos for: hasRemote positive, hasRemote negative, getHead, fetch with remote, fetch no-remote, pullRebase with new commits, pullRebase no changes, stash save/pop cycle, rebase conflict detection.

## 3. Implement Deterministic Merge Module (src/merge.js)

- [ ] 3.1 Create `src/merge.js` with `buildCanonicalKey(memory)` — produces `scope:kind:contentHash` key using `normalizeContent()` from `schema.js`.
- [ ] 3.2 Implement `mergeByCanonicalKey(records)` — deduplicates by canonicalKey, keeps latest `updatedAt`.
- [ ] 3.3 Implement `readPendingFiles(pendingDir)` — reads all JSON files in `pending/` directory and returns flat array of memory records.
- [ ] 3.4 Implement `mergePendingToStore(pendingDir, storePath)` — merges pending files into JSONL, removes merged pending files, returns `{ pending, merged, total }` stats.
- [ ] 3.5 Handle empty/missing `pending/` directory gracefully — return `{ pending: 0, merged: 0, total: existingTotal }`.
- [ ] 3.6 Handle write failure to JSONL — throw fatal error with descriptive message.
- [ ] 3.7 Create `tests/merge.test.js` covering: single file merge, multi-file merge with overlaps, canonicalKey collision with latest updatedAt wins, empty pending dir, missing pending dir, write failure simulation.

## 4. Implement Prepare Command Module (src/commands/prepare.js)

- [ ] 4.1 Create `src/commands/prepare.js` with `prepareCommand(args)` as the entry point.
- [ ] 4.2 Step 1: Ensure `.mem-sync` directory exists and is a Git repository (call `ensureClone` if missing).
- [ ] 4.3 Step 2: Acquire repository lock via `acquireLock()` before any mutation; wrap in try/finally for guaranteed release.
- [ ] 4.4 Step 3: Git sync — check remote, fetch, pull/rebase with stash protection. Track `{ skipped, pulled, conflicts }`.
- [ ] 4.5 Step 4: Deterministic merge — call `mergePendingToStore()` for `pending/` directory. Track `{ pending, merged, total }`.
- [ ] 4.6 Step 5: Index update — compare HEAD with stored `repo_commit`, call `rebuildCommand()` or `updateCommand()`. Track `{ rebuilt, records }`.
- [ ] 4.7 Step 6: Release lock in finally block (guaranteed even on fatal errors).
- [ ] 4.8 Write JSON result to stdout; all diagnostic/progress/warning messages to stderr.
- [ ] 4.9 Implement error handling per design matrix: lock timeout (fatal), no remote (skip git), fetch fail (warning), rebase conflict (fatal), merge write fail (fatal), index fail (warning).
- [ ] 4.10 Create `tests/cli-prepare.test.js` covering: fresh clone scenario, up-to-date scenario, remote changes scenario, pending merge scenario, HEAD-changed rebuild scenario, HEAD-unchanged update scenario, no-remote scenario, lock timeout scenario, rebase conflict scenario, index failure non-fatal scenario.

## 5. Update cli.js Routing

- [ ] 5.1 Import `prepareCommand` from `src/commands/prepare.js`.
- [ ] 5.2 Add `case 'prepare': await prepareCommand(args); break;` to the existing switch/if-else routing.
- [ ] 5.3 Update `printHelp()` to include `mem-sync prepare` in the usage section.

## 6. Integration and Documentation

- [ ] 6.1 Run `npm test` and confirm all tests pass (existing + new).
- [ ] 6.2 Verify no regressions in existing `cli-remember.test.js`, `cli-recall.test.js`, `cli-index.test.js`, `index-store.test.js`, `memory-store.test.js`, `schema.test.js`.
- [ ] 6.3 Update `README.md` with `mem-sync prepare` usage and description.
- [ ] 6.4 Review implementation against all decisions in `design.md`: lock mechanism, Git operations contract, merge determinism, HEAD-change detection, error handling matrix, JSON output structure.
