# Tasks: Encrypted Repo Support

## Task 1: Create encryption module (`src/encryption.js`)

**Files:**
- Create: `src/encryption.js`
- Create: `tests/encryption.test.js`

**Steps:**
1. Create `src/encryption.js` with:
   - `loadEncryptionConfig(repoPath)` — reads `.mem-sync/meta/encryption.json`, returns config or null
   - `isEncrypted(line)` — checks if line starts with age header marker
   - `checkAgeBinary()` — verifies `age` binary is available, returns version
   - `generateKeypair()` — calls `age-keygen`, returns publicKey + privateKeyPath
   - `encryptLine(plaintext, config)` — pipes through `age -r <key>`
   - `decryptLine(ciphertext, config)` — pipes through `age -d -i <keypath>`
2. Create `tests/encryption.test.js` with roundtrip, key generation, error handling tests
3. Run tests: `node --test tests/encryption.test.js`

**Dependencies:** None

---

## Task 2: Integrate encryption into repo-store.js

**Files:**
- Modify: `src/repo-store.js`
- Modify: `tests/memory-store.test.js` (add encryption tests)

**Steps:**
1. Import encryption functions in `repo-store.js`
2. Add `loadEncryptionConfig` call in `appendJSONL` — encrypt before write
3. Add decrypt step in `readJSONL` — decrypt after read, auto-detect
4. Add decrypt step in `readJSONLStream` — decrypt each line
5. Add decrypt step in `writeJSONL` — encrypt all lines before write
6. Add encryption tests to `tests/memory-store.test.js`
7. Run tests: `node --test tests/memory-store.test.js`

**Dependencies:** Task 1

---

## Task 3: Refactor merge.js to use repo-store

**Files:**
- Modify: `src/merge.js`
- Modify: `tests/merge.test.js`

**Steps:**
1. Remove `readJSONLSync()` from merge.js
2. Import `readJSONL` and `writeJSONL` from repo-store.js
3. Replace inline `readFileSync + split + JSON.parse` with `readJSONL()`
4. Replace inline `mkdirSync + writeFileSync` with `writeJSONL()`
5. Make `mergePendingToStore()` async
6. Convert `readPendingFiles()` from sync to async
7. Update callers: `prepare.js` and `flush.js` (add `await`)
8. Update tests in `tests/merge.test.js`
9. Run tests: `node --test tests/merge.test.js`

**Dependencies:** Task 2

---

## Task 4: Add encryption to index-store.js

**Files:**
- Modify: `src/index-store.js`
- Modify: `tests/index-store.test.js`

**Steps:**
1. Import `isEncrypted` and `decryptLine` from encryption.js
2. In `rebuildIndex`, add decrypt step before `JSON.parse` for each line
3. Handle missing key gracefully (skip encrypted lines with warning)
4. Add encryption index tests to `tests/index-store.test.js`
5. Run tests: `node --test tests/index-store.test.js`

**Dependencies:** Task 2

---

## Task 5: Add CLI commands (init --encrypt, key status, key export)

**Files:**
- Modify: `src/commands/init.js`
- Create: `src/commands/key.js`
- Modify: `src/cli.js`
- Create: `tests/cli-key.test.js`

**Steps:**
1. Add `--encrypt` and `--password` flags to `init` command
2. Create `src/commands/key.js` with `keyStatusCommand` and `keyExportCommand`
3. Register `key` command in `src/cli.js`
4. Update help text
5. Create `tests/cli-key.test.js`
6. Run tests: `node --test tests/cli-key.test.js`

**Dependencies:** Task 1
