# Proposal: Implement `retain --pending` Command

## Background
mem-sync CLI needs a `retain --pending` command that extracts candidate memories from agent session transcripts using rule-based pattern matching, and writes them to the device's pending file for later merge by `flush`.

## Why
- Agents generate valuable knowledge during conversations (preferences, decisions, facts)
- Manual `remember` is insufficient — users won't remember to invoke it for every important fact
- `retain` automates candidate extraction from conversation transcripts
- Pending files are the staging area before commit — safe, auditable, mergeable

## What
1. **`src/retain-engine.js`** — Pure extraction function: `extractCandidates(transcript, options) → Candidate[]`
2. **`src/commands/retain.js`** — CLI command: reads transcript file, calls engine, writes to pending
3. **Wire into `src/cli.js`** — Register the `retain` command
4. **Tests** — Unit tests for engine + integration tests for CLI

## Scope
- MVP rule-based extraction only (no LLM)
- `--pending` flag mandatory in v1 (safety gate)
- Dedup against existing pending file by canonicalKey
- Supports Chinese and English trigger patterns
