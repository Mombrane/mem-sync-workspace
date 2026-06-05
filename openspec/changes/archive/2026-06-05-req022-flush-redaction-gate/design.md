# REQ-022 Technical Design

## Architecture

### Fix 1: LLM Redaction in `retain.js`

**Location:** `src/commands/retain.js`, lines 101-105

**Current code:**
```js
for (const llmRecord of llmRecords) {
  records.push(llmRecord);
}
```

**New code:**
```js
for (const llmRecord of llmRecords) {
  if (!options.skipRedaction) {
    const redactResult = redactContent(llmRecord.content);
    if (redactResult.blocked) {
      const matchedRules = redactResult.matches.map(m => m.rule).join(', ');
      console.error(`[mem-sync:redact] blocked LLM candidate: ${matchedRules}`);
      continue;
    }
  }
  records.push(llmRecord);
}
```

**Pattern:** Same as lines 88-95 for rule-based candidates. `redactContent` already imported at line 2.

### Fix 2: Pre-Commit Redaction Gate in `flush.js`

**Location:** `src/commands/flush.js`, between Step 4 (merge) and Step 5 (commit)

**Approach:** Scan only the NEWLY MERGED records (not the entire store) to avoid re-scanning old data. Use `mergeResult` to identify which records were just written.

Actually, scanning the full store is safer — it catches secrets from any source (skip-redaction, manual edits, migration). The store is small (hundreds to low thousands of records) so performance is not a concern.

**Implementation:**
1. Import `redactContent` from `../redaction-engine.js`
2. After merge (Step 4), read the store with `readJSONL` (already available)
3. Scan each record's `content` field
4. If any record is blocked, log the details, set `process.exitCode = 1`, return early
5. Add `--skip-redaction` CLI flag to bypass

**Key decision:** Scan the full store, not just merged records. This provides defense-in-depth.

### Fix 3: `--skip-redaction` CLI Flag

**Location:** `src/commands/flush.js` argument parsing

Add `--skip-redaction` to the options parser, same pattern as retain.js.

## Data Flow

```
pending records
  → merge (mergePendingToStore)
  → scan merged store (redactContent per record)
  → if blocked: abort, log, exit 1
  → if clean: stage → commit → push
```
