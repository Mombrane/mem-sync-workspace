# REQ-022 Requirements

## R1: LLM Redaction Parity in `retain`
- LLM-extracted records must pass the same `redactContent()` check as rule-engine candidates
- Blocked LLM records are logged and skipped (same behavior as rule-based)
- `--skip-redaction` flag applies to both rule-based and LLM records

## R2: Pre-Commit Redaction Gate in `flush`
- After merge completes, scan the merged store for secrets
- If any record is blocked by redaction rules, abort the commit
- Print clear error message listing blocked record IDs and matched rules
- Set `process.exitCode = 1` on block
- Do NOT silently drop records — user must review and fix

## R3: `--skip-redaction` Flag for `flush`
- Bypasses the pre-commit redaction scan
- Parity with `remember --skip-redaction` and `retain --skip-redaction`
- Default: redaction check enabled (no flag)

## R4: Test Coverage
- Test: flush with secret in pending → blocked before commit
- Test: flush with `--skip-redaction` → commit proceeds
- Test: retain with LLM-extracted secret → blocked
- Test: clean records → flush succeeds normally
