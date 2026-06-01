## Context

`mem-sync` has a working JSONL storage layer (`src/memory-store.js`, `src/repo-store.js`), a schema v1 validation pipeline (`src/schema.js`), and a local SQLite/FTS5 index (`src/index-store.js`). But the CLI surface (`src/cli.js`) exposes only a prototype `add` command with `--scope` and `--source` flags, and no search capability. The `remember` and `recall` commands bridge the storage and index layers into a usable CLI.

The explore phase document (`docs/remember-recall-design.md`) produced detailed designs for both commands, the `searchIndex` options-object refactor, shared argparse helpers, and output format specifications.

## Goals / Non-Goals

**Goals:**

- Replace `mem-sync add` with `mem-sync remember` accepting all schema v1 metadata fields.
- Add `mem-sync recall` with FTS5-powered search, structured filters, and three output formats.
- Refactor `searchIndex()` to accept an options object with backward compatibility for the old `(cacheDir, query, limit)` signature.
- Extract `src/argparse.js` with reusable validation helpers.
- Extract command logic into `src/commands/remember.js` and `src/commands/recall.js`.
- Fix the existing `searchIndex` limit parameter bug identified during the explore phase.
- Preserve existing diagnostic-output-to-stderr, machine-output-to-stdout convention.
- Write comprehensive tests for each new module and for CLI integration.

**Non-Goals:**

- Do not implement automatic index update on `remember` — the prepare/flush lifecycle handles reindexing separately.
- Do not change the JSONL storage format or schema v1.
- Do not add CJK trigram minimum-length workarounds (P2 enhancement, documented as known limitation).
- Do not implement interactive mode or REPL for either command.
- Do not implement `retain` engine or import/export tool integration in this change.

## Decisions

### 1. remember Reuses memory-store.js add(), Extended with New Options

The `remember` command calls `memoryStore.add(text, options)` directly — the same function used by the current `add` command. The CLI layer parses the richer flag set (--kind, --tag, --confidence, etc.) and passes them through `options` to `normalizeMemoryInput()` in `schema.js`.

Rationale:

- Zero change to the storage layer — `memory-store.js` and `schema.js` already support all v1 metadata fields via `normalizeMemoryInput({...options, content, id, scope, source, now})`.
- The CLI becomes a thin parser + store invocation, keeping command modules testable.
- Avoids duplicating validation logic between CLI and store.

### 2. searchIndex Signature Change: (cacheDir, options) with Backward Compat

Change `searchIndex(cacheDir, query, limit)` to `searchIndex(cacheDir, options)` where `options` is:

```js
{
  query: string,            // required — FTS5 query string
  limit: number,            // default 20

  // Structured filters (applied as SQL WHERE clauses)
  scope: string,
  kind: string,
  tags: string[],           // post-filtered in JS (AND semantics)
  projectId: string,
  agentId: string,
  minConfidence: number,    // 0–1
  minImportance: number,    // 0–1
  veracity: string,
  excludeDeleted: boolean,  // default true
  excludeExpired: boolean,  // default true
}
```

Backward compatibility is provided by detecting the argument shape at the top of `searchIndex`:

```js
export function searchIndex(cacheDir, optionsOrQuery, legacyLimit) {
  const options = typeof optionsOrQuery === 'string'
    ? { query: optionsOrQuery, limit: legacyLimit }
    : optionsOrQuery;
  // ... rest of function uses options.query, options.limit, etc.
}
```

Rationale:

- The old `(cacheDir, query, limit)` signature is used nowhere outside the test suite — the explore phase found no production callers.
- The options object is extensible — future filters (e.g., date ranges) can be added without changing the function signature again.
- The backward-compat shim lets existing tests pass without modification and can be removed in a follow-up cleanup.
- Tags are post-filtered in JS rather than SQL to avoid SQLite JSON1 extension dependency; the result set after FTS + SQL filters is small (≤ limit) so JS filtering is cheap.

### 3. Three Output Formats for recall

