## ADDED Requirements

### Requirement: Reconcile External Test Gaps Through Public Behavior
The system SHALL accept test-gap suggestions only when they cover public behavior, command behavior, or regression risks not already covered by the existing suite.

#### Scenario: Reject private helper-only coverage
- **WHEN** a test-gap suggestion requires exporting a private helper solely for direct testing
- **THEN** the change keeps the helper private and covers the behavior through an existing public API instead

#### Scenario: Add non-duplicative command coverage
- **WHEN** a command engine is already covered but its parser or command output is not covered
- **THEN** the change adds parser and representative command-output tests without duplicating all engine scenarios

### Requirement: Verify Test Gap Reconciliation Before Functional Completion Work
The system SHALL run focused test-gap reconciliation checks before continuing the June 2 functional completion tasks.

#### Scenario: Focused tests pass
- **WHEN** the reconciled test files are added or expanded
- **THEN** each affected test file can be run directly with `node --test` and produces deterministic local results

#### Scenario: Full suite remains healthy
- **WHEN** all paired implementation fixes for reconciliation tests are complete
- **THEN** `npm test` passes without skipped or todo tests

### Requirement: Preserve Machine-Readable Output During Test-Driven Changes
The system SHALL keep command results on stdout and operational diagnostics on stderr when adding or changing command behavior.

#### Scenario: Command emits diagnostics and JSON result
- **WHEN** a command needs to report operational progress while returning JSON
- **THEN** progress and key diagnostic logs are written to stderr and the JSON result remains parseable from stdout

### Requirement: Document Non-Obvious Safety Decisions
The implementation SHALL include concise comments for non-obvious safety, compatibility, or diagnostic boundaries introduced by this change.

#### Scenario: Git command execution avoids shell interpolation
- **WHEN** Git wrapper code uses argument-array process execution for user-controlled values
- **THEN** a nearby comment explains that the form avoids shell interpolation for paths, commit messages, and remote URLs
