## MODIFIED Requirements

### Requirement: Use GitHub Repository As Sync Backend
The system SHALL support a user-owned GitHub repository as the synchronization backend for memory files, and local Git transport helpers SHALL safely handle user-controlled file paths, commit messages, and remote URLs without shell interpolation.

#### Scenario: User syncs from another platform
- **WHEN** a platform pulls the GitHub repository and reads the memory store
- **THEN** it can access memories written by other platforms using the shared JSON format

#### Scenario: Git helper receives quoted input
- **WHEN** a Git helper stages a file path or creates a commit message containing quotes or shell-significant characters
- **THEN** the helper treats the value as a Git argument and does not let the shell reinterpret it

### Requirement: Preserve Git-Reviewable Data
The system SHALL store synchronized memories in plain, deterministic JSON suitable for Git review.

#### Scenario: User reviews memory changes on GitHub
- **WHEN** a memory is added or updated
- **THEN** the repository diff clearly shows the changed JSON record

### Requirement: Keep Remote Transport Replaceable
The system SHALL keep memory creation and merge logic independent from the GitHub transport implementation, and transport diagnostics SHALL be emitted separately from machine-readable command output.

#### Scenario: Future GitHub API sync is added
- **WHEN** the transport layer changes from shell Git commands to GitHub API calls
- **THEN** memory normalization, identifier creation, and merge behavior remain unchanged

#### Scenario: Git command logs progress
- **WHEN** a Git-backed command fetches, pulls, stages, commits, pushes, or skips a remote operation
- **THEN** key operational logs are written to stderr while stdout remains reserved for command results
