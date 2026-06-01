# remember / recall CLI Design

## 1. searchIndex Options Object Design

### Current signature (index-store.js:436)

```js
export function searchIndex(cacheDir, query, limit)
// limit is positional, default 20
```

### Proposed new signature

```js
export function searchIndex(cacheDir, options)
```

### Options object

```js
{
  query: string,            // required — FTS5 query string
  limit: number,            // default 20

  // Structured filters (applied as SQL WHERE clauses on the memories table)
  scope: string,            // filter by scope enum value
  kind: string,             // filter by kind enum value
  tags: string[],           // filter: record must have ALL listed tags
  projectId: string,        // filter by project_id
  agentId: string,          // filter by agent_id
  minConfidence: number,    // 0–1, default unfiltered (0)
  minImportance: number,    // 0–1, default unfiltered (0)
  veracity: string,         // filter by veracity enum value

  // Deleted/expired handling
  excludeDeleted: boolean,  // default true — skip deletedAt != null
  excludeExpired: boolean,  // default true — skip validUntil in the past
}
```

### SQL generation pseudocode

```sql
SELECT m.*, f.rank
FROM memories_fts f
JOIN memories m ON m.rowid = f.rowid
WHERE memories_fts MATCH @query
  -- Structured filters (only when option is provided)
  AND (@scope IS NULL OR m.scope = @scope)
  AND (@kind IS NULL OR m.kind = @kind)
  AND (@projectId IS NULL OR m.project_id = @projectId)
  AND (@agentId IS NULL OR m.agent_id = @agentId)
  AND (@veracity IS NULL OR m.veracity = @veracity)
  AND m.confidence >= @minConfidence
  AND m.importance >= @minImportance
  -- Deleted/expired exclusion
  AND (@excludeDeleted = 0 OR m.deleted_at IS NULL)
  AND (@excludeExpired = 0 OR m.valid_until IS NULL OR m.valid_until >= @nowIso)
  -- Tags: handled post-query in JS (tags_json is a JSON array string,
  -- SQLite JSON functions could work but JS filtering is simpler and safer)
ORDER BY rank
LIMIT @limit
```

**Tags filtering rationale**: `tags_json` stores `JSON.stringify(tags)` — arrays like `["python","testing"]`. We filter post-query in JS with `Array.every` to avoid SQLite JSON1 extension dependency. The result set is already limited by FTS + other filters, so the post-filter is cheap.

**Backward compat**: The old `searchIndex(cacheDir, query, limit)` signature can be supported temporarily by detecting the argument shape:

```js
export function searchIndex(cacheDir, optionsOrQuery, legacyLimit) {
  // Detect old signature: second arg is a string
  const options = typeof optionsOrQuery === 'string'
    ? { query: optionsOrQuery, limit: legacyLimit }
    : optionsOrQuery;
  // ...
}
```

This lets us ship the new API without breaking the existing test suite immediately.

### Tag filtering JS implementation

```js
function filterByTags(records, requiredTags) {
  if (!requiredTags || requiredTags.length === 0) return records;
  return records.filter(r => requiredTags.every(t => r.tags.includes(t)));
}
```

---

## 2. Markdown Output Format for recall

### Default format: `--format markdown` (human-readable)

