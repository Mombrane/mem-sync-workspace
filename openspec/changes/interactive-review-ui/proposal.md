# Proposal: Interactive Review UI

## Why

Currently `mem-sync review pending` is read-only — it displays pending records in a markdown table. Users (and agents) need the ability to **accept** or **reject** pending records before they get merged into the memory store. This completes the review-approve workflow that `retain --pending` → `review pending` → `flush` was designed for.

## What

Add `review approve` and `review reject` subcommands:

- `review approve <id>` — Move a single pending record to the memory store
- `review approve --all` — Move all pending records to the memory store
- `review reject <id>` — Remove a single pending record without storing it
- `review reject --all` — Remove all pending records

## Scope

- No new dependencies
- No interactive TUI (future enhancement)
- Records go to flat `memories.jsonl` (scope is stored within the record)
- Two-phase safety: append to store first, then remove from pending
- Lock protection for bulk operations

## Out of Scope

- `$EDITOR` integration (`--edit` flag) — defer to v2
- Multi-file storage by scope — defer to separate requirement
- Rejected record audit log — defer to v2
