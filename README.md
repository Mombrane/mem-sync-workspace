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
node ./src/cli.js remember "User prefers concise Chinese replies" --scope assistant --source codex
node ./src/cli.js list
node ./src/cli.js export
node ./src/cli.js index rebuild
node ./src/cli.js index status --format json
```

By default, local data is written to `.mem-sync/memories.jsonl` in the current working directory. Set `MEM_SYNC_HOME` to use a different directory.

New memories are normalized as Memory Schema v1 records. The `add` command emits schema diagnostics to stderr, while `list` and `export` keep stdout suitable for human reading or JSON processing.

## FTS Index Commands

`mem-sync` supports full-text search over memories via SQLite FTS5 with trigram tokenization for mixed-language (Chinese/English) queries.

```bash
# Build or rebuild the FTS index from JSONL source files
node ./src/cli.js index rebuild
# Output: {"indexed":42}

# Check index status (human-readable)
node ./src/cli.js index status
# Index: exists
#   Record count: 42
#   Repo HEAD:    abc123def
#   DB path:      .mem-sync/.cache/index.sqlite

# Check index status (JSON)
node ./src/cli.js index status --format json
# Output: {"recordCount":42,"repoHead":"abc123def","dbPath":"...","exists":true}

# Incremental update — skips if repo HEAD unchanged
node ./src/cli.js index update
# Output: {"skipped":true} or {"rebuilt":true,"recordCount":42}
```

The index database (`index.sqlite`) is stored in `.mem-sync/.cache/` and should be added to `.gitignore` — it's a derived artifact rebuilt from the JSONL source of truth.

### How it works

1. **rebuild** — scans all `.jsonl` files under `MEM_SYNC_HOME`, validates each record against Memory Schema v1, skips deleted/expired records, inserts valid ones into SQLite, and rebuilds the FTS5 trigram index.
2. **status** — reports whether the index exists, how many records are indexed, and which Git HEAD commit was used.
3. **update** — compares the stored `repo_head` with the current Git HEAD. If they match, skips. If not, falls back to a full rebuild.

## Roadmap

The current prototype stores memories in `.mem-sync/memories.jsonl` (JSONL format). Local FTS recall and Git sync are implemented and available.

## GitHub Sync Model

This prototype keeps GitHub integration intentionally thin:

1. A user creates or chooses a private GitHub repository.
2. Each platform stores memory data inside that repository.
3. Platforms run ordinary Git operations to pull latest changes and push updates.
4. `mem-sync` merges memory records by stable `id` and newest `updatedAt` timestamp.

Future versions can add OAuth setup, GitHub API support, encryption, per-client adapters, and conflict review workflows.