```markdown
# Recall: "python testing preferences" — 3 results

## 1. [preference] User prefers pytest over unittest
**Score:** -2.15 (BM25) | **ID:** \`mem_a1b2c3d4e5f6\`
**Scope:** user | **Kind:** preference | **Confidence:** 1.0 | **Importance:** 0.9
**Tags:** \`python\`, \`testing\`, \`pytest\`
**Created:** 2026-05-15T08:30:00.000Z | **Updated:** 2026-06-01T12:00:00.000Z

> User prefers pytest over unittest for all Python projects.
> They want fixtures, parametrize, and concise assertion style.

---

## 2. [decision] Use 80% coverage threshold
**Score:** -1.87 (BM25) | **ID:** \`mem_b2c3d4e5f6a1\`
**Scope:** project | **Kind:** decision | **Confidence:** 0.8 | **Importance:** 0.7
**Tags:** \`python\`, \`testing\`, \`coverage\`
**Created:** 2026-05-20T14:00:00.000Z

> Set coverage threshold to 80% for all projects.
> Critical paths require 95%.

---

## 3. [episode] Fixed test flakiness in CI
**Score:** -1.42 (BM25) | **ID:** \`mem_c3d4e5f6a1b2\`
**Scope:** project | **Kind:** episode | **Confidence:** 1.0 | **Importance:** 0.5
**Tags:** \`python\`, \`testing\`, \`ci\`
**Created:** 2026-05-28T09:15:00.000Z

> Fixed test flakiness in CI by adding retry logic for network-dependent tests.
```

### Format rules

| Element | Rule |
|---------|------|
| Header | `# Recall: "query" — N results` |
| Title line | `## N. [kind] summary-text` — first 80 chars of summary |
| Score | Raw BM25 rank (negative, lower = better). Display with 2 decimal places. |
| ID | Backtick-wrapped, clickable for `show` command |
| Metadata line 1 | scope, kind, confidence, importance |
| Metadata line 2 | tags (if any) as inline code spans |
| Metadata line 3 | created/updated timestamps |
| Content | Blockquoted, full content text |
| Separator | `---` between results |
| Empty | `# Recall: "query" — 0 results\n\nNo matching memories found.` |
| Error | `# Recall: "query"\n\nIndex not built. Run \`mem-sync index rebuild\` first.` |

### `--format json` (machine-readable)

```json
{
  "query": "python testing",
  "count": 3,
  "results": [
    {
      "rank": -2.15,
      "memory": { /* full schema v1 record */ }
    }
  ]
}
```

This is the raw `searchIndex` output wrapped with query metadata. No transformation beyond JSON serialization.

### `--format memories` (agent prompt injection)

Designed to be injected directly into an agent's system prompt or context window. Compact, dense, no markdown formatting characters that could confuse prompt parsing.

```text
[MEMORY id=mem_a1b2c3d4e5f6 rank=0.89 kind=preference scope=user confidence=1.0 importance=0.9]
User prefers pytest over unittest for all Python projects. They want fixtures, parametrize, and concise assertion style.
[/MEMORY]
[MEMORY id=mem_b2c3d4e5f6a1 rank=0.78 kind=decision scope=project confidence=0.8 importance=0.7 tags=python,testing,coverage]
Set coverage threshold to 80% for all projects. Critical paths require 95%.
[/MEMORY]
[MEMORY id=mem_c3d4e5f6a1b2 rank=0.65 kind=episode scope=project confidence=1.0 importance=0.5 tags=python,testing,ci]
Fixed test flakiness in CI by adding retry logic for network-dependent tests.
[/MEMORY]
```

Format rules:
- One `[MEMORY ...]...[/MEMORY]` block per result
- Attributes on opening tag: id, rank (normalized 0–1), kind, scope, confidence, importance, tags
- Content between tags is the raw content text (unquoted, unescaped except for `[/MEMORY]` which must be escaped)
- rank is normalized: `1 / (1 + abs(bm25_rank))` → 0–1 range where 1 = best match
- Empty result: no output (empty string), not even a header
- Error/No index: no output (empty string) — agent should handle gracefully

---

## 3. CLI Argument Parsing in cli.js

### Refactoring strategy

The current `cli.js` inlines all command handlers. We'll refactor to extract:
- `src/commands/remember.js` — replaces inline `addMemory` + `parseAddArgs`
- `src/commands/recall.js` — new, wraps `searchIndex` with format output

But the argument parsing itself stays in `cli.js` as a lightweight router. Each command module exports a function that receives `(args, stdout, stderr)`.

### cli.js command routing (updated)

