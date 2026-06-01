# Requirements: `flush` Command

## R1: Merge pending records
- `flush` reads all pending files from `pending/` directory
- Merges them into `memories.jsonl` using `mergePendingToStore`
- Deduplication by canonicalKey (latest updatedAt wins)
- Deletes merged pending files after successful merge

## R2: Git sync before commit
- If remote configured: fetch + pull --rebase
- Stash protection for uncommitted changes
- Rebase conflicts are fatal (same as prepare)

## R3: Commit merged changes
- Only commit if `mergeResult.merged > 0`
- Stage `memories.jsonl` only
- Commit message: `mem-sync: merge {N} pending records (total: {T})`
- Skip commit if no records were merged

## R4: Push to remote
- Only push if remote is configured (`hasRemote`)
- Push failure is non-blocking (warning logged, process continues)
- Push to `origin main`

## R5: Update local index
- After commit, update/rebuild SQLite index
- If HEAD changed since last index: full rebuild
- Otherwise: incremental update
- Index failure is non-blocking

## R6: Locking
- Acquire `repo.lock` before any operations
- Release in `finally` block (guaranteed)
- Lock timeout: 10s (same as prepare)

## R7: JSON output
- Output result as JSON to stdout
- Diagnostic logs to stderr
- Fields: git, merge, commit, push, index

## R8: Idempotency
- Running flush twice with no new pending records: skips commit, skips push, only runs index check
