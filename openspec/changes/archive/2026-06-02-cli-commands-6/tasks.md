# Tasks: Implement 6 CLI Commands

## Task 1: Shared test helpers (tests/helpers.js)
- Extract makeRecord, initGitRepo, commitFile, setupMemSyncEnv, cleanupEnv
- Based on patterns from cli-prepare.test.js
- Files: tests/helpers.js

## Task 2: init command
- Create src/commands/init.js with initCommand + parseInitArgs
- Create directory skeleton, meta files, initial commit
- Wire in cli.js
- Create tests/cli-init.test.js
- Files: src/commands/init.js, src/cli.js, tests/cli-init.test.js

## Task 3: sync command
- Create src/commands/sync.js
- Reuse git.js functions (fetch, pullRebase, stashSave, stashPop)
- Reuse index-store.js updateIndex
- Wire in cli.js
- Create tests/cli-sync.test.js
- Files: src/commands/sync.js, src/cli.js, tests/cli-sync.test.js

## Task 4: status command
- Create src/commands/status.js
- Read HEAD, remote, pending count, index status
- Wire in cli.js
- Create tests/cli-status.test.js
- Files: src/commands/status.js, src/cli.js, tests/cli-status.test.js

## Task 5: log command
- Create src/commands/log.js
- Parse git log output
- Wire in cli.js
- Create tests/cli-log.test.js
- Files: src/commands/log.js, src/cli.js, tests/cli-log.test.js

## Task 6: show command
- Create src/commands/show.js
- Search JSONL files by ID using readJSONLStream
- Wire in cli.js
- Create tests/cli-show.test.js
- Files: src/commands/show.js, src/cli.js, tests/cli-show.test.js

## Task 7: forget command
- Create src/commands/forget.js
- Soft delete in store, remove from pending
- Wire in cli.js
- Create tests/cli-forget.test.js
- Files: src/commands/forget.js, src/cli.js, tests/cli-forget.test.js

## Task 8: Update help text and final integration
- Update printHelp() in cli.js with all new commands
- Run full test suite
- Files: src/cli.js