```js
#!/usr/bin/env node
import { rememberCommand } from './commands/remember.js';
import { recallCommand } from './commands/recall.js';
import { listMemories } from './commands/list.js';
import { exportMemories } from './commands/export.js';
import { rebuildCommand, statusCommand, updateCommand } from './commands/index.js';

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case 'remember': await rememberCommand(args); break;
    case 'recall':   await recallCommand(args); break;
    case 'list':     await listMemories(); break;
    case 'export':   await exportMemories(); break;
    case 'index':    handleIndexCommand(args); break;
    default:         printHelp(); process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`mem-sync: ${error.message}`);
  process.exitCode = 1;
}
```

### remember command argument parsing

```
mem-sync remember <content> [options]

Options:
  --kind <kind>              one of: preference, identity, project_fact,
                             decision, workflow, correction, warning, episode
                             (default: episode)
  --scope <scope>            one of: user, project, agent, global, local-only
                             (default: global)
  --tag <tag>                repeatable, e.g. --tag python --tag testing
  --confidence <0..1>        (default: 1 for manual source)
  --importance <0..1>        (default: 0.5)
  --project-id <id>          project identifier
  --agent-id <id>            agent identifier
  --source-type <type>       e.g. manual, agent, import, tool
                             (default: manual)
  --source-agent <name>      agent name (default: current agent)
  --valid-until <ISO>        expiry timestamp
  --summary <text>           custom summary (default: first 120 chars of content)
  --supersedes <id>          repeatable, IDs this memory supersedes
```

**Parsing logic** (in `src/commands/remember.js`):

```js
export async function rememberCommand(args) {
  const { content, options } = parseRememberArgs(args);
  const store = createMemoryStore({ logger: msg => console.error(msg) });
  const memory = await store.add(content, options);
  console.log(memory.id);
}
```

Key design decisions:
- Content comes from positional args NOT starting with `--`, joined with space
- Flags that accept values consume the next arg
- `--tag` and `--supersedes` are repeatable (accumulate into arrays)
- `--confidence` and `--importance` are validated as floats in [0, 1]
- Unknown flags cause immediate error (strict parsing)
- Empty content causes error: "content cannot be empty."

### recall command argument parsing

```
mem-sync recall <query> [options]

Options:
  --format <fmt>             markdown | json | memories
                             (default: markdown)
  --limit <n>                max results (default: 20)
  --scope <scope>            filter by scope
  --kind <kind>              filter by kind
  --tag <tag>                repeatable, require ALL tags
  --min-confidence <0..1>    minimum confidence threshold
  --min-importance <0..1>    minimum importance threshold
  --project-id <id>          filter by project
  --agent-id <id>            filter by agent
  --veracity <v>             filter by veracity
  --include-deleted          include soft-deleted records
  --include-expired          include expired records
```

**Parsing logic** (in `src/commands/recall.js`):

```js
export async function recallCommand(args) {
  const options = parseRecallArgs(args);
  // options.query, options.format, options.limit, options.filters...

  const cacheDir = resolveCachePath();
  const results = searchIndex(cacheDir, options);

  switch (options.format) {
    case 'json':     return outputJSON(results, options.query);
    case 'memories': return outputMemories(results);
    default:         return outputMarkdown(results, options.query);
  }
}
```

#### parseRecallArgs detail

