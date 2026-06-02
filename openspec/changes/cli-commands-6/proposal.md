# Proposal: Implement 6 remaining CLI commands

## Why
The design doc (section 11) defines CLI commands not yet implemented: `init`, `sync`, `status`, `log`, `show`, `forget`. These complete the core CLI interface for memory management and audit.

## What
Implement 6 commands that fill gaps in the CLI surface:
1. `init` — Initialize a memory repo with directory skeleton
2. `sync` — Fetch + pull rebase from remote (without merging pending)
3. `status` — Lightweight local state snapshot
4. `log` — Git log of memory changes
5. `show` — Display a specific memory by ID
6. `forget` — Soft delete a memory record

## Scope
- All 6 commands with corresponding tests
- Wire into cli.js command router
- Update help text
- No new dependencies
