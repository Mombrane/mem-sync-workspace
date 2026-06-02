# Requirements: compact, summarize, review pending

## R1: compact command

### R1.1 Basic operation
- Reads all memories from JSONL store
- Filters candidates: updatedAt < threshold, confidence >= 0.8, not deleted, not expired
- Deduplicates candidates by canonicalKey (keep latest updatedAt)
- Writes compacted result back to JSONL
- Creates .bak backup before overwriting

### R1.2 Age threshold
- Default: 30 days
- Configurable via `--older-than <days>`
- Only memories older than threshold are candidates

### R1.3 Dry run
- `--dry-run` flag shows what would be compacted without modifying files
- Output: count of candidates, duplicates found, records that would be removed

### R1.4 Integration with flush
- `flush --compact` runs compact after merge, before commit
- Default: compact disabled in flush (opt-in)

## R2: summarize command

### R2.1 profile.md generation
- Source: scope=user, kind in [preference, identity]
- Filter: confidence >= 0.6, not deleted/expired
- Output: grouped by kind, bullet points with confidence scores

### R2.2 summary.md generation
- Source: scope=global or scope=user
- Filter: importance >= 0.3, confidence >= 0.6
- Output: grouped by kind, sorted by importance

### R2.3 project summary generation
- `--project <path>` flag
- Source: projectId matches resolved project
- Output: projects/<id>/summary.md

### R2.4 Force overwrite
- `--force` flag overwrites existing summary files
- Default: skip if file exists

### R2.5 Metadata
- Generated timestamp in output
- Source memory count

## R3: review pending command

### R3.1 Basic display
- Lists all pending memories from pending/ directory
- Shows: id, kind, scope, confidence, content preview (120 chars), source agent, createdAt

### R3.2 Kind filtering
- `--kind <kind>` filters by memory kind
- Uses MEMORY_KINDS enum from schema.js

### R3.3 Full content
- `--full` flag shows complete content instead of preview

### R3.4 Output format
- Default: markdown table
- Consistent with other command outputs