```js
function parseRecallArgs(args) {
  const queryParts = [];
  const options = {
    format: 'markdown',
    limit: 20,
    tags: [],
    filters: {}
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--format':
        options.format = validateEnum(requireValue(args, i++, '--format'),
          ['markdown', 'json', 'memories'], '--format');
        break;
      case '--limit':
        options.limit = validatePositiveInt(requireValue(args, i++, '--limit'), '--limit');
        break;
      case '--scope':
        options.filters.scope = requireValue(args, i++, '--scope');
        break;
      case '--kind':
        options.filters.kind = requireValue(args, i++, '--kind');
        break;
      case '--tag':
        options.tags.push(requireValue(args, i++, '--tag'));
        break;
      case '--min-confidence':
        options.filters.minConfidence = validateRange(
          parseFloat(requireValue(args, i++, '--min-confidence')), 0, 1, '--min-confidence');
        break;
      case '--min-importance':
        options.filters.minImportance = validateRange(
          parseFloat(requireValue(args, i++, '--min-importance')), 0, 1, '--min-importance');
        break;
      case '--project-id':
        options.filters.projectId = requireValue(args, i++, '--project-id');
        break;
      case '--agent-id':
        options.filters.agentId = requireValue(args, i++, '--agent-id');
        break;
      case '--veracity':
        options.filters.veracity = requireValue(args, i++, '--veracity');
        break;
      case '--include-deleted':
        options.filters.excludeDeleted = false;
        break;
      case '--include-expired':
        options.filters.excludeExpired = false;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`unknown option: ${arg}`);
        }
        queryParts.push(arg);
    }
    i++;
  }

  options.query = queryParts.join(' ');
  if (!options.query) throw new Error('query is required.');

  return options;
}
```

### Shared argument parsing helpers (extracted to avoid duplication)

Since both `remember` and `recall` need parsing, we extract shared helpers:

**New file: `src/argparse.js`**

```js
export function requireValue(args, index, flag) { ... }
export function validateEnum(value, allowed, flag) { ... }
export function validateRange(value, min, max, flag) { ... }
export function validatePositiveInt(value, flag) { ... }
```

These are pure functions, easily testable.

---

## 4. Test Cases

### 4.1 `remember` command tests (`tests/cli-remember.test.js`)

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `remember "hello world"` | Defaults: kind=episode, scope=global, outputs mem_ id to stdout |
| 2 | `remember "hello" --kind preference --scope user` | Explicit kind/scope applied |
| 3 | `remember "hello" --tag python --tag testing` | Repeatable --tag accumulates |
| 4 | `remember "hello" --confidence 0.8 --importance 0.9` | Numeric fields parsed and validated |
| 5 | `remember "hello" --project-id myproj --agent-id claude` | String fields passed through |
| 6 | `remember "hello" --source-type agent --source-agent codex` | Source object constructed correctly |
| 7 | `remember "hello" --valid-until 2027-01-01T00:00:00.000Z` | ISO timestamp accepted |
| 8 | `remember "hello" --summary "custom summary text"` | Custom summary overrides auto-summary |
| 9 | `remember "hello" --supersedes mem_abc --supersedes mem_def` | Repeatable --supersedes accumulates |
| 10 | `remember ""` (empty content) | Exit code 1, stderr contains "content cannot be empty" |
| 11 | `remember "hello" --kind invalid_kind` | Exit code 1, stderr contains "must be one of" |
| 12 | `remember "hello" --confidence 1.5` | Exit code 1, stderr contains "between 0 and 1" |
| 13 | `remember "hello" --confidence notanumber` | Exit code 1, parse error |
| 14 | `remember "hello" --unknown-flag value` | Exit code 1, stderr contains "unknown option" |
| 15 | Schema diagnostics to stderr | stderr has normalize/validate lines, stdout has only mem_ id |
| 16 | Result appears in JSONL file | After remember, memories.jsonl contains the record |
| 17 | Content normalization | `remember "  hello   world  "` stores "hello world" |

### 4.2 `recall` command tests (`tests/cli-recall.test.js`)

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `recall "python" --format json` (with indexed data) | Valid JSON output with query + results |
| 2 | `recall "python"` (default markdown) | Human-readable markdown with scores |
| 3 | `recall "python" --format memories` | Agent prompt injection format with [MEMORY] blocks |
| 4 | `recall "python" --limit 3` | Respects limit |
| 5 | `recall "python" --scope user` | Filters by scope |
| 6 | `recall "python" --kind preference` | Filters by kind |
| 7 | `recall "python" --tag python --tag testing` | Filters by all tags |
| 8 | `recall "python" --min-confidence 0.8` | Confidence threshold |
| 9 | `recall "python" --min-importance 0.7` | Importance threshold |
| 10 | `recall "nonexistent query"` | "No matching memories found" in output, exit code 0 |
| 11 | `recall` (no query) | Exit code 1, stderr "query is required" |
| 12 | `recall "python" --format invalid` | Exit code 1, stderr "must be one of" |
| 13 | `recall "python"` with no index built | "Index not built" message, exit code 0 |
| 14 | `recall "python" --include-deleted` | Includes soft-deleted records |
| 15 | `recall "python" --include-expired` | Includes expired records |
| 16 | `recall "python" --project-id myproj` | Filters by project |

