# Requirements: `retain --pending`

## R1: CLI Interface
- `mem-sync retain --transcript-file <path> --pending --device <id> [--project-id id] [--agent-id id]`
- `--pending` flag is **mandatory** in v1 — reject without it
- `--transcript-file` is **mandatory** — path to JSON transcript
- `--device` is **mandatory** — device identifier for pending file name
- `--project-id` and `--agent-id` are optional

## R2: Transcript Format
- Input: JSON array of `{ role: string, content: string }` objects
- Engine ignores unknown fields gracefully
- Empty array → write nothing, print `0`

## R3: Extraction Rules (MVP)
Priority order (first matching rule per message wins for that rule category):

| Pattern | Kind | Scope | Confidence | Veracity |
|---------|------|-------|------------|----------|
| 记住/remember/请记住/记一下 | preference | user | 0.95 | stated |
| 以后/默认/不要/总是/always/never/default | preference | user | 0.85 | stated |
| 决定/采用/选择/decided/chose/adopted | decision | project* | 0.8 | stated |
| 架构/命令/坑点/constraint/architecture/pitfall | project_fact | project* | 0.6 | inferred |
| (fallback — no rule matched, user messages only) | episode | global | 0.3 | inferred |

*When `projectId` is provided; otherwise `global`

## R4: Candidate Schema
Each candidate goes through `normalizeMemoryInput` to produce a full Schema v1 record:
- `source.type = 'retain'`
- `source.agent = agentId` (if provided)
- `source.device = deviceId`
- `evidence = [{ type: 'user_message', text: originalMessage }]`
- `content = extracted sentence/phrase`

## R5: Pending File
- Written to `.mem-sync/pending/<device-id>.jsonl` (relative to CWD)
- Uses `appendJSONL` from repo-store.js
- Dedup: skip candidates whose `createCanonicalKey` already exists in the pending file

## R6: Output
- stdout: candidate count (integer)
- stderr: diagnostic messages (errors, warnings)

## R7: Error Handling
| Condition | Behavior |
|-----------|----------|
| Missing `--pending` | Error: "retain requires --pending in v1", exit 1 |
| Missing `--transcript-file` | Error: "--transcript-file requires a value", exit 1 |
| Missing `--device` | Error: "--device requires a value", exit 1 |
| File not found | Error: "transcript file not found: <path>", exit 1 |
| Invalid JSON | Error: "invalid JSON in transcript file", exit 1 |
| Empty transcript | Write nothing, print 0, exit 0 |
