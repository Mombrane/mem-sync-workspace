## 1. Choose And Install SQLite Dependency

- [ ] 1.1 Evaluate `better-sqlite3` on Node.js 20+: confirm native build succeeds and FTS5 is enabled.
- [ ] 1.2 Install `better-sqlite3` as a runtime dependency (`npm install better-sqlite3`).
- [ ] 1.3 Smoke-test FTS5: run a small Node script that creates `CREATE VIRTUAL TABLE t USING fts5(content);` and confirms no SQLite error.
- [ ] 1.4 Document the dependency choice rationale in `design.md` Decisions section if not already there.

## 2. Index Store Tests

- [ ] 2.1 Create `tests/index-store.test.js` with test coverage for:
  - `createIndexDatabase(cacheDir)` creates a new SQLite database with correct tables.
  - `rebuildIndex(repoDir, cacheDir)` indexes all valid JSONL memories.
  - Rebuild skips records with non-null `deletedAt`.
  - Rebuild skips records with `validUntil` in the past.
  - Rebuild skips JSONL lines that fail to parse (invalid JSON, schema validation failure).
  - Rebuild stores `repo_head` in `index_meta` on success.
  - `getIndexStatus(cacheDir)` returns `recordCount`, `repoHead`, and `dbPath` for a built index.
  - `getIndexStatus(cacheDir)` reports no index when database does not exist.
  - `searchIndex(cacheDir, query, limit)` returns BM25-ranked results for matching content.
  - `searchIndex(cacheDir, query, limit)` returns empty array when index is empty.
  - `searchIndex(cacheDir, query, limit)` respects the limit parameter.
  - `updateIndex(repoDir, cacheDir)` skips when repo HEAD matches stored `repo_head`.
  - `updateIndex(repoDir, cacheDir)` falls back to full rebuild when no `repo_head` exists.
- [ ] 2.2 Each test uses a temporary directory for the cache database and a temporary JSONL repo directory with controlled test data.
- [ ] 2.3 Run `node --test tests/index-store.test.js` and confirm all tests fail (red phase) before implementation.

## 3. Index Store Implementation

- [ ] 3.1 Create `src/index-store.js` with exported functions:
  - `createIndexDatabase(cacheDir)` — creates or opens the SQLite database, sets WAL and busy timeout pragmas, creates `memories`, `memories_fts`, and `index_meta` tables if they don't exist.
  - `rebuildIndex(repoDir, cacheDir, { logger })` — scans `memories/**/*.jsonl` for JSONL records, validates each record, inserts valid/non-deleted/non-expired records into `memories`, populates FTS, writes `repo_head` to `index_meta`, returns `{ recordCount }`.
  - `getIndexStatus(cacheDir)` — returns `{ recordCount, repoHead, dbPath, exists }`.
  - `searchIndex(cacheDir, query, { limit = 20 })` — performs FTS5 MATCH query with BM25 ordering, returns matching memory records.
  - `updateIndex(repoDir, cacheDir, { logger })` — checks `index_meta.repo_head` against current HEAD; if matching, skips; otherwise falls back to `rebuildIndex`.
- [ ] 3.2 Add detailed Chinese comments explaining:
  - WAL mode and busy timeout rationale.
  - External-content FTS5 design and `content_rowid` linkage.
  - Rebuild loop: which records are skipped and why.
  - `index_meta` table purpose and `repo_head` tracking.
  - JSON column storage (`source_json`, `evidence_json`, `tags_json`, `supersedes_json`).
- [ ] 3.3 Ensure index functions are pure: they accept explicit paths and an optional logger, do not read global state, and do not write to stdout directly.
- [ ] 3.4 Run `node --test tests/index-store.test.js` and confirm all tests pass.

## 4. Index CLI Command

- [ ] 4.1 Create `src/commands/index.js` with subcommands:
  - `index rebuild` — calls `rebuildIndex`, prints record count to stderr as progress, writes JSON `{ indexed: N }` to stdout on success.
  - `index status` — calls `getIndexStatus`, supports `--format json` for machine-readable output.
  - `index update` — calls `updateIndex`, reports whether index was already up to date or a rebuild was performed.
- [ ] 4.2 Wire the `index` command into `src/cli.js` with subcommand routing.
- [ ] 4.3 Ensure diagnostic output (progress, warnings, errors) goes to stderr; JSON output goes to stdout.

## 5. Index CLI Tests

- [ ] 5.1 Create `tests/cli-index.test.js` with test coverage for:
  - `mem-sync index rebuild` prints indexed record count.
  - `mem-sync index status --format json` prints valid JSON with `recordCount`, `repoHead`, `dbPath`.
  - `mem-sync index status` (no format flag) prints human-readable status.
  - `mem-sync index update` skips when index is already up to date.
  - `mem-sync index update` rebuilds when no prior index exists.
- [ ] 5.2 Each test sets up a temporary repository with JSONL test data and a temporary cache directory.
- [ ] 5.3 Run `node --test tests/cli-index.test.js` and confirm tests pass both in isolation and together with existing tests.

## 6. Integration And Documentation

- [ ] 6.1 Run `npm test` and confirm all existing tests pass alongside new index tests.
- [ ] 6.2 Update `README.md` with `mem-sync index` usage examples (rebuild, status, update).
- [ ] 6.3 Review the implementation against `openspec/changes/sqlite-fts-index/design.md`, especially:
  - FTS5 external-content schema correctness.
  - Chinese comment quality and coverage.
  - Diagnostic output isolation (stderr vs stdout).
  - Test isolation with temporary directories.
