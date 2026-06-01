import { createHash } from 'node:crypto';

export function normalizeText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Memory text must be a string.');
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new Error('Memory text cannot be empty.');
  }

  return normalized;
}

export function createMemoryStore({ now = () => new Date() } = {}) {
  return {
    add(text, options = {}) {
      const normalizedText = normalizeText(text);
      const scope = options.scope ?? 'global';
      const source = options.source ?? 'manual';
      const timestamp = typeof now === 'function' ? now() : now;
      const isoTimestamp = new Date(timestamp).toISOString();
      const id = createMemoryId(normalizedText, scope, source);

      return {
        id,
        text: normalizedText,
        scope,
        source,
        createdAt: isoTimestamp,
        updatedAt: isoTimestamp
      };
    }
  };
}

export function createMemoryId(text, scope = 'global', source = 'manual') {
  const digest = createHash('sha256')
    .update(`${scope}\0${source}\0${normalizeText(text)}`)
    .digest('hex')
    .slice(0, 12);

  return `mem_${digest}`;
}

export function mergeMemorySets(memorySets) {
  const byId = new Map();

  for (const memorySet of memorySets) {
    for (const memory of memorySet) {
      const current = byId.get(memory.id);
      if (!current || compareTimestamp(memory.updatedAt, current.updatedAt) > 0) {
        byId.set(memory.id, memory);
      }
    }
  }

  return [...byId.values()].sort((left, right) => {
    const timestampComparison = compareTimestamp(left.updatedAt, right.updatedAt);
    if (timestampComparison !== 0) return timestampComparison;
    return left.id.localeCompare(right.id);
  });
}

function compareTimestamp(left, right) {
  return new Date(left).getTime() - new Date(right).getTime();
}
