# mem-sync

`mem-sync` is a small GitHub-backed memory sync toolkit prototype. It is designed for assistants, CLIs, desktop apps, and other clients that need to share portable user memories through a normal Git repository.

## Goals

- Store memories as plain JSON files that can be reviewed, diffed, and backed up.
- Use GitHub as the transport layer, so every platform can sync through clone/pull/merge/push.
- Keep the local data model simple enough for multiple apps to adopt.
- Prefer deterministic IDs and last-write-wins merge behavior for the first prototype.

## Quick Start

```bash
npm test
node ./src/cli.js add "User prefers concise Chinese replies" --scope assistant --source codex
node ./src/cli.js list
node ./src/cli.js export
```

By default, local data is written to `.mem-sync/memories.json` in the current working directory. Set `MEM_SYNC_HOME` to use a different directory.

New memories are normalized as Memory Schema v1 records. The `add` command emits schema diagnostics to stderr, while `list` and `export` keep stdout suitable for human reading or JSON processing.

## Roadmap

The current prototype still stores memories in `.mem-sync/memories.json`. The next implementation phase migrates the source of truth to Git-friendly JSONL files, then layers local FTS recall and Git sync on top.

## GitHub Sync Model

This prototype keeps GitHub integration intentionally thin:

1. A user creates or chooses a private GitHub repository.
2. Each platform stores memory data inside that repository.
3. Platforms run ordinary Git operations to pull latest changes and push updates.
4. `mem-sync` merges memory records by stable `id` and newest `updatedAt` timestamp.

Future versions can add OAuth setup, GitHub API support, encryption, per-client adapters, and conflict review workflows.
