## Context

`mem-sync` has a working JSONL storage layer (`src/repo-store.js`), a schema v1 validation pipeline (`src/schema.js`), a local SQLite/FTS5 index (`src/index-store.js`), and a CLI surface (`src/cli.js`) with `remember`, `recall`, `list`, `export`, and `index` commands. But each session starts with an unknown repository state — is the clone present? Is it up to date? Are there unmerged pending changes? Is the index stale?

The `prepare` command provides a single `mem-sync prepare` invocation that agents can run before any other command, guaranteeing a consistent, synchronized starting state.

The `.mem-sync` directory itself is a Git repository. `prepare` operates entirely within this directory, located via the `MEM_SYNC_HOME` environment variable (consistent with `src/repo-store.js:19`).

## Goals / Non-Goals

**Goals:**

- Implement `mem-sync prepare` as a 6-step initialization sequence: clone check → repo lock → git fetch/pull/rebase → deterministic merge → index update/rebuild → unlock.
- Implement atomic file locking with PID-based stale detection and configurable timeout.
- Implement Git operation wrappers with proper error handling (fetch failures are warnings; rebase conflicts are fatal).
- Implement deterministic merge of pending changes by canonicalKey with latest `updatedAt` wins.
- Integrate with existing index commands (`rebuild`, `update`) to handle HEAD-change detection.
- Output structured JSON to stdout for programmatic consumption; all diagnostics to stderr.
- Follow the existing pattern of extracting command logic into `src/commands/` modules.

**Non-Goals:**

- Do not implement auto-commit or auto-push after merge. The `prepare` command only synchronizes inbound; outbound changes require a separate `flush` or `push` command (to be implemented later).
- Do not modify the JSONL storage format or schema v1.
- Do not change the existing `remember`, `recall`, or `index` command behavior.
- Do not implement interactive conflict resolution — rebase conflicts are fatal.
- Do not support custom Git remotes beyond the default origin configured in the `.mem-sync` repo.

## Decisions

### 1. `.mem-sync` IS the Git Repository

The `.mem-sync` directory itself is a Git repository. `prepare` runs `git` commands with `cwd: memSyncHome` (resolved from `MEM_SYNC_HOME` or defaulting to `.mem-sync`). There is no separate clone/cache layering — the working directory and the repository are the same directory.

Rationale:

- Matches the existing codebase: `src/index-store.js:23-29` already runs `git rev-parse HEAD` with `cwd: repoDir` where `repoDir` is JSONL's parent directory (i.e., `.mem-sync`).
- Simplifies the mental model: one directory, one repository, one source of truth.
- No clone-to-temp or worktree complexity — `prepare` is a session-initialization command, not a concurrent-operation manager.
- Consistent with how `src/repo-store.js:19` uses `MEM_SYNC_HOME` to locate the store path.

### 2. Atomic File Lock with PID Expiration

The lock mechanism (`src/lock.js`) uses `fs.openSync(path, fs.constants.O_EXCL | fs.constants.O_CREAT)` to atomically create a lock file. The lock file contains the acquiring process's PID. Stale lock detection uses `process.kill(pid, 0)` — if this syscall fails with `ESRCH`, the original process is dead and the lock can be taken.

```js
// src/lock.js API sketch
export async function acquireLock(lockPath, { timeout = 10000, pollInterval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, 'wx'); // O_EXCL|O_CREAT
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (isStaleLock(lockPath)) {
        fs.unlinkSync(lockPath);
        continue; // retry immediately
      }
      await sleep(pollInterval);
    }
  }
  throw new LockTimeoutError(`Could not acquire lock within ${timeout}ms`);
}

export function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already released */ }
}
```

Rationale:

- `O_EXCL|O_CREAT` is atomic on all POSIX filesystems and NTFS — no race condition between checking and creating.
- PID-based staleness avoids the common "stuck lock after crash" problem without requiring a heartbeat thread.
- 10-second timeout is generous enough for normal lock-hold times (seconds) but short enough that users aren't blocked long.
- No dependency on external lock libraries — minimal implementation, easy to audit.

### 3. Git Operations Wrapper (src/git.js)

Git operations are wrapped in `src/git.js` to provide consistent error handling and output parsing:

```js
// src/git.js API sketch
export async function ensureClone(remoteUrl, cwd) { ... }
export async function fetch(cwd) { ... }
export async function pullRebase(cwd) { ... }
export async function stashSave(cwd) { ... }
export async function stashPop(cwd) { ... }
export async function rebaseAbort(cwd) { ... }
export async function getHead(cwd) { ... }
```

Rationale:

- All git operations are synchronous from Node's perspective (using `execSync`), consistent with `src/index-store.js:25-29` which already uses `execSync` for `git rev-parse`.
- Stash protection ensures local pending changes survive a fetch/pull/rebase cycle.
- Error handling is explicit: fetch failures are caught and logged as warnings; rebase conflicts abort and throw fatal.
- No remote scenario is detected by checking `git remote get-url origin` — if it fails, git operations are skipped.

### 4. Deterministic Merge by canonicalKey

The merge module (`src/merge.js`) implements a deterministic merge of pending change files:

```js
// src/merge.js API sketch
export function buildCanonicalKey(memory) {
  // canonicalKey = `${scope}:${kind}:${content_hash}`
  // content_hash = sha256(normalized_content).slice(0, 12)
  const contentHash = createHash('sha256')
    .update(normalizeContent(memory.content))
    .digest('hex').slice(0, 12);
  return `${memory.scope}:${memory.kind}:${contentHash}`;
}

export function mergeByCanonicalKey(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = buildCanonicalKey(record);
    const existing = byKey.get(key);
    if (!existing || new Date(record.updatedAt) > new Date(existing.updatedAt)) {
      byKey.set(key, record);
    }
  }
  return [...byKey.values()];
}
```

