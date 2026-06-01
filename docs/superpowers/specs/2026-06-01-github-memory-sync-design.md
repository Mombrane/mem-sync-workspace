# GitHub Memory Sync Design

## Problem

Users often work across multiple AI tools, editors, and devices. Each tool may learn useful preferences or facts, but those memories are siloed. This workspace starts a tool that uses a GitHub repository as a portable synchronization backend.

## Initial Scope

Build a local-first CLI and library prototype that can:

- Add normalized memory records.
- List records from a local store.
- Export the local store as deterministic JSON.
- Merge records from multiple stores by `id`, keeping the newest `updatedAt` value.
- Leave remote GitHub transport to ordinary Git commands for the first iteration.

## Data Model

A memory record contains:

- `id`: deterministic identifier derived from normalized text, scope, and source.
- `text`: trimmed single-line memory content.
- `scope`: consumer namespace such as `global`, `assistant`, or `project`.
- `source`: platform or client that created the memory.
- `createdAt`: ISO timestamp for creation.
- `updatedAt`: ISO timestamp for the latest mutation.

## Architecture

- `src/memory-store.js`: pure memory creation and merge logic.
- `src/file-store.js`: filesystem persistence for local JSON stores.
- `src/cli.js`: command-line entrypoint for add, list, and export commands.
- `tests/`: Node test runner tests for core behavior.

## Design Choices

- Plain JSON is used first because it is transparent in GitHub diffs.
- Deterministic IDs prevent duplicate memories when the same memory is captured on multiple clients.
- Last-write-wins keeps merge behavior predictable for the prototype.
- No encryption is included yet; users should use a private repository and avoid secrets.

## Future Work

- Add optional age-based pruning and tags.
- Add encrypted-at-rest store support.
- Add GitHub API setup and sync commands.
- Add adapters for specific AI tools and memory file formats.
- Add conflict review for semantically similar but non-identical memories.
