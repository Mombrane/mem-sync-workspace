import { join } from 'node:path';
import {
  searchIndex,
  getIndexStatus
} from '../index-store.js';
import { MEMORY_KINDS, MEMORY_SCOPES, MEMORY_VERACITIES } from '../schema.js';
import {
  requireValue,
  validateEnum,
  validateRange,
  validatePositiveInt
} from '../argparse.js';

const OUTPUT_FORMATS = ['markdown', 'json', 'memories'];

/**
 * 解析缓存目录路径（与 index 命令使用相同的默认值）。
 */
function resolveCacheDir() {
  const repoDir = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  return join(repoDir, '.cache');
}

/**
 * recall 命令：搜索记忆并以指定格式输出结果。
 *
 * 这是 `mem-sync recall <query> [options]` 的入口点。
 * 首先检查索引是否存在，然后调用 searchIndex 执行搜索，
 * 最后按指定格式格式化输出（默认 markdown）。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function recallCommand(args) {
  const { query, format, ...searchOptions } = parseRecallArgs(args);
  const cacheDir = resolveCacheDir();

  // 检查索引是否存在，以区分"无匹配"和"索引未构建"
  const indexStatus = getIndexStatus(cacheDir);

  if (!indexStatus.exists) {
    // 按格式输出"索引未构建"消息
    outputNoIndex(query, format);
    return;
  }

  // 执行搜索
  const results = searchIndex(cacheDir, { query, ...searchOptions });

  // 按格式输出结果
  switch (format) {
    case 'json':
      outputJSON(results, query);
      break;
    case 'memories':
      outputMemories(results);
      break;
    default:
      outputMarkdown(results, query);
      break;
  }
}

/**
 * 解析 recall 命令的命令行参数。
 *
 * 查询字符串来自所有不以 -- 开头的参数，用空格拼接。
 * 缺少查询触发错误（exit code 1）。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {object} 解析后的选项对象，包含 query、format 和所有 searchIndex 过滤条件
 * @throws {Error} 如果验证失败（空查询、未知标志、无效值等）
 */
export function parseRecallArgs(args) {
  const queryParts = [];
  const searchOptions = {
    limit: 20
  };
  let format = 'markdown';
  const tags = [];

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--format') {
      format = validateEnum(
        requireValue(args, index, '--format'),
        OUTPUT_FORMATS,
        '--format'
      );
      index += 2;
    } else if (arg === '--limit') {
      searchOptions.limit = validatePositiveInt(
        requireValue(args, index, '--limit'),
        '--limit'
      );
      index += 2;
    } else if (arg === '--scope') {
      searchOptions.scope = requireValue(args, index, '--scope');
      index += 2;
    } else if (arg === '--kind') {
      searchOptions.kind = requireValue(args, index, '--kind');
      index += 2;
    } else if (arg === '--tag') {
      tags.push(requireValue(args, index, '--tag'));
      index += 2;
    } else if (arg === '--min-confidence') {
      const raw = requireValue(args, index, '--min-confidence');
      const num = parseFloat(raw);
      if (!Number.isFinite(num)) {
        throw new Error('--min-confidence must be a number.');
      }
      searchOptions.minConfidence = validateRange(num, 0, 1, '--min-confidence');
      index += 2;
    } else if (arg === '--min-importance') {
      const raw = requireValue(args, index, '--min-importance');
      const num = parseFloat(raw);
      if (!Number.isFinite(num)) {
        throw new Error('--min-importance must be a number.');
      }
      searchOptions.minImportance = validateRange(num, 0, 1, '--min-importance');
      index += 2;
    } else if (arg === '--project-id') {
      searchOptions.projectId = requireValue(args, index, '--project-id');
      index += 2;
    } else if (arg === '--agent-id') {
      searchOptions.agentId = requireValue(args, index, '--agent-id');
      index += 2;
    } else if (arg === '--veracity') {
      searchOptions.veracity = requireValue(args, index, '--veracity');
      index += 2;
    } else if (arg === '--include-deleted') {
      searchOptions.excludeDeleted = false;
      index += 1;
    } else if (arg === '--include-expired') {
      searchOptions.excludeExpired = false;
      index += 1;
    } else if (arg.startsWith('--')) {
      // 未知标志：严格解析，立即报错
      throw new Error(`unknown option: ${arg}`);
    } else {
      // 非标志参数收集为查询词
      queryParts.push(arg);
      index += 1;
    }
  }

  const query = queryParts.join(' ');
  if (!query) {
    throw new Error('query is required.');
  }

  // 将累加的标签数组附加到搜索选项
  if (tags.length > 0) {
    searchOptions.tags = tags;
  }

  return { query, format, ...searchOptions };
}

// ─── 输出格式化 ────────────────────────────────────────────────────────

