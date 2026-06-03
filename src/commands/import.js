import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeMemoryInput } from '../schema.js';
import { appendJSONL, readJSONL, resolveLegacyStorePath, resolveStorePath } from '../repo-store.js';

export async function importCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'legacy') {
    throw new Error('import requires subcommand: legacy');
  }

  const opts = parseImportLegacyArgs(rest);
  const storePath = opts.storePath ?? resolveStorePath();
  const legacyPath = opts.legacyPath ?? resolveLegacyStorePath(dirname(storePath));

  const parsed = JSON.parse(await readFile(legacyPath, 'utf8'));
  const legacyMemories = Array.isArray(parsed?.memories) ? parsed.memories : [];
  const existing = await readJSONL(storePath);
  const existingKeys = new Set(existing.map(record => record.canonicalKey));

  let imported = 0;
  let skipped = 0;
  for (const memory of legacyMemories) {
    const normalized = normalizeMemoryInput({
      content: memory.content ?? memory.text,
      kind: memory.kind,
      scope: memory.scope,
      source: typeof memory.source === 'string' ? { type: memory.source } : memory.source,
      projectId: memory.projectId,
      agentId: memory.agentId,
      evidence: memory.evidence,
      confidence: memory.confidence,
      veracity: memory.veracity,
      importance: memory.importance,
      tags: memory.tags,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      validUntil: memory.validUntil,
      deletedAt: memory.deletedAt,
      supersedes: memory.supersedes
    });

    if (existingKeys.has(normalized.canonicalKey)) {
      skipped += 1;
      continue;
    }
    await appendJSONL(normalized, storePath);
    existingKeys.add(normalized.canonicalKey);
    imported += 1;
  }

  console.log(JSON.stringify({ imported, skipped, total: legacyMemories.length }));
}

export function parseImportLegacyArgs(args) {
  const opts = {};
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--from') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--from requires a value.');
      opts.legacyPath = value;
      index += 2;
    } else if (arg === '--to') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--to requires a value.');
      opts.storePath = value;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}
