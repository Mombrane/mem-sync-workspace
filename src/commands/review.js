import path from 'node:path';
import os from 'node:os';
import { readPendingFiles } from '../merge.js';

const HOME = os.homedir();
const DEFAULT_REPO = path.join(HOME, '.memcli', 'default');

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
  let hasPendingSubcommand = false;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === 'pending') {
      hasPendingSubcommand = true;
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

  if (!hasPendingSubcommand) {
    throw new Error('review requires the "pending" subcommand.');
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
