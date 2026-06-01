import { createHash } from 'node:crypto';
import { normalizeContent, normalizeMemoryInput } from './schema.js';

export function normalizeText(text) {
  return normalizeContent(text);
}

export function createMemoryStore({ now = () => new Date(), logger = defaultLogger } = {}) {
  return {
    add(text, options = {}) {
      log(logger, '[mem-sync:schema] normalize:start');
      const normalizedText = normalizeText(text);
      const legacyScope = options.scope ?? 'global';
      const scope = normalizeLegacyScope(legacyScope);
      const source = options.source ?? 'manual';
      const timestamp = typeof now === 'function' ? now() : now;
      const id = createMemoryId(normalizedText, legacyScope, legacySourceName(source));

      try {
        // 过渡期仍由 memory-store 接收旧 add(text, options) API，
        // 但返回值已经升级为 Schema v1，避免后续 JSONL 迁移时再做大规模形态转换。
        const memory = normalizeMemoryInput({
          ...options,
          id,
          content: normalizedText,
          scope,
          source,
          now: timestamp
        });

        log(logger, '[mem-sync:schema] validate:ok');
        log(logger, '[mem-sync:store] memory:accepted');
        return memory;
      } catch (error) {
        log(logger, `[mem-sync:schema] validate:error ${error.message}`);
        throw error;
      }

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

function legacySourceName(source) {
  if (typeof source === 'string') return source;
  return source?.agent ?? source?.type ?? 'manual';
}

function normalizeLegacyScope(scope) {
  // 旧原型和 README 示例使用 assistant；Schema v1 中对应 agent。
  // 在 store 边界做兼容映射，避免把旧命名泄漏进新的持久化 schema。
  return scope === 'assistant' ? 'agent' : scope;
}

function defaultLogger() {}

function log(logger, message) {
  if (typeof logger === 'function') {
    logger(message);
  }
}
