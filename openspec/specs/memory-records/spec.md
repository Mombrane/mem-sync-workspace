## Purpose

Define the canonical memory record behavior used by all local and remote synchronization flows.

## Requirements

### Requirement: Normalize Memory Text
The system SHALL normalize memory text before persistence by trimming leading and trailing whitespace and collapsing repeated whitespace to a single space.

#### Scenario: Add memory with extra whitespace
- **WHEN** a client adds a memory containing leading, trailing, or repeated whitespace
- **THEN** the stored memory text is a single trimmed line

### Requirement: Create Stable Memory Identifiers
The system SHALL create deterministic memory identifiers from normalized text, scope, and source.

#### Scenario: Same memory captured twice by same source
- **WHEN** the same normalized text, scope, and source are submitted multiple times
- **THEN** the resulting memory identifier is the same

### Requirement: Merge Memory Sets By Recency
The system SHALL merge memory sets by memory identifier and keep the record with the newest `updatedAt` timestamp.

#### Scenario: Same identifier appears in multiple stores
- **WHEN** multiple memory records share the same identifier
- **THEN** only the record with the newest `updatedAt` timestamp remains in the merged output
