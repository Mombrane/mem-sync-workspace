import path from 'node:path';
import { readPendingFiles, findAndRemoveFromPending, removeAllPending } from '../merge.js';
import { normalizeMemoryInput } from '../schema.js';
import { appendJSONL } from '../repo-store.js';

const DEFAULT_REPO = path.resolve(process.env.MEM_SYNC_HOME ?? '.mem-sync');

const PREVIEW_LENGTH = 120;

/**
 * review 命令：解析命令行参数，显示 pending 目录中的待合并记录。
 *
 * 这是 `mem-sync review pending [options]` 的入口点。
 * 纯只读操作，不会修改任何文件。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function reviewCommand(args) {
  const opts = parseReviewArgs(args);
  const pendingDir = path.join(opts.repo, 'pending');

  const records = readPendingFiles(pendingDir);

  // Filter by kind if specified
  const filtered = opts.kind
    ? records.filter(r => r.kind === opts.kind)
    : records;

  // Format and output
  if (filtered.length === 0) {
    console.log('No pending records found.');
    return;
  }

  console.log(formatTable(filtered, opts.full));
}

/**
 * 解析 review 命令的命令行参数。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ repo: string, kind?: string, full: boolean }}
 */
export function parseReviewArgs(args) {
  let kind;
  let full = false;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === 'pending') {
      // 兼容直接调用 review pending 的情况（CLI 路由已剥离子命令）
      index += 1;
    } else if (arg === '--kind') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--kind requires a value.');
      }
      kind = raw;
      index += 2;
    } else if (arg === '--full') {
      full = true;
      index += 1;
    } else if (arg === '--repo') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--repo requires a value.');
      }
      repo = raw;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      index += 1;
    }
  }

  return { repo, kind, full };
}

/**
 * Format records as a markdown table.
 *
 * @param {Object[]} records - filtered records
 * @param {boolean} full - show full content instead of preview
 * @returns {string} markdown table string
 */
export function formatTable(records, full = false) {
  const lines = [];
  lines.push('| id | kind | scope | confidence | content | source | createdAt |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const r of records) {
    const id = r.id ?? '';
    const kind = r.kind ?? '';
    const scope = r.scope ?? '';
    const confidence = r.confidence != null ? String(r.confidence) : '';
    const rawContent = r.content ?? r.text ?? '';
    const content = full ? rawContent : preview(rawContent);
    const source = formatSource(r.source);
    const createdAt = r.createdAt ?? '';

    lines.push(
      `| ${id} | ${kind} | ${scope} | ${confidence} | ${content} | ${source} | ${createdAt} |`
    );
  }

  return lines.join('\n');
}

/**
 * Truncate content to PREVIEW_LENGTH characters.
 * @param {string} text
 * @returns {string}
 */
function preview(text) {
  const clean = text.replace(/\n/g, ' ');
  if (clean.length <= PREVIEW_LENGTH) return clean;
  return clean.slice(0, PREVIEW_LENGTH) + '…';
}

/**
 * Format source object or string.
 * @param {string|object} source
 * @returns {string}
 */
function formatSource(source) {
  if (typeof source === 'string') return source;
  return source?.agent ?? source?.type ?? 'unknown';
}

/**
 * approve 命令：批准 pending 记录并合并到 memories.jsonl。
 *
 * 支持两种模式：
 * - approve <id>：批准单条记录
 * - approve --all：批准所有 pending 记录
 *
 * 批准后记录从 pending/ 移除并追加到 memories.jsonl。
 *
 * @param {string[]} args - 命令行参数
 * @returns {Promise<void>}
 */
export async function approveCommand(args) {
  const opts = parseApproveArgs(args);
  const pendingDir = path.join(opts.repo, 'pending');
  const memoriesPath = path.join(opts.repo, 'memories.jsonl');

  if (opts.all) {
    const records = readPendingFiles(pendingDir);
    const ids = [];

    for (const record of records) {
      const normalized = normalizeMemoryInput(record);
      await appendJSONL(normalized, memoriesPath);
      ids.push(normalized.id);
    }

    const removed = removeAllPending(pendingDir);

    console.log(JSON.stringify({ approved: ids, count: ids.length }));
    return;
  }

  // Single ID approve
  const result = findAndRemoveFromPending(pendingDir, opts.id);
  if (!result.found) {
    console.error('mem-sync: no pending record with id: ' + opts.id);
    process.exitCode = 1;
    return;
  }

  const normalized = normalizeMemoryInput(result.record);
  await appendJSONL(normalized, memoriesPath);

  console.log(JSON.stringify({ approved: opts.id }));
}

/**
 * 解析 approve 命令的参数。
 *
 * @param {string[]} args
 * @returns {{ id: string|undefined, all: boolean, repo: string }}
 */
export function parseApproveArgs(args) {
  let id;
  let all = false;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--all') {
      all = true;
      index += 1;
    } else if (arg === '--repo') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--repo requires a value.');
      }
      repo = raw;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      id = arg;
      index += 1;
    }
  }

  if (!id && !all) {
    throw new Error(
      'approve requires a memory id or --all flag. Usage: mem-sync approve <id> [--repo <path>]'
    );
  }

  return { id, all, repo };
}

/**
 * reject 命令：拒绝 pending 记录，从 pending 目录移除。
 *
 * 支持两种模式：
 * - reject <id>：拒绝单条记录
 * - reject --all：拒绝所有 pending 记录
 *
 * 拒绝后记录从 pending/ 移除，不会写入 memories.jsonl。
 *
 * @param {string[]} args - 命令行参数
 * @returns {void}
 */
export function rejectCommand(args) {
  const opts = parseRejectArgs(args);
  const pendingDir = path.join(opts.repo, 'pending');

  if (opts.all) {
    const removed = removeAllPending(pendingDir);
    console.log(
      JSON.stringify({ rejected: removed.ids, count: removed.count })
    );
    return;
  }

  // Single ID reject
  const result = findAndRemoveFromPending(pendingDir, opts.id);
  if (!result.found) {
    console.error('mem-sync: no pending record with id: ' + opts.id);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ rejected: opts.id }));
}

/**
 * 解析 reject 命令的参数。
 *
 * @param {string[]} args
 * @returns {{ id: string|undefined, all: boolean, repo: string }}
 */
export function parseRejectArgs(args) {
  let id;
  let all = false;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--all') {
      all = true;
      index += 1;
    } else if (arg === '--repo') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--repo requires a value.');
      }
      repo = raw;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      id = arg;
      index += 1;
    }
  }

  if (!id && !all) {
    throw new Error(
      'reject requires a memory id or --all flag. Usage: mem-sync reject <id> [--repo <path>]'
    );
  }

  return { id, all, repo };
}