### 4.3 `searchIndex` options object tests (`tests/index-store.test.js` additions)

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `searchIndex(cacheDir, { query, limit: 5 })` | New options object works |
| 2 | `searchIndex(cacheDir, { query, scope: 'user' })` | Scope filter in SQL |
| 3 | `searchIndex(cacheDir, { query, kind: 'preference' })` | Kind filter in SQL |
| 4 | `searchIndex(cacheDir, { query, minConfidence: 0.8 })` | Confidence threshold |
| 5 | `searchIndex(cacheDir, { query, tags: ['python'] })` | Tag post-filter |
| 6 | `searchIndex(cacheDir, { query, tags: ['python', 'testing'] })` | Multi-tag AND filter |
| 7 | `searchIndex(cacheDir, { query, excludeDeleted: false })` | Include deleted |
| 8 | `searchIndex(cacheDir, { query, excludeExpired: false })` | Include expired |
| 9 | `searchIndex(cacheDir, 'legacy query')` | Backward compat: string as second arg |
| 10 | `searchIndex(cacheDir, 'legacy query', 10)` | Backward compat: string + limit |

### 4.4 `argparse` helper tests (`tests/argparse.test.js`)

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `requireValue` returns next arg | Basic functionality |
| 2 | `requireValue` throws on missing value | Error handling |
| 3 | `requireValue` throws on flag-as-value | "--flag" as value rejected |
| 4 | `validateEnum` passes for valid value | Happy path |
| 5 | `validateEnum` throws for invalid value | Error message includes allowed list |
| 6 | `validateRange` with boundary values | 0 and 1 accepted |
| 7 | `validateRange` throws for out-of-range | Error message |
| 8 | `validatePositiveInt` accepts positive int | Happy path |
| 9 | `validatePositiveInt` rejects 0, negative, float | Error handling |

---

## 5. Issues and Edge Cases

### 5.1 Critical: ID divergence between memory-store.js and schema.js

**Problem**: `memory-store.js:createMemoryId()` uses `sha256(scope\0source\0content)`, but `schema.js:createMemoryIdFromCanonicalKey()` uses `sha256(canonicalKey)` where canonicalKey = `kind:scope:projectId:agentId:contentHash`. These produce different IDs for the same content.

**Current behavior**: `memory-store.js` generates its own ID and passes it to `normalizeMemoryInput` via `input.id`, which then uses it (line 58 of schema.js: `const id = input.id ?? createMemoryIdFromCanonicalKey(canonicalKey)`).

**Impact**: If any other code path calls `normalizeMemoryInput` without providing `input.id`, it gets a different ID than what `memory-store.js` would produce. This means:
- Direct `normalizeMemoryInput` usage won't match existing records
- `remember` command always uses `memory-store.js` path, so consistent within itself
- But if `retain` engine or import tools use `normalizeMemoryInput` directly, they'll create separate records for duplicate content

**Fix**: `memory-store.js` should use `createMemoryIdFromCanonicalKey` from `schema.js` instead of its own `createMemoryId`. Or better, remove `createMemoryId` from `memory-store.js` entirely and always let `normalizeMemoryInput` generate the ID.

### 5.2 Critical: searchIndex limit parameter bug in existing tests

