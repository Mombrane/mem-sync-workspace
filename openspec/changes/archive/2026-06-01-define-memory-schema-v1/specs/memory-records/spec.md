## MODIFIED Requirements

### Requirement: Normalize Memory Text
The system SHALL normalize memory content before persistence by trimming leading and trailing whitespace and collapsing repeated whitespace to a single space.

#### Scenario: Add memory with extra whitespace
- **WHEN** a client adds a memory containing leading, trailing, or repeated whitespace
- **THEN** the stored memory content is a single trimmed line

### Requirement: Create Stable Memory Identifiers
The system SHALL create deterministic memory identifiers from normalized content and schema-relevant canonical fields.

#### Scenario: Same memory captured twice with same canonical fields
- **WHEN** the same normalized content, kind, scope, source, project identity, and agent identity are submitted multiple times
- **THEN** the resulting memory identifier is the same

### Requirement: Merge Memory Sets By Recency
The system SHALL merge memory sets by memory identifier and keep the record with the newest `updatedAt` timestamp.

#### Scenario: Same identifier appears in multiple stores
- **WHEN** multiple memory records share the same identifier
- **THEN** only the record with the newest `updatedAt` timestamp remains in the merged output

## ADDED Requirements

### Requirement: Create Memory Schema V1 Records
The system SHALL normalize memory input into a Memory Schema v1 record containing `schemaVersion`, `id`, `canonicalKey`, `kind`, `scope`, `content`, `summary`, `source`, `evidence`, `confidence`, `veracity`, `importance`, `createdAt`, `updatedAt`, `validUntil`, `deletedAt`, `supersedes`, and `tags`.

#### Scenario: Create record from minimal input
- **WHEN** a client normalizes memory input with only content and a timestamp
- **THEN** the resulting record has `schemaVersion` set to `1`, default kind `episode`, default scope `global`, default source `{ type: "manual" }`, empty array fields, nullable lifecycle fields set to `null`, and ISO `createdAt` and `updatedAt` timestamps

#### Scenario: Create record from explicit metadata
- **WHEN** a client supplies kind, scope, source, evidence, confidence, veracity, importance, supersedes, tags, and lifecycle metadata
- **THEN** the resulting record preserves valid explicit metadata and normalizes textual content fields

### Requirement: Validate Memory Schema V1 Records
The system SHALL validate Memory Schema v1 records before they are accepted for persistence.

#### Scenario: Reject unknown memory kind
- **WHEN** a memory record contains a `kind` value outside the supported kind list
- **THEN** validation fails with an error that identifies the `kind` field

#### Scenario: Reject invalid confidence range
- **WHEN** a memory record contains `confidence` below `0` or above `1`
- **THEN** validation fails with an error that identifies the `confidence` field

#### Scenario: Reject malformed collection fields
- **WHEN** a memory record contains non-array `evidence`, `supersedes`, or `tags`
- **THEN** validation fails with an error that identifies the malformed field

### Requirement: Create Canonical Memory Keys
The system SHALL create deterministic canonical keys from memory kind, scope, optional project identity, optional agent identity, and normalized content hash.

#### Scenario: Same canonical fields create same key
- **WHEN** two records contain the same kind, scope, project identity, agent identity, and normalized content
- **THEN** their canonical keys are identical

#### Scenario: Different scope creates different key
- **WHEN** two records contain the same normalized content but different scopes
- **THEN** their canonical keys are different

### Requirement: Preserve Machine-Readable Output With Diagnostics
The system SHALL keep schema normalization and validation diagnostics separate from machine-readable command output.

#### Scenario: Export records after schema validation logs
- **WHEN** a command emits key-node diagnostics while producing JSON output
- **THEN** diagnostic logs are not written into the JSON output stream
