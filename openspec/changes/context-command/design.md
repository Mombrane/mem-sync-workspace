## Context

`mem-sync` has a working JSONL storage layer (`src/repo-store.js`), a schema v1 validation pipeline (`src/schema.js`), a local SQLite/FTS5 index (`src/index-store.js`), and CLI commands for `remember`, `recall`, `prepare`, `list`, `export`, and `index`. The `context` command adds session-startup context assembly — reading summary files and querying working memories — to give agents a consistent, zero-boilerplate initialization.

The `.mem-sync` directory contains `profile.md`, `summary.md`, and `projects/<project-id>/summary.md`. These files are maintained by higher-level summarization workflows (future `summarize` command). The `context` command is a pure reader of these files plus the FTS5 index.

## Goals / Non-Goals

**Goals:**

- Implement `mem-sync context` with two modes: `startup` (files only) and `recall` (files + index query).
- Support three output formats: `markdown` (human-readable), `json` (machine-parseable), `memories` (`[MEMORY]` blocks for agent prompt injection).
- Implement `src/project-resolver.js` as a standalone, testable module for deriving stable project IDs.
- Read `profile.md`, `summary.md`, and `projects/<project-id>/summary.md` with graceful degradation when files are missing.
- Sort recall results by importance + recency composite score.
- Follow the existing codebase patterns: hand-written argument parsing (recall.js style), `MEM_SYNC_HOME` for directory resolution (prepare.js style), `searchIndex` API (index-store.js style).
- Add comprehensive tests: unit tests for project-resolver, integration tests for the context command.

**Non-Goals:**

- Do not mutate any files — `context` is read-only. No locks, no writes, no index modifications.
- Do not implement summarization logic — that belongs to a future `summarize` command. `context` only reads pre-existing summary files.
- Do not change the existing `recall`, `remember`, or `index` command behavior.
- Do not add new index query capabilities — `context` uses the existing `searchIndex` API.
- Do not implement deep recall (multi-hop, evidence traversal) — that belongs to `recall --deep`.

## Decisions

### 1. Project ID Derivation (src/project-resolver.js)

The `project-resolver` module provides a single function:

```js
// src/project-resolver.js API sketch
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function resolveProjectId(cwd, explicitId = null) {
  // 1. Explicit ID takes absolute precedence
  if (explicitId) return explicitId;

  // 2. Git remote origin URL → SHA256, first 12 hex chars
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
    if (remoteUrl) {
      return createHash('sha256').update(remoteUrl).digest('hex').slice(0, 12);
    }
  } catch { /* no remote, continue */ }

  // 3. package.json name field
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (pkg.name) return pkg.name;
  } catch { /* no package.json, continue */ }

  // 4. Directory basename (always succeeds)
  return basename(cwd);
}
```

Rationale:

- **Git remote SHA256** is cross-device stable: two clones of the same repo on different machines produce the same project ID. 12 hex chars balances collision resistance (4 billion IDs) with readability.
- **package.json name** is a common convention in Node.js projects; most tools already use it.
- **Directory basename** is the universal fallback — always available, good enough for non-Git directories.
- **Standalone module**: `project-resolver.js` has zero dependencies on other `src/` modules (only uses Node.js built-ins). This makes it independently testable and reusable by future commands (`recall`, `prepare`).

### 2. Argument Parsing (Hand-Written, recall.js Style)

The context command uses the same hand-written argument parsing pattern as `src/commands/recall.js`:

- Import `requireValue`, `validateEnum`, `validatePositiveInt` from `src/argparse.js`.
- Parse `--project`, `--project-id`, `--mode`, `--format`, `--limit` flags.
- Use the same destructuring-with-defaults pattern: `let mode = 'startup'; let format = 'markdown'; let limit = 5;`.
- Unknown `--*` flags throw with `unknown option: ${arg}`.
- Positional arguments (not starting with `--`) are ignored (unlike `recall` which treats them as query terms).

Rationale:

- Consistent with existing codebase — no new parsing library, no CLI framework.
- The hand-written parser is small (~40 lines), easy to audit, and already well-tested in recall.js.
- The `context` command has fewer flags than `recall`, making the parser even simpler.

### 3. Summary File Reading

Summary files are read synchronously using `readFileSync` from `node:fs`, consistent with the existing codebase's use of sync I/O:

