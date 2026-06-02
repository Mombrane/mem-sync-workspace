# Mem Sync Completion And Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the June 1 `mem-sync` implementation plan into an accurate June 2 completion state by closing remaining CLI gaps, aligning documentation, and hardening Git sync behavior without expanding into deferred product features.

**Architecture:** Keep the existing JSONL-first CLI architecture and implement small vertical slices. Each task starts with focused tests, then patches the minimum source files needed, then runs the relevant test file and `npm test`. Avoid broad rewrites: preserve existing command modules, `node:test`, and the current OpenSpec archive history.

**Tech Stack:** Node.js 20+, ECMAScript modules, `node:test`, `node:fs/promises`, `node:child_process` using argument arrays for new Git process calls, `better-sqlite3` for FTS index support.

---

## Current State Snapshot

As of 2026-06-02, the repository has no active OpenSpec change under `openspec/changes` and the full test suite passes with 312 tests. The CLI currently exposes:

```text
remember, recall, retain, context, flush, redact, compact, summarize,
review pending, doctor, list, export, index rebuild/status/update
```

The June 1 plan is partially complete but not accurately checked off. Implemented areas include Schema v1, JSONL storage, redaction, SQLite FTS indexing, recall, context, prepare, retain, flush, summarize, doctor, and review. Remaining gaps from the June 1 plan are:

- No `add` alias for `remember`.
- No legacy import command for `.mem-sync/memories.json`.
- No `show` or `forget` command for explicit memory inspection and soft deletion.
- No standalone `init`, `sync`, or `status` command; existing lifecycle behavior is covered partly by `prepare`, `flush`, and `doctor`.
- README still documents `add` and an outdated JSON roadmap.
- `compact`, `summarize`, and `review` default to `~/.memcli/default` instead of the repository-wide `.mem-sync` / `MEM_SYNC_HOME` convention.
- `flush --compact` exists in code but is missing from CLI help.
- `src/git.js` builds shell command strings and assumes `origin/main`.

## Non-Goals

- Do not add encryption, OAuth, GitHub API sync, or multi-client adapters in this plan.
- Do not rewrite the CLI router into a framework; use the existing `if/else` command dispatch style for this plan.
- Do not change the Memory Schema v1 shape except for fields required by soft deletion behavior already present in the schema.
- Do not replace SQLite or remove `better-sqlite3`.

## File Structure

### Existing Files To Modify

- `README.md` — align quick start, command list, roadmap, and storage model with the implemented CLI.
- `src/cli.js` — add command aliases/routes and update help text.
- `src/argparse.js` — reuse existing value/enum/integer validation helpers where appropriate.
- `src/repo-store.js` — add small helpers if command implementations need shared JSONL read/write behavior.
- `src/commands/remember.js` — keep existing `remember` behavior while allowing `add` to route to it.
- `src/commands/compact.js` — change default repo resolution to `MEM_SYNC_HOME ?? '.mem-sync'`.
- `src/commands/summarize.js` — change default repo resolution to `MEM_SYNC_HOME ?? '.mem-sync'`.
- `src/commands/review.js` — change default repo resolution to `MEM_SYNC_HOME ?? '.mem-sync'`.
- `src/commands/flush.js` — validate flags and expose `--compact` consistently.
- `src/git.js` — replace shell-string execution for user-controlled arguments and support default branch discovery.
- `docs/superpowers/plans/2026-06-01-mem-sync-cli-workflow.md` — add a short supersession note pointing to this June 2 plan.

### New Files To Create

- `src/commands/import.js` — import legacy `.mem-sync/memories.json` into JSONL with schema normalization.
- `src/commands/show.js` — print a single memory by `id` in JSON or human-readable form.
- `src/commands/forget.js` — soft-delete a memory by setting `deletedAt` and updating `updatedAt`.
- `src/commands/status.js` — summarize repo/index/pending status without mutating state.
- `src/commands/init.js` — initialize or clone the memory repo explicitly.
- `src/commands/sync.js` — pull/rebase and update index without promoting pending records.

### New Or Modified Tests

- `tests/cli-alias.test.js` — verify `add` behaves as `remember`.
- `tests/cli-import.test.js` — verify legacy import behavior.
- `tests/cli-show-forget.test.js` — verify `show` and `forget` behavior.
- `tests/cli-default-repo.test.js` — verify command defaults use `MEM_SYNC_HOME` / `.mem-sync`.
- `tests/cli-status-init-sync.test.js` — verify standalone lifecycle commands.
- `tests/git.test.js` — add direct Git wrapper coverage, branch discovery, and argument safety coverage.
- `tests/cli-flush.test.js` — add `--compact` help/validation coverage.
- `tests/cli-compact.test.js` — cover compact command parsing and representative command output.
- `tests/cli-summarize.test.js` — cover summarize command parsing and representative command output.
- `tests/cli-entry.test.js` — cover top-level help, unknown command, and unknown index subcommand behavior.
- `tests/memory-store.test.js` — add write-path redaction coverage.
- `tests/redaction-engine.test.js` — add custom rule configuration error coverage.
- `tests/schema.test.js` — add public schema compatibility and timestamp boundary coverage.
- `tests/index-store.test.js` — add focused filter, recursive JSONL, and logger coverage.
- `tests/argparse.test.js` — add non-number range validation coverage.
- `tests/project-resolver.test.js` — add package-without-name fallback coverage.

---

## Iteration 0: Test Gap Reconciliation

**Outcome:** External test-gap suggestions are reconciled against the current codebase, and non-duplicative public-behavior tests are added before functional changes continue.

### Task 0.1: Add Direct Git Wrapper Coverage

**Files:**
- Modify: `tests/git.test.js`

- [ ] **Step 1: Import direct Git helpers in `tests/git.test.js`**

Replace the existing import from `../src/git.js` in `tests/git.test.js` with this import list:

```js
import {
  ensureClone,
  hasRemote,
  getHead,
  fetch,
  pullRebase,
  stashSave,
  stashPop,
  rebaseAbort,
  stageFile,
  commit,
  push,
  RebaseConflictError
} from '../src/git.js';
```

This adds `stageFile`, `commit`, and `push` to the current import list.

- [ ] **Step 2: Add `stageFile` tests**

Append these tests to `tests/git.test.js` near the other public Git helper tests:

