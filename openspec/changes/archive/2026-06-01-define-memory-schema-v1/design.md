## Context

`mem-sync` currently persists prototype records with only `id`, `text`, `scope`, `source`, `createdAt`, and `updatedAt`. That shape is easy to test but too small for the planned JSONL source-of-truth, Git review, local recall, context assembly, tombstone deletion, and later retention workflows.

Memory Schema v1 introduces a durable contract before JSONL migration begins. The design must keep pure schema functions deterministic and testable, while giving CLI and store integration points enough logging to diagnose record creation during early adoption.

## Goals / Non-Goals

**Goals:**

- Define a Memory Schema v1 record with stable defaults, validation rules, deterministic `id`, and deterministic `canonicalKey`.
- Centralize content normalization so every caller stores a trimmed single-line `content` value.
- Preserve compatibility with the existing `createMemoryStore().add()` flow during the transition.
- Make schema behavior understandable to future maintainers through detailed Chinese comments in implementation code.
- Emit key-node logs from command/store integration points when records are normalized, validated, rejected, or accepted.
- Keep the schema module dependency-free and covered by focused `node:test` tests.

**Non-Goals:**

- Do not migrate persistence from `.mem-sync/memories.json` to JSONL in this change.
- Do not implement `remember`, `show`, `forget`, indexing, recall, Git sync, retain, summarize, or doctor commands.
- Do not add encryption, redaction, or secret scanning yet.
- Do not introduce a third-party schema validation dependency.

## Decisions

### 1. Use a Small Hand-Written Validator

Implement `src/schema.js` with explicit exported constants and validation functions instead of adding a dependency such as Zod, Ajv, or JSON Schema.

Rationale:

- The schema is still small and can be validated with clear field-specific checks.
- Hand-written checks keep startup fast and avoid dependency churn before storage/index iterations.
- Error messages can name the invalid field directly, matching the test expectations and making CLI failures actionable.

Alternative considered: JSON Schema + Ajv. Rejected for this iteration because it adds dependency and packaging decisions before the data model has stabilized.

### 2. Treat `content` as Canonical Text, Keep Old `text` Compatibility Outside Schema

Schema v1 records use `content` as the canonical memory body. The legacy store may expose or adapt old `text` behavior temporarily, but `src/schema.js` should not produce new prototype-shaped records.

Rationale:

- `content` is clearer for memories that may include preferences, facts, decisions, warnings, and episodes.
- Avoiding dual fields inside v1 prevents future JSONL data from carrying redundant `text`/`content` values.
- Compatibility belongs in `memory-store.js` during the transition, not in the schema contract.

Alternative considered: include both `text` and `content` in every v1 record. Rejected because it creates ambiguity over which field indexing and sync should trust.

### 3. Derive `canonicalKey` From Semantic Deduplication Inputs

`canonicalKey` should be deterministic and include `kind`, `scope`, optional project/agent identity where available, and a hash of normalized `content`.

Recommended shape:

```text
<kind>:<scope>:<project-id-or-empty>:<agent-id-or-empty>:<content-hash>
```

Rationale:

- `id` can remain a compact record identifier, while `canonicalKey` explicitly documents dedupe intent.
- Later JSONL merge, conflict review, and recall indexing can group related records without parsing opaque IDs.
- Including kind and scope prevents unrelated memories with identical text from collapsing accidentally.

Alternative considered: use only a content hash. Rejected because the same sentence can mean different things across scopes or memory kinds.

### 4. Default Confidence and Veracity From Source Type

`normalizeMemoryInput()` should default manual records to `confidence: 1` and `veracity: "stated"`; non-manual records should default to `confidence: 0.5` and `veracity: "unknown"` unless explicitly provided.

Rationale:

- Manual user entries are treated as explicitly stated memory.
- Imported, inferred, or tool-originated records need a lower default confidence until verified.
- These defaults support future recall ranking without requiring every caller to supply metadata.

Alternative considered: always default to `confidence: 1`. Rejected because it overstates machine-inferred or imported memories.

### 5. Keep Pure Schema Functions Quiet; Log at Boundaries

`normalizeMemoryInput()` and `validateMemory()` should remain pure and should not print logs directly. CLI/store integration should log key nodes such as normalization start, validation success, validation failure, and persistence handoff.

Rationale:

- Pure functions stay deterministic and easy to test.
- Users still get useful observability at the command lifecycle level.
- Tests avoid brittle stdout/stderr coupling around low-level validation.

Suggested log labels:

```text
[mem-sync:schema] normalize:start
[mem-sync:schema] validate:ok
[mem-sync:schema] validate:error
[mem-sync:store] memory:accepted
```

Alternative considered: log inside every validation branch. Rejected because it makes pure validators noisy and harder to reuse in batch imports.

### 6. Require Detailed Chinese Comments for Schema Code

Implementation code should include detailed Chinese comments around non-obvious schema choices: enum purpose, default derivation, canonical key construction, timestamp normalization, lifecycle fields, and validation failures.

Rationale:

- The project documentation and user workflow are Chinese-heavy.
- Future agents and maintainers need to understand why each metadata field exists before changing persisted data.
- Comments should explain intent and constraints, not restate trivial JavaScript syntax.

Alternative considered: rely only on tests and docs. Rejected because schema code will become a high-risk persistence boundary.

## Risks / Trade-offs

- [Risk] Hand-written validation can miss edge cases as schema grows. → Mitigation: keep validation tests field-focused and revisit JSON Schema when schema complexity increases.
- [Risk] Changing `createMemoryStore().add()` output to v1 may break old CLI output expectations. → Mitigation: update tests deliberately and keep temporary compatibility aliases only where explicitly needed.
- [Risk] `canonicalKey` choices may need revision after project/agent identity design matures. → Mitigation: version records with `schemaVersion` and keep key construction centralized in `createCanonicalKey()`.
- [Risk] Logging can pollute JSON export output if emitted to stdout. → Mitigation: emit diagnostic logs to stderr or behind a debug flag; never mix logs into machine-readable stdout.
- [Risk] Detailed comments can become stale. → Mitigation: require comments only around schema decisions and update them whenever validation/default behavior changes.

## Migration Plan

1. Add failing schema tests for v1 normalization and validation.
2. Implement `src/schema.js` with constants, normalization, validation, canonical key, and content normalization.
3. Update `src/memory-store.js` so new additions are schema v1-compatible while preserving deterministic ID behavior expected by transition tests.
4. Update README/design notes only as needed to describe that Schema v1 is the next persisted shape, while JSONL migration remains future work.
5. Run focused schema tests, existing memory-store tests, and all tests.

Rollback strategy: revert `src/schema.js`, schema tests, and `memory-store.js` integration changes. Since this iteration does not migrate persisted files, rollback does not require data conversion.

## Design Review

- The design correctly puts schema validation before JSONL persistence, reducing migration risk.
- The design keeps pure schema functions side-effect-free and moves logging to integration boundaries, preventing test instability and preserving composability.
- The largest concern is compatibility with old `text`-based CLI behavior; implementation should make the transition explicit in tests rather than silently emitting mixed record shapes.
- The logging requirement is useful but must be constrained to stderr/debug paths so commands like `export` remain machine-readable.
- The Chinese comment requirement is appropriate for schema boundary code, but implementation should avoid comments for trivial syntax and focus on persistence rationale.
