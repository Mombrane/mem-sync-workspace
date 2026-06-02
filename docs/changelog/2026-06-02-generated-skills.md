# Generated Skills (REQ-002)

**Date:** 2026-06-02
**Status:** ✅ Complete
**Commit:** d09f476, e79d113

## Summary

Implemented `generated skills` — a feature that analyzes long-term memories (workflow, decision, correction, warning kinds) and automatically generates reusable `SKILL.md` files in the memory repo's `skills/` directory.

## Changes

### New Files
- `src/skills-engine.js` — Core engine: filter → cluster by tag → render SKILL.md
- `src/commands/skills.js` — CLI command: `skills generate|list|show`
- `tests/skills-engine.test.js` — 10 unit tests
- `tests/cli-skills.test.js` — 13 integration tests (7 parser + 6 CLI)

### Modified Files
- `src/cli.js` — Added `skills` command dispatch + help text

## Design Decisions

1. **Separate engine file** (`skills-engine.js`) rather than extending summarize-engine.js — different input criteria, different output structure
2. **Standalone CLI command** (`mem-sync skills generate`) rather than flag on summarize — cleaner separation, supports future `list`/`show` subcommands
3. **Cluster by primary tag** with kind fallback — tags are optional (default `[]`), so memories without tags cluster under their kind name
4. **Higher confidence threshold** (≥ 0.8) vs summarize (≥ 0.6) — skills are published artifacts, need higher quality bar
5. **MIN_WORKFLOW_COUNT = 2** — prevents anemic skills from single memories
6. **MAX_STEPS = 10** — caps skill length for readability

## Review Findings

- Fixed: `isSkillCandidate()` was missing importance threshold check (≥ 0.3). Added during review.

## Verification

- 473 total tests pass (23 new + 450 existing)
- 0 failures, 0 regressions
- Full test suite runs in ~10 seconds
