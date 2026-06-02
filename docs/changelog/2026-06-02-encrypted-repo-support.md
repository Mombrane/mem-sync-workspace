# Changelog: Encrypted Repo Support

**Date:** 2026-06-02
**Change:** REQ-003 — encrypted repo support
**Commit:** 06d4b67

## Summary

Added repo-level encryption using the `age` encryption tool. When encryption is enabled, each JSONL line is independently encrypted before writing to disk, and decrypted transparently on read.

## What Changed

### New Files
- `src/encryption.js` — age encryption module (encrypt/decrypt, key management, config loading)
- `src/commands/key.js` — CLI commands for key status and export
- `tests/encryption.test.js` — 18 tests for encryption module
- `tests/repo-store-encryption.test.js` — 6 tests for repo-store encryption integration
- `tests/cli-key.test.js` — 10 tests for key CLI commands

### Modified Files
- `src/repo-store.js` — encrypt on write, decrypt on read (appendJSONL, readJSONL, readJSONLStream, writeJSONL)
- `src/index-store.js` — decrypt encrypted lines during index rebuild
- `src/commands/init.js` — added `--encrypt` and `--password` flags
- `src/cli.js` — registered `key` command, updated help text

### Design Decisions
1. **age binary** (not pure JS) — the age format spec is complex; shelling out to the binary is simpler and more reliable
2. **Line-level encryption** — preserves JSONL's O(1) append model and Git diff friendliness
3. **Integration at repo-store layer** — encryption is transparent to callers
4. **Decrypted index storage** — FTS5 needs plaintext; index is a rebuildable local cache
5. **Stream function delegates to readJSONL for encrypted files** — avoids async generator + readline timing issues

## Test Results
- 613 tests pass, 0 failures
- 34 new tests added (18 encryption + 6 repo-store + 10 CLI)

## Cost
- Explore: ~$1.32 (2 rounds)
- Propose: $0 (Hermes wrote directly)
- Delegate: ~$1.68 (Task 1 + Tasks 2&5 parallel)
- Review + fix: manual (stream function fix, index-store sync decrypt)
- Total: ~$3.00
