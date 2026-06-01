## Purpose

Define the `mem-sync context` CLI command: generate a session-startup context block by reading user profile, global summary, project summary, and optionally querying recent working memories from the FTS5 index.

## ADDED Requirements

### Requirement: Context Command Interface

The system SHALL provide a `mem-sync context` command with the following interface:

```
mem-sync context [--project <path>] [--project-id <id>] [--mode startup|recall] [--format markdown|json|memories] [--limit N]
```

Defaults: `--mode startup`, `--format markdown`, `--limit 5`.

#### Scenario: Default invocation

- **WHEN** the user runs `mem-sync context` with no arguments
- **THEN** the command reads `profile.md`, `summary.md`, and the project summary for the auto-derived project ID
- **AND** output is formatted as markdown
- **AND** no index query is performed (startup mode)

#### Scenario: Startup mode with explicit project-id

- **WHEN** the user runs `mem-sync context --project-id my-project --mode startup`
- **THEN** the provided `--project-id` is used instead of auto-deriving from the working directory
- **AND** the project summary is read from `projects/my-project/summary.md`

#### Scenario: Recall mode includes working memories

- **WHEN** the user runs `mem-sync context --mode recall --limit 10`
- **THEN** the command reads all summary files (same as startup mode)
- **AND** additionally queries the FTS5 index for recent working memories (scope=project or projectId matches)
- **AND** results are sorted by importance + recency, limited to 10

#### Scenario: JSON format output

- **WHEN** the user runs `mem-sync context --format json`
- **THEN** stdout contains a single JSON object with keys: `profile`, `summary`, `projectSummary`, `memories` (memories only in recall mode)
- **AND** each key is `null` if the corresponding source was not found

#### Scenario: Memories format output

- **WHEN** the user runs `mem-sync context --format memories`
- **THEN** output uses `[MEMORY]...[/MEMORY]` blocks consistent with `recall --format memories`
- **AND** summary file content is wrapped in memory blocks with kind=summary

#### Scenario: Index not built in recall mode

- **WHEN** the user runs `mem-sync context --mode recall` and the FTS5 index does not exist
- **THEN** the command degrades gracefully to file-only mode
- **AND** a warning is written to stderr
- **AND** the `memories` field in JSON output is `null`

### Requirement: Project ID Derivation

The system SHALL derive a stable, cross-device project ID from the working directory using a layered fallback strategy.

#### Scenario: Explicit --project-id takes precedence

- **WHEN** `--project-id` is provided
- **THEN** the value is used directly without any derivation
- **AND** it is validated as a non-empty string

#### Scenario: Git remote URL hash

- **WHEN** `--project-id` is not provided and the working directory has a Git remote origin
- **THEN** the project ID is the SHA256 hash of the remote URL, truncated to 12 hex characters
- **AND** this ensures the same repo produces the same project ID across devices

#### Scenario: package.json name fallback

- **WHEN** `--project-id` is not provided, no Git remote is configured, and `package.json` exists with a `name` field
- **THEN** the project ID is the `name` field from `package.json`

#### Scenario: Directory basename fallback

- **WHEN** `--project-id` is not provided, no Git remote is configured, and no `package.json` with `name` exists
- **THEN** the project ID is the basename of the working directory

#### Scenario: --project path overrides working directory

- **WHEN** `--project <path>` is provided
- **THEN** the specified path is used as the working directory for project ID derivation
- **AND** `--project` and `--project-id` can be used together (explicit ID takes precedence)

### Requirement: Summary File Reading

The system SHALL read three markdown summary files from the `.mem-sync` directory, handling missing files gracefully.

#### Scenario: Read profile.md

- **WHEN** the context command runs
- **THEN** it reads `<mem-sync-home>/profile.md`
- **AND** if the file does not exist, the profile content is `null`

#### Scenario: Read summary.md

- **WHEN** the context command runs
- **THEN** it reads `<mem-sync-home>/summary.md`
- **AND** if the file does not exist, the summary content is `null`

#### Scenario: Read project summary

- **WHEN** the context command runs with a resolved project ID
- **THEN** it reads `<mem-sync-home>/projects/<project-id>/summary.md`
- **AND** if the file or directory does not exist, the project summary content is `null`

#### Scenario: All files missing

- **WHEN** none of the three summary files exist
- **THEN** the command still succeeds (exit code 0)
- **AND** output reflects that no context is available (markdown: informational message; JSON: all fields null)

### Requirement: Working Memory Recall for Context

The system SHALL query the FTS5 index for recent working memories when mode is `recall`, using the resolved project ID for scoping.

#### Scenario: Query working memories by project

- **WHEN** mode is `recall`
- **THEN** the command calls `searchIndex()` with `scope: 'project'` and `projectId: <resolved>`
- **AND** results are sorted by importance descending, then recency descending
- **AND** the top N results (default 5) are included in output

#### Scenario: Limit applied

- **WHEN** `--limit 3` is provided in recall mode
- **THEN** at most 3 working memories are returned

#### Scenario: No matching working memories

- **WHEN** recall mode finds no matching memories for the project
- **THEN** the memories section is empty (markdown: no memory entries; JSON: empty array; memories: no blocks)
- **AND** summary file content is still included

### Requirement: Markdown Output Format

The system SHALL produce human-readable markdown output consistent with the styling of `recall` command output.

#### Scenario: Markdown output structure

- **WHEN** format is `markdown` (default)
- **THEN** output includes sections for profile, global summary, project summary, and memories (recall mode only)
- **AND** each section has a level-1 or level-2 heading
- **AND** file content is rendered as block quotes
- **AND** missing sections are noted with an informational message

#### Scenario: Markdown output in startup mode

- **WHEN** mode is `startup` and format is `markdown`
- **THEN** output contains sections for profile, summary, and project summary only
- **AND** no index query is performed
- **AND** no memories section appears

### Requirement: Command Registration via cli.js

The system SHALL register `context` as a top-level command in `src/cli.js` following the existing command routing pattern.

#### Scenario: context command routing

- **WHEN** the user runs `mem-sync context`
- **THEN** `cli.js` routes to `contextCommand(args)` from `src/commands/context.js`
- **AND** the existing command routing structure (`if/else if` on command name) is preserved

#### Scenario: Help text includes context

- **WHEN** the user runs `mem-sync` with no command or `mem-sync --help`
- **THEN** the help output includes `mem-sync context`
