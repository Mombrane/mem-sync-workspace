# Design: Generated Skills

## Architecture

```
src/skills-engine.js   ← Core: filter → cluster → render SKILL.md
src/commands/skills.js  ← CLI: parse args → dispatch subcommands
src/cli.js              ← Add 'skills' command dispatch

tests/skills-engine.test.js  ← Engine unit tests
tests/cli-skills.test.js     ← CLI integration tests
```

## Skills Engine Design

### Core Function: `generateSkills(opts)`

```js
export async function generateSkills(opts) {
  const { repoPath, force = false, projectId } = opts;
  const memoriesDir = path.join(repoPath, 'memories');

  // 1. Read all 4 memory sources (same as summarizeMemories)
  // 2. Filter: kind ∈ {workflow, decision, correction, warning}
  //    + isValid() + confidence ≥ 0.8
  // 3. Cluster by primary tag (first non-empty tag)
  //    - Memories with tags[] → group by tags[0]
  //    - Memories with empty tags → group under kind name (e.g., "workflows")
  // 4. For each cluster with ≥ 2 workflow memories:
  //    - Sort workflows by computeScore() DESC, cap at 10
  //    - Collect related decisions, corrections, warnings
  //    - Render SKILL.md from template
  //    - Write to skills/<name>/SKILL.md
  // 5. Return { skills: number, names: string[], skipped: number }
}
```

### Clustering Algorithm

```
Phase 1: Filter
  candidates = memories.filter(m =>
    ['workflow','decision','correction','warning'].includes(m.kind) &&
    isValid(m) &&
    (m.confidence ?? 0) >= 0.8
  )

Phase 2: Group by Primary Tag
  For each candidate:
    primaryTag = m.tags?.[0] || m.kind  // fallback to kind name
    tagGroups[primaryTag].push(m)

Phase 3: Validate Clusters
  For each tagGroup:
    workflows = group.filter(m => m.kind === 'workflow')
    if workflows.length < MIN_WORKFLOW_COUNT (2):
      skip cluster (add to skipped count)

Phase 4: Generate
  For each valid cluster:
    name = slugify(primaryTag)  // "git workflow" → "git-workflow"
    render SKILL.md template
    write to skills/<name>/SKILL.md
```

### SKILL.md Template

```markdown
---
name: {{name}}
description: "Generated from {{count}} memories about {{primaryTag}}"
---

# {{titleCase(name)}}

Generated: {{now}} | Sources: {{total}} memories

## Overview

{{highestScoredWorkflow.content}}

## Steps / Pattern

{{#each workflows sorted by score}}
{{@index}}. {{content}}
{{/each}}

## Related Decisions

{{#each decisions}}
- {{content}} (confidence: {{confidence}})
{{/each}}

## Corrections / Pitfalls

{{#each corrections}}
- ⚠️ {{content}}
{{/each}}

## Source Memories

{{#each allContributingMemories}}
- {{id}} (kind: {{kind}}, importance: {{importance}}, updated: {{updatedAt}})
{{/each}}
```

### Scoring

Reuse `computeScore()` pattern from summarize-engine.js:
```
score = importance × 0.6 + recency × 0.4
```

Higher confidence floor for skills (0.8 vs 0.6) because skills are published artifacts.

### Helper Functions

```js
function slugify(text) // "Git Workflow" → "git-workflow"
function titleCase(text) // "git-workflow" → "Git Workflow"
function isSkillCandidate(memory) // isValid + confidence ≥ 0.8
function groupByPrimaryTag(memories) // Map<string, Memory[]>
function renderSkillMarkdown(cluster, now) // template fill
```

## CLI Design

### `src/commands/skills.js`

```js
export async function skillsCommand(args) {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'generate':
      const opts = parseGenerateArgs(rest);
      const result = await generateSkills(opts);
      console.log(JSON.stringify(result, null, 2));
      break;
    case 'list':
      const listOpts = parseListArgs(rest);
      const list = await listSkills(listOpts);
      console.log(JSON.stringify(list, null, 2));
      break;
    case 'show':
      const showOpts = parseShowArgs(rest);
      const content = await showSkill(showOpts);
      console.log(content);
      break;
    default:
      throw new Error(`unknown skills subcommand: ${subcommand ?? '(none)'}`);
  }
}
```

### `listSkills(opts)`

Read `skills/` directory, for each subdirectory read SKILL.md frontmatter, return:
```json
[
  { "name": "git-workflow", "description": "...", "path": "skills/git-workflow/SKILL.md" }
]
```

### `showSkill(opts)`

Read `skills/<name>/SKILL.md` and output raw markdown content.

## Integration Points

### cli.js Dispatch

Add to `src/cli.js`:
```js
} else if (command === 'skills') {
  await skillsCommand(args);
}
```

### No Integration with summarize/flush

Skills generation is a separate, explicit operation. Not triggered by `summarize` or `flush`.

## File Dependencies

- `src/repo-store.js` — `readJSONL()` for reading memory sources
- `src/schema.js` — `MEMORY_KINDS`, `normalizeContent()`, `isValid()` pattern
- `src/summarize-engine.js` — `computeScore()` pattern (will be extracted or duplicated)
