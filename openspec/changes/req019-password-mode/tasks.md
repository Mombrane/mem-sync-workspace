# Tasks: REQ-019 Password Mode

## Task 1: Implement password mode in encryptLine/decryptLine/decryptLineSync
**Files:** `src/encryption.js`
**Dependencies:** none

Changes:
1. Add `import { Encrypter, Decrypter } from 'age-encryption'` at top
2. Add `getPasswordFromEnv()` helper that reads `process.env.MEM_SYNC_PASSWORD`, throws descriptive error if missing
3. In `encryptLine()`: replace password throw with actual implementation using `Encrypter`
4. In `decryptLine()`: replace password throw with actual implementation using `Decrypter`
5. In `decryptLineSync()`: replace password throw with `execFileSync('node', ['-e', script])` that uses the async JS library internally

## Task 2: Add password mode tests
**Files:** `tests/encryption.test.js`
**Dependencies:** Task 1

Changes:
1. Update existing "password mode throws" tests to instead test successful encrypt/decrypt roundtrip
2. Add test: encrypt with password, decrypt with password → same plaintext
3. Add test: missing MEM_SYNC_PASSWORD throws descriptive error
4. Add test: decryptLineSync with password mode works
5. Add test: wrong password fails to decrypt
6. Add test: encrypted output starts with `age-encryption.org/v1` header (isEncrypted returns true)
