## Purpose

Define the `mem-sync recall` CLI command: query the local SQLite/FTS5 index for relevance-ranked memories with structured filters and format output for human reading, machine consumption, or agent prompt injection.

## ADDED Requirements

### Requirement: Search Indexed Memories With Full-Text Query

The system SHALL accept a query string and return BM25-ranked results from the local FTS5 index.

#### Scenario: Recall returns matching results in markdown format

- **WHEN** the user runs `mem-sync recall "python"`
- **AND** indexed memories exist that match "python"
- **THEN** results are displayed in human-readable markdown with BM25 scores, IDs, metadata, and blockquoted content
- **AND** results are ordered by relevance (lowest BM25 rank first)
- **AND** each result is separated by `---`

#### Scenario: Recall with no matching results

- **WHEN** the user runs `mem-sync recall "nonexistent query"`
- **AND** no indexed memories match the query
- **THEN** the output is `# Recall: "nonexistent query" — 0 results\n\nNo matching memories found.`
- **AND** exit code is 0

#### Scenario: Recall when no index exists

- **WHEN** the user runs `mem-sync recall "any query"`
- **AND** no index database file exists
- **THEN** in markdown format: `# Recall: "any query"\n\nIndex not built. Run \`mem-sync index rebuild\` first.`
- **AND** exit code is 0

### Requirement: Support Three Output Formats

The system SHALL support `--format markdown` (default), `--format json`, and `--format memories` for the recall output, each with distinct formatting rules.

#### Scenario: JSON output format

- **WHEN** the user runs `mem-sync recall "python" --format json`
- **THEN** valid JSON is written to stdout with structure `{ query: "python", count: N, results: [{ rank: ..., memory: {...} }] }`
- **AND** each memory object is the full schema v1 record

#### Scenario: Memories output format for agent injection

- **WHEN** the user runs `mem-sync recall "python" --format memories`
- **THEN** each result is wrapped in `[MEMORY id=... rank=... ...]...[/MEMORY]` blocks
- **AND** rank is normalized to 0–1 range (1 = best match)
- **AND** content containing `[/MEMORY]` is escaped as `[\/MEMORY]`

#### Scenario: Memories format with no results produces empty output

- **WHEN** the user runs `mem-sync recall "nonexistent" --format memories`
- **THEN** nothing is written to stdout (empty string)

#### Scenario: Invalid format rejected

- **WHEN** the user runs `mem-sync recall "query" --format invalid`
- **THEN** exit code is 1
- **AND** stderr indicates the format must be one of "markdown", "json", "memories"

### Requirement: Apply Structured Filters to Search Results

The system SHALL narrow search results by structured metadata filters when specified.

#### Scenario: Filter by scope

- **WHEN** the user runs `mem-sync recall "query" --scope user`
- **THEN** only records with `scope: "user"` are returned

#### Scenario: Filter by kind

- **WHEN** the user runs `mem-sync recall "query" --kind preference`
- **THEN** only records with `kind: "preference"` are returned

#### Scenario: Filter by tags (ALL required)

- **WHEN** the user runs `mem-sync recall "query" --tag python --tag testing`
- **THEN** only records that have BOTH "python" AND "testing" tags are returned

#### Scenario: Filter by minimum confidence

- **WHEN** the user runs `mem-sync recall "query" --min-confidence 0.8`
- **THEN** only records with `confidence >= 0.8` are returned

#### Scenario: Filter by minimum importance

- **WHEN** the user runs `mem-sync recall "query" --min-importance 0.7`
- **THEN** only records with `importance >= 0.7` are returned

#### Scenario: Filter by project

- **WHEN** the user runs `mem-sync recall "query" --project-id myproj`
- **THEN** only records with `project_id: "myproj"` are returned

### Requirement: Respect Result Limit

The system SHALL cap the number of returned results per the `--limit` flag.

#### Scenario: Custom limit

- **WHEN** the user runs `mem-sync recall "query" --limit 3`
- **AND** more than 3 results exist
- **THEN** exactly 3 results are returned

#### Scenario: Default limit

- **WHEN** the user runs `mem-sync recall "query"` without `--limit`
- **THEN** at most 20 results are returned (matching `searchIndex` default)

### Requirement: Include or Exclude Soft-Deleted and Expired Records

The system SHALL exclude soft-deleted (`deletedAt != null`) and expired (`validUntil` in the past) records by default, with opt-in flags to include them.

#### Scenario: Include deleted records

- **WHEN** the user runs `mem-sync recall "query" --include-deleted`
- **THEN** results may include records with non-null `deletedAt`

#### Scenario: Include expired records

- **WHEN** the user runs `mem-sync recall "query" --include-expired`
- **THEN** results may include records with `validUntil` in the past

### Requirement: Validate Recall Arguments

The system SHALL validate all recall flag values and reject invalid input with clear error messages and exit code 1.

#### Scenario: Reject missing query

- **WHEN** the user runs `mem-sync recall` with no positional arguments
- **THEN** exit code is 1
- **AND** stderr contains "query is required"
