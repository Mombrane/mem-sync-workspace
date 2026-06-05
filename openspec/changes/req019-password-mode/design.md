# Design: Password Encryption Mode (REQ-019)

## Architecture

### Hybrid approach
- `mode: 'age'` → existing `age` binary (key-based, unchanged)
- `mode: 'password'` → `age-encryption` JS library (passphrase-based, no TTY needed)

### Password source
`MEM_SYNC_PASSWORD` environment variable. If not set, throw clear error.

### Module changes

#### `src/encryption.js`
1. Import `Encrypter`, `Decrypter` from `age-encryption`
2. Add helper `getPasswordFromEnv()` — reads `MEM_SYNC_PASSWORD`, throws if missing
3. Modify `encryptLine()`:
   - If `config.mode === 'password'`: use `new Encrypter()`, `setPassphrase(password)`, `await enc.encrypt(plaintext, 'text')`
   - Return the armored ciphertext string (starts with `age-encryption.org/v1`)
4. Modify `decryptLine()`:
   - If `config.mode === 'password'`: use `new Decrypter()`, `addPassphrase(password)`, `await dec.decrypt(ciphertext, 'text')`
5. Modify `decryptLineSync()`:
   - If `config.mode === 'password'`: spawn `node -e "..."` via `execFileSync` that uses the async JS library
   - Pass ciphertext via stdin, password via env var, get plaintext from stdout
   - This keeps the sync interface while using the async library internally

#### `tests/encryption.test.js`
- Add tests for password mode encrypt/decrypt roundtrip
- Add test for missing `MEM_SYNC_PASSWORD` env var
- Add test for `decryptLineSync` password mode
- Add test for compatibility: encrypt with JS lib, decrypt with age CLI (if age supports it)

### Compatibility
The `age-encryption` JS library produces output compatible with the `age` CLI (same format: `age-encryption.org/v1`). However, `age -d` for password mode also needs `/dev/tty` for passphrase prompt, so CLI compatibility testing may be limited.

### Config structure
```json
{
  "version": 1,
  "mode": "password",
  "publicKeys": []
}
```
No additional fields needed — password comes from env var at runtime.
