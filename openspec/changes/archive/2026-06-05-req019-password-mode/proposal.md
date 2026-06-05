# REQ-019: Password Encryption Mode

## Why
The CLI already accepts `--encrypt --password` in `mem-sync init` and writes a password-mode config, but `encryptLine`/`decryptLine`/`decryptLineSync` all throw "not yet implemented". Users who initialized with password mode cannot use encryption at all.

## What
Implement password-based age encryption using the `age-encryption` npm package (v0.3.0, official JS implementation by FiloSottile). Password is provided via `MEM_SYNC_PASSWORD` environment variable.

## Key Constraint
`age -p` (CLI) reads passphrase from `/dev/tty` only — cannot pipe non-interactively. The JS library (`age-encryption`) reads passphrase programmatically via `setPassphrase()`/`addPassphrase()` — no TTY needed.

## Scope
- `encryptLine` — password mode via JS library
- `decryptLine` — password mode via JS library  
- `decryptLineSync` — password mode via `execFileSync` spawning a Node subprocess (JS lib is async, but callers like `rebuildIndex` are sync)
- Tests for all three functions in password mode
- Error message when `MEM_SYNC_PASSWORD` is not set
