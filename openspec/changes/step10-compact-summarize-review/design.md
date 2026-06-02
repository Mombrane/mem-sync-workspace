# Design: compact, summarize, review pending

## Architecture

Three new command files following existing pattern:
- `src/commands/compact.js` — standalone compact command
- `src/commands/summarize.js` — standalone summarize command  
- `src/commands/review.js` — review pending command

Two new engine files:
- `src/compact-engine.js` — compact logic (reusable by flush --compact)
- `src/summarize-engine.js` — summarize logic (generates markdown)

CLI dispatcher updated in `src/cli.js`.

## compact-engine.js

### API
```js
/**
 * @param {Object} opts
 * @param {string} opts.storePath - path to memories.jsonl
 * @param {number} opts.olderThanDays - age threshold (default 30)
 * @param {boolean} opts.dryRun - preview only
 * @returns {{ candidates: number, duplicates: number, removed: number, kept: number }}
 */
export function compactMemories(opts)
```

### Algorithm
1. Read all records via `readJSONL(storePath)`
2. Filter candidates: `updatedAt < now - olderThanDays`, `confidence >= 0.8`, `deletedAt == null`, `validUntil == null || validUntil > now`
3. Group candidates by canonicalKey
4. For each group: keep record with latest updatedAt, mark others for removal
5. Merge: non-candidates + kept candidates
6. If not dryRun: backup storePath to storePath.bak, write merged records
7. Return stats

### Dedup strategy
- Tier 1 (MVP): Exact canonicalKey match via `buildCanonicalKey(scope, kind, contentHash)`
- Tier 2 (future): Jaccard similarity on tokenized content for same (scope, kind, projectId) groups

## summarize-engine.js

### API
```js
/**
 * @param {Object} opts
 * @param {string} opts.repoPath - path to memory repo root
 * @param {string} [opts.projectId] - project ID for project summary
 * @param {boolean} opts.force - overwrite existing files
 * @returns {{ profile: boolean, summary: boolean, project: boolean, memoryCount: number }}
 */
export function summarizeMemories(opts)
```

### Scoring
Inherits from context.js: `importance * 0.6 + recency * 0.4`

### Thresholds
- minConfidence: 0.6 (excludes low-quality episodes)
- minImportance: 0.3 (broad filter, lets scoring handle ranking)

### Output format

**profile.md**:
```markdown
# User Profile
Generated: <ISO timestamp> | Sources: N memories

## Preferences
- <content> (confidence: X.XX)

## Identity
- <content> (confidence: X.XX)
```

**summary.md**:
```markdown
# Memory Summary
Generated: <ISO timestamp> | Sources: N memories

## <Kind>
- <content> (importance: X.XX, updated: YYYY-MM-DD)
```

**projects/<id>/summary.md**:
```markdown
# Project Summary: <project-id>
Generated: <ISO timestamp> | Sources: N memories

## <Kind>
- <content> (importance: X.XX, updated: YYYY-MM-DD)
```

## review.js

### API
```js
// Command handler, follows existing pattern
export function reviewCommand(argv)
```

### Implementation
1. Parse args: `--kind`, `--full`, `--format` (markdown|json)
2. Read pending files via `readPendingFiles(pendingDir)` from merge.js
3. Filter by kind if specified
4. Format output: table with preview or full content
5. Write to stdout

## CLI integration

### cli.js changes
Add three new command branches:
```js
} else if (cmd === 'compact') {
  // ...
} else if (cmd === 'summarize') {
  // ...
} else if (cmd === 'review') {
  // ...
}
```

### flush.js integration
Add `--compact` flag:
- After mergePendingToStore (step 4)
- Before commit (step 5)
- Call compactMemories({ storePath, olderThanDays: 30, dryRun: false })

## Testing strategy

### compact-engine.test.js
- Test age filtering (records older/newer than threshold)
- Test confidence filtering (high/low confidence)
- Test deleted/expired exclusion
- Test dedup by canonicalKey (keeps latest)
- Test dryRun mode (no file modification)
- Test .bak backup creation
- Test stats returned correctly

### summarize-engine.test.js
- Test profile.md generation (user scope, preference/identity kinds)
- Test summary.md generation (global scope, all kinds)
- Test project summary generation
- Test force overwrite
- Test skip existing (no --force)
- Test threshold filtering
- Test metadata (timestamp, count)

### review.test.js
- Test basic pending display
- Test kind filtering
- Test full content mode
- Test empty pending directory

## File changes summary

New files:
- src/compact-engine.js (~80 lines)
- src/summarize-engine.js (~120 lines)
- src/commands/compact.js (~40 lines)
- src/commands/summarize.js (~50 lines)
- src/commands/review.js (~50 lines)
- tests/compact-engine.test.js (~80 lines)
- tests/summarize-engine.test.js (~80 lines)
- tests/review.test.js (~60 lines)

Modified files:
- src/cli.js (add 3 command branches)
- src/commands/flush.js (add --compact flag)
