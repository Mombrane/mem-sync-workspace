# Requirements: Encrypted Repo Support

## Functional Requirements

### FR-1: Encryption Configuration
- The system SHALL read encryption config from `.mem-sync/meta/encryption.json`
- Config format: `{ "version": 1, "mode": "age"|"password", "publicKeys": ["age1..."] }`
- When no encryption config exists, the system operates in plaintext mode (backward compatible)

### FR-2: Keypair Generation
- `mem-sync init --encrypt` SHALL generate an X25519 keypair using `age-keygen`
- Private key stored at `~/.mem-sync/age-key` (mode 0600)
- Public key written to `.mem-sync/meta/encryption.json`

### FR-3: Password-Based Encryption
- `mem-sync init --encrypt --password` SHALL configure password-based encryption
- Password entered interactively (not stored on disk)
- Uses age's built-in scrypt-based passphrase mode

### FR-4: Line-Level Encryption
- Each JSONL line is independently encrypted before writing
- Encrypted format: age ASCII-armored ciphertext
- Append operation remains O(1) — encrypt one record, append one line

### FR-5: Transparent Decrypt on Read
- `readJSONL`, `readJSONLStream`, `readJSONLSync` SHALL auto-detect encrypted lines
- Auto-detection: lines starting with `age-encryption.org/v1` are treated as encrypted
- Plaintext lines in the same file are parsed normally (migration support)

### FR-6: Decrypted Index Storage
- The local SQLite index stores decrypted content for FTS search
- No changes to recall/search code needed

### FR-7: Key Management CLI
- `mem-sync key status` — show encryption mode, public key fingerprint
- `mem-sync key export` — export private key for backup

## Non-Functional Requirements

### NFR-1: Backward Compatibility
- Existing plaintext repos work without any changes
- Mixed encrypted/plaintext files are supported during migration
- No schema changes required

### NFR-2: Performance
- Encryption overhead < 5ms per record for typical 2KB memories
- No regression in recall/search performance

### NFR-3: Error Handling
- Missing `age` binary → clear error with install instructions
- Wrong key → clear error message, not garbage output
- Corrupted ciphertext → skip line with warning (consistent with JSONL parse errors)

## Test Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Encrypt/decrypt roundtrip | Plaintext preserved |
| 2 | Key generation | Valid age keypair |
| 3 | Wrong key error | Clear error message |
| 4 | Plaintext repo (no config) | Works as before |
| 5 | Mixed plain/encrypted lines | Both parsed correctly |
| 6 | Full prepare flow with encryption | Merge + index work |
| 7 | Full flush flow with encryption | Commit + push work |
| 8 | Missing age binary | Actionable error |
| 9 | Password-based roundtrip | Plaintext preserved |
| 10 | merge.js refactored to use repo-store | No duplication |