```js
function readSummaryFile(memSyncHome, relativePath) {
  try {
    return readFileSync(join(memSyncHome, relativePath), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null; // file doesn't exist — not an error
  }
}
```

The three files read:

| File | Path | Content |
|------|------|---------|
| Profile | `profile.md` | User-level preferences, style, constraints |
| Global Summary | `summary.md` | Cross-project knowledge summary |
| Project Summary | `projects/<project-id>/summary.md` | Project-specific knowledge summary |

Rationale:

- **Synchronous I/O**: The existing codebase consistently uses `readFileSync` (index-store.js, schema.js). `context` is a CLI command that exits after execution — there's no concurrent request handling, so blocking is acceptable.
- **ENOENT → null**: Missing files are not errors. A fresh `.mem-sync` directory won't have summary files yet; the command should still produce useful output.
- **No encoding assumptions**: Files are read as UTF-8. Future summarization commands write UTF-8.

### 4. Working Memory Recall Sorting

When mode is `recall`, the command queries the index for working memories and sorts by a composite score:

```
compositeScore = importance * 0.6 + recencyNormalized * 0.4
```

Where:
- `importance` is the stored importance value (0–1)
- `recencyNormalized` is based on `updatedAt`: 1.0 for today, decaying to 0 for records older than 90 days

```js
function computeContextScore(memory) {
  const importance = memory.importance ?? 0.5;
  const daysSinceUpdate = Math.max(0, (Date.now() - new Date(memory.updatedAt)) / 86400000);
  const recency = Math.max(0, 1 - daysSinceUpdate / 90);
  return importance * 0.6 + recency * 0.4;
}
```

Rationale:

- **Importance-weighted**: Working memories with high importance scores (explicitly set by `remember`) should appear first regardless of age.
- **Recency bonus**: Recent memories (updated within the last few days) get a boost, ensuring fresh context.
- **90-day decay window**: After 3 months, recency contributes nothing — importance alone determines ranking.
- **Composite over raw BM25**: Unlike `recall` which uses BM25 for query relevance, `context` recall has no query string — it needs a different relevance metric. Importance + recency is the right signal for "what should the agent know now."

### 5. Output Format Design

#### Markdown (default)

Human-readable, consistent with `recall --format markdown` styling:

```markdown
# Context for <project-id>

## Profile
> User prefers concise Chinese replies.
> Prefers TypeScript over plain JavaScript.

## Global Summary
> Project uses GitHub as memory source of truth.
> ...

## Project Summary
> This project implements the mem-sync CLI tool.
> ...

## Recent Working Memories
### 1. [working] Decision: use SQLite FTS5 for local search
**Importance:** 0.9 | **Updated:** 2026-06-01
> ...
```

#### JSON

Machine-parseable, consistent with `recall --format json` structure:

```json
{
  "projectId": "a1b2c3d4e5f6",
  "profile": "User prefers concise...",
  "summary": "...",
  "projectSummary": "...",
  "memories": [
    { "rank": 1, "memory": { ... } }
  ]
}
```

#### Memories

Agent prompt injection format, consistent with `recall --format memories`:

```
[MEMORY id=... rank=0.95 kind=preference scope=user ...]
...
[/MEMORY]
```

Summary file content is wrapped as memories with `kind=summary` and appropriate scope.

Rationale:

- All three formats already exist in the `recall` command — users and integrations are familiar with them.
- `markdown` is the default because it's the most common use case (agent startup context).
- `json` enables programmatic consumption (e.g., `context=$(mem-sync context --format json)` in a shell script).
- `memories` format enables direct injection into agent system prompts without additional parsing.

### 6. Graceful Degradation

The command handles missing resources without crashing:

| Resource | Behavior when missing |
|----------|----------------------|
| `profile.md` | `null`, output notes "no profile configured" |
| `summary.md` | `null`, output notes "no global summary" |
| `projects/<id>/summary.md` | `null`, output notes "no project summary" |
| FTS5 index | Warning to stderr, memories section empty/null |
| Cannot derive project ID | Basename fallback always succeeds |

Rationale:

- **Never crash on missing data**: An agent should always be able to start, even with zero context. Partial context is better than a blocked startup.
- **Warnings on stderr**: Diagnostics for operators without polluting the agent's context (stdout).
- **Consistent null handling**: JSON output uses `null` for missing sections; markdown uses human-readable notes; memories format emits no blocks.

### 7. Error Handling Strategy

