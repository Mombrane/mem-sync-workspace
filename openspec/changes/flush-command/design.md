# Design: `flush` Command

## Architecture

```
Session end
    ↓
memcli flush
    ↓
1. Acquire lock (repo.lock)
    ↓
2. Git sync: fetch + pull --rebase (stash protection)
    ↓
3. mergePendingToStore (pending/ → memories.jsonl)
    ↓
4. If merged > 0:
   a. git add memories.jsonl
   b. git commit -m "mem-sync: merge N pending records (total: T)"
   c. If hasRemote: git push origin main (non-blocking)
    ↓
5. Update local index (rebuild or incremental)
    ↓
6. Release lock
    ↓
JSON result → stdout
```

## Module Design

### `src/commands/flush.js` — CLI Command

```js
export async function flushCommand(args)
```

**Flow:** Mirrors prepare.js structure with added commit/push steps.

1. Parse `--remote` arg (optional)
2. Resolve paths: `memSyncHome`, `lockPath`, `pendingDir`, `storePath`, `cacheDir`
3. Ensure repo exists (`ensureClone`)
4. Acquire lock (`acquireLock`)
5. Git sync (same as prepare): fetch → stash → pull/rebase → pop
6. Merge pending → store (`mergePendingToStore`)
7. If `mergeResult.merged > 0`:
   - `stageFile(memSyncHome, 'memories.jsonl')`
   - `commit(memSyncHome, message)` → returns commit hash
   - If `hasRemote(memSyncHome)`: `push(memSyncHome)` → non-blocking
8. Update index (same logic as prepare: HEAD changed → rebuild, else incremental)
9. Output JSON to stdout
10. Release lock in `finally`

**JSON Output Format:**
```json
{
  "git": { "skipped": false, "pulled": 0, "conflicts": 0 },
  "merge": { "pending": 5, "merged": 3, "total": 42 },
  "commit": { "made": true, "hash": "abc1234" },
  "push": { "attempted": true, "success": true },
  "index": { "rebuilt": false, "records": 42 }
}
```

### `src/git.js` — New Helper Functions

```js
export function stageFile(cwd, filePath)
// execGit(`add ${filePath}`, cwd)

export function commit(cwd, message)
// execGit(`commit -m "${message}"`, cwd)
// Returns commit short hash via `git rev-parse --short HEAD`

export function push(cwd)
// execGit('push origin main', cwd)
// Returns true on success, false on failure (non-blocking)
```

### Commit Message Format

```
mem-sync: merge {merged} pending records (total: {total})
```

Example: `mem-sync: merge 3 pending records (total: 42)`

## File Dependencies

| File | Action | Purpose |
|------|--------|---------|
| `src/commands/flush.js` | CREATE | CLI command implementation |
| `src/git.js` | MODIFY | Add stageFile, commit, push helpers |
| `src/cli.js` | MODIFY | Register flush command + help text |
| `tests/cli-flush.test.js` | CREATE | Integration tests |

## Integration Points

- **merge.js**: `mergePendingToStore` — core merge logic
- **git.js**: `hasRemote`, `fetch`, `pullRebase`, `stashSave`, `stashPop`, `getHead` + new helpers
- **index-store.js**: `rebuildIndex`, `updateIndex`, `getIndexStatus`
- **lock.js**: `acquireLock`, `releaseLock`, `LockTimeoutError`
- **repo-store.js**: `resolveStorePath`

## Design Decisions

1. **Skip commit when merged=0**: No changes to commit. Only run index update.
2. **Push failure is non-blocking**: Log warning but don't fail. Local commit is preserved.
3. **Index update AFTER commit**: So `repo_head` matches the new HEAD, avoiding wasteful rebuilds on next run.
4. **Same lock as prepare**: `repo.lock` prevents concurrent prepare+flush.
5. **Only stage memories.jsonl**: Pending files are already deleted by merge. `.cache/` is not staged.

## Non-Goals (v1)

- Compact old working memories (step 10)
- Summarize profile/project/global (step 10)
- Redaction (step 9)
- Custom commit messages
- `--require-push` flag
- Dry-run mode
