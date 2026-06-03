# Proposal: CLI Compatibility & README Consistency Fix

## Problem

1. README Quick Start uses `node ./src/cli.js add ...` but `src/cli.js` has no `add` route — it prints help and exits.
2. README roadmap says "prototype still stores memories in `.mem-sync/memories.json`" — this is outdated; JSONL is already the source of truth.
3. `compact`, `summarize`, `review`, `skills` commands default to `~/.memcli/default` while other commands use `.mem-sync` / `MEM_SYNC_HOME` convention.
4. Help text is consistent with actual commands, but `add` alias is missing.

## Solution

1. Add `add` as an alias for `remember` in `src/cli.js` routing.
2. Update README: fix Quick Start, remove outdated roadmap paragraph.
3. Fix default repo paths in `compact.js`, `summarize.js`, `review.js`, `skills.js`.
4. Add `tests/cli-alias.test.js` to verify `add` works like `remember`.

## Scope

- `src/cli.js` — add `add` route
- `README.md` — fix Quick Start + roadmap
- `src/commands/compact.js` — fix DEFAULT_REPO
- `src/commands/summarize.js` — fix DEFAULT_REPO
- `src/commands/review.js` — fix DEFAULT_REPO
- `src/commands/skills.js` — fix DEFAULT_REPO
- `tests/cli-alias.test.js` — new test file
