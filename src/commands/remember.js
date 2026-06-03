import { createMemoryStore } from '../memory-store.js';
import { resolveStorePath } from '../repo-store.js';
import { MEMORY_KINDS, MEMORY_SCOPES } from '../schema.js';
import {
  requireValue,
  validateEnum,
  validateRange
} from '../argparse.js';

/**
 * remember 命令：解析命令行参数，调用 memory-store 持久化新记忆。
 *
 * 这是 `mem-sync remember <content> [options]` 的入口点。
 * 解析后的选项通过 memoryStore.add(text, options) 传递给 normalizeMemoryInput，
 * 最终生成符合 Schema v1 的记录并追加写入 JSONL。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function rememberCommand(args) {
  const { content, options } = parseRememberArgs(args);
  const store = createMemoryStore({ logger: (message) => console.error(message) });
  const memory = await store.add(content, options);

  // stdout 仅输出记忆 ID，供脚本管道消费
  console.log(memory.id);
}

/**
 * 解析 remember 命令的命令行参数。
 *
 * 内容收集自所有不以 -- 开头的参数，用空格拼接。
 * 空内容触发错误（exit code 1）。
 * 未知标志触发错误（exit code 1）。
 * 重复标志 --tag 和 --supersedes 累加到数组中。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ content: string, options: object }} 解析后的内容和 store 选项
 * @throws {Error} 如果验证失败（空内容、未知标志、无效值等）
 */
export function parseRememberArgs(args) {
  const contentParts = [];
  const options = {};
  const tags = [];
  const supersedes = [];
  let sourceType = 'manual';
  let sourceAgent = undefined;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--kind') {
      options.kind = validateEnum(
        requireValue(args, index, '--kind'),
        MEMORY_KINDS,
        '--kind'
      );
      index += 2;
    } else if (arg === '--scope') {
      options.scope = validateEnum(
        requireValue(args, index, '--scope'),
        MEMORY_SCOPES,
        '--scope'
      );
      index += 2;
    } else if (arg === '--tag') {
      tags.push(requireValue(args, index, '--tag'));
      index += 2;
    } else if (arg === '--confidence') {
      const raw = requireValue(args, index, '--confidence');
      const num = parseFloat(raw);
      if (!Number.isFinite(num)) {
        throw new Error('--confidence must be a number.');
      }
      options.confidence = validateRange(num, 0, 1, '--confidence');
      index += 2;
    } else if (arg === '--importance') {
      const raw = requireValue(args, index, '--importance');
      const num = parseFloat(raw);
      if (!Number.isFinite(num)) {
        throw new Error('--importance must be a number.');
      }
      options.importance = validateRange(num, 0, 1, '--importance');
      index += 2;
    } else if (arg === '--project-id') {
      options.projectId = requireValue(args, index, '--project-id');
      index += 2;
    } else if (arg === '--agent-id') {
      options.agentId = requireValue(args, index, '--agent-id');
      index += 2;
    } else if (arg === '--source-type') {
      sourceType = requireValue(args, index, '--source-type');
      index += 2;
    } else if (arg === '--source-agent') {
      sourceAgent = requireValue(args, index, '--source-agent');
      index += 2;
    } else if (arg === '--valid-until') {
      options.validUntil = requireValue(args, index, '--valid-until');
      index += 2;
    } else if (arg === '--summary') {
      options.summary = requireValue(args, index, '--summary');
      index += 2;
    } else if (arg === '--supersedes') {
      supersedes.push(requireValue(args, index, '--supersedes'));
      index += 2;
    } else if (arg === '--skip-redaction') {
      options.skipRedaction = true;
      index += 1;
    } else if (arg === '--author') {
      options.author = requireValue(args, index, '--author');
      index += 2;
    } else if (arg === '--device') {
      options.device = requireValue(args, index, '--device');
      index += 2;
    } else if (arg === '--session') {
      options.session = requireValue(args, index, '--session');
      index += 2;
    } else if (arg.startsWith('--')) {
      // 未知标志：严格解析，立即报错
      throw new Error(`unknown option: ${arg}`);
    } else {
      // 非标志参数收集为内容
      contentParts.push(arg);
      index += 1;
    }
  }

  const content = contentParts.join(' ');
  if (!content) {
    throw new Error('content cannot be empty.');
  }

  // 构建 source 对象，传递给 normalizeMemoryInput
  // schema v1 需要 source.type 和可选的 source.agent
  options.source = { type: sourceType };
  if (sourceAgent) {
    options.source.agent = sourceAgent;
  }

  // 将累加的数组附加到选项
  if (tags.length > 0) {
    options.tags = tags;
  }
  if (supersedes.length > 0) {
    options.supersedes = supersedes;
  }

  return { content, options };
}
