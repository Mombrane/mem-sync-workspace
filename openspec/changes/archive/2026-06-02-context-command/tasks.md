## 1. Implement Project Resolver Module (src/project-resolver.js)

- [ ] 1.1 Create `src/project-resolver.js` with `resolveProjectId(cwd, explicitId)` function.
- [ ] 1.2 Implement Layer 1: If `explicitId` is provided, return it directly (validate non-empty string).
- [ ] 1.3 Implement Layer 2: Try `git remote get-url origin` via `execSync`, hash with SHA256, return first 12 hex chars.
- [ ] 1.4 Implement Layer 3: Try reading `package.json` from `cwd`, return `name` field if present.
- [ ] 1.5 Implement Layer 4: Return `basename(cwd)` as final fallback.
- [ ] 1.6 Create `tests/project-resolver.test.js` covering 5 test cases: explicit ID, git remote hash, package.json name, directory basename, no git + no package.json.

## 2. Implement Context Command Module (src/commands/context.js)

- [ ] 2.1 Create `src/commands/context.js` with `contextCommand(args)` as the entry point.
- [ ] 2.2 Implement `parseContextArgs(args)` using hand-written parser (recall.js style): `--project`, `--project-id`, `--mode` (startup|recall), `--format` (markdown|json|memories), `--limit` (positive int).
- [ ] 2.3 Implement `readSummaryFiles(memSyncHome, projectId)` — reads `profile.md`, `summary.md`, `projects/<project-id>/summary.md` synchronously, returns `null` for ENOENT.
- [ ] 2.4 Implement `queryWorkingMemories(cacheDir, projectId, limit)` — calls `searchIndex()` with scope/projectId filters, sorts by composite importance+recency score, returns top N.
- [ ] 2.5 Implement `outputContextMarkdown(profile, summary, projectSummary, memories, projectId)` — markdown output with sections for each component, consistent with recall.js styling.
- [ ] 2.6 Implement `outputContextJson(profile, summary, projectSummary, memories, projectId)` — JSON output with null fields for missing components.
- [ ] 2.7 Implement `outputContextMemories(profile, summary, projectSummary, memories)` — memories format output using `[MEMORY]...[/MEMORY]` blocks, consistent with recall.js outputMemories.
- [ ] 2.8 Handle graceful degradation: index not built → warning on stderr, continue file-only; all files missing → informational output; recall mode with no matches → empty memories section.

## 3. Create Project Resolver Tests (tests/project-resolver.test.js)

- [ ] 3.1 Test: explicit `--project-id` is returned directly, ignoring all other sources.
- [ ] 3.2 Test: Git remote URL produces consistent SHA256 hash across calls.
- [ ] 3.3 Test: package.json `name` field is used when no Git remote exists.
- [ ] 3.4 Test: Directory basename is used as final fallback (no Git, no package.json).
- [ ] 3.5 Test: `--project` path overrides `cwd` for derivation (but `--project-id` still wins when both provided).

## 4. Create Context Command Integration Tests (tests/cli-context.test.js)

- [ ] 4.1 Test: `context --mode startup --format markdown` with all three summary files present — verify correct sections and content.
- [ ] 4.2 Test: `context --mode startup --format json` — verify JSON structure, null fields for missing files.
- [ ] 4.3 Test: `context --mode startup --format memories` — verify `[MEMORY]` block output.
- [ ] 4.4 Test: `context --mode recall --format markdown` with index built and matching memories — verify memories section present.
- [ ] 4.5 Test: `context --mode recall --limit 3` — verify at most 3 memories returned.
- [ ] 4.6 Test: `context --mode recall` with index not built — verify graceful degradation, warning on stderr, file content still output.
- [ ] 4.7 Test: `context --project-id <explicit>` — verify explicit ID used, correct project summary path read.
- [ ] 4.8 Test: Missing `profile.md` — verify output notes missing profile.
- [ ] 4.9 Test: Missing `summary.md` — verify output notes missing summary.
- [ ] 4.10 Test: Missing `projects/<id>/summary.md` — verify output notes missing project summary.
- [ ] 4.11 Test: All three files missing — verify informational output, exit code 0.
- [ ] 4.12 Test: Invalid `--mode` value — verify error to stderr, exit code 1.
- [ ] 4.13 Test: Invalid `--format` value — verify error to stderr, exit code 1.
- [ ] 4.14 Test: Invalid `--limit` value (zero, negative, non-integer) — verify error to stderr, exit code 1.
- [ ] 4.15 Test: Unknown `--*` flag — verify error to stderr, exit code 1.
- [ ] 4.16 Test: Recall mode memories sorting — verify higher importance + recency memories appear first.

## 5. Update cli.js Routing

- [ ] 5.1 Import `contextCommand` from `src/commands/context.js`.
- [ ] 5.2 Add `else if (command === 'context') { await contextCommand(args); }` to the existing routing.
- [ ] 5.3 Update `printHelp()` to include `mem-sync context` in the usage section.

## 6. Integration and Verification

- [ ] 6.1 Run `npm test` and confirm all tests pass (existing + new).
- [ ] 6.2 Verify no regressions in `cli-remember.test.js`, `cli-recall.test.js`, `cli-prepare.test.js`, `cli-index.test.js`, `index-store.test.js`.
- [ ] 6.3 Manually test: `mem-sync context --mode startup --format markdown` in a project directory.
- [ ] 6.4 Manually test: `mem-sync context --mode recall --format json` with a populated index.
- [ ] 6.5 Review implementation against all decisions in `design.md`: project ID derivation, argument parsing style, graceful degradation, output format consistency.
