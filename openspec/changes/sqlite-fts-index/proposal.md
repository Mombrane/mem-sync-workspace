## Why

The current `mem-sync` prototype stores memories as JSONL records on disk, but has no local query capability. Every read requires scanning and parsing the entire JSONL file, which doesn't scale beyond a few hundred records and cannot support relevance-ranked retrieval. A local SQLite/FTS5 index is needed now because:

- The recall engine (planned in the next iteration) requires fast full-text search with relevance scoring.
- JSONL remains the source of truth, but query-time scanning defeats the purpose of structured memory retrieval.
- The index must be rebuildable from source-of-truth JSONL files — it is a cache, not a primary store.
- FTS5 provides BM25 relevance ranking without adding an embedding dependency, keeping the MVP lightweight.

## What Changes

- Add the project's first runtime dependency: a SQLite library with FTS5 support.
- Introduce `src/index-store.js` with functions to create, rebuild, incrementally update, and query a local SQLite/FTS5 index.
- Add `mem-sync index rebuild`, `mem-sync index status`, and `mem-sync index update` CLI commands.
- The index stores all schema v1 memory fields plus file origin metadata (`file_path`, `line_no`, `repo_commit`).
- The index uses an external-content FTS5 virtual table linked to a `memories` content table.
- Full rebuild is the primary strategy; incremental update is a best-effort optimization that falls back to full rebuild on failure.

## Capabilities

### New Capabilities

- `memory-index`: Create, maintain, and query a local SQLite/FTS5 index over JSONL memory records. The index is rebuildable from source-of-truth files and supports BM25-ranked full-text search over `content`, `summary`, and `tags` columns.

### Modified Capabilities

- None. Existing `memory-records` and `github-sync` capabilities are unchanged. The index is a downstream consumer of memory records.

## Impact

- Affected code: new `src/index-store.js`, new `src/commands/index.js`, modified `src/cli.js`, new `tests/index-store.test.js`, new `tests/cli-index.test.js`.
- Affected dependencies: `package.json` gains a SQLite dependency (candidate: `better-sqlite3`).
- Affected docs: OpenSpec gains `memory-index` requirements; CLI help and README gain index commands.
- No existing JSONL files, schema validation, or memory store behavior is changed.
- The index database lives outside the Git repo (in a local cache directory) and is never committed.
