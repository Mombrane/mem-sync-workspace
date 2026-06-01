# mem-sync Project Context

## Purpose

`mem-sync` is a local-first toolkit for sharing user memories across assistants, CLIs, editors, and devices through a user-owned GitHub repository.

## Current Stack

- Runtime: Node.js 20+
- Module system: ECMAScript modules
- CLI entrypoint: `src/cli.js`
- Test runner: Node built-in `node --test`
- Storage format: JSON files designed for Git diffs and merges

## Constraints

- Keep the storage format transparent and reviewable.
- Do not require a hosted service beyond a GitHub repository.
- Treat private memories as sensitive; avoid logging full records except for explicit list/export commands.
- Keep diagnostic logs separate from machine-readable stdout, especially JSON export output.
- Prefer deterministic behavior that is easy to test.
- Schema boundary code should include Chinese comments for non-obvious persistence decisions.

## Conventions

- OpenSpec changes live under `openspec/changes/`.
- Stable product requirements live under `openspec/specs/`.
- Prototype implementation should remain dependency-light until GitHub API support is needed.
- Memory Schema v1 records use `content` as canonical text; legacy `text` is a transition concern outside the schema contract.
