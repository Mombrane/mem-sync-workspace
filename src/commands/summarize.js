import path from 'node:path';
import { summarizeMemories } from '../summarize-engine.js';

const DEFAULT_REPO = path.resolve(process.env.MEM_SYNC_HOME ?? '.mem-sync');

/**
 * summarize 命令：解析命令行参数，调用 summarizeEngine 生成摘要文件。
 *
 * 这是 `mem-sync summarize [options]` 的入口点。
 * 读取记忆库，生成 profile.md / summary.md / project summary.md 文件。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function summarizeCommand(args) {
  const opts = parseSummarizeArgs(args);
  const result = await summarizeMemories(opts);
  console.log(JSON.stringify(result, null, 2));
}

/**
 * 解析 summarize 命令的命令行参数。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ repoPath: string, projectId?: string, force: boolean }}
 */
export function parseSummarizeArgs(args) {
  let projectId;
  let force = false;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--project') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--project requires a value.');
      }
      projectId = raw;
      index += 2;
    } else if (arg === '--force') {
      force = true;
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

  const opts = { repoPath: repo, force };
  if (projectId !== undefined) {
    opts.projectId = projectId;
  }
  return opts;
}
