# Technical Design: 6 CLI Commands

## Architecture
Each command follows the existing pattern: `src/commands/xxx.js` exports `xxxCommand(args)` + `parseXxxArgs(args)`. Wired in `src/cli.js`. Tests in `tests/cli-xxx.test.js`.

## Command Designs

### 1. init
- Accepts: `--repo <url>` (optional)
- Steps: `ensureClone(url, cwd)` → create dirs → write meta files → initial commit
- Output: JSON with repo path and whether remote was cloned

### 2. sync
- Accepts: `--repo <path>` (optional)
- Steps: ensure repo → lock → fetch → pull rebase → index update → unlock
- No merge of pending (that's prepare's job)
- Output: JSON with pulled count and index status

### 3. status
- Accepts: `--format json` (default), `--repo <path>`
- Reads: HEAD, remote config, pending count, index status, rebase state
- No network I/O (remote reachability is doctor's concern)
- Output: JSON state snapshot

### 4. log
- Accepts: `--limit <n>` (default 10), `--repo <path>`
- Reads: `git log --oneline -n <limit>` from mem-sync home
- Output: JSON array of { hash, message, date }

### 5. show
- Accepts: `<id>`, `--repo <path>`
- Searches: memories/*.jsonl, pending/*.jsonl for matching id
- Output: JSON record or error if not found

### 6. forget
- Accepts: `<id>`, `--reason <text>` (optional), `--repo <path>`
- Store records: set `deletedAt` + write back via `writeJSONL`
- Pending records: remove file entirely
- No auto-commit (flush handles that)
- Output: JSON with action taken (soft-deleted or removed from pending)
