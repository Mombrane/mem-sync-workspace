## 1. Schema Tests

- [x] 1.1 Add `tests/schema.test.js` coverage for v1 defaults, explicit metadata preservation, canonical keys, and validation failures.
- [x] 1.2 Run `node --test tests/schema.test.js` and confirm it fails because `src/schema.js` is not implemented yet.

## 2. Schema Module

- [x] 2.1 Create `src/schema.js` with exported enum constants, `normalizeContent`, `normalizeMemoryInput`, `validateMemory`, and `createCanonicalKey`.
- [x] 2.2 Add detailed Chinese comments explaining schema fields, defaults, canonical key construction, lifecycle metadata, and validation decisions.
- [x] 2.3 Ensure schema functions remain deterministic and do not write logs directly.
- [x] 2.4 Run `node --test tests/schema.test.js` and confirm schema tests pass.

## 3. Legacy Store Integration

- [x] 3.1 Add transition tests proving `createMemoryStore().add()` creates schema v1-compatible records while keeping stable identifiers for equivalent inputs.
- [x] 3.2 Update `src/memory-store.js` to call schema normalization/validation for new records.
- [x] 3.3 Add key-node diagnostic logging at store or CLI boundaries for normalization start, validation success, validation failure, and memory acceptance without writing diagnostics to JSON stdout.
- [x] 3.4 Run `node --test tests/memory-store.test.js` and confirm existing and transition tests pass.

## 4. Documentation And Review

- [x] 4.1 Update user/project design documentation to describe Memory Schema v1 as the canonical future persisted shape and clarify JSONL migration remains a later iteration.
- [x] 4.2 Review the implementation against `openspec/changes/define-memory-schema-v1/design.md`, especially logging isolation, old/new field compatibility, and Chinese comment quality.
- [x] 4.3 Run `npm test` and confirm all tests pass.
