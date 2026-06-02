import { readJSONL, writeJSONL } from './repo-store.js';
import { buildCanonicalKey } from './merge.js';
import fs from 'node:fs';

/**
 * Compact memories by removing duplicates and low-value records
 * @param {Object} opts
 * @param {string} opts.storePath - path to memories.jsonl
 * @param {number} [opts.olderThanDays=30] - age threshold in days
 * @param {boolean} [opts.dryRun=false] - preview only, don't modify files
 * @returns {{ candidates: number, duplicates: number, removed: number, kept: number, total: number }}
 */
export async function compactMemories(opts) {
  const { storePath, olderThanDays = 30, dryRun = false } = opts;
  const now = Date.now();
  const ageThreshold = now - olderThanDays * 86_400_000;

  // 1. Read all records
  const allRecords = await readJSONL(storePath);

  // 2. Split into candidates and non-candidates
  const candidates = [];
  const nonCandidates = [];

  for (const record of allRecords) {
    const updatedAt = new Date(record.updatedAt).getTime();
    const isOldEnough = updatedAt < ageThreshold;
    const hasHighConfidence = record.confidence >= 0.8;
    const isNotDeleted = record.deletedAt == null;
    const isNotExpired =
      record.validUntil == null || new Date(record.validUntil).getTime() > now;

    if (isOldEnough && hasHighConfidence && isNotDeleted && isNotExpired) {
      candidates.push(record);
    } else {
      nonCandidates.push(record);
    }
  }

  // 3. Group candidates by canonicalKey
  const groups = new Map();
  for (const record of candidates) {
    const key = buildCanonicalKey(record);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }

  // 4. For each group, keep the latest updatedAt, mark others for removal
  const keptCandidates = [];
  let duplicates = 0;

  for (const group of groups.values()) {
    // Sort descending by updatedAt so the first element is the latest
    group.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    keptCandidates.push(group[0]);
    duplicates += group.length - 1;
  }

  const removed = candidates.length - keptCandidates.length;
  const merged = [...nonCandidates, ...keptCandidates];

  // 6. If not dryRun, backup and write
  if (!dryRun) {
    fs.copyFileSync(storePath, `${storePath}.bak`);
    await writeJSONL(merged, storePath);
  }

  // 7. Return stats
  return {
    candidates: candidates.length,
    duplicates,
    removed,
    kept: keptCandidates.length,
    total: allRecords.length,
  };
}
