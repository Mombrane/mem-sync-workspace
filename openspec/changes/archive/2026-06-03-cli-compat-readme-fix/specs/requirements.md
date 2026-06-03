# Requirements: CLI Compatibility & README Consistency Fix

## Functional Requirements

### FR-1: `add` alias
- `mem-sync add <content>` must behave identically to `mem-sync remember <content>`
- All flags (`--kind`, `--scope`, `--source`, `--tag`, `--importance`, `--confidence`) must work through `add`
- `add` must appear in help text or at minimum not break

### FR-2: README accuracy
- Quick Start must use commands that actually work (no `add` route)
- Roadmap must not claim JSONL is a future migration — it's already implemented
- Storage model description must match reality

### FR-3: Default repo path consistency
- `compact`, `summarize`, `review`, `skills` must use the same default repo resolution as `remember`, `recall`, `flush`, etc.
- Resolution: `MEM_SYNC_HOME ?? '.mem-sync'` relative to cwd

## Non-Functional Requirements
- All existing tests must continue to pass
- New alias test must verify functional equivalence
