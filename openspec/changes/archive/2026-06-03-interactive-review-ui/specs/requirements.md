# Requirements: Interactive Review UI

## Functional Requirements

### FR-1: review approve <id>
- Given a pending record with matching `<id>`
- When the user runs `review approve <id> [--repo <path>]`
- Then the record is removed from pending and appended to `memories.jsonl`
- Output: JSON `{"approved": "<id>"}`

### FR-2: review approve --all
- When the user runs `review approve --all [--repo <path>]`
- Then ALL pending records are moved to `memories.jsonl`
- Pending files are cleared (empty files preserved)
- Output: JSON `{"approved": [...ids], "count": N}`
- Uses lock protection during write phase

### FR-3: review reject <id>
- Given a pending record with matching `<id>`
- When the user runs `review reject <id> [--repo <path>]`
- Then the record is removed from pending (NOT added to memory store)
- Output: JSON `{"rejected": "<id>"}`

### FR-4: review reject --all
- When the user runs `review reject --all [--repo <path>]`
- Then ALL pending records are removed
- Output: JSON `{"rejected": [...ids], "count": N}`

### FR-5: Error handling
- Approve/reject with non-existent ID: error message, exit code 1
- Approve when ID already exists in memories.jsonl: skip with warning
- Empty pending directory: "No pending records found." message

### FR-6: Schema normalization
- Pending records are normalized via `normalizeMemoryInput()` before storing
- Existing `id` is preserved
- `canonicalKey` is recomputed by normalizer

## Non-Functional Requirements

### NFR-1: Two-phase safety
- Append to memories.jsonl BEFORE removing from pending
- If append succeeds but removal fails: record exists in both places (harmless, canonicalKey dedup)

### NFR-2: Lock protection
- `--all` operations use `acquireLock`/`releaseLock` during write phase
- Single-record operations: no lock needed (O(1), fast)

### NFR-3: Backward compatibility
- `review pending` behavior unchanged
- Existing tests continue to pass