The `recall` command supports `--format markdown` (default), `--format json`, and `--format memories`.

**markdown**: Human-readable with scores, IDs, metadata, and blockquoted content. Designed for terminal reading.

**json**: Machine-readable JSON with `{ query, count, results: [{ rank, memory }] }`. Raw `searchIndex` output wrapped with query metadata. Zero transformation beyond JSON serialization.

**memories**: Agent prompt injection format using `[MEMORY]...[/MEMORY]` blocks with attributes (id, rank, kind, scope, confidence, importance, tags). Compact, dense, no markdown formatting characters that could confuse prompt parsing. BM25 rank is normalized to 0–1 range with `1 / (1 + abs(bm25_rank))`.

Rationale:

- markdown is the natural default for a CLI tool that humans interact with.
- json enables scripting and programmatic consumption (e.g., `mem-sync recall "query" --format json | jq '.results[0].memory'`).
- memories is designed for the primary integration target: injecting relevant context into an LLM agent's system prompt or context window. Empty results produce empty output (not even a header), so agents can unconditionally inject the output without guard logic.

### 4. Shared argparse.js for DRY Flag Parsing

Both `remember` and `recall` parse `--kind`, `--scope`, `--tag`, `--confidence`/`--min-confidence`, etc. These are extracted into `src/argparse.js`:

```js
export function requireValue(args, index, flag) { ... }
export function validateEnum(value, allowed, flag) { ... }
export function validateRange(value, min, max, flag) { ... }
export function validatePositiveInt(value, flag) { ... }
```

Rationale:

- Pure functions, easily testable in isolation (`tests/argparse.test.js`).
- Avoids the current pattern of inlining `requireValue` in `cli.js:98-104` and then duplicating it in command modules.
- Consistent error messages (e.g., `"--confidence must be between 0 and 1"`) across all commands.

### 5. Command Modules Extract from cli.js

Each command becomes a module in `src/commands/`:

- `src/commands/remember.js` exports `rememberCommand(args)` — parses args, calls `memoryStore.add()`, writes memory ID to stdout.
- `src/commands/recall.js` exports `recallCommand(args)` — parses args, calls `searchIndex()`, formats and writes output.

`cli.js` becomes a lightweight router:

```js
switch (command) {
  case 'remember': await rememberCommand(args); break;
  case 'recall':   await recallCommand(args); break;
  case 'list':     await listMemories(); break;
  case 'export':   await exportMemories(); break;
  case 'index':    handleIndexCommand(args); break;
  default:         printHelp();
}
```

Rationale:

- Matches the existing pattern of `src/commands/index.js` for the `index` subcommand.
- Keeps `cli.js` under 50 lines — easy to scan and understand.
- Command modules are independently testable without spawning child processes.

### 6. No-Index Detection in recall

When `recall` is called but no index exists, `searchIndex` returns `[]`. To distinguish "no matching results" from "index not built," the `recall` command calls `getIndexStatus()` first:

- If `exists === false`:
  - markdown: `# Recall: "query"\n\nIndex not built. Run \`mem-sync index rebuild\` first.`
  - json: `{"error": "INDEX_NOT_BUILT", "message": "Index not built. Run \`mem-sync index rebuild\` first."}`
  - memories: empty output (safe for unconditional agent injection)
- Otherwise: proceed with search and format.

Rationale:

- Avoids the confusing silent-empty-result problem where the user can't tell if their query matched nothing or the index doesn't exist.
- The json error format uses an `error` key (not a thrown exception) with exit code 0 — consistent with "no results" being a valid, non-error state.
- memories format intentionally produces empty output on error: agents should inject the output unconditionally, and empty string is harmless.

### 7. Fix Existing searchIndex Limit Bug

`tests/index-store.test.js:330` passes `searchIndex(cacheDir, 'query', { limit: 3 })` — the third argument is an object `{ limit: 3 }`, not a number. The function uses `effectiveLimit = limit ?? 20`, so `effectiveLimit` becomes the object, which is passed to SQLite as `@effectiveLimit`. This likely causes a SQL error caught by the try/catch, returning `[]`. The test passes because `0 <= 3` is vacuously true.

