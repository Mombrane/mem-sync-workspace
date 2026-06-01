# Design: `retain --pending`

## Architecture

```
transcript.json
    ↓ read (command)
[{role, content}]
    ↓ extract (engine — pure function)
Candidate[]
    ↓ normalizeMemoryInput (schema.js)
Schema v1 record[]
    ↓ dedup against existing pending file
New records only
    ↓ appendJSONL (repo-store.js)
pending/<device>.jsonl
```

## Module Design

### `src/retain-engine.js` — Pure Extraction

```js
/**
 * Extract candidate memories from a transcript.
 * Pure function — no I/O, no side effects.
 *
 * @param {Array<{role: string, content: string}>} transcript
 * @param {{ projectId?: string, agentId?: string, now?: Date }} options
 * @returns {Array<Object>} candidates — partial memory inputs for normalizeMemoryInput
 */
export function extractCandidates(transcript, options = {})
```

**Internal rule structure** (data-driven):
```js
const RULES = [
  {
    name: 'explicit-remember',
    test: (msg) => /(?:记住|remember|请记住|记一下)/i.test(msg.content),
    extract: (msg) => ({
      content: extractSentence(msg.content, /(?:记住|remember|请记住|记一下)[:：]?\s*(.*)/i),
      kind: 'preference',
      scope: 'user',
      confidence: 0.95,
      veracity: 'stated'
    })
  },
  // ... more rules
];
```

Rules are applied per-message. Each rule returns a candidate or null. A message can match multiple rules (producing multiple candidates), but each rule only produces at most one candidate per message.

### `src/commands/retain.js` — CLI Command

```js
export async function retainCommand(args)
export function parseRetainArgs(args)
```

**Flow:**
1. Parse args with `parseRetainArgs`
2. Validate `--pending` flag present
3. Read transcript file with `readFile` + `JSON.parse`
4. Call `extractCandidates(transcript, options)`
5. For each candidate, call `normalizeMemoryInput` to get full Schema v1 record
6. Dedup against existing `pending/<device>.jsonl` using `createCanonicalKey`
7. Append new records via `appendJSONL`
8. Print count to stdout

### Dedup Strategy

```js
// Read existing pending records
const existingRecords = readJSONLSync(pendingPath);
const existingKeys = new Set(existingRecords.map(r => r.canonicalKey));

// Filter out duplicates
const newRecords = candidates.filter(c => !existingKeys.has(c.canonicalKey));
```

Uses `createCanonicalKey` from schema.js (full key: `kind:scope:projectId:agentId:contentHash`) for precise dedup.

### Source Object

```js
{
  type: 'retain',
  agent: options.agentId ?? null,
  device: deviceId
}
```

### Evidence Object

```js
[{
  type: 'user_message',
  text: originalMessage.content
}]
```

## File Dependencies

| File | Action | Purpose |
|------|--------|---------|
| `src/retain-engine.js` | CREATE | Pure extraction engine |
| `src/commands/retain.js` | CREATE | CLI command |
| `src/cli.js` | MODIFY | Register retain command |
| `tests/retain-engine.test.js` | CREATE | Engine unit tests |
| `tests/cli-retain.test.js` | CREATE | CLI integration tests |

## Integration Points

- **schema.js**: `normalizeMemoryInput`, `createCanonicalKey` — used by command for normalization and dedup
- **repo-store.js**: `appendJSONL`, `readJSONL` — used by command for I/O
- **merge.js**: `readPendingFiles` — compatible format (writes to same `pending/` directory)
- **cli.js**: Add `retain` branch to command router

## Non-Goals (v1)

- LLM-based extraction
- Stdin input (only `--transcript-file`)
- `retain` without `--pending` (permanent writes)
- Sentence splitting (match against full message)
- Cross-device dedup
