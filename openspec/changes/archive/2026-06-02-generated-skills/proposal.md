# Proposal: Generated Skills

## Why

mem-sync's memory repo contains rich workflow, decision, and correction memories that encode reusable procedures. Currently these memories sit in JSONL files and are only accessible via `recall`. Agents loading mem-sync's context have no structured playbook to reference — they must re-discover procedures from raw memory fragments every time.

**Generated skills** solves this by analyzing long-term memories and producing `skills/<name>/SKILL.md` files that agents can load as structured playbooks. This bridges the gap between "raw memories" and "actionable knowledge."

## What

1. New engine: `src/skills-engine.js` — filters, clusters, and generates SKILL.md files
2. New command: `mem-sync skills generate|list|show` — CLI entry point
3. New tests: engine unit tests + CLI integration tests

## Scope

- Template-based generation (no LLM required)
- Cluster by memory `kind` + tag affinity (not content similarity)
- Read from same 4 memory sources as summarize
- Higher confidence threshold (≥ 0.8) than summarize (≥ 0.6)
- Minimum 2 workflow memories per skill to prevent anemic output
