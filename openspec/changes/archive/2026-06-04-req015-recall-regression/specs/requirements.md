# REQ-015 Requirements

## FR-01: Golden Corpus Fixture
Create `tests/fixtures/recall-golden.jsonl` with ~20 carefully designed memory records covering 6 conflict scenarios:
1. New vs Old: same fact with different updatedAt timestamps
2. Veracity Conflict: stated > tool > inferred > unknown
3. Cross-Project: same content, different projectIds
4. Similar Text: content about similar topics but not identical
5. Team Sharing: personal > project > team scope priority (equal quality)
6. Deleted/Expired/Superseded: lifecycle filtering

## FR-02: Golden Manifest
Create `tests/fixtures/recall-golden-manifest.json` mapping each query to expected results using 4 assertion types:
- `expectedTopK`: strict top-K identity match
- `expectedOrder`: relative ordering constraint
- `expectedContains`: result must include these IDs
- `expectedNotContains`: result must exclude these IDs

## FR-03: Regression Test File
Create `tests/recall-regression.test.js` that:
- Loads golden corpus, writes to temp MEM_SYNC_HOME, rebuilds index
- For each query in manifest, runs recall and asserts against expected results
- Covers all 6 scenarios with ~10-15 test cases

## FR-04: Provenance Filter Tests
Add tests for provenance filters (--author, --device, --reviewer, --trust-tier) in the regression file.

## FR-05: Chain Supersedes Test
Add test for A→B→C chain supersedes scenario.

## FR-06: Team Scope Test
Add test verifying personal > project > team > global ordering when quality is equal.

## FR-07: ValidUntil Boundary Test
Add test for records that are exactly expired vs exactly valid.

## Constraints
- All tests must use ES module imports (project has "type": "module")
- Use `spawnSync` with CLI for end-to-end testing (consistent with existing tests)
- Must pass with full test suite (npm test)
