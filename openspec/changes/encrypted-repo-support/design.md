# Design: Encrypted Repo Support

## Architecture Overview

```
                    ┌─────────────────┐
                    │  CLI Commands    │
                    │  init --encrypt  │
                    │  key status      │
                    │  key export      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ encryption.js   │
                    │ (NEW module)    │
                    │ - encrypt()     │
                    │ - decrypt()     │
                    │ - generateKey() │
                    │ - loadConfig()  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───────┐ ┌───▼────┐ ┌───────▼───────┐
     │ repo-store.js  │ │merge.js│ │ index-store.js │
     │ (modified)     │ │(refact)│ │  (modified)    │
     │ encrypt/decrypt│ │use repo│ │ decrypt before │
     │ at read/write  │ │-store  │ │ indexing       │
     └────────────────┘ └────────┘ └───────────────┘
```

## Key Design Decisions

### 1. Shell out to `age` binary (not pure JS)
The age format spec involves complex binary header structures, stanza format, and HKDF key derivation. Implementing this correctly in pure JS would be ~300+ lines of crypto-serialization code with high error risk. The `age` binary is widely packaged (`apt install age`, `brew install age`) and has a clean stdin/stdout interface.

### 2. Line-level encryption (not file-level)
Each JSONL line is independently encrypted. This preserves:
- O(1) append writes (encrypt one record, append one line)
- Git diff friendliness (one changed line = one changed encrypted blob)
- Stream reading model (decrypt line-by-line)

### 3. Integration at repo-store layer
Encryption hooks are added in `repo-store.js` (primary read/write) and `merge.js` (refactored to use repo-store). The command layer (`flush`, `prepare`, `recall`) needs zero changes.

### 4. Decrypted index storage
The SQLite index stores plaintext for FTS search. The index is a rebuildable local cache — consistent with the architecture principle "本地索引可以删除重建."

### 5. Auto-detection for backward compatibility
Lines starting with `age-encryption.org/v1` (the age header marker) are treated as encrypted. All other lines are parsed as plaintext JSON. This allows mixed files during migration.

## Module: `src/encryption.js`

```javascript
// Core functions
export async function generateKeypair() → { publicKey, privateKey, keyPath }
export async function encryptLine(plaintext, config) → encryptedLine
export async function decryptLine(encryptedLine, config) → plaintext
export function loadEncryptionConfig(repoPath) → config | null
export function isEncrypted(line) → boolean
export async function checkAgeBinary() → { available, path, version }
```

### Key management
- Private key: `~/.mem-sync/age-key` (mode 0600)
- Config: `.mem-sync/meta/encryption.json`
- Password mode: not stored, entered interactively via `read()` with echo off

### Encrypt/decrypt implementation
```javascript
// Encrypt: pipe plaintext through age -r <public-key>
const { stdout } = await execFile('age', ['-r', config.publicKey], { input: plaintext });

// Decrypt: pipe ciphertext through age -d -i <private-key-path>
const { stdout } = await execFile('age', ['-d', '-i', config.privateKeyPath], { input: ciphertext });
```

## Modified: `src/repo-store.js`

Add conditional encrypt/decrypt in read/write functions:

```javascript
// In appendJSONL:
let line = JSON.stringify(record) + '\n';
const enc = loadEncryptionConfig(storePath);
if (enc) line = await encryptLine(line, enc);
await appendFile(storePath, line, 'utf8');

// In readJSONL:
for (const rawLine of lines) {
  let line = rawLine;
  if (isEncrypted(line)) line = await decryptLine(line, enc);
  records.push(JSON.parse(line));
}
```

## Refactored: `src/merge.js`

Refactor to use `repo-store.js` read/write instead of duplicating JSONL logic:
- Delete `readJSONLSync()` → use `readJSONL()` from repo-store
- Replace inline `writeFileSync` → use `writeJSONL()` from repo-store
- Make `mergePendingToStore()` async (callers are already async)
- `readPendingFiles()` converted from sync to async

## Modified: `src/index-store.js`

Add decrypt step in `rebuildIndex` before `JSON.parse`:
```javascript
for (const rawLine of rawLines) {
  let line = rawLine;
  if (isEncrypted(line)) line = await decryptLine(line, enc);
  const record = JSON.parse(line);
  // ... index as before
}
```

## CLI Changes

### `src/commands/init.js`
Add `--encrypt` and `--encrypt --password` flags:
- Generates keypair or configures password mode
- Writes `meta/encryption.json`

### New: `src/commands/key.js`
- `mem-sync key status` — show encryption config
- `mem-sync key export` — print private key path

## Error Handling

| Error | Behavior |
|-------|----------|
| `age` binary not found | Throw with install instructions |
| Wrong private key | `age` returns non-zero exit; throw descriptive error |
| Corrupted ciphertext | Skip line with warning (consistent with JSONL parse errors) |
| Missing private key file | Throw with key path and backup instructions |
| Password prompt interrupted | Throw with cancellation message |
