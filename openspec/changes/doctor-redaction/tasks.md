# Tasks: doctor + redaction

## Task 1: redaction-engine.js (pure module)
**Files:** `src/redaction-engine.js`, `tests/redaction-engine.test.js`
**Dependencies:** none

### Subtasks:
1.1. Create `src/redaction-engine.js` with:
  - `DEFAULT_PATTERNS` array (7 built-in patterns)
  - `loadRedactionRules(repoPath)` — loads `meta/redaction-rules.json` if exists, merges with defaults
  - `redactContent(content, rules)` — scans text against all rules, returns `{ blocked, severity, matches }`
  - `redactMemory(memory, rules)` — convenience wrapper that scans `memory.content`

1.2. Create `tests/redaction-engine.test.js` with:
  - Test each default pattern against known secrets (AWS key, JWT, private key, etc.)
  - Test clean content returns `{ blocked: false }`
  - Test empty/null content handling
  - Test custom rules loading from JSON
  - Test malformed rules JSON throws
  - Test severity tiers (block vs warn)

## Task 2: redact --check command
**Files:** `src/commands/redact.js`, `tests/cli-redact.test.js`
**Dependencies:** Task 1

### Subtasks:
2.1. Create `src/commands/redact.js` with:
  - `redactCommand(args)` — parses `--check` flag
  - Reads `memories.jsonl` line by line
  - Runs `redactContent` on each record's content
  - Outputs JSON result to stdout

2.2. Create `tests/cli-redact.test.js` with:
  - Test scanning clean memories (no findings)
  - Test scanning memories with embedded secrets
  - Test empty JSONL file
  - Test missing JSONL file
  - Test JSON output structure

## Task 3: doctor command
**Files:** `src/commands/doctor.js`, `tests/cli-doctor.test.js`
**Dependencies:** none (can parallel with Task 1-2)

### Subtasks:
3.1. Create `src/commands/doctor.js` with:
  - `doctorCommand(args)` — aggregates 7 check functions
  - `checkJsonlIntegrity(memSyncHome)` — line-by-line JSONL scan with error collection
  - `checkRecords(memSyncHome)` — count active/deleted/expired
  - `checkIndex(cacheDir, memSyncHome)` — index existence and staleness
  - `checkLock(lockPath)` — lock file existence and staleness
  - `checkRepo(memSyncHome)` — git init status, HEAD, rebase
  - `checkPending(pendingDir)` — pending file and record counts
  - `checkRemote(memSyncHome)` — remote configuration and reachability

3.2. Create `tests/cli-doctor.test.js` with:
  - Test healthy state (all checks pass)
  - Test missing .mem-sync directory
  - Test empty JSONL
  - Test malformed JSONL lines
  - Test stale lock file
  - Test stale index
  - Test JSON output structure

## Task 4: CLI registration + help update
**Files:** `src/cli.js`
**Dependencies:** Tasks 2, 3

### Subtasks:
4.1. Add imports for `doctorCommand` and `redactCommand`
4.2. Add `doctor` and `redact` command dispatch
4.3. Update `printHelp()` with new commands

## Task 5: Write-path integration
**Files:** `src/memory-store.js`, `src/commands/remember.js`, `src/commands/retain.js`
**Dependencies:** Task 1

### Subtasks:
5.1. In `memory-store.js`: add redaction check in `add()` before `normalizeText()`
5.2. In `commands/remember.js`: add `--skip-redaction` flag parsing
5.3. In `commands/retain.js`: add per-candidate redaction in the candidate loop
5.4. In `commands/retain.js`: add `--skip-redaction` flag parsing

## Task 6: Integration tests for redaction in write paths
**Files:** extend `tests/cli-remember.test.js`, `tests/cli-retain.test.js`
**Dependencies:** Task 5

### Subtasks:
6.1. Test `remember` with secret content → exit code 1, nothing written
6.2. Test `remember --skip-redaction` with secret content → succeeds
6.3. Test `retain` with mixed candidates → blocked ones skipped, clean ones written
