# REQ-015 Tasks

## Task 1: Create Golden Corpus Fixture
**Files:** `tests/fixtures/recall-golden.jsonl`
**Description:** Create ~20 memory records in JSONL format covering 6 conflict scenarios (new-vs-old, veracity, cross-project, similar-text, team-sharing, deleted/expired/superseded) plus chain supersedes.

## Task 2: Create Golden Manifest
**Files:** `tests/fixtures/recall-golden-manifest.json`
**Description:** Create JSON manifest mapping each query to expected results using assertion types (expectedTopK, expectedOrder, expectedContains, expectedNotContains, expectedCount).

## Task 3: Create Regression Test File
**Files:** `tests/recall-regression.test.js`
**Description:** Create test file that:
- Loads golden corpus, writes to temp MEM_SYNC_HOME, rebuilds index
- For each query in manifest, runs recall via CLI and asserts against expected
- Includes provenance filter tests (--author, --device, --reviewer, --trust-tier)
- Includes chain supersedes test
- Includes team scope ordering test
- Includes validUntil boundary test
- Uses ES module imports (project has "type": "module")
- Uses `spawnSync` for CLI calls (consistent with existing tests)

## Dependencies
- Task 1 and 2 can be done in parallel
- Task 3 depends on Task 1 and 2
