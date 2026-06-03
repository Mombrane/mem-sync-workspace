# Tasks: CLI Compatibility & README Consistency Fix

## Task 1: Add `add` alias in src/cli.js
**Files:** `src/cli.js`
- Add `else if (command === 'add')` routing to `rememberCommand`
- Add `add` to the help text usage section

## Task 2: Fix README.md
**Files:** `README.md`
- Change Quick Start `add` to `remember`
- Replace outdated roadmap paragraph with accurate JSONL description

## Task 3: Fix DEFAULT_REPO in command files
**Files:** `src/commands/compact.js`, `src/commands/summarize.js`, `src/commands/review.js`, `src/commands/skills.js`
- Change `path.join(HOME, '.memcli', 'default')` to `path.join(process.cwd(), process.env.MEM_SYNC_HOME ?? '.mem-sync')`

## Task 4: Add tests/cli-alias.test.js
**Files:** `tests/cli-alias.test.js` (new)
- Test that `add` command routes to `remember`
- Test that output matches `remember` command output
- Test flags are passed through correctly

## Task 5: Run full test suite
**Files:** none
- Run `npm test` to verify no regressions
