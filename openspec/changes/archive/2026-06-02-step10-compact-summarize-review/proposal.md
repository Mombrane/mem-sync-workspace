# Proposal: compact, summarize, review pending

## Why

Steps 1-9 implemented the core memory lifecycle (init, prepare, sync, remember, recall, context, retain, flush, doctor, redaction). The remaining P1 features complete the lifecycle:

- **compact**: Removes duplicate/low-value working memories, keeping the store clean
- **summarize**: Generates human/agent-readable summary files from structured memories
- **review pending**: Lets users inspect pending memories before flush merges them

These complete the "review/merge/compact → summarize → L3 semantic summary" pipeline described in the design doc.

## What

### compact
- Standalone command: `mem-sync compact [--older-than 30d] [--dry-run]`
- Filters working memories by age and stability (confidence >= 0.8, not deleted/expired)
- Deduplicates by canonicalKey (exact match via existing merge logic)
- Optionally integrates into flush via `flush --compact` flag
- Creates .bak backup before modifying JSONL

### summarize
- Standalone command: `mem-sync summarize [--project <path>] [--force]`
- Generates profile.md (user scope), summary.md (global), projects/<id>/summary.md
- Rule-based (no LLM), deterministic, rebuildable from JSONL
- Filters by confidence >= 0.6, importance >= 0.3
- Uses existing scoring formula from context.js

### review pending
- Command: `mem-sync review pending [--kind <kind>] [--full]`
- Shows pending memories with preview (120 chars) or full content
- Supports kind filtering
- Shows source agent and file origin

## Scope

3 new commands, 3 new source files, ~200 lines of new code, ~150 lines of tests.
