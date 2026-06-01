## Context

`mem-sync` currently persists memories as JSONL records in `memories/**/*.jsonl` files. Every read operation requires scanning and parsing JSONL files line by line. This works for `list` and `export` commands, but cannot support the recall engine planned in the next iteration, which needs fast, relevance-ranked full-text search over hundreds or thousands of memories.

The design introduces a local SQLite database with an FTS5 full-text index as a rebuildable cache. JSONL files remain the source of truth — the index can be dropped and rebuilt at any time. This follows the architecture principle established in the overall design: "本地索引可以删除重建，不能成为唯一真相" (the local index can be deleted and rebuilt; it must not become the sole source of truth).

## Goals / Non-Goals

**Goals:**

- Introduce a SQLite dependency that supports FTS5 on Node.js 20+.
- Create `src/index-store.js` with functions to create the index schema, rebuild from JSONL files, update incrementally, and query with FTS5.
- Add `mem-sync index rebuild`, `mem-sync index status`, and `mem-sync index update` CLI commands.
- Store all schema v1 memory fields plus file origin metadata (`file_path`, `line_no`, `repo_commit`).
- Use WAL journal mode and busy timeout for concurrent-read safety.
- Keep diagnostic output on stderr, machine-readable output on stdout.
- Write tests using temporary directories and an isolated SQLite database per test.
- Include detailed Chinese comments around schema decisions, rebuild logic, and FTS5 integration points.

**Non-Goals:**

- Do not implement the recall engine in this change — only the index layer.
- Do not add embedding or vector search capabilities.
- Do not change the JSONL storage format or memory schema v1.
- Do not implement index locking for multi-process safety in this iteration — single-process usage is assumed.
- Do not implement `git diff`-based incremental update with real Git integration yet — the MVP incremental `update` command may delegate to full rebuild and note that it performed a full rebuild.
- Do not support tokenizer customization beyond FTS5 defaults.

## Decisions

### 1. Use `better-sqlite3` as the SQLite Dependency

Use `better-sqlite3` for synchronous, non-blocking SQLite access with native FTS5 support.

Rationale:

- Synchronous API simplifies the index store code — rebuild and query are inherently sequential operations that don't benefit from async I/O on a local file.
- `better-sqlite3` bundles SQLite with FTS5 enabled by default, avoiding platform-specific compilation flags.
- The synchronous model avoids callback/promise complexity in transaction management.
- Widely used in Node.js desktop and CLI tools (e.g., VS Code extensions, Electron apps).

Alternative considered: `sqlite` + `sqlite3` async wrapper. Rejected because the async API adds complexity for operations that are naturally sequential (full table scan, bulk insert, FTS rebuild). The async benefit is marginal for a local CLI tool.

Alternative considered: `sql.js` (WebAssembly SQLite). Rejected because it requires loading the entire database into memory, which doesn't scale for large memory collections.

### 2. Use External-Content FTS5 With a Content Table

Store memory records in a concrete `memories` table and use an external-content FTS5 virtual table (`memories_fts`) that references it via `content_rowid`.

Rationale:

- External-content FTS5 avoids duplicating all memory fields in the FTS index — only the indexed text columns (`content`, `summary`, `tags`) are stored in the FTS structure.
- The `memories` table can be queried directly for non-text fields (kind, scope, confidence, timestamps) without joining through FTS.
- Rebuilds and incremental updates modify the `memories` table, then trigger FTS synchronization — the two concerns are cleanly separated.

Alternative considered: content-only FTS5 (no external content table). Rejected because it would require storing all memory metadata as FTS column values, mixing full-text and structured data concerns.

Alternative considered: separate FTS index per scope or kind. Rejected as premature optimization — a single FTS5 table with the `content` column is sufficient for MVP scale.

### 3. Full Rebuild First, Incremental Update as Best-Effort Optimization

Prioritize full rebuild as the primary index construction path. Incremental update is a best-effort optimization that falls back to full rebuild on any failure.

Rationale:

- Full rebuild is simple, deterministic, and always produces a correct index.
- Incremental update requires computing a file-level diff between Git commits, which introduces Git dependency and edge cases (force pushes, rebases, detached HEAD).
- For MVP scale (hundreds to low thousands of memories), full rebuild is fast enough — likely under one second.
- The `update` command can initially delegate to `rebuild` and still satisfy the contract; proper incremental logic can be added later without changing the API.

Alternative considered: always incremental, with full rebuild as fallback. Rejected because it makes the happy path more complex and harder to test, with minimal benefit at current scale.

### 4. Index Cache Location Outside the Git Repository

Place the index database at a local cache path (e.g., `~/.memcli/cache/<repo-id>/index.sqlite` or a project-configurable path) rather than inside the memory repository.

Rationale:

- The index is a derived artifact, not source of truth — it should never be committed to the memory Git repository.
- Keeping it outside the repo avoids accidental commits and `.gitignore` complexity.
- Multiple clones of the same repo can share a single index if the cache key is the repo identifier.
- The path should be configurable so tests can use temporary directories.

Alternative considered: storing the index inside the repo at `.mem-sync/index.sqlite`. Rejected because it risks accidental commits and conflates derived artifacts with source data.

### 5. Store JSON Arrays and Objects as JSON Text Columns