Fix: Update the test to match the new options-object signature: `searchIndex(cacheDir, { query: 'query', limit: 3 })`. After the options-object refactor, the old positional form `searchIndex(cacheDir, 'query', 3)` will also work via the backward-compat shim.

Rationale:

- This bug was discovered during the explore phase and could mask real search failures in the test suite.
- Fixing it alongside the options-object refactor is natural — the new signature makes the bug impossible.

## Risks / Trade-offs

- [Risk] The backward-compat shim in `searchIndex` may confuse callers about which signature to use. → Mitigation: Add JSDoc deprecation tags on the old signature; remove the shim in a follow-up change once all callers are updated.
- [Risk] The `--format memories` escape logic (escaping `[/MEMORY]` as `[\/MEMORY]`) may miss edge cases. → Mitigation: Add a dedicated test for content containing the closing tag sequence.
- [Risk] Tags post-filtering in JS means the FTS5 result set is constrained only by the text query and SQL-level filters, not by tags. If a query matches 1000 records but only 1 has the required tag, we fetch 1000 rows from SQLite and filter down to 1. → Mitigation: For MVP scale, this is acceptable — the `limit` parameter bounds the SQL result set. If tag-heavy filtering becomes common, SQLite JSON1 extension can be used later.
- [Risk] `console.log` on some terminals may mangle CJK characters or emoji in markdown output. → Mitigation: All structural characters in markdown format are ASCII; content passes through as-is. Use `process.stdout.write` for explicit UTF-8 control where needed.

## Migration Plan

1. Implement `src/argparse.js` with test coverage.
2. Refactor `searchIndex()` to accept options object with backward-compat shim.
3. Fix the existing searchIndex limit test bug.
4. Add structured filter tests to `tests/index-store.test.js`.
5. Implement `src/commands/remember.js` with parsing and store integration.
6. Implement `src/commands/recall.js` with search, format selection, and output.
7. Update `src/cli.js` to route `remember` and `recall` commands.
8. Write `tests/cli-remember.test.js`, `tests/cli-recall.test.js`, `tests/argparse.test.js`.
9. Update README with `remember` and `recall` usage examples.
10. Run `npm test` and confirm all tests pass.

Rollback strategy: Revert `cli.js` to the current `add` command, delete `src/commands/remember.js`, `src/commands/recall.js`, `src/argparse.js`, and associated tests. No existing data is affected — both commands are new surface on existing storage and index layers.

## Open Questions

- Should `remember` automatically trigger `index update`? → Resolved: No, for MVP. The prepare/flush lifecycle handles reindexing. Document clearly: "Newly remembered facts require `mem-sync index update` before they appear in recall."
- Should `recall` default limit be 20 (matching `searchIndex`) or 8 (friendlier for terminal display)? → Resolved in explore: default 20, consistent with `searchIndex`. Users can override with `--limit`.
- Should we keep the old `add` command as an alias? → Resolved: No, `remember` replaces `add` directly. The old `add` command is a prototype and has no production users.

## Design Review

- The design cleanly separates concerns: CLI parsing → command logic → store/index invocation → output formatting.
- The options-object refactor of `searchIndex` is the right abstraction level — it matches how the function is actually used (structured filters, not free-form query parameters) and is trivially backward-compatible.
- Three output formats for `recall` cover the real use cases: human, script, agent. The `memories` format is particularly well-designed for the primary integration target.
- Extracting `argparse.js` avoids the common CLI anti-pattern of copy-pasted flag parsing.
- The explore phase's thorough test case enumeration (17 remember cases, 16 recall cases, 10 searchIndex cases, 9 argparse cases) provides confidence that edge cases are covered.
- The no-index detection in `recall` is a UX improvement over the current silent-empty behavior.
