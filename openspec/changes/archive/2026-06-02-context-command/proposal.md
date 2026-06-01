## Why

When an AI agent starts a new session, it has no context about the user, the project, or recent working memories. Today, agent frameworks must manually read files from `.mem-sync` and query the FTS5 index to build a system prompt preamble — ad-hoc, error-prone, and inconsistent across integrations.

The `context` command provides a single `mem-sync context` invocation that agents run at session startup. It reads the user's profile, global summary, project-level summary, and (in recall mode) top recent working memories from the index, then outputs a merged context block in markdown, JSON, or `[MEMORY]` block format. This eliminates per-integration boilerplate and ensures every agent session starts with consistent, up-to-date context.

The command addresses:

- **No standard context assembly**: Each agent integration (Claude Code, Codex, custom CLI) must reimplement file reading and memory search — the `context` command provides a single, stable interface.
- **No project-aware memory scoping**: The recall command already supports `--project-id`, but deriving a stable project ID from the current working directory is left to the caller. `context` includes a reusable `project-resolver` module that derives a cross-device stable project ID from git remote, package.json, or directory basename.
- **Graceful degradation**: Summary files may not exist, the index may not be built, or the working directory may not be a recognized project. The command degrades gracefully, outputting what it can rather than crashing.

## What Changes

- Add `mem-sync context` command with two modes (`--mode startup|recall`) and three output formats (`--format markdown|json|memories`).
- Add `src/project-resolver.js` — standalone module to derive a stable project ID from the working directory (git remote SHA256 → package.json name → directory basename fallback).
- Add `src/commands/context.js` — command entry point with parameter parsing, file reading, index querying, and output formatting.
- Update `src/cli.js` to register the `context` route.
- Add `tests/project-resolver.test.js` (5 unit tests) and `tests/cli-context.test.js` (10+ integration tests).

## Capabilities

### New Capabilities

- `context-command`: Generate a session-startup context block from user profile, global summary, project summary, and optionally recent working memories.

### Modified Capabilities

- None. Existing `remember`, `recall`, `prepare`, `list`, `export`, and `index` commands are unchanged. `context` is a new command that reads existing data (files + index) without mutation.

## Impact

- Affected code: new `src/project-resolver.js`, new `src/commands/context.js`, modified `src/cli.js`.
- Affected tests: new `tests/project-resolver.test.js`, new `tests/cli-context.test.js`.
- Affected docs: OpenSpec gains `context-command` requirements; CLI help updated.
- No existing JSONL files, schema validation, memory store, index store, or Git operations are changed.
- The `context` command is read-only — no locks, no mutations, no writes. It can run concurrently with any other command.
