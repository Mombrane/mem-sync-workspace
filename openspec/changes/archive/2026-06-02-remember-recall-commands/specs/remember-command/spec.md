## Purpose

Define the `mem-sync remember` CLI command: accept user/agent memory input with structured metadata, validate against schema v1, and persist to JSONL.

## ADDED Requirements

### Requirement: Accept Memory Content With Structured Metadata

The system SHALL accept memory content from positional CLI arguments along with typed flag options and persist a validated schema v1 record to JSONL.

#### Scenario: Remember with defaults

- **WHEN** the user runs `mem-sync remember "hello world"`
- **THEN** a schema v1 memory record is created with kind=episode, scope=global, source_type=manual
- **AND** the record is appended to `memories.jsonl`
- **AND** the memory ID (e.g., `mem_a1b2c3d4e5f6`) is written to stdout

#### Scenario: Remember with explicit kind and scope

- **WHEN** the user runs `mem-sync remember "hello" --kind preference --scope user`
- **THEN** the created record has `kind: "preference"` and `scope: "user"`

#### Scenario: Remember with repeatable tags

- **WHEN** the user runs `mem-sync remember "note" --tag python --tag testing`
- **THEN** the created record has `tags: ["python", "testing"]`

#### Scenario: Remember with numeric confidence and importance

- **WHEN** the user runs `mem-sync remember "fact" --confidence 0.8 --importance 0.9`
- **THEN** the created record has `confidence: 0.8` and `importance: 0.9`

#### Scenario: Remember with project and agent identifiers

- **WHEN** the user runs `mem-sync remember "task" --project-id myproj --agent-id claude`
- **THEN** the created record has `project_id: "myproj"` and `agent_id: "claude"`

#### Scenario: Remember with source metadata

- **WHEN** the user runs `mem-sync remember "note" --source-type agent --source-agent codex`
- **THEN** the created record has `source: { type: "agent", agent: "codex" }`

#### Scenario: Remember with expiration timestamp

- **WHEN** the user runs `mem-sync remember "temp" --valid-until 2027-01-01T00:00:00.000Z`
- **THEN** the created record has `valid_until` set to that ISO timestamp

#### Scenario: Remember with custom summary

- **WHEN** the user runs `mem-sync remember "long text..." --summary "custom summary"`
- **THEN** the created record has `summary: "custom summary"` instead of auto-generated summary

#### Scenario: Remember with supersedes

- **WHEN** the user runs `mem-sync remember "update" --supersedes mem_abc --supersedes mem_def`
- **THEN** the created record has `supersedes: ["mem_abc", "mem_def"]`

#### Scenario: Content is normalized

- **WHEN** the user runs `mem-sync remember "  hello   world  "`
- **THEN** the stored content is "hello world" (whitespace normalized)

### Requirement: Validate and Reject Invalid Input

The system SHALL validate all flag values against schema v1 constraints and reject invalid input with a clear error message and exit code 1.

#### Scenario: Reject empty content

- **WHEN** the user runs `mem-sync remember ""`
- **THEN** exit code is 1
- **AND** stderr contains "content cannot be empty"

#### Scenario: Reject invalid kind

- **WHEN** the user runs `mem-sync remember "text" --kind invalid_kind`
- **THEN** exit code is 1
- **AND** stderr indicates the value must be one of the valid kind enum values

#### Scenario: Reject out-of-range confidence

- **WHEN** the user runs `mem-sync remember "text" --confidence 1.5`
- **THEN** exit code is 1
- **AND** stderr indicates the value must be between 0 and 1

#### Scenario: Reject non-numeric confidence

- **WHEN** the user runs `mem-sync remember "text" --confidence notanumber`
- **THEN** exit code is 1
- **AND** stderr indicates a parse error

#### Scenario: Reject unknown flags

- **WHEN** the user runs `mem-sync remember "text" --unknown-flag value`
- **THEN** exit code is 1
- **AND** stderr contains "unknown option"

### Requirement: Keep Diagnostic Output Separate From Stdout

The system SHALL write schema diagnostics (normalize/validate messages) to stderr and write only the memory ID to stdout.

#### Scenario: Schema diagnostics go to stderr

- **WHEN** a memory is successfully remembered
- **THEN** stderr contains `[mem-sync:schema]` diagnostic lines
- **AND** stdout contains only the memory ID

### Requirement: Remembered Records Appear in JSONL

The system SHALL persist remembered records to the JSONL file so they survive process exit and are available for index rebuild.

#### Scenario: Record appears in JSONL

- **WHEN** a memory is successfully remembered
- **THEN** the `memories.jsonl` file contains the complete schema v1 record as a JSON line
- **AND** the record is valid per `validateMemory()` from `schema.js`
