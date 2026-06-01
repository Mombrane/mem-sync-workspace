## Purpose

Define how `mem-sync` uses a user-owned GitHub repository as a portable memory synchronization backend.

## Requirements

### Requirement: Use GitHub Repository As Sync Backend
The system SHALL support a user-owned GitHub repository as the synchronization backend for memory files.

#### Scenario: User syncs from another platform
- **WHEN** a platform pulls the GitHub repository and reads the memory store
- **THEN** it can access memories written by other platforms using the shared JSON format

### Requirement: Preserve Git-Reviewable Data
The system SHALL store synchronized memories in plain, deterministic JSON suitable for Git review.

#### Scenario: User reviews memory changes on GitHub
- **WHEN** a memory is added or updated
- **THEN** the repository diff clearly shows the changed JSON record

### Requirement: Keep Remote Transport Replaceable
The system SHALL keep memory creation and merge logic independent from the GitHub transport implementation.

#### Scenario: Future GitHub API sync is added
- **WHEN** the transport layer changes from shell Git commands to GitHub API calls
- **THEN** memory normalization, identifier creation, and merge behavior remain unchanged