```js
test('stageFile stages an existing file', () => {
  const repoDir = createTempRepo('stage-file');
  try {
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');

    stageFile(repoDir, 'memory.jsonl');

    const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8' });
    assert.match(status, /^A\s+memory\.jsonl/m);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('stageFile throws when file does not exist', () => {
  const repoDir = createTempRepo('stage-missing');
  try {
    assert.throws(() => stageFile(repoDir, 'missing.jsonl'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Add `commit` tests**

Append:

```js
test('commit creates a commit with the requested message', () => {
  const repoDir = createTempRepo('commit-message');
  try {
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');

    const hash = commit(repoDir, 'mem-sync: test commit');

    assert.match(hash, /^[0-9a-f]{7,}$/);
    const message = execSync('git log -1 --format=%s', { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(message, 'mem-sync: test commit');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('commit throws when there are no staged changes', () => {
  const repoDir = createTempRepo('commit-empty');
  try {
    assert.throws(() => commit(repoDir, 'mem-sync: empty'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Add `push` tests**

Append:

```js
test('push returns false when no remote is configured', () => {
  const repoDir = createTempRepo('push-no-remote');
  try {
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');
    commit(repoDir, 'mem-sync: local only');

    assert.equal(push(repoDir), false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('push sends committed changes to origin', () => {
  const bareDir = createBareRepo('push-origin');
  const repoDir = createTempRepo('push-origin-local');
  try {
    execSync(`git remote add origin "${bareDir}"`, { cwd: repoDir, encoding: 'utf8' });
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');
    commit(repoDir, 'mem-sync: push test');

    assert.equal(push(repoDir), true);

    const remoteLog = execSync('git log --oneline --all', { cwd: bareDir, encoding: 'utf8' });
    assert.match(remoteLog, /mem-sync: push test/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Add argument-safety regression test**

Append:

```js
test('stageFile and commit handle quotes in file names and messages', () => {
  const repoDir = createTempRepo('git-safe-args');
  try {
    const filename = 'quote"file.txt';
    writeFileSync(join(repoDir, filename), 'content', 'utf8');

    stageFile(repoDir, filename);
    const hash = commit(repoDir, 'message with "quotes"');

    assert.match(hash, /^[0-9a-f]{7,}$/);
    const message = execSync('git log -1 --format=%s', { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(message, 'message with "quotes"');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test tests/git.test.js
```

Expected: the first four behavior tests pass. The quote-handling regression test fails before Iteration 4 with a Git command error because `src/git.js` currently builds shell strings; Iteration 4 fixes that failure.

### Task 0.2: Add Compact Command Parser Coverage

**Files:**
- Create: `tests/cli-compact.test.js`
- Modify: `src/commands/compact.js` when the parser integer validation test fails

- [ ] **Step 1: Create `tests/cli-compact.test.js`**

Create this test file:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compactCommand, parseCompactArgs } from '../src/commands/compact.js';
import { normalizeMemoryInput } from '../src/schema.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('parseCompactArgs parses --older-than, --dry-run, and --repo', () => {
  const opts = parseCompactArgs(['--older-than', '14', '--dry-run', '--repo', '/tmp/mem-sync-repo']);
  assert.equal(opts.olderThanDays, 14);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.storePath, join('/tmp/mem-sync-repo', 'memories.jsonl'));
});

test('parseCompactArgs rejects missing and invalid --older-than values', () => {
  assert.throws(() => parseCompactArgs(['--older-than']), /--older-than requires a value/);
  assert.throws(() => parseCompactArgs(['--older-than', 'abc']), /--older-than must be a non-negative integer/);
  assert.throws(() => parseCompactArgs(['--older-than', '-1']), /--older-than must be a non-negative integer/);
});

test('parseCompactArgs rejects unknown flags', () => {
  assert.throws(() => parseCompactArgs(['--unknown']), /unknown option: --unknown/);
});

test('compactCommand dry-run outputs JSON and does not modify store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-compact-'));
  try {
    mkdirSync(dir, { recursive: true });
    const oldRecord = normalizeMemoryInput({
      content: 'Old high confidence memory',
      confidence: 0.95,
      now: '2026-01-01T00:00:00.000Z'
    });
    const storePath = join(dir, 'memories.jsonl');
    writeFileSync(storePath, JSON.stringify(oldRecord) + '\n', 'utf8');
    const before = readFileSync(storePath, 'utf8');

    let output = '';
    const originalLog = console.log;
    console.log = (message) => { output += message; };
    try {
      await compactCommand(['--repo', dir, '--dry-run', '--older-than', '1']);
    } finally {
      console.log = originalLog;
    }

    const result = JSON.parse(output);
    assert.equal(result.total, 1);
    assert.equal(readFileSync(storePath, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compact command works through CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-compact-spawn-'));
  try {
    mkdirSync(dir, { recursive: true });
    const record = normalizeMemoryInput({ content: 'Spawn compact memory', confidence: 0.95, now: '2026-01-01T00:00:00.000Z' });
    writeFileSync(join(dir, 'memories.jsonl'), JSON.stringify(record) + '\n', 'utf8');

    const result = spawnSync(process.execPath, [CLI, 'compact', '--repo', dir, '--dry-run'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test tests/cli-compact.test.js
```

Expected before parser tightening: this may fail because `parseCompactArgs` currently uses `parseInt`. Patch `parseCompactArgs` to reject non-integer forms such as `1abc`, then rerun until it passes.

### Task 0.3: Add Summarize Command Parser Coverage

**Files:**
- Create: `tests/cli-summarize.test.js`
- Modify: `src/commands/summarize.js` only for defects exposed by these command parser tests

- [ ] **Step 1: Create `tests/cli-summarize.test.js`**

Create this test file:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSummarizeArgs, summarizeCommand } from '../src/commands/summarize.js';
import { normalizeMemoryInput } from '../src/schema.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('parseSummarizeArgs parses --project, --force, and --repo', () => {
  const opts = parseSummarizeArgs(['--project', 'proj-a', '--force', '--repo', '/tmp/mem-sync-repo']);
  assert.deepEqual(opts, { projectId: 'proj-a', force: true, repoPath: '/tmp/mem-sync-repo' });
});

test('parseSummarizeArgs rejects missing values and unknown flags', () => {
  assert.throws(() => parseSummarizeArgs(['--project']), /--project requires a value/);
  assert.throws(() => parseSummarizeArgs(['--repo']), /--repo requires a value/);
  assert.throws(() => parseSummarizeArgs(['--unknown']), /unknown option: --unknown/);
});

test('summarizeCommand outputs JSON and writes summary files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-summarize-'));
  try {
    mkdirSync(dir, { recursive: true });
    const records = [
      normalizeMemoryInput({ kind: 'preference', scope: 'user', content: 'User prefers concise Chinese replies', importance: 0.9, confidence: 0.9 }),
      normalizeMemoryInput({ kind: 'project_fact', scope: 'project', projectId: 'proj-a', content: 'Project uses Node test runner', importance: 0.9, confidence: 0.9 })
    ];
    writeFileSync(join(dir, 'memories.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    let output = '';
    const originalLog = console.log;
    console.log = (message) => { output += message; };
    try {
      await summarizeCommand(['--repo', dir, '--project', 'proj-a', '--force']);
    } finally {
      console.log = originalLog;
    }

    const result = JSON.parse(output);
    assert.equal(result.profile.written, true);
    assert.equal(result.project.written, true);
    assert.equal(existsSync(join(dir, 'profile.md')), true);
    assert.equal(existsSync(join(dir, 'projects', 'proj-a', 'summary.md')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summarize command works through CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-summarize-spawn-'));
  try {
    mkdirSync(dir, { recursive: true });
    const record = normalizeMemoryInput({ kind: 'preference', scope: 'user', content: 'CLI summary memory', importance: 0.9, confidence: 0.9 });
    writeFileSync(join(dir, 'memories.jsonl'), JSON.stringify(record) + '\n', 'utf8');

    const result = spawnSync(process.execPath, [CLI, 'summarize', '--repo', dir, '--force'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).profile.written, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test tests/cli-summarize.test.js
```

Expected: pass.

### Task 0.4: Add Redaction Write-Path And Rule Error Coverage

**Files:**
- Modify: `tests/memory-store.test.js`
- Modify: `tests/redaction-engine.test.js`

- [ ] **Step 1: Add memory-store redaction tests**

Append to `tests/memory-store.test.js`:

```js
test('createMemoryStore.add blocks content matching redaction rules', async () => {
  const storePath = join(await mkdtemp(join(tmpdir(), 'mem-sync-redaction-block-')), 'memories.jsonl');
  const store = createMemoryStore({ storePath });

  await assert.rejects(
    () => store.add('api_key="1234567890abcdef"', { source: 'codex' }),
    /content blocked by redaction rule: api-key/
  );
});

test('createMemoryStore.add allows redacted-looking content when skipRedaction is true', async () => {
  const storePath = join(await mkdtemp(join(tmpdir(), 'mem-sync-redaction-skip-')), 'memories.jsonl');
  const store = createMemoryStore({ storePath });

  const memory = await store.add('api_key="1234567890abcdef"', { source: 'codex', skipRedaction: true });

  assert.equal(memory.content, 'api_key="1234567890abcdef"');
});
```

`tests/memory-store.test.js` already imports `mkdtemp`, `tmpdir`, and `join`; no import changes are needed for these two tests.

- [ ] **Step 2: Add redaction rule config error tests**

Append to `tests/redaction-engine.test.js`:

```js
test('loadRedactionRules throws on invalid custom regex', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'redaction-invalid-regex-'));
  try {
    const metaDir = join(tmpDir, 'meta');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(join(metaDir, 'redaction-rules.json'), JSON.stringify({
      version: 1,
      rules: [{ name: 'bad-regex', pattern: '[' }]
    }), 'utf8');

    assert.throws(() => loadRedactionRules(tmpDir), /Invalid regex in rule "bad-regex"/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadRedactionRules throws when custom rule misses name or pattern', () => {
  for (const rule of [{ pattern: 'SECRET' }, { name: 'missing-pattern' }]) {
    const tmpDir = mkdtempSync(join(tmpdir(), 'redaction-invalid-rule-'));
    try {
      const metaDir = join(tmpDir, 'meta');
      mkdirSync(metaDir, { recursive: true });
      writeFileSync(join(metaDir, 'redaction-rules.json'), JSON.stringify({ version: 1, rules: [rule] }), 'utf8');

      assert.throws(() => loadRedactionRules(tmpDir), /Invalid custom rule: missing name or pattern/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --test tests/memory-store.test.js tests/redaction-engine.test.js
```

Expected: pass.

### Task 0.5: Add CLI Entry Behavior Coverage

**Files:**
- Create: `tests/cli-entry.test.js`

- [ ] **Step 1: Create `tests/cli-entry.test.js`**

Create this test file:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('no command prints help and exits zero', () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /mem-sync remember/);
});

test('unknown command prints help and exits one', () => {
  const result = run(['not-a-command']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Usage:/);
});

test('unknown index subcommand exits one with available subcommands', () => {
  const result = run(['index', 'wat']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown index subcommand: wat/);
  assert.match(result.stderr, /index rebuild \| index status \| index update/);
});

test('list formats string, object, and missing source through public CLI output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-cli-entry-list-'));
  try {
    mkdirSync(dir, { recursive: true });
    const records = [
      { id: 'mem_string', scope: 'user', source: 'codex', content: 'string source' },
      { id: 'mem_agent', scope: 'user', source: { type: 'manual', agent: 'cursor' }, content: 'agent source' },
      { id: 'mem_unknown', scope: 'user', content: 'unknown source' }
    ];
    writeFileSync(join(dir, 'memories.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    const result = run(['list'], { MEM_SYNC_HOME: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mem_string\tuser\tcodex\tstring source/);
    assert.match(result.stdout, /mem_agent\tuser\tcursor\tagent source/);
    assert.match(result.stdout, /mem_unknown\tuser\tunknown\tunknown source/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test tests/cli-entry.test.js
```

Expected: pass.

### Task 0.6: Add Public Schema Boundary Coverage

**Files:**
- Modify: `tests/schema.test.js`

- [ ] **Step 1: Add schema compatibility tests**

Append to `tests/schema.test.js`:

```js
test('normalizeMemoryInput accepts legacy text field and explicit id', () => {
  const memory = normalizeMemoryInput({
    id: 'mem_explicit',
    text: ' Legacy text body ',
    now: '2026-06-02T00:00:00.000Z'
  });

  assert.equal(memory.id, 'mem_explicit');
  assert.equal(memory.content, 'Legacy text body');
});

test('createCanonicalKey changes when projectId or agentId changes', () => {
  const base = normalizeMemoryInput({ content: 'Scoped fact', kind: 'project_fact', scope: 'project', projectId: 'a', agentId: 'agent-1' });
  const differentProject = normalizeMemoryInput({ content: 'Scoped fact', kind: 'project_fact', scope: 'project', projectId: 'b', agentId: 'agent-1' });
  const differentAgent = normalizeMemoryInput({ content: 'Scoped fact', kind: 'project_fact', scope: 'project', projectId: 'a', agentId: 'agent-2' });

  assert.notEqual(base.canonicalKey, differentProject.canonicalKey);
  assert.notEqual(base.canonicalKey, differentAgent.canonicalKey);
});

test('normalizeMemoryInput applies defaults for non-manual source through public API', () => {
  const memory = normalizeMemoryInput({ content: 'Imported fact', source: { type: 'imported' } });

  assert.equal(memory.confidence, 0.5);
  assert.equal(memory.veracity, 'unknown');
});
```

- [ ] **Step 2: Add timestamp error tests**

Append:

```js
test('normalizeMemoryInput rejects invalid timestamp fields with field names', () => {
  assert.throws(() => normalizeMemoryInput({ content: 'x', now: 'not-date' }), /now must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', createdAt: 'not-date' }), /createdAt must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', updatedAt: 'not-date' }), /updatedAt must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', validUntil: 'not-date' }), /validUntil must be a valid ISO timestamp/);
  assert.throws(() => normalizeMemoryInput({ content: 'x', deletedAt: 'not-date' }), /deletedAt must be a valid ISO timestamp/);
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --test tests/schema.test.js
```

Expected: pass.

### Task 0.7: Add Focused Index Filter And Logger Coverage

**Files:**
- Modify: `tests/index-store.test.js`

- [ ] **Step 1: Add filter tests**

Append to `tests/index-store.test.js`:

```js
test('searchIndex filters by projectId, agentId, veracity, and minImportance', async () => {
  const repoDir = await tempDir('index-filter-extra-repo');
  const cacheDir = await tempDir('index-filter-extra-cache');
  try {
    await writeJSONLFile(repoDir, 'memories.jsonl', [
      makeRecord({ id: 'mem_target', content: 'shared keyword target', projectId: 'project-a', agentId: 'agent-a', veracity: 'stated', importance: 0.9 }),
      makeRecord({ id: 'mem_project', content: 'shared keyword wrong project', projectId: 'project-b', agentId: 'agent-a', veracity: 'stated', importance: 0.9 }),
      makeRecord({ id: 'mem_agent', content: 'shared keyword wrong agent', projectId: 'project-a', agentId: 'agent-b', veracity: 'stated', importance: 0.9 }),
      makeRecord({ id: 'mem_veracity', content: 'shared keyword wrong veracity', projectId: 'project-a', agentId: 'agent-a', veracity: 'unknown', importance: 0.9 }),
      makeRecord({ id: 'mem_importance', content: 'shared keyword low importance', projectId: 'project-a', agentId: 'agent-a', veracity: 'stated', importance: 0.1 })
    ]);
    rebuildIndex(repoDir, cacheDir, { repoHead: 'filter-extra' });

    const results = searchIndex(cacheDir, {
      query: 'shared keyword',
      projectId: 'project-a',
      agentId: 'agent-a',
      veracity: 'stated',
      minImportance: 0.5,
      limit: 10
    });

    assert.deepEqual(results.map(result => result.id), ['mem_target']);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});
```

Use the existing helpers exactly as named in `tests/index-store.test.js`: `tempDir`, `writeJSONLFile`, and `makeRecord`.

- [ ] **Step 2: Add recursive JSONL and logger tests**

Append:

```js
test('rebuildIndex indexes JSONL files in nested directories', async () => {
  const repoDir = await tempDir('index-recursive-repo');
  const cacheDir = await tempDir('index-recursive-cache');
  try {
    await mkdir(join(repoDir, 'memories', '2026'), { recursive: true });
    await writeJSONLFile(join(repoDir, 'memories', '2026'), 'nested.jsonl', [
      makeRecord({ id: 'mem_nested', content: 'nested recursive memory' })
    ]);

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'recursive-test' });
    assert.equal(result.recordCount, 1);

    const matches = searchIndex(cacheDir, { query: 'recursive', limit: 10 });
    assert.deepEqual(matches.map(match => match.id), ['mem_nested']);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('rebuildIndex sends parse and validation diagnostics to logger', async () => {
  const repoDir = await tempDir('index-logger-repo');
  const cacheDir = await tempDir('index-logger-cache');
  try {
    await writeFile(join(repoDir, 'memories.jsonl'), [
      '{ bad json',
      JSON.stringify({ id: 'bad-schema' })
    ].join('\n') + '\n', 'utf8');
    const logs = [];

    const result = rebuildIndex(repoDir, cacheDir, { repoHead: 'logger-test', logger: message => logs.push(message) });

    assert.equal(result.recordCount, 0);
    assert.ok(logs.some(message => message.includes('invalid JSON')));
    assert.ok(logs.some(message => message.includes('schema')));
  } finally {
    await rm(repoDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  }
});
```

Use existing imports from `node:fs/promises`; add `mkdir` and `writeFile` if missing.

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --test tests/index-store.test.js
```

Expected before filter implementation: this may fail for unsupported `projectId`, `agentId`, `veracity`, or `minImportance` filters. Add the missing filter support in `src/index-store.js`, then rerun until it passes.

### Task 0.8: Add Low-Priority Boundary Tests

**Files:**
- Modify: `tests/argparse.test.js`
- Modify: `tests/project-resolver.test.js`

- [ ] **Step 1: Add non-number range tests**

Append to `tests/argparse.test.js`:

```js
test('validateRange rejects NaN and string values', () => {
  assert.throws(
    () => validateRange(Number.NaN, 0, 1, '--confidence'),
    /--confidence must be between 0 and 1/
  );
  assert.throws(
    () => validateRange('0.5', 0, 1, '--confidence'),
    /--confidence must be between 0 and 1/
  );
});
```

- [ ] **Step 2: Add package-without-name fallback test**

Append to `tests/project-resolver.test.js`:

```js
test('resolveProjectId falls back to directory basename when package.json has no name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-no-name-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');

    const result = resolveProjectId(dir);

    assert.equal(result, basename(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Update the existing `node:path` import in `tests/project-resolver.test.js` from:

```js
import { join } from 'node:path';
```

to:

```js
import { basename, join } from 'node:path';
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --test tests/argparse.test.js tests/project-resolver.test.js
```

Expected: pass.

### Task 0.9: Run Test Gap Reconciliation Verification

**Files:**
- No source files modified in this verification step

- [ ] **Step 1: Run all newly added or expanded test files**

Run:

```bash
node --test \
  tests/git.test.js \
  tests/cli-compact.test.js \
  tests/cli-summarize.test.js \
  tests/memory-store.test.js \
  tests/redaction-engine.test.js \
  tests/cli-entry.test.js \
  tests/schema.test.js \
  tests/index-store.test.js \
  tests/argparse.test.js \
  tests/project-resolver.test.js
```

Expected before Iteration 4: all listed tests pass except the quote-handling Git regression in `tests/git.test.js`. Expected after Iteration 4: all listed tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: pass after all intentionally failing regression tests are resolved in their paired implementation iterations.

---

## Iteration 1: Documentation And Command Surface Alignment

**Outcome:** Users can follow README and CLI help without hitting removed or hidden commands.

### Task 1.1: Update README To Match Current CLI

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace stale `add` quick-start command**

Change the quick start example from:

```bash
node ./src/cli.js add "User prefers concise Chinese replies" --scope assistant --source codex
```

to:

```bash
node ./src/cli.js remember "User prefers concise Chinese replies" --scope user --source codex
```

- [ ] **Step 2: Replace stale roadmap paragraph**

Replace the paragraph that says the prototype still stores `.mem-sync/memories.json` with:

```markdown
## Roadmap

The current prototype stores new memories in `.mem-sync/memories.jsonl` and keeps legacy `.mem-sync/memories.json` as a migration input. The next implementation phase focuses on closing remaining explicit CLI gaps (`show`, `forget`, legacy import), making Git sync branch-safe, and documenting the agent lifecycle commands.
```

- [ ] **Step 3: Add current command list**

Add this concise section after Quick Start:

```markdown
## Commands

- `remember` / `add` — create a schema v1 memory record.
- `list`, `show`, `forget`, `export` — inspect, soft-delete, and export memories.
- `index rebuild/status/update` — manage the local SQLite FTS index.
- `recall`, `context` — retrieve relevant memories for users and agents.
- `retain`, `review pending`, `flush` — collect pending candidates and promote them safely.
- `prepare`, `init`, `sync`, `status`, `doctor` — manage repository lifecycle and diagnostics.
- `redact`, `compact`, `summarize` — run safety, maintenance, and summary workflows.
```

- [ ] **Step 4: Run docs sanity check**

Run:

```bash
rg -n 'node ./src/cli.js add|still stores memories in `.mem-sync/memories.json`' README.md
```

Expected: no matches.

### Task 1.2: Add `add` Alias And Help Consistency

**Files:**
- Modify: `src/cli.js`
- Test: `tests/cli-alias.test.js`

- [ ] **Step 1: Write failing alias test**

Create `tests/cli-alias.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

test('add is a compatibility alias for remember', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-add-alias-'));
  try {
    const result = spawnSync(process.execPath, [CLI, 'add', 'Alias content', '--scope', 'user', '--source', 'codex'], {
      encoding: 'utf8',
      env: { ...process.env, MEM_SYNC_HOME: dir }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /^mem_/);

    const lines = readFileSync(join(dir, 'memories.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.content, 'Alias content');
    assert.equal(record.scope, 'user');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-alias.test.js
```

Expected: FAIL because `add` is not routed.

- [ ] **Step 3: Route `add` to `rememberCommand`**

In `src/cli.js`, change the first command branch to:

```js
  if (command === 'remember' || command === 'add') {
    await rememberCommand(args);
```

- [ ] **Step 4: Update help text**

In `printHelp()`, change the remember usage line to:

```text
  mem-sync remember|add <content> [--kind kind] [--scope scope] [--tag tag] [...]
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-alias.test.js
npm test
```

Expected: both pass.

---

## Iteration 2: Explicit Memory CLI Completion

**Outcome:** The explicit-memory portion of the June 1 plan is complete: users can import legacy data, inspect one record, and soft-delete records without touching Git sync.

### Task 2.1: Add Legacy Import Command

**Files:**
- Create: `src/commands/import.js`
- Modify: `src/cli.js`
- Test: `tests/cli-import.test.js`

- [ ] **Step 1: Write failing import tests**

Create `tests/cli-import.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function runImport(dir, extraArgs = []) {
  return spawnSync(process.execPath, [CLI, 'import', 'legacy', ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, MEM_SYNC_HOME: dir }
  });
}

test('import legacy migrates .mem-sync/memories.json to JSONL schema v1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-import-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memories.json'), JSON.stringify({
      memories: [
        { text: 'Legacy preference', scope: 'user', source: 'codex', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }
      ]
    }));

    const result = runImport(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { imported: 1, skipped: 0, total: 1 });

    const record = JSON.parse(readFileSync(join(dir, 'memories.jsonl'), 'utf8').trim());
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.content, 'Legacy preference');
    assert.equal(record.scope, 'user');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('import legacy is idempotent by canonical key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-import-idempotent-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memories.json'), JSON.stringify({ memories: [{ text: 'Same item' }] }));

    assert.equal(runImport(dir).status, 0);
    const second = runImport(dir);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(JSON.parse(second.stdout), { imported: 0, skipped: 1, total: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-import.test.js
```

Expected: FAIL because `import` route does not exist.

- [ ] **Step 3: Implement `src/commands/import.js`**

Create:

```js
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeMemoryInput } from '../schema.js';
import { appendJSONL, readJSONL, resolveLegacyStorePath, resolveStorePath } from '../repo-store.js';

export async function importCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'legacy') {
    throw new Error('import requires subcommand: legacy');
  }

  const opts = parseImportLegacyArgs(rest);
  const storePath = opts.storePath ?? resolveStorePath();
  const legacyPath = opts.legacyPath ?? resolveLegacyStorePath(dirname(storePath));

  const parsed = JSON.parse(await readFile(legacyPath, 'utf8'));
  const legacyMemories = Array.isArray(parsed?.memories) ? parsed.memories : [];
  const existing = await readJSONL(storePath);
  const existingKeys = new Set(existing.map(record => record.canonicalKey));

  let imported = 0;
  let skipped = 0;
  for (const memory of legacyMemories) {
    const normalized = normalizeMemoryInput({
      content: memory.content ?? memory.text,
      kind: memory.kind,
      scope: memory.scope,
      source: typeof memory.source === 'string' ? { type: memory.source } : memory.source,
      projectId: memory.projectId,
      agentId: memory.agentId,
      evidence: memory.evidence,
      confidence: memory.confidence,
      veracity: memory.veracity,
      importance: memory.importance,
      tags: memory.tags,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      validUntil: memory.validUntil,
      deletedAt: memory.deletedAt,
      supersedes: memory.supersedes
    });

    if (existingKeys.has(normalized.canonicalKey)) {
      skipped += 1;
      continue;
    }
    await appendJSONL(normalized, storePath);
    existingKeys.add(normalized.canonicalKey);
    imported += 1;
  }

  console.log(JSON.stringify({ imported, skipped, total: legacyMemories.length }));
}

export function parseImportLegacyArgs(args) {
  const opts = {};
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--from') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--from requires a value.');
      opts.legacyPath = value;
      index += 2;
    } else if (arg === '--to') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--to requires a value.');
      opts.storePath = value;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}
```

- [ ] **Step 4: Wire CLI route and help**

Add import in `src/cli.js`:

```js
import { importCommand } from './commands/import.js';
```

Add route before `list`:

```js
  } else if (command === 'import') {
    await importCommand(args);
```

Add help line:

```text
  mem-sync import legacy [--from <memories.json>] [--to <memories.jsonl>]
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-import.test.js
npm test
```

Expected: both pass.

### Task 2.2: Add `show` Command

**Files:**
- Create: `src/commands/show.js`
- Modify: `src/cli.js`
- Test: `tests/cli-show-forget.test.js`

- [ ] **Step 1: Write failing `show` tests**

Create `tests/cli-show-forget.test.js` with this initial content:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeMemoryInput } from '../src/schema.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function writeMemories(dir, memories) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'memories.jsonl'), memories.map(record => JSON.stringify(record)).join('\n') + '\n');
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MEM_SYNC_HOME: dir }
  });
}

test('show prints one memory as JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-show-'));
  try {
    const memory = normalizeMemoryInput({ content: 'Show me', now: '2026-06-02T00:00:00.000Z' });
    writeMemories(dir, [memory]);

    const result = run(dir, ['show', memory.id, '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).id, memory.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('show exits 1 when memory is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-show-missing-'));
  try {
    writeMemories(dir, []);
    const result = run(dir, ['show', 'mem_missing']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /memory not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-show-forget.test.js
```

Expected: FAIL because `show` route does not exist.

- [ ] **Step 3: Implement `src/commands/show.js`**

Create:

```js
import { readMemories } from '../repo-store.js';

export async function showCommand(args) {
  const opts = parseShowArgs(args);
  const memories = await readMemories();
  const memory = memories.find(record => record.id === opts.id && !record.deletedAt);
  if (!memory) {
    throw new Error(`memory not found: ${opts.id}`);
  }

  if (opts.format === 'json') {
    console.log(JSON.stringify(memory, null, 2));
  } else {
    console.log(`${memory.id}\t${memory.kind}\t${memory.scope}\t${memory.content}`);
  }
}

export function parseShowArgs(args) {
  let id;
  let format = 'human';
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--format') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--format requires a value.');
      if (!['human', 'json'].includes(value)) throw new Error('--format must be one of: human, json.');
      format = value;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!id) {
      id = arg;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!id) throw new Error('show requires a memory id.');
  return { id, format };
}
```

- [ ] **Step 4: Wire CLI route and help**

Add import:

```js
import { showCommand } from './commands/show.js';
```

Add route:

```js
  } else if (command === 'show') {
    await showCommand(args);
```

Add help line:

```text
  mem-sync show <id> [--format human|json]
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-show-forget.test.js
npm test
```

Expected: both pass.

### Task 2.3: Add `forget` Soft Delete Command

**Files:**
- Create: `src/commands/forget.js`
- Modify: `src/cli.js`
- Modify: `tests/cli-show-forget.test.js`

- [ ] **Step 1: Append failing `forget` tests**

Append to `tests/cli-show-forget.test.js`:

```js
test('forget soft-deletes a memory and show hides it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-forget-'));
  try {
    const memory = normalizeMemoryInput({ content: 'Forget me', now: '2026-06-02T00:00:00.000Z' });
    writeMemories(dir, [memory]);

    const result = run(dir, ['forget', memory.id]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { forgotten: 1, id: memory.id });

    const updated = JSON.parse(readFileSync(join(dir, 'memories.jsonl'), 'utf8').trim());
    assert.equal(updated.id, memory.id);
    assert.ok(updated.deletedAt);
    assert.ok(updated.updatedAt >= updated.deletedAt);

    const show = run(dir, ['show', memory.id]);
    assert.equal(show.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forget exits 1 when memory is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-forget-missing-'));
  try {
    writeMemories(dir, []);
    const result = run(dir, ['forget', 'mem_missing']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /memory not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-show-forget.test.js
```

Expected: FAIL because `forget` route does not exist.

- [ ] **Step 3: Implement `src/commands/forget.js`**

Create:

```js
import { readMemories, writeMemories } from '../repo-store.js';
import { validateMemory } from '../schema.js';

export async function forgetCommand(args) {
  const opts = parseForgetArgs(args);
  const memories = await readMemories();
  const now = new Date().toISOString();
  let forgotten = 0;

  const updated = memories.map(memory => {
    if (memory.id !== opts.id || memory.deletedAt) return memory;
    forgotten += 1;
    return validateMemory({ ...memory, deletedAt: now, updatedAt: now });
  });

  if (forgotten === 0) {
    throw new Error(`memory not found: ${opts.id}`);
  }

  await writeMemories(updated);
  console.log(JSON.stringify({ forgotten, id: opts.id }));
}

export function parseForgetArgs(args) {
  if (args.length !== 1 || args[0].startsWith('--')) {
    throw new Error('forget requires a memory id.');
  }
  return { id: args[0] };
}
```

- [ ] **Step 4: Wire CLI route and help**

Add import:

```js
import { forgetCommand } from './commands/forget.js';
```

Add route:

```js
  } else if (command === 'forget') {
    await forgetCommand(args);
```

Add help line:

```text
  mem-sync forget <id>
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-show-forget.test.js
npm test
```

Expected: both pass.

---

## Iteration 3: Repository Path And Maintenance Command Consistency

**Outcome:** Maintenance commands operate on the same default repository as the rest of the CLI and no longer surprise users with `~/.memcli/default`.

### Task 3.1: Unify Default Repo Resolution For `compact`, `summarize`, And `review`

**Files:**
- Modify: `src/commands/compact.js`
- Modify: `src/commands/summarize.js`
- Modify: `src/commands/review.js`
- Test: `tests/cli-default-repo.test.js`

- [ ] **Step 1: Write failing default repo tests**

Create `tests/cli-default-repo.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeMemoryInput } from '../src/schema.js';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MEM_SYNC_HOME: dir }
  });
}

test('compact defaults to MEM_SYNC_HOME', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-compact-default-'));
  try {
    const memory = normalizeMemoryInput({ content: 'Old memory', now: '2026-01-01T00:00:00.000Z', confidence: 0.9 });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memories.jsonl'), JSON.stringify(memory) + '\n');

    const result = run(dir, ['compact', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).total, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review pending defaults to MEM_SYNC_HOME', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-review-default-'));
  try {
    const pendingDir = join(dir, 'pending');
    mkdirSync(pendingDir, { recursive: true });
    const memory = normalizeMemoryInput({ content: 'Pending default repo' });
    writeFileSync(join(pendingDir, 'device.jsonl'), JSON.stringify(memory) + '\n');

    const result = run(dir, ['review', 'pending']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Pending default repo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-default-repo.test.js
```

Expected: FAIL because defaults use `~/.memcli/default`.

- [ ] **Step 3: Replace default constants**

In each of `src/commands/compact.js`, `src/commands/summarize.js`, and `src/commands/review.js`, remove `os.homedir()` usage and replace the default repo constant with:

```js
const DEFAULT_REPO = process.env.MEM_SYNC_HOME ?? '.mem-sync';
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/cli-default-repo.test.js tests/compact-engine.test.js tests/review.test.js tests/summarize-engine.test.js
```

Expected: pass.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: pass.

### Task 3.2: Expose And Validate `flush --compact`

**Files:**
- Modify: `src/cli.js`
- Modify: `src/commands/flush.js`
- Modify: `tests/cli-flush.test.js`

- [ ] **Step 1: Add failing help test**

Append to `tests/cli-flush.test.js`:

```js
test('help documents flush --compact', () => {
  const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /mem-sync flush \[--remote <url>\] \[--compact\]/);
});
```

- [ ] **Step 2: Add failing unknown flag test**

Append:

```js
test('flush rejects unknown flags', () => {
  const env = createRepoEnv();
  try {
    const result = runCLI(['flush', '--unknown'], env.dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown option: --unknown/);
  } finally {
    cleanupEnv(env);
  }
});
```

Use the existing helper names in `tests/cli-flush.test.js`; if the file uses different helper names, match the existing helpers exactly.

- [ ] **Step 3: Run test to verify failure**

Run:

```bash
node --test tests/cli-flush.test.js
```

Expected: FAIL on help or unknown-flag behavior.

- [ ] **Step 4: Add `parseFlushArgs`**

In `src/commands/flush.js`, add:

```js
export function parseFlushArgs(args) {
  let remoteUrl = null;
  let compact = false;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--remote') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--remote requires a value.');
      remoteUrl = value;
      index += 2;
    } else if (arg === '--compact') {
      compact = true;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { remoteUrl, compact };
}
```

Then replace the existing `remoteIdx` and `compactFlag` parsing with:

```js
  const { remoteUrl, compact: compactFlag } = parseFlushArgs(args);
```

- [ ] **Step 5: Update help text**

In `src/cli.js`, change:

```text
  mem-sync flush [--remote <url>]
```

to:

```text
  mem-sync flush [--remote <url>] [--compact]
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/cli-flush.test.js
npm test
```

Expected: both pass.

---

## Iteration 4: Git Sync Hardening

**Outcome:** Git operations are safer with paths/messages/remotes and work with non-`main` default branches.

### Task 4.1: Replace User-Controlled Shell String Git Calls

**Files:**
- Modify: `src/git.js`
- Test: `tests/git.test.js`

- [ ] **Step 1: Add failing special-character path test**

Append to `tests/git.test.js`:

```js
test('stageFile and commit handle quotes in file names and messages', () => {
  const repoDir = createTempRepo('git-safe-args-');
  try {
    writeFileSync(join(repoDir, 'quote"file.txt'), 'content');
    stageFile(repoDir, 'quote"file.txt');
    const hash = commit(repoDir, 'message with "quotes"');
    assert.match(hash, /^[0-9a-f]{7,}$/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
```

Use the existing temp repo helper names in `tests/git.test.js`; if they differ, adapt only the helper calls.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/git.test.js
```

Expected: FAIL with current shell-string quoting.

- [ ] **Step 3: Add argument-array Git executor**

In `src/git.js`, import `spawnSync`:

```js
import { execSync, spawnSync } from 'node:child_process';
```

Add:

```js
function execGitArgs(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    const error = new Error(result.stderr || `git ${args.join(' ')} failed`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.status = result.status;
    throw error;
  }
  return result.stdout;
}
```

- [ ] **Step 4: Switch user-controlled calls to argument arrays**

Replace:

```js
execGit(`add "${filePath}"`, cwd);
execGit(`commit -m "${message}"`, cwd);
execGit(`clone "${remoteUrl}" "${cwd}"`, process.cwd());
```

with:

```js
execGitArgs(['add', filePath], cwd);
execGitArgs(['commit', '-m', message], cwd);
execGitArgs(['clone', remoteUrl, cwd], process.cwd());
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests/git.test.js tests/cli-flush.test.js
```

Expected: pass.

### Task 4.2: Support Default Branch Discovery

**Files:**
- Modify: `src/git.js`
- Test: `tests/git.test.js`

- [ ] **Step 1: Add failing non-main branch test**

Append to `tests/git.test.js`:

```js
test('pullRebase and push use current branch when it is not main', () => {
  const { repoDir, bareDir } = createRepoWithRemote('master');
  try {
    writeFileSync(join(repoDir, 'master.txt'), 'change');
    stageFile(repoDir, 'master.txt');
    commit(repoDir, 'master branch change');
    assert.equal(push(repoDir), true);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});
```

Add this helper near the existing `createTempRepo` and `createBareRepo` helpers in `tests/git.test.js`:

```js
function createRepoWithRemote(branch = 'main') {
  const bareDir = createBareRepo(`branch-${branch}-bare`);
  const repoDir = createTempRepo(`branch-${branch}-local`);
  execSync(`git remote add origin "${bareDir}"`, { cwd: repoDir, encoding: 'utf8' });
  execSync(`git branch -M ${branch}`, { cwd: repoDir, encoding: 'utf8' });
  writeFileSync(join(repoDir, 'README.md'), `initial ${branch}`, 'utf8');
  execSync('git add README.md', { cwd: repoDir, encoding: 'utf8' });
  execSync(`git commit -m "initial ${branch}"`, { cwd: repoDir, encoding: 'utf8' });
  execSync(`git push -u origin ${branch}`, { cwd: repoDir, encoding: 'utf8' });
  return { repoDir, bareDir };
}
``` 

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/git.test.js
```

Expected: FAIL because `push` uses `origin main`.

- [ ] **Step 3: Add current branch helper**

In `src/git.js`, add:

```js
export function getCurrentBranch(cwd) {
  try {
    return execGit('rev-parse --abbrev-ref HEAD', cwd).trim();
  } catch {
    return 'main';
  }
}
```

- [ ] **Step 4: Replace hardcoded main references**

In `fetch`, `pullRebase`, and `push`, use:

```js
const branch = getCurrentBranch(cwd);
```

Then replace:

```js
HEAD..origin/main
pull --rebase origin main
push origin main
```

with template strings based on `branch`:

```js
`rev-list --count HEAD..origin/${branch}`
`pull --rebase origin ${branch}`
`push origin ${branch}`
```

Only `branch` comes from Git itself, not user CLI input.

- [ ] **Step 5: Run focused and full tests**

Run:

```bash
node --test tests/git.test.js tests/cli-flush.test.js tests/cli-prepare.test.js
npm test
```

Expected: all pass.

---

## Iteration 5: Standalone Lifecycle Commands

**Outcome:** The June 1 `init`, `sync`, and `status` command plan is fulfilled without changing `prepare` or `flush` semantics.

### Task 5.1: Add `init` Command

**Files:**
- Create: `src/commands/init.js`
- Modify: `src/cli.js`
- Test: `tests/cli-status-init-sync.test.js`

- [ ] **Step 1: Write failing init test**

Create `tests/cli-status-init-sync.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = new URL('../src/cli.js', import.meta.url).pathname;

function run(dir, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MEM_SYNC_HOME: dir }
  });
}

test('init creates a local git memory repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-init-'));
  rmSync(dir, { recursive: true, force: true });
  try {
    const result = run(dir, ['init']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).initialized, true);
    assert.equal(existsSync(join(dir, '.git')), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-status-init-sync.test.js
```

Expected: FAIL because `init` route does not exist.

- [ ] **Step 3: Implement `src/commands/init.js`**

Create:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureClone, hasRemote } from '../git.js';

export async function initCommand(args) {
  const opts = parseInitArgs(args);
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const existed = existsSync(join(memSyncHome, '.git'));
  ensureClone(opts.remoteUrl, memSyncHome);
  console.log(JSON.stringify({ initialized: !existed, repo: memSyncHome, hasRemote: hasRemote(memSyncHome) }));
}

export function parseInitArgs(args) {
  let remoteUrl = null;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--remote') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--remote requires a value.');
      remoteUrl = value;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { remoteUrl };
}
```

- [ ] **Step 4: Wire CLI route and help**

Add import:

```js
import { initCommand } from './commands/init.js';
```

Add route:

```js
  } else if (command === 'init') {
    await initCommand(args);
```

Add help line:

```text
  mem-sync init [--remote <url>]
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-status-init-sync.test.js
npm test
```

Expected: both pass.

### Task 5.2: Add `status` Command

**Files:**
- Create: `src/commands/status.js`
- Modify: `src/cli.js`
- Modify: `tests/cli-status-init-sync.test.js`

- [ ] **Step 1: Append failing status test**

Append:

```js
test('status reports repo, index, and pending state as JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-status-'));
  try {
    assert.equal(run(dir, ['init']).status, 0);
    const result = run(dir, ['status', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.repo.exists, true);
    assert.equal(status.index.exists, false);
    assert.equal(status.pending.count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-status-init-sync.test.js
```

Expected: FAIL because `status` route does not exist.

- [ ] **Step 3: Implement `src/commands/status.js`**

Create:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getIndexStatus } from '../index-store.js';
import { readPendingFiles } from '../merge.js';
import { getHead, hasRemote } from '../git.js';

export async function statusCommand(args) {
  const opts = parseStatusArgs(args);
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const repoExists = existsSync(join(memSyncHome, '.git'));
  const pendingDir = join(memSyncHome, 'pending');
  const pending = readPendingFiles(pendingDir);
  const status = {
    repo: { exists: repoExists, path: memSyncHome, head: repoExists ? getHead(memSyncHome) : null, hasRemote: repoExists ? hasRemote(memSyncHome) : false },
    index: getIndexStatus(join(memSyncHome, '.cache')),
    pending: { count: pending.length }
  };

  if (opts.format === 'json') {
    console.log(JSON.stringify(status));
  } else {
    console.log(`Repo: ${status.repo.exists ? 'exists' : 'not found'}`);
    console.log(`Index: ${status.index.exists ? 'exists' : 'not found'}`);
    console.log(`Pending: ${status.pending.count}`);
  }
}

export function parseStatusArgs(args) {
  let format = 'human';
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--format') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--format requires a value.');
      if (!['human', 'json'].includes(value)) throw new Error('--format must be one of: human, json.');
      format = value;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { format };
}
```

- [ ] **Step 4: Wire CLI route and help**

Add import:

```js
import { statusCommand as repoStatusCommand } from './commands/status.js';
```

Add route before `index` route:

```js
  } else if (command === 'status') {
    await repoStatusCommand(args);
```

Add help line:

```text
  mem-sync status [--format human|json]
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-status-init-sync.test.js
npm test
```

Expected: both pass.

### Task 5.3: Add `sync` Command

**Files:**
- Create: `src/commands/sync.js`
- Modify: `src/cli.js`
- Modify: `tests/cli-status-init-sync.test.js`

- [ ] **Step 1: Append failing sync test**

Append:

```js
test('sync updates index without promoting pending records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-sync-'));
  try {
    assert.equal(run(dir, ['init']).status, 0);
    const sync = run(dir, ['sync']);
    assert.equal(sync.status, 0, sync.stderr);
    const result = JSON.parse(sync.stdout);
    assert.equal(result.index.rebuilt || result.index.skipped, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/cli-status-init-sync.test.js
```

Expected: FAIL because `sync` route does not exist.

- [ ] **Step 3: Implement `src/commands/sync.js`**

Create:

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureClone, hasRemote, fetch, pullRebase, stashSave, stashPop, RebaseConflictError } from '../git.js';
import { updateIndex } from '../index-store.js';

export async function syncCommand(args) {
  const opts = parseSyncArgs(args);
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const cacheDir = join(memSyncHome, '.cache');
  const result = { git: { skipped: false, fetched: 0, pulled: 0, conflicts: 0 }, index: null };

  if (!existsSync(join(memSyncHome, '.git'))) {
    ensureClone(opts.remoteUrl, memSyncHome);
  }

  if (hasRemote(memSyncHome)) {
    result.git.fetched = fetch(memSyncHome);
    const stashed = stashSave(memSyncHome);
    try {
      result.git.pulled = pullRebase(memSyncHome);
    } catch (error) {
      if (error instanceof RebaseConflictError) {
        result.git.conflicts = 1;
        process.exitCode = 1;
        console.log(JSON.stringify(result));
        return;
      }
      throw error;
    } finally {
      if (stashed) stashPop(memSyncHome);
    }
  } else {
    result.git.skipped = true;
  }

  result.index = updateIndex(memSyncHome, cacheDir, { logger: message => console.error(message) });
  console.log(JSON.stringify(result));
}

export function parseSyncArgs(args) {
  let remoteUrl = null;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--remote') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--remote requires a value.');
      remoteUrl = value;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { remoteUrl };
}
```

- [ ] **Step 4: Wire CLI route and help**

Add import:

```js
import { syncCommand } from './commands/sync.js';
```

Add route:

```js
  } else if (command === 'sync') {
    await syncCommand(args);
```

Add help line:

```text
  mem-sync sync [--remote <url>]
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/cli-status-init-sync.test.js
npm test
```

Expected: both pass.

---

## Iteration 6: Plan State Reconciliation

**Outcome:** Future agents can tell which plan is current and which June 1 requirements were intentionally carried forward.

### Task 6.1: Mark June 1 Plan As Superseded By June 2 Completion Plan

**Files:**
- Modify: `docs/superpowers/plans/2026-06-01-mem-sync-cli-workflow.md`
- Modify: `docs/superpowers/plans/2026-06-02-mem-sync-completion-plan.md`

- [ ] **Step 1: Add supersession note to June 1 plan**

Insert after the title in `docs/superpowers/plans/2026-06-01-mem-sync-cli-workflow.md`:

```markdown
> **Status as of 2026-06-02:** This plan is superseded for remaining work by `docs/superpowers/plans/2026-06-02-mem-sync-completion-plan.md`. Many tasks in this file were implemented through OpenSpec changes but the checkboxes were not updated, so this file should be treated as historical context rather than a live task tracker.
```

- [ ] **Step 2: Add completion matrix to this June 2 plan**

Add a short table near the top of this file:

```markdown
## June 1 Plan Reconciliation

| June 1 Area | June 2 Status |
| --- | --- |
| Schema v1, JSONL, redaction, FTS, recall, context | Implemented and tested |
| Prepare, retain, flush, compact, summarize, doctor, review | Implemented and tested |
| `add`, legacy import, `show`, `forget` | Carried forward in this plan |
| `init`, `sync`, `status` | Carried forward in this plan |
| encryption, OAuth, GitHub API, conflict review | Deferred beyond this plan |
```

- [ ] **Step 3: Verify plan references**

Run:

```bash
rg -n 'superseded|2026-06-02-mem-sync-completion-plan|June 1 Plan Reconciliation' docs/superpowers/plans
```

Expected: both plan files are referenced.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
```

Expected: pass.

---

## Suggested Execution Order

1. Iteration 0 — reconcile external test-gap suggestions first, keeping only non-duplicative public-behavior coverage.
2. Iteration 1 — documentation and `add` alias because it removes immediate user-facing confusion.
3. Iteration 2 — explicit memory CLI gaps because they complete the June 1 local-memory surface.
4. Iteration 3 — default path and `flush --compact` consistency because these are low-risk usability fixes.
5. Iteration 4 — Git hardening because it changes lower-level behavior and uses regression tests from Iteration 0.
6. Iteration 5 — standalone lifecycle commands because they rely on hardened Git helpers.
7. Iteration 6 — plan reconciliation after implementation behavior is settled.

## Verification Checklist

- [ ] `npm test` passes.
- [ ] `node ./src/cli.js` help lists all implemented commands.
- [ ] README has no stale `add`-only quick start or old JSON roadmap language.
- [ ] `compact`, `summarize`, and `review pending` use `MEM_SYNC_HOME` by default.
- [ ] Git tests cover direct `stageFile`/`commit`/`push` behavior, quoted filenames/messages, and non-`main` branches.
- [ ] June 1 plan points to this June 2 plan as the live tracker for remaining work.

## Deferred Beyond June 2 Plan

- Encryption at rest or per-record encryption.
- GitHub OAuth and GitHub API sync.
- Semantic conflict review for similar but non-identical memories.
- Multi-client adapters for specific desktop apps or assistants.
- Background daemon or scheduled sync.

## Self-Review

### Spec Coverage

This plan covers all concrete June 1 leftovers visible in the current codebase: compatibility alias, legacy import, explicit `show`/`forget`, standalone lifecycle commands, command defaults, hidden `flush --compact`, Git branch/argument hardening, documentation reconciliation, and the vetted external test-gap additions for public behavior.

### Placeholder Scan

Placeholder scan passed for executable task content. The remaining conditional language describes intentional red-green sequencing where a regression test fails before its paired implementation iteration.

### Scope Check

The plan is focused on completion and hardening. Larger product capabilities from the June 1 future-work list remain explicitly deferred.
