## Why

The current `mem-sync` CLI has a generic `add` command that writes memories to JSONL and an `index` command that builds a searchable SQLite/FTS5 index. But there is no end-to-end path for an agent or user to write a memory and later retrieve it via relevance-ranked search. The `remember` and `recall` commands close this loop:

- `remember` replaces the prototype `add` command with a schema-aware write path that accepts structured metadata (kind, tags, confidence, importance, scope, source) and writes a validated v1 memory record to JSONL.
- `recall` provides relevance-ranked full-text retrieval from the local SQLite/FTS5 index, with structured filters (scope, kind, tags, confidence threshold) and multiple output formats for human reading, machine parsing, and agent prompt injection.

These two commands form the core read-write surface of `mem-sync` and unblock agent integration.

## What Changes

- Rename/upgrade `mem-sync add` to `mem-sync remember` with full v1 schema option support (--kind, --tag, --confidence, --importance, --source-type, --source-agent, --project-id, --agent-id, --valid-until, --summary, --supersedes).
- Add `mem-sync recall` command that wraps `searchIndex()` with structured filter options and three output formats: markdown (default), json, and memories (agent prompt injection).
- Change `searchIndex()` signature from `(cacheDir, query, limit)` to `(cacheDir, options)` with backward compatibility for the old positional-argument form.
- Extract shared argument-parsing helpers (`requireValue`, `validateEnum`, `validateRange`, `validatePositiveInt`) into `src/argparse.js` to avoid duplication between command modules.
- Extract command implementations into dedicated modules: `src/commands/remember.js` and `src/commands/recall.js`.
- Fix the existing `searchIndex` limit parameter bug where tests pass a `{ limit: 3 }` object instead of the number `3`.

## Capabilities

### New Capabilities

- `remember-command`: Accept user/agent memory input via CLI with structured metadata, validate against schema v1, and persist to JSONL.
- `recall-command`: Query the local FTS5 index with structured filters, format output for human reading (markdown), machine consumption (json), or agent prompt injection (memories).

### Modified Capabilities

- `memory-index`: The `searchIndex()` function gains an options-object API with structured filters (scope, kind, tags, projectId, agentId, minConfidence, minImportance, veracity, excludeDeleted, excludeExpired) while maintaining backward compatibility with the old positional signature.

## Impact

- Affected code: modified `src/cli.js`, modified `src/index-store.js` (searchIndex options object), new `src/argparse.js`, new `src/commands/remember.js`, new `src/commands/recall.js`.
- Affected tests: new `tests/cli-remember.test.js`, new `tests/cli-recall.test.js`, new `tests/argparse.test.js`, additions to `tests/index-store.test.js` (options object and filter tests).
- Affected docs: OpenSpec gains `remember-command` and `recall-command` requirements; CLI help and README update.
- No existing JSONL files, schema validation, or memory store behavior is changed — `remember` is a superset of the current `add` command.
- The index database contract is unchanged; `searchIndex` gains new capabilities that are backward-compatible.
