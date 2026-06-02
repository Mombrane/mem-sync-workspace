# Tasks: Generated Skills

## Task 1: Skills Engine Core
**Files:** `src/skills-engine.js`
**Dependencies:** None

Implement the core skills engine:
- `generateSkills(opts)` — main export
- `isSkillCandidate(memory)` — filter function (isValid + confidence ≥ 0.8)
- `groupByPrimaryTag(memories)` — clustering by first tag or kind fallback
- `renderSkillMarkdown(cluster, now)` — SKILL.md template rendering
- `slugify(text)` — kebab-case conversion
- `titleCase(text)` — display name conversion
- Constants: `MIN_WORKFLOW_COUNT = 2`, `MAX_STEPS = 10`, `SKILL_CONFIDENCE = 0.8`

Read from 4 memory sources (same as summarizeMemories).
Return `{ skills: number, names: string[], skipped: number }`.

## Task 2: Skills CLI Command
**Files:** `src/commands/skills.js`
**Dependencies:** Task 1

Implement CLI entry point:
- `skillsCommand(args)` — dispatch to subcommands
- `parseGenerateArgs(args)` — `--repo`, `--force`, `--project`
- `parseListArgs(args)` — `--repo`
- `parseShowArgs(args)` — positional name arg + `--repo`
- `listSkills(opts)` — read skills/ dir, parse frontmatter
- `showSkill(opts)` — read and output SKILL.md content

Follow exact pattern of `src/commands/summarize.js`.

## Task 3: CLI Dispatch Integration
**Files:** `src/cli.js`
**Dependencies:** Task 2

Add `skills` command dispatch to cli.js:
```js
} else if (command === 'skills') {
  await skillsCommand(args);
}
```

## Task 4: Engine Unit Tests
**Files:** `tests/skills-engine.test.js`
**Dependencies:** Task 1

Test cases:
- S1: Generate skills from workflow memories with tags
- S2: Skip clusters below MIN_WORKFLOW_COUNT
- S3: Force overwrite existing skills
- S4: Handle memories with empty tags (kind fallback)
- S5: No skill-worthy memories returns { skills: 0, names: [], skipped: 0 }
- S6: Confidence threshold filtering (0.79 excluded, 0.80 included)
- S7: Slugify and titleCase helpers
- S8: Max steps cap (10 steps per skill)
- S9: Mixed kinds in same cluster (workflow + decision + correction)

Follow pattern of `tests/summarize-engine.test.js`.

## Task 5: CLI Integration Tests
**Files:** `tests/cli-skills.test.js`
**Dependencies:** Task 2, Task 3

Test cases:
- S1: `skills generate` creates SKILL.md files
- S2: `skills generate --force` overwrites existing
- S3: `skills list` returns JSON array
- S4: `skills show <name>` outputs markdown
- S5: `skills` with no subcommand throws error
- S6: `skills generate` with no memories returns { skills: 0 }

Follow pattern of `tests/cli-summarize.test.js` (spawnSync + direct call).
