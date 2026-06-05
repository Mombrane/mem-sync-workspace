# REQ-022: Flush Redaction Gate

## Why

Design docs (§13, §17) specify that all write paths must pass through secret detector + redaction rules before committing to the repo. Currently, `flush` merges pending records into the store and commits/pushes without any redaction check. Additionally, LLM-extracted records in `retain` bypass the redaction check that rule-engine candidates receive.

This creates bypass vectors where secrets can reach the store:
1. `--skip-redaction` on retain → pending → flush merges unchecked
2. LLM-extracted records from retain are never scanned
3. Manually edited pending files
4. Records from versions before redaction existed

## What

1. Add redaction check for LLM records in `retain` (parity with rule-based)
2. Add pre-commit redaction gate in `flush` — scan merged store after merge, block commit if secrets found
3. Add `--skip-redaction` flag to `flush` for parity with remember/retain
4. Add test coverage for all new gates

## Scope

- `src/commands/retain.js` — LLM redaction fix (5 lines)
- `src/commands/flush.js` — pre-commit redaction gate (~20 lines)
- `tests/cli-redact.test.js` — new test cases (~30 lines)