Rationale:

- canonicalKey is derived from `scope`, `kind`, and a content hash — two records about the same thing in the same scope and kind are treated as the same memory.
- Latest `updatedAt` wins, consistent with `mergeMemorySets()` in `src/memory-store.js:59-76`.
- Deterministic: given the same input set, always produces the same output — important for testability and debugging.
- Content hash uses normalized content (whitespace-collapsed), matching `normalizeContent()` from `schema.js`.

### 5. HEAD Change Detection for Index Strategy

After git operations and merge, `prepare` compares the current Git HEAD with the `repo_commit` stored in the index database:

```js
const currentHead = getGitHead(memSyncHome);
const indexStatus = getIndexStatus(cacheDir);
if (currentHead !== indexStatus.repoCommit || !indexStatus.exists) {
  rebuildCommand();        // full rebuild
} else {
  updateCommand();          // incremental update
}
```

Rationale:

- `src/index-store.js` already stores `repo_commit` in the index metadata table during rebuild and update.
- `getIndexStatus()` already exists in `src/index-store.js` and is used by `recall` for no-index detection.
- Full rebuild is the safe default when HEAD changes; incremental update is the optimization when only local appends have occurred.
- This logic is consistent with the existing `index update` command which also relies on `repo_commit` comparison.

### 6. Error Handling Strategy

| Condition | Severity | Action |
|---|---|---|
| Lock timeout (10s) | Fatal | Error to stderr, non-zero exit, no stdout JSON |
| No remote configured | Info | Skip git, continue to merge/index |
| Clone fails | Fatal | Error to stderr, non-zero exit |
| Fetch fails | Warning | Log to stderr, continue with local state |
| Rebase conflict | Fatal | Abort rebase, error to stderr, non-zero exit |
| Merge write failure | Fatal | Error to stderr, non-zero exit |
| Index update failure | Warning | Log to stderr, continue (index stale but operational) |
| Index rebuild failure | Warning | Log to stderr, continue (index may not exist) |

Rationale:

- Fatal errors stop the sequence — there's no point continuing if the repository is in an inconsistent state.
- Warnings allow the sequence to continue — a stale index is better than a blocked agent startup.
- The lock is always released before exit, whether success or failure, via try/finally in the command module.

### 7. Output Format

The command writes a single JSON object to stdout:

```json
{
  "git": { "skipped": false, "pulled": 3, "conflicts": 0 },
  "merge": { "pending": 2, "merged": 5, "total": 42 },
  "index": { "rebuilt": false, "records": 42 }
}
```

All progress, warning, and error messages go to stderr. This keeps stdout machine-parseable for agent integration (e.g., `result=$(mem-sync prepare)` in a shell script).

Rationale:

- JSON output is consistent with `recall --format json` and `index status --format json`.
- The structure is intentionally flat and simple — one level of nesting, numeric values, no nested objects.
- `total` in `merge` represents the total record count in JSONL after merge (useful for downstream monitoring).
- `records` in `index` represents the total indexed record count (may differ from `merge.total` if index is stale).

## Risks / Trade-offs

- [Risk] The atomic lock file approach has a small race window between `process.kill(pid, 0)` and `fs.unlinkSync(lockPath)` — another process could also detect the same stale lock and remove it simultaneously. → Mitigation: The subsequent `fs.openSync(..., 'wx')` is atomic; only one process will succeed, the other will retry.
- [Risk] `execSync` for git operations blocks the event loop. → Mitigation: `mem-sync` is a CLI tool that exits after execution — there's no concurrent request handling, so blocking is acceptable. The existing codebase already uses `execSync` for git commands.
- [Risk] Rebase conflicts are fatal — the user must manually resolve. → Mitigation: This is by design. Automatic conflict resolution for binary-format files is unpredictable. A future `flush` or `push` command will handle outbound changes, reducing the likelihood of inbound rebase conflicts.
- [Risk] The `.mem-sync` directory being the repository itself means `git clean` or accidental directory deletion loses pending changes. → Mitigation: The pending changes directory (`pending/`) is inside `.mem-sync`, so it is versioned and protected by Git. A `git reset --hard` could lose uncommitted pending files, but that requires an explicit destructive action — not something `prepare` does.

## Migration Plan

1. Implement `src/lock.js` with test coverage.
2. Implement `src/git.js` with test coverage (using a temporary Git repo).
3. Implement `src/merge.js` with test coverage.
4. Implement `src/commands/prepare.js` orchestrating the 6-step sequence.
5. Update `src/cli.js` to register the `prepare` route.
6. Write `tests/cli-prepare.test.js`, `tests/lock.test.js`, `tests/git.test.js`, `tests/merge.test.js`.
7. Update CLI help output to include `mem-sync prepare`.
8. Run `npm test` and confirm all tests pass.

Rollback strategy: Remove the `prepare` case from `cli.js`, delete `src/lock.js`, `src/git.js`, `src/merge.js`, `src/commands/prepare.js`, and associated tests. No existing functionality is affected — `prepare` is a new command that composes existing operations.

## Open Questions

- Should `prepare` accept a `--timeout` flag for lock acquisition? → Resolved: For MVP, use a fixed 10-second timeout. A configurable timeout can be added later if needed.
- Should `prepare` always rebuild the index after merge, or only when HEAD changes? → Resolved: Follow the HEAD-change detection pattern — if HEAD changed, full rebuild; otherwise incremental update. This avoids unnecessary full rebuilds.
- Should we support `--skip-git` or `--skip-index` flags? → Resolved: Not for MVP. The full sequence is the expected default. Flags can be added later if use cases emerge.