Store `source`, `evidence`, `tags`, and `supersedes` as JSON text columns (`source_json`, `evidence_json`, `tags_json`, `supersedes_json`) rather than normalizing them into separate relational tables.

Rationale:

- These fields are primarily read and returned as-is by the recall engine — they don't need to be queried relationally in the MVP.
- JSON text columns preserve the exact structure from the JSONL source, avoiding lossy round-trips.
- The FTS5 index on `tags` uses a text representation, which is sufficient for tag-based search.
- If relational queries over these fields become necessary later, they can be extracted in a future schema migration.

Alternative considered: normalized `memory_tags`, `memory_evidence` junction tables. Rejected as over-engineering for the MVP, where these fields are pass-through metadata.

### 6. Keep Index Functions Pure Where Possible; Log at Boundaries

`src/index-store.js` functions should accept explicit parameters (repo directory, cache directory, logger) and avoid reading global state. Diagnostic logging should happen at the CLI command boundary, not deep inside index functions.

Rationale:

- Testable: functions can be called with temporary directories and a test logger.
- Composable: the index store can be used by future commands (recall, context, doctor) without CLI coupling.
- Follows the same pattern established in `src/schema.js` and `src/memory-store.js`.

Suggested log labels:

```text
[mem-sync:index] rebuild:start
[mem-sync:index] rebuild:progress   (periodic record count)
[mem-sync:index] rebuild:complete   (total count, duration)
[mem-sync:index] rebuild:skip       (invalid or deleted record skipped)
[mem-sync:index] update:uptodate    (index already matches HEAD)
[mem-sync:index] update:fallback    (incremental failed, falling back to rebuild)
```

### 7. Require Chinese Comments for Index Schema Decisions

Implementation code in `src/index-store.js` should include detailed Chinese comments around:

- Why each SQLite pragma is chosen (WAL, busy timeout).
- The external-content FTS5 design and its relationship to the `memories` content table.
- Rebuild loop decisions: which records are skipped and why.
- The `index_meta` table structure and its role in incremental update tracking.
- JSON column storage rationale.

Rationale:

- The index store is a persistence boundary — future maintainers need to understand the schema design before modifying it.
- Chinese comments match the project convention established in `src/schema.js` and documented in `openspec/project.md`.
- Comments should explain intent and constraints, not restate obvious SQL syntax.

## Risks / Trade-offs

- [Risk] `better-sqlite3` requires native compilation and may fail on some platforms. → Mitigation: verify installation on Node.js 20+ Linux before committing to the dependency; document platform requirements.
- [Risk] Full rebuild may become slow with very large memory collections (10k+ records). → Mitigation: the rebuild is sequential JSONL scan + bulk insert, which SQLite handles well. If performance becomes an issue, incremental update can be fully implemented.
- [Risk] FTS5 default tokenizer may not handle Chinese text segmentation optimally. → Mitigation: document the tokenizer behavior; BM25 on character-level tokens is still useful for Chinese search. If needed, the `unicode61` tokenizer or ICU tokenizer can be configured later.
- [Risk] The index database may grow large if memories are frequently updated (old rows deleted and re-inserted). → Mitigation: WAL mode auto-checkpointing handles this; a periodic `VACUUM` can be added to `index rebuild` if fragmentation becomes an issue.
- [Risk] Concurrent access to the index database from multiple `mem-sync` processes could cause `SQLITE_BUSY` errors. → Mitigation: WAL mode allows concurrent readers and one writer; busy timeout handles short-lived contention. Multi-process safety with explicit file locking can be added later.

## Migration Plan

1. Install `better-sqlite3` as a dependency.
2. Implement `src/index-store.js` with schema creation, rebuild, status, and search functions.
3. Add `src/commands/index.js` CLI command with `rebuild`, `status`, and `update` subcommands.
4. Wire the index command into `src/cli.js`.
5. Write and run focused tests in `tests/index-store.test.js` and `tests/cli-index.test.js`.
6. Update README with index command examples.

Rollback strategy: remove the `better-sqlite3` dependency, delete `src/index-store.js`, `src/commands/index.js`, and associated tests. No existing data or behavior is affected — the index is a new, isolated subsystem.

## Open Questions

- Exact cache directory path: `~/.memcli/cache/<repo-id>/index.sqlite` or a project-relative path? → Resolve during implementation based on `repo-layout.js` conventions.
- Should `index rebuild` accept a `--repo` flag or infer the repo from the current working directory? → Follow the same pattern as other `mem-sync` commands once `repo-layout.js` is implemented.

## Design Review

- The design correctly treats the SQLite index as a rebuildable cache, not source of truth, aligning with the architecture principle established in the overall design.
- Choosing `better-sqlite3` for synchronous access simplifies the code and matches the CLI use case well.
- The external-content FTS5 design avoids data duplication and keeps full-text and structured queries separated.
- The full-rebuild-first strategy is pragmatic for MVP scale and avoids premature complexity in incremental update logic.
- The JSON-column decision for arrays/objects is appropriate for MVP where these fields are pass-through metadata, but should be revisited if relational queries over tags or evidence become necessary.
- The Chinese comment requirement follows the established project convention and is justified at this persistence boundary.