/**
 * 输出 Markdown 格式的搜索结果。
 * 人类可读，适用于终端直接查看。
 */
function outputMarkdown(results, query) {
  const count = results.length;

  // 表头
  process.stdout.write(`# Recall: "${query}" — ${count} result${count !== 1 ? 's' : ''}\n\n`);

  if (count === 0) {
    process.stdout.write('No matching memories found.\n');
    return;
  }

  results.forEach((memory, i) => {
    const rank = i + 1;
    const summaryText = (memory.summary ?? memory.content ?? '').slice(0, 80);
    const score = typeof memory._rank === 'number' ? memory._rank.toFixed(2) : 'N/A';
    const tags = memory.tags && memory.tags.length > 0 ? memory.tags : [];

    // 标题行
    process.stdout.write(`## ${rank}. [${memory.kind}] ${summaryText}\n`);
    // 分数和 ID
    process.stdout.write(`**Score:** ${score} (BM25) | **ID:** \`${memory.id}\`\n`);
    // 元数据行 1：scope, kind, confidence, importance
    process.stdout.write(
      `**Scope:** ${memory.scope} | **Kind:** ${memory.kind} | ` +
      `**Confidence:** ${memory.confidence} | **Importance:** ${memory.importance}\n`
    );

    // 元数据行 2：标签（如果有）
    if (tags.length > 0) {
      const tagSpans = tags.map(t => `\`${t}\``).join(', ');
      process.stdout.write(`**Tags:** ${tagSpans}\n`);
    }

    // 元数据行 3：创建/更新时间
    const created = memory.createdAt ?? 'unknown';
    const updated = memory.updatedAt ?? 'unknown';
    if (created === updated) {
      process.stdout.write(`**Created:** ${created}\n`);
    } else {
      process.stdout.write(`**Created:** ${created} | **Updated:** ${updated}\n`);
    }

    process.stdout.write('\n');

    // 内容（块引用格式）
    const content = memory.content ?? '';
    const lines = content.split('\n');
    for (const line of lines) {
      process.stdout.write(`> ${line}\n`);
    }

    process.stdout.write('\n');

    // 结果分隔符（最后一个结果后不加）
    if (i < count - 1) {
      process.stdout.write('---\n\n');
    }
  });
}

/**
 * 输出 JSON 格式的搜索结果。
 * 机器可读，适用于脚本管道消费（如 jq）。
 */
function outputJSON(results, query) {
  const output = {
    query,
    count: results.length,
    results: results.map((memory, i) => ({
      rank: i + 1,
      memory
    }))
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}

/**
 * 输出 memories 格式的搜索结果。
 * 专为 LLM agent 上下文注入设计，使用 [MEMORY]...[/MEMORY] 块。
 * 空结果或索引未构建时输出空字符串。
 */
function outputMemories(results) {
  for (const memory of results) {
    // BM25 rank 归一化到 0–1 范围：1 / (1 + abs(rank))
    // rank 值越小（越负）表示相关性越高，归一化后 1 表示最佳匹配
    const rawRank = typeof memory._rank === 'number' ? memory._rank : 0;
    const normalizedRank = (1 / (1 + Math.abs(rawRank))).toFixed(2);

    const attrs = [
      `id=${memory.id}`,
      `rank=${normalizedRank}`,
      `kind=${memory.kind}`,
      `scope=${memory.scope}`,
      `confidence=${memory.confidence}`,
      `importance=${memory.importance}`
    ];

    if (memory.tags && memory.tags.length > 0) {
      attrs.push(`tags=${memory.tags.join(',')}`);
    }

    process.stdout.write(`[MEMORY ${attrs.join(' ')}]\n`);

    // 转义内容中的 [/MEMORY] 序列，防止输出格式被意外截断
    const content = memory.content ?? '';
    const escaped = content.replace(/\[\/MEMORY\]/g, '[\\/MEMORY]');
    process.stdout.write(escaped + '\n');

    process.stdout.write('[/MEMORY]\n');
  }
}

/**
 * 输出"索引未构建"错误消息。
 * 消息格式取决于输出格式：
 * - markdown：人类可读引导消息
 * - json：结构化错误对象
 * - memories：空输出（安全地无条件注入到 agent 上下文）
 */
function outputNoIndex(query, format) {
  switch (format) {
    case 'json':
      process.stdout.write(JSON.stringify({
        error: 'INDEX_NOT_BUILT',
        message: 'Index not built. Run `mem-sync index rebuild` first.'
      }) + '\n');
      break;
    case 'memories':
      // memories 格式：空输出，agent 可以安全无条件注入
      break;
    default: // markdown
      process.stdout.write(`# Recall: "${query}"\n\n`);
      process.stdout.write('Index not built. Run `mem-sync index rebuild` first.\n');
      break;
  }
}
