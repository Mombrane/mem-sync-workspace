import path from 'node:path';
import { compactMemories } from '../compact-engine.js';

const DEFAULT_REPO = path.resolve(process.env.MEM_SYNC_HOME ?? '.mem-sync');

/**
 * compact 命令：解析命令行参数，调用 compactEngine 去重合并。
 *
 * 这是 `mem-sync compact [options]` 的入口点。
 * 按 canonicalKey 去重高置信度、旧记录，并输出统计 JSON。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function compactCommand(args) {
  const opts = parseCompactArgs(args);
  const result = await compactMemories(opts);
  console.log(JSON.stringify(result, null, 2));
}

/**
 * 解析 compact 命令的命令行参数。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ storePath: string, olderThanDays: number, dryRun: boolean }}
 */
export function parseCompactArgs(args) {
  let olderThanDays = 30;
  let dryRun = false;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--older-than') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--older-than requires a value.');
      }
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 0) {
        throw new Error('--older-than must be a non-negative integer.');
      }
      olderThanDays = num;
      index += 2;
    } else if (arg === '--dry-run') {
      dryRun = true;
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

  const storePath = path.join(repo, 'memories.jsonl');
  return { storePath, olderThanDays, dryRun };
}
