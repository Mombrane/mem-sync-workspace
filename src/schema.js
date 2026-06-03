import { createHash } from 'node:crypto';

export const MEMORY_KINDS = ['preference', 'identity', 'project_fact', 'decision', 'workflow', 'correction', 'warning', 'episode'];
// 'user' is deprecated — retained for backward compatibility with existing records.
// New code should use 'personal' for user-scoped memories.
export const MEMORY_SCOPES = ['personal', 'project', 'agent', 'global', 'local-only', 'team', 'user'];
export const MEMORY_VERACITIES = ['stated', 'inferred', 'tool', 'imported', 'unknown'];
export const VERACITY_SCORES = {
  stated: 1.0,
  tool: 0.9,
  inferred: 0.5,
  imported: 0.5,
  unknown: 0.3
};

const HASH_LENGTH = 12;
const SUMMARY_LENGTH = 120;

// 统一内容规范化入口：所有持久化和去重逻辑都必须基于同一份单行文本，
// 否则 JSONL 合并、canonicalKey 和召回索引会因为空白差异产生重复记录。
export function normalizeContent(content) {
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string.');
  }

  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    throw new Error('content cannot be empty.');
  }

  return normalized;
}

export function normalizeMemoryInput(input = {}) {
  const content = normalizeContent(input.content ?? input.text);
  const kind = input.kind ?? 'episode';
  const scope = input.scope ?? 'global';
  const source = normalizeSource(input.source);
  const timestamp = toIsoTimestamp(input.now ?? new Date(), 'now');
  // v1 记录显式保存 schemaVersion 和生命周期字段，目的是让未来 JSONL
  // 数据即使经历 Git 历史、导入导出或后续 schema migration，也能判断记录语义。
  const memory = {
    schemaVersion: 1,
    kind,
    scope,
    projectId: input.projectId ?? null,
    agentId: input.agentId ?? source.agent ?? null,
    content,
    summary: normalizeSummary(input.summary, content),
    source,
    // 这些集合字段默认空数组，而不是 null，方便后续索引、过滤和 JSONL diff。
    evidence: normalizeArray(input.evidence, 'evidence'),
    confidence: input.confidence ?? defaultConfidence(source),
    veracity: input.veracity ?? defaultVeracity(source),
    importance: input.importance ?? 0.5,
    createdAt: toIsoTimestamp(input.createdAt ?? timestamp, 'createdAt'),
    updatedAt: toIsoTimestamp(input.updatedAt ?? timestamp, 'updatedAt'),
    // 生命周期字段使用 null 表示“未设置”，保留字段本身是为了支持软删除、过期和审计。
    validUntil: normalizeNullableTimestamp(input.validUntil, 'validUntil'),
    deletedAt: normalizeNullableTimestamp(input.deletedAt, 'deletedAt'),
    supersedes: normalizeArray(input.supersedes, 'supersedes'),
    tags: normalizeArray(input.tags, 'tags'),
    // Provenance fields: optional, default null. Old records missing these fields
    // pass validateMemory without error. They are filled by remember/retain/approve.
    author: input.author ?? null,
    device: input.device ?? null,
    session: input.session ?? null,
    reviewer: input.reviewer ?? null,
    reviewedAt: normalizeNullableTimestamp(input.reviewedAt, 'reviewedAt'),
    trustTier: input.trustTier ?? null
  };

  // canonicalKey 表达“语义去重”的边界；id 仍然是短标识符，二者职责分离。
  const canonicalKey = createCanonicalKey(memory);
  const id = input.id ?? createMemoryIdFromCanonicalKey(canonicalKey);
  const completeMemory = { id, canonicalKey, ...memory };

  return validateMemory(completeMemory);
}

export function validateMemory(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) {
    throw new TypeError('memory must be an object.');
  }

  // 校验错误必须包含字段名，CLI 可以直接把错误展示给用户，测试也能定位失败字段。
  requireEqual(memory.schemaVersion, 1, 'schemaVersion');
  requireString(memory.id, 'id');
  requireString(memory.canonicalKey, 'canonicalKey');
  requireEnum(memory.kind, MEMORY_KINDS, 'kind');
  requireEnum(memory.scope, MEMORY_SCOPES, 'scope');
  requireString(memory.content, 'content');
  requireString(memory.summary, 'summary');
  requireObject(memory.source, 'source');
  requireArray(memory.evidence, 'evidence');
  requireNumberInRange(memory.confidence, 0, 1, 'confidence');
  requireEnum(memory.veracity, MEMORY_VERACITIES, 'veracity');
  requireNumberInRange(memory.importance, 0, 1, 'importance');
  requireIsoTimestamp(memory.createdAt, 'createdAt');
  requireIsoTimestamp(memory.updatedAt, 'updatedAt');
  requireNullableIsoTimestamp(memory.validUntil, 'validUntil');
  requireNullableIsoTimestamp(memory.deletedAt, 'deletedAt');
  requireArray(memory.supersedes, 'supersedes');
  requireArray(memory.tags, 'tags');

  return memory;
}

