# Requirements: Generated Skills

## Functional Requirements

### FR-1: Skill Generation from Memories
- Read memories from all 4 JSONL sources (user, working/global, projects/<id>, working/projects/<id>)
- Filter for `workflow`, `decision`, `correction`, `warning` kinds
- Apply confidence threshold ≥ 0.8 (higher than summarize's 0.6)
- Apply standard validity checks (not deleted, not expired, importance ≥ 0.3)

### FR-2: Clustering Strategy
- Primary clustering: by `kind` (workflow memories form the backbone)
- Secondary grouping: by tags (when present — tags are optional, default to `[]`)
- Fallback: when no tags exist, group workflow memories into a single "general-workflows" skill
- Minimum 2 workflow memories required per skill (skip clusters below threshold)

### FR-3: SKILL.md Output Format
```yaml
---
name: <kebab-case-name>
description: "Use when <triggering conditions>"
---
# <Human-Readable Skill Name>
Generated: <ISO> | Sources: N memories
## Overview
## Steps / Pattern
## Related Decisions
## Corrections / Pitfalls
## Source Memories
```

### FR-4: CLI Commands
- `mem-sync skills generate [--repo <path>] [--force] [--project <id>]`
- `mem-sync skills list [--repo <path>]`
- `mem-sync skills show <name> [--repo <path>]`

### FR-5: Force/Overwrite Behavior
- Without `--force`: skip existing skill directories
- With `--force`: regenerate all skills, overwriting SKILL.md files

## Non-Functional Requirements

### NFR-1: Deterministic Output
Same input memories → same SKILL.md output (no randomness, no LLM).

### NFR-2: Rebuildable
Delete `skills/` directory → `skills generate --force` → identical output.

### NFR-3: Test Coverage
- Engine unit tests (filtering, clustering, rendering)
- CLI integration tests (argument parsing, command dispatch, JSON output)

## Scenarios

### S1: Generate skills from workflow memories
Given: 3 workflow memories tagged ["git"], 1 decision memory tagged ["git"]
When: `mem-sync skills generate`
Then: `skills/git-workflows/SKILL.md` created with 3 steps + 1 decision

### S2: Skip anemic clusters
Given: 1 workflow memory tagged ["deploy"]
When: `mem-sync skills generate`
Then: No skill generated (below MIN_WORKFLOW_COUNT=2)

### S3: Force overwrite
Given: Existing `skills/git-workflows/SKILL.md`
When: `mem-sync skills generate --force`
Then: SKILL.md regenerated with latest memories

### S4: List existing skills
Given: 2 generated skills in `skills/`
When: `mem-sync skills list`
Then: JSON array of skill names and descriptions

### S5: No skill-worthy memories
Given: Only `preference` and `episode` memories
When: `mem-sync skills generate`
Then: `{ skills: 0, names: [] }` output, no `skills/` subdirectories created
