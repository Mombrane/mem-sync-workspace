# Proposal: Encrypted Repo Support

## Why

mem-sync stores memories as plaintext JSONL in a Git repo. While the repo may be private, the data is readable by anyone with repo access (GitHub, CI, collaborators). For users storing sensitive preferences, decisions, or project facts, an encryption-at-rest layer is essential.

The design doc (section 13) explicitly lists "optional encryption" as part of the safety pipeline and "encrypted repo support" as a P2 feature.

## What

Add repo-level encryption using the `age` encryption tool. When enabled:
- Each JSONL line is independently encrypted before writing to disk
- Decryption happens transparently on read
- The local SQLite index stores decrypted content (for FTS search)
- Plaintext repos continue to work without changes (backward compatible)

## Scope

- **In scope:** age binary integration, line-level encryption, keypair/password modes, encrypt on write/decrypt on read, key status/export CLI commands, merge.js refactoring
- **Out of scope:** Multi-recipient encryption, key rotation with re-encryption, Shamir's Secret Sharing, local-only scope enforcement (orthogonal concern)
