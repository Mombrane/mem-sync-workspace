## Why

The current prototype stores a minimal memory shape that is sufficient for `add/list/export`, but it is not durable enough for JSONL source-of-truth storage, Git review, recall indexing, lifecycle operations, or cross-client validation. Memory Schema v1 is needed now because later JSONL, FTS, Git sync, and context features should depend on a stable record contract instead of retrofitting fields after data is persisted.

## What Changes

- Introduce Memory Schema v1 as the canonical persisted memory record shape.
- Add normalization for input content, default values, timestamps, arrays, nullable lifecycle fields, and deterministic identity fields.
- Add validation that rejects unknown enum values, malformed required fields, invalid ranges, invalid timestamps, and non-array collection fields.
- Add a canonical key derived from schema-relevant fields for dedupe and future merge/index workflows.
- Keep the legacy memory store compatible during the transition by creating schema v1 records while preserving existing deterministic behavior where required by tests.
- Require detailed Chinese code comments around schema decisions and validation branches so later contributors can understand why each field exists.
- Require key-node log output for schema normalization/validation integration points without making pure validation functions noisy by default.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `memory-records`: Upgrade the canonical memory record behavior from minimal prototype records to Memory Schema v1 records with normalization, validation, deterministic canonical keys, lifecycle metadata, and schema-aware identifiers.

## Impact

- Affected code: `src/schema.js`, `src/memory-store.js`, and focused tests in `tests/schema.test.js` and `tests/memory-store.test.js`.
- Affected behavior: new records include `schemaVersion`, `content`, `summary`, `kind`, `source`, `evidence`, `confidence`, `veracity`, `importance`, `canonicalKey`, lifecycle fields, and tag/supersession arrays.
- Affected docs: OpenSpec `memory-records` requirements and the implementation design for the memory schema must be updated.
- Dependencies: no new runtime dependency is expected for Iteration 1.1.
