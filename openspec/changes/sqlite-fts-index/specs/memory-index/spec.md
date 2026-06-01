## Purpose

Define how `mem-sync` creates, maintains, and queries a local SQLite/FTS5 index over JSONL memory records. The index is a rebuildable cache — the JSONL files remain the source of truth.

## ADDED Requirements

### Requirement: Create Local SQLite Index Database

The system SHALL create a local SQLite database for memory indexing at a configurable cache path outside the Git repository.

#### Scenario: First index creation

- **WHEN** the system rebuilds the index for the first time
- **THEN** a new SQLite database file is created at the configured cache path
- **AND** the database uses WAL journal mode and a busy timeout of at least 5 seconds
- **AND** the database contains `memories`, `memories_fts`, and `index_meta` tables

#### Scenario: Index database schema matches v1 memory records

- **WHEN** the index tables are created
- **THEN** the `memories` table stores all schema v1 record fields (`id`, `kind`, `scope`, `project_id`, `agent_id`, `content`, `summary`, `source_json`, `evidence_json`, `confidence`, `importance`, `veracity`, `tags_json`, `created_at`, `updated_at`, `valid_until`, `deleted_at`, `supersedes_json`)
- **AND** the `memories` table stores file origin fields (`file_path`, `line_no`, `repo_commit`)
- **AND** the `memories_fts` virtual table indexes `content`, `summary`, and `tags` columns using FTS5 with external content from the `memories` table

### Requirement: Rebuild Index From Source-Of-Truth JSONL Files

The system SHALL support full index rebuild by scanning all JSONL memory files and inserting valid, non-deleted, non-expired records into the index.

#### Scenario: Rebuild indexes all valid memories

- **WHEN** the rebuild command runs against a repository containing valid JSONL memory records
- **THEN** each valid memory record is inserted into the `memories` table with its `file_path` and `line_no`
- **AND** the `memories_fts` virtual table is synchronized with the inserted content
- **AND** the rebuild reports the total number of indexed records

#### Scenario: Rebuild skips deleted and expired records

- **WHEN** a JSONL record has a non-null `deletedAt` field or a `validUntil` timestamp in the past
- **THEN** that record is excluded from the index

#### Scenario: Rebuild skips invalid records

- **WHEN** a JSONL line fails schema validation or cannot be parsed as JSON
- **THEN** that line is skipped with a warning diagnostic
- **AND** the rebuild continues processing remaining lines

#### Scenario: Rebuild stores repository commit reference

- **WHEN** the rebuild completes successfully
- **THEN** the `index_meta` table records the current repository HEAD commit under the key `repo_head`

### Requirement: Incremental Index Update

The system SHALL support incremental index update by detecting changed files since the last indexed commit and updating only affected records.

#### Scenario: Skip update when repository HEAD is unchanged

- **WHEN** the index update command runs and the current repository HEAD matches the stored `repo_head` in `index_meta`
- **THEN** no index modifications are performed
- **AND** the command reports that the index is up to date

#### Scenario: Update only changed files

- **WHEN** the repository HEAD has changed since the last index
- **AND** file-level diff can be computed between the old and new HEAD
- **THEN** only records from changed or added JSONL files are re-indexed
- **AND** records from unchanged files are preserved

#### Scenario: Fall back to full rebuild on diff failure

- **WHEN** the incremental update cannot compute a diff (e.g., index is missing `repo_head`, or the old commit is unreachable)
- **THEN** the system falls back to a full rebuild
- **AND** the command reports that a full rebuild was performed

### Requirement: Full-Text Search Over Indexed Memories

The system SHALL support BM25-ranked full-text search over indexed memory content, summaries, and tags using SQLite FTS5.

#### Scenario: Search finds matching content

- **WHEN** a query string is submitted for full-text search
- **THEN** the system returns memory records whose `content`, `summary`, or `tags` match the query
- **AND** results are ordered by BM25 relevance rank

#### Scenario: Search respects result limits

- **WHEN** a query is submitted with a limit parameter
- **THEN** the system returns at most that many results

#### Scenario: Empty index returns no results

- **WHEN** a query is submitted and no index has been built
- **THEN** the system returns an empty result set

### Requirement: Index Status Reporting

The system SHALL report the current state of the local index, including record count, indexed commit, and database location.

#### Scenario: Report status of populated index

- **WHEN** the index status command runs against a built index
- **THEN** the output includes the total indexed record count, the `repo_head` commit, and the database file path

#### Scenario: Report status when no index exists

- **WHEN** the index status command runs but no index database file exists
- **THEN** the output indicates that no index has been built yet

### Requirement: Diagnostic Output Separate From Machine-Readable Output

The system SHALL keep index operation diagnostics separate from machine-readable command output.

#### Scenario: Status command with JSON output

- **WHEN** the index status command is invoked with `--format json`
- **THEN** valid JSON is written to stdout
- **AND** diagnostic messages (rebuild progress, warnings, errors) are written to stderr

#### Scenario: Rebuild progress logged to stderr

- **WHEN** the rebuild command processes records
- **THEN** progress diagnostics are written to stderr only