**Problem**: `index-store.test.js:330` calls `searchIndex(cacheDir, '搜索关键词', { limit: 3 })`. The function expects `limit` as a number but receives an object `{ limit: 3 }`. Since `{ limit: 3 }` is truthy, `effectiveLimit` becomes `{ limit: 3 }` (the object), not `3`. When passed to SQLite as `@effectiveLimit`, this likely causes a SQL error which is caught by the try/catch, returning `[]`. The test passes only because `0 <= 3` is true.

**Fix**: Either fix the test to pass `3` directly, or update `searchIndex` to accept the options object first (see 1 above).

### 5.3 Medium: No index error UX

**Problem**: When `recall` is called but no index exists, `searchIndex` returns `[]`. The user can't tell the difference between "no matching results" and "index not built."

**Fix**: `recall` command checks `getIndexStatus()` before searching. If `exists === false`, output a specific message:
- markdown: `Index not built. Run \`mem-sync index rebuild\` first.`
- json: `{"error": "INDEX_NOT_BUILT", "message": "..."}`
- memories: empty output (no injection)

### 5.4 Medium: BM25 rank normalization for --format memories

**Problem**: Raw BM25 rank is a negative number (lower = better match). The `--format memories` output needs a 0–1 normalized score for agent consumption.

**Fix**: Normalize with `rank_norm = 1 / (1 + abs(rank))`. This maps:
- rank = 0 (perfect match) → 1.0
- rank = -1 → 0.5
- rank = -10 → 0.09

For `--format markdown`, display the raw BM25 rank (more informative for debugging).

### 5.5 Medium: Tags stored as JSON array in FTS

**Problem**: `tags_json` is indexed in FTS5 for text search, but structured tag filtering ("record must have tag X") can't use FTS MATCH. SQLite JSON1 functions (`json_each`) could work but add complexity.

**Fix**: Post-filter in JS after FTS query. The result set after FTS + structured SQL filters is small enough (≤ limit, default 20) that JS filtering is effectively free.

### 5.6 Low: CJK trigram minimum length

**Problem**: The trigram tokenizer requires at least 3 CJK characters to generate trigrams. A query like `测试` (2 chars) won't match `测试内容` because there are no 3-char trigrams in a 2-char query.

**Fix**: Document this limitation. For CJK queries shorter than 3 chars, prepend/append a wildcard or fall back to `LIKE '%query%'` on the content column. This is a P2 enhancement.

### 5.7 Low: Concurrent remember + recall

**Problem**: `remember` appends to JSONL (fast), but the index isn't updated until `index rebuild` or `index update` runs. So newly remembered facts won't appear in recall until a reindex.

**Fix**: This is by design for MVP — `remember` writes JSONL immediately, `recall` reads from the index, and `prepare`/`flush` lifecycle hooks handle reindexing. Document clearly: "Newly remembered facts require `mem-sync index update` before they appear in recall."

### 5.8 Low: --format memories escaping

**Problem**: If memory content contains `[/MEMORY]`, it would break the `--format memories` output format.

**Fix**: Escape `[/MEMORY]` as `[\/MEMORY]` in the content body. Also escape null bytes and other control characters.

### 5.9 Low: Output encoding

**Problem**: `console.log` on some terminals may mangle CJK characters or emoji.

**Fix**: All output goes through `process.stdout.write` with explicit UTF-8. Markdown output uses only ASCII structural characters; content is passed through as-is.

### 5.10 Verification checklist

Before considering the design complete, verify:

- [ ] `searchIndex` options shape consistent between CLI layer and index-store module
- [ ] `--format` flag naming consistent across all commands (`index status --format json`, `recall --format json`)
- [ ] Error messages follow existing pattern: `mem-sync: <message>` to stderr
- [ ] Exit codes: 0 for success/empty-results, 1 for errors
- [ ] JSON output always goes to stdout, diagnostics to stderr (existing pattern)
- [ ] Test isolation via `MEM_SYNC_HOME` env var (existing pattern)
- [ ] `remember` command creates valid v1 records that pass `validateMemory`
- [ ] `recall` command output is parseable by both humans and scripts