export function createCanonicalKey(memory) {
  const content = normalizeContent(memory.content ?? memory.text);
  const kind = memory.kind ?? 'episode';
  const scope = memory.scope ?? 'global';
  const source = normalizeSource(memory.source);
  const projectId = memory.projectId ?? '';
  const agentId = memory.agentId ?? source.agent ?? '';
  // key 中保留 kind/scope/project/agent，避免同一句话在不同上下文中被错误合并。
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, HASH_LENGTH);

  return `${kind}:${scope}:${projectId}:${agentId}:${contentHash}`;
}

export function createMemoryIdFromCanonicalKey(canonicalKey) {
  const digest = createHash('sha256').update(canonicalKey).digest('hex').slice(0, HASH_LENGTH);
  return `mem_${digest}`;
}

function normalizeSource(source) {
  if (source === undefined || source === null) {
    return { type: 'manual' };
  }

  // 兼容旧 CLI 的 --source codex 字符串输入；schema v1 内部统一为来源对象。
  if (typeof source === 'string') {
    return { type: 'manual', agent: source };
  }

  requireObject(source, 'source');
  requireString(source.type, 'source.type');
  return { ...source };
}

function normalizeSummary(summary, content) {
  if (summary === undefined || summary === null) {
    return [...content].slice(0, SUMMARY_LENGTH).join('');
  }

  return normalizeContent(summary);
}

function defaultConfidence(source) {
  // 手动写入视为用户明确陈述，默认可信度最高；工具/导入/推断来源保守处理。
  return source.type === 'manual' ? 1 : 0.5;
}

function defaultVeracity(source) {
  // veracity 描述“这条记忆如何被确认”，后续 recall 排序会依赖这个信号。
  return source.type === 'manual' ? 'stated' : 'unknown';
}

function normalizeArray(value, field) {
  if (value === undefined || value === null) return [];
  requireArray(value, field);
  return [...value];
}

function normalizeNullableTimestamp(value, field) {
  if (value === undefined || value === null) return null;
  return toIsoTimestamp(value, field);
}

function toIsoTimestamp(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`${field} must be a valid ISO timestamp.`);
  }
  return date.toISOString();
}

function requireEqual(value, expected, field) {
  if (value !== expected) {
    throw new Error(`${field} must be ${expected}.`);
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
  }
}

function requireNumberInRange(value, min, max, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}.`);
  }
}

function requireIsoTimestamp(value, field) {
  requireString(value, field);
  toIsoTimestamp(value, field);
}

function requireNullableIsoTimestamp(value, field) {
  if (value === null) return;
  requireIsoTimestamp(value, field);
}

/**
 * Compute the trust tier for a memory record based on reviewer status, source type, and confidence.
 *
 * Rules:
 *   - 'high':     reviewer is set AND confidence >= 0.7
 *   - 'medium':   reviewer is set OR (source.type === 'manual' AND confidence >= 0.5)
 *   - 'low':      source.type in ['inferred', 'imported'] (no reviewer)
 *   - 'untrusted': confidence < 0.3 AND no reviewer
 *   - fallback:   'medium'
 *
 * @param {object} record - A validated memory record
 * @returns {'high'|'medium'|'low'|'untrusted'} The computed trust tier
 */
export function computeTrustTier(record) {
  const hasReviewer = record.reviewer != null && record.reviewer !== '';
  const confidence = record.confidence ?? 0;
  const sourceType = record.source?.type ?? 'manual';

  if (hasReviewer && confidence >= 0.7) {
    return 'high';
  }
  if (hasReviewer || (sourceType === 'manual' && confidence >= 0.5)) {
    return 'medium';
  }
  if (sourceType === 'inferred' || sourceType === 'imported') {
    return 'low';
  }
  if (confidence < 0.3) {
    return 'untrusted';
  }
  return 'medium';
}

/**
 * Compute a quality multiplier for ranking based on confidence, importance, and veracity.
 * Returns a value in [0, 1] where higher = better quality.
 */
export function getQualityMultiplier(record) {
  const confidence = record.confidence ?? 0.5;
  const importance = record.importance ?? 0.5;
  const veracityScore = VERACITY_SCORES[record.veracity] ?? 0.3;
  return (confidence + importance + veracityScore) / 3;
}