| Condition | Severity | Action |
|-----------|----------|--------|
| Invalid `--mode` value | Fatal | Error to stderr, exit code 1 |
| Invalid `--format` value | Fatal | Error to stderr, exit code 1 |
| Invalid `--limit` value | Fatal | Error to stderr, exit code 1 |
| Unknown `--*` flag | Fatal | Error to stderr, exit code 1 |
| Summary file ENOENT | None | Content is `null`, continue |
| Summary file read error (non-ENOENT) | Fatal | Error to stderr, exit code 1 |
| Index not built (recall mode) | Warning | Log to stderr, continue file-only |
| Index query error | Warning | Log to stderr, continue file-only |

Rationale:

- **Fatal on invalid input**: The user or integration provided bad arguments — fail fast with a clear message.
- **Warning on missing infrastructure**: Missing index or files are expected states, not errors — continue with what's available.
- **No mutations, no need for locks or rollback**: The command is read-only, simplifying error handling dramatically.

### 8. File Organization

```
src/project-resolver.js      — resolveProjectId(cwd, explicitId) -> string
src/commands/context.js       — contextCommand(args), parseContextArgs(args), output formatters

tests/project-resolver.test.js — 5 unit tests
tests/cli-context.test.js      — 10+ integration tests
```

Rationale:

- `project-resolver.js` is at `src/` top level (not `src/commands/`) because it's a shared utility, not a command. Future commands (`recall`, `prepare`) may import it.
- `context.js` follows the existing `src/commands/` convention (recall.js, prepare.js, index.js).
- Test files follow the existing `tests/` naming convention (`cli-*.test.js` for command integration tests, `*-resolver.test.js` for unit tests).

### 9. No Mutations, No Lock

The `context` command is read-only:
- Reads files from `.mem-sync` (using `readFileSync`).
- Queries the FTS5 index (using `searchIndex`, which opens the database read-only).
- No writes, no git operations, no lock acquisition.

This means:
- `context` can run concurrently with any other `mem-sync` command.
- No lock contention with `prepare` or `remember`.
- Safe to call unconditionally at agent startup — no coordination needed.

## Risks / Trade-offs

- [Risk] SHA256 of Git remote URL may change if the remote URL changes (e.g., repo rename on GitHub). → Mitigation: This is expected behavior — the project identity should follow the repo. Project summaries for the old ID can be migrated manually. The explicit `--project-id` flag provides an escape hatch.
- [Risk] Summary files may be large (hundreds of KB), increasing agent context cost. → Mitigation: Summarization (future `summarize` command) is responsible for keeping summary files concise. The `context` command does no truncation — it trusts the summarizer. A future enhancement could add `--max-chars` for truncation.
- [Risk] Importance-only ranking may surface stale but highly-important memories ahead of fresh but moderately-important ones. → Mitigation: The 60/40 importance/recency split balances this. The 90-day recency decay ensures very old memories phase out.
- [Risk] `context` reads `profile.md` and `summary.md` but has no mechanism to signal that they were read (for analytics or freshness tracking). → Mitigation: Reading is free — no side effects needed. If analytics are desired, they belong in the agent integration layer, not the CLI.

## Migration Plan

1. Implement `src/project-resolver.js` with unit tests.
2. Implement `src/commands/context.js` with argument parsing, file reading, index querying, and output formatting.
3. Update `src/cli.js` to register the `context` route.
4. Write `tests/project-resolver.test.js` (5 unit tests).
5. Write `tests/cli-context.test.js` (10+ integration tests).
6. Update CLI help output to include `mem-sync context`.
7. Run `npm test` and confirm all tests pass.

Rollback strategy: Remove the `context` case from `cli.js`, delete `src/project-resolver.js`, `src/commands/context.js`, and associated tests. No existing functionality is affected — `context` is a new command that only reads existing data.

## Open Questions

- Should `context` support a `--profile` flag to specify a custom profile file path? → Resolved: Not for MVP. `profile.md` is the convention. Custom paths can be added later.
- Should `context` merge multiple project summaries (e.g., parent projects or monorepos)? → Resolved: Not for MVP. Single project context is sufficient for initial use cases.
- Should `context` emit a `MEM_SYNC_CONTEXT` environment variable instead of stdout? → Resolved: stdout is the existing pattern (recall, prepare both use stdout). Environment variable injection can be a wrapper concern.
