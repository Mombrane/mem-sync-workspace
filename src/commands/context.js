import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { resolveProjectId } from '../project-resolver.js';
import { getIndexStatus } from '../index-store.js';
import { MEMORY_KINDS, MEMORY_SCOPES } from '../schema.js';
import {
  requireValue,
  validateEnum,
  validatePositiveInt
} from '../argparse.js';

const OUTPUT_FORMATS = ['markdown', 'json', 'memories'];
const MODES = ['startup', 'recall'];

/**
 * context 命令：组装 session 启动上下文。
 *
 * 读取 .mem-sync 下的摘要文件（profile.md、summary.md、projects/<id>/summary.md），
 * 并在 recall 模式下查询索引中的工作记忆。输出格式化的上下文，
 * 供 LLM agent 在启动时注入。
 *
 * 这是 `mem-sync context [options]` 的入口点。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function contextCommand(args) {
  const parsed = parseContextArgs(args);
  const cwd = parsed.project ? parsed.project : process.cwd();
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const cacheDir = join(memSyncHome, '.cache');

  // 解析项目 ID
  const projectId = resolveProjectId(cwd, parsed.projectId);

  // 读取摘要文件
  const profile = readSummaryFile(memSyncHome, 'profile.md');
  const summary = readSummaryFile(memSyncHome, 'summary.md');
  const projectSummary = readSummaryFile(memSyncHome, `projects/${projectId}/summary.md`);

  // 查询工作记忆（仅 recall 模式）
  let memories = [];
  if (parsed.mode === 'recall') {
    try {
      const indexStatus = getIndexStatus(cacheDir);
      if (!indexStatus.exists) {
        console.error('mem-sync: index not built — continuing with file-only context');
      } else {
        memories = queryWorkingMemories(cacheDir, projectId, parsed.limit);
      }
    } catch (err) {
      console.error(`mem-sync: index query warning — ${err.message}`);
    }
  }

  // 按格式输出
  switch (parsed.format) {
    case 'json':
      outputContextJson(profile, summary, projectSummary, memories, projectId);
      break;
    case 'memories':
      outputContextMemories(profile, summary, projectSummary, memories, projectId);
      break;
    default:
      outputContextMarkdown(profile, summary, projectSummary, memories, projectId);
      break;
  }
}

/**
 * 解析 context 命令的命令行参数。
 *
 * 使用与 recall.js 相同的手写解析模式：
 * - `--project <path>`: 项目目录路径（用于项目 ID 派生）
 * - `--project-id <id>`: 显式项目 ID
 * - `--mode <mode>`: startup | recall（默认 startup）
 * - `--format <fmt>`: markdown | json | memories（默认 markdown）
 * - `--limit <n>`: 正整数，召回模式下的最大记忆数量（默认 5）
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {object} 解析后的选项对象
 * @throws {Error} 如果验证失败
 */
export function parseContextArgs(args) {
  let project = null;
  let projectId = null;
  let mode = 'startup';
  let format = 'markdown';
  let limit = 5;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--project') {
      project = requireValue(args, index, '--project');
      index += 2;
    } else if (arg === '--project-id') {
      projectId = requireValue(args, index, '--project-id');
      index += 2;
    } else if (arg === '--mode') {
      mode = validateEnum(
        requireValue(args, index, '--mode'),
        MODES,
        '--mode'
      );
      index += 2;
    } else if (arg === '--format') {
      format = validateEnum(
        requireValue(args, index, '--format'),
        OUTPUT_FORMATS,
        '--format'
      );
      index += 2;
    } else if (arg === '--limit') {
      limit = validatePositiveInt(
        requireValue(args, index, '--limit'),
        '--limit'
      );
      index += 2;
    } else if (arg.startsWith('--')) {
      // 未知标志：严格解析，立即报错
      throw new Error(`unknown option: ${arg}`);
    } else {
      // 非标志参数：静默忽略（与 design.md 决策一致）
      index += 1;
    }
  }

  return { project, projectId, mode, format, limit };
}

/**
 * 同步读取摘要文件。
 * ENOENT 不视为错误 — 返回 null，表示文件不存在。
 * 其他 I/O 错误向上抛出。
 *
 * @param {string} memSyncHome - .mem-sync 目录路径
 * @param {string} relativePath - 相对于 memSyncHome 的文件路径
 * @returns {string|null} 文件内容，若文件不存在则返回 null
 */
function readSummaryFile(memSyncHome, relativePath) {
  try {
    return readFileSync(join(memSyncHome, relativePath), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

/**
 * 查询工作记忆并按重要性 + 新鲜度复合分数排序。
 *
 * 复合分数 = importance * 0.6 + recencyNormalized * 0.4
 * - recencyNormalized: 今天为 1.0，线性衰减至 90 天后为 0
 *
 * 与 recall 命令不同，context recall 没有文本查询——它检索所有匹配
 * 项目的活跃记忆并根据复合分数排序。因此我们直接查询 memories 表
 * 而不是通过 FTS5（FTS5 需要查询字符串才能执行 MATCH）。
 *
 * @param {string} cacheDir - 索引数据库缓存目录
 * @param {string} projectId - 项目标识符
 * @param {number} limit - 返回的最大记忆数量
 * @returns {object[]} 按复合分数降序排列的记忆数组
 */
function queryWorkingMemories(cacheDir, projectId, limit) {
  const dbPath = join(cacheDir, 'index.sqlite');
  if (!existsSync(dbPath)) {
    return [];
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  let rows = [];
  try {
    const nowIso = new Date().toISOString();

    rows = db.prepare(`
      SELECT *
      FROM memories
      WHERE (project_id IS NULL OR project_id = @projectId)
        AND deleted_at IS NULL
        AND (valid_until IS NULL OR valid_until >= @nowIso)
      ORDER BY rowid
    `).all({ projectId, nowIso });

    // 将数据库行映射为 Schema v1 记录格式
    const records = rows.map(row => ({
      schemaVersion: 1,
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      projectId: row.project_id ?? null,
      agentId: row.agent_id ?? null,
      content: row.content,
      summary: row.summary,
      source: safeParseJSON(row.source_json, { type: 'unknown' }),
      evidence: safeParseJSON(row.evidence_json, []),
      confidence: row.confidence,
      importance: row.importance,
      veracity: row.veracity,
      tags: safeParseJSON(row.tags_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      validUntil: row.valid_until ?? null,
      deletedAt: row.deleted_at ?? null,
      supersedes: safeParseJSON(row.supersedes_json, []),
      canonicalKey: null
    }));

    return records
      .map(memory => ({ memory, score: computeContextScore(memory) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item, i) => {
        item.memory._contextRank = i + 1;
        item.memory._contextScore = item.score;
        return item.memory;
      });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * 安全解析 JSON，失败时返回默认值。
 */
function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * 计算上下文排序的复合分数。
 *
 * @param {object} memory - Schema v1 记忆记录
 * @returns {number} 0-1 范围内的复合分数
 */
function computeContextScore(memory) {
  const importance = memory.importance ?? 0.5;
  const daysSinceUpdate = Math.max(0, (Date.now() - new Date(memory.updatedAt).getTime()) / 86400000);
  const recency = Math.max(0, 1 - daysSinceUpdate / 90);
  return importance * 0.6 + recency * 0.4;
}

// ─── 输出格式化 ────────────────────────────────────────────────────────

/**
 * 输出 Markdown 格式的上下文。
 * 人类可读，与 recall.js 的 Markdown 风格保持一致。
 */
function outputContextMarkdown(profile, summary, projectSummary, memories, projectId) {
  process.stdout.write(`# Context for ${projectId}\n\n`);

  // 用户画像
  process.stdout.write('## Profile\n');
  if (profile) {
    const lines = profile.split('\n');
    for (const line of lines) {
      process.stdout.write(`> ${line}\n`);
    }
  } else {
    process.stdout.write('> *(no profile configured)*\n');
  }
  process.stdout.write('\n');

  // 全局摘要
  process.stdout.write('## Global Summary\n');
  if (summary) {
    const lines = summary.split('\n');
    for (const line of lines) {
      process.stdout.write(`> ${line}\n`);
    }
  } else {
    process.stdout.write('> *(no global summary)*\n');
  }
  process.stdout.write('\n');

  // 项目摘要
  process.stdout.write('## Project Summary\n');
  if (projectSummary) {
    const lines = projectSummary.split('\n');
    for (const line of lines) {
      process.stdout.write(`> ${line}\n`);
    }
  } else {
    process.stdout.write('> *(no project summary)*\n');
  }

  // 近期工作记忆
  if (memories && memories.length > 0) {
    process.stdout.write('\n');
    process.stdout.write('## Recent Working Memories\n');
    memories.forEach((memory, i) => {
      const rank = i + 1;
      const summaryText = (memory.summary ?? memory.content ?? '').slice(0, 80);
      const importance = memory.importance ?? 0.5;
      const updated = memory.updatedAt ?? 'unknown';

      process.stdout.write(`### ${rank}. [${memory.kind}] ${summaryText}\n`);
      process.stdout.write(`**Importance:** ${importance.toFixed(1)} | **Updated:** ${updated}\n`);
      const content = memory.content ?? '';
      const contentLines = content.split('\n');
      for (const line of contentLines) {
        process.stdout.write(`> ${line}\n`);
      }
      process.stdout.write('\n');
    });
  }
}

/**
 * 输出 JSON 格式的上下文。
 * 机器可读，与 recall.js 的 JSON 结构一致。
 */
function outputContextJson(profile, summary, projectSummary, memories, projectId) {
  const output = {
    projectId,
    profile,
    summary,
    projectSummary,
    memories: memories && memories.length > 0
      ? memories.map((memory, i) => ({
          rank: i + 1,
          memory
        }))
      : []
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}

/**
 * 输出 memories 格式的上下文。
 * 专为 LLM agent 上下文注入设计，使用 [MEMORY]...[/MEMORY] 块。
 * 与 recall.js 的 outputMemories 保持一致。
 */
function outputContextMemories(profile, summary, projectSummary, memories, projectId) {
  // 用户画像作为 kind=profile 记忆块
  if (profile) {
    writeMemoryBlock({
      id: `profile-${projectId}`,
      kind: 'preference',
      scope: 'user',
      confidence: 1,
      importance: 1,
      source: { type: 'summary' },
      tags: ['profile'],
      content: profile,
      createdAt: null,
      updatedAt: null
    });
  }

  // 全局摘要作为 kind=summary 记忆块
  if (summary) {
    writeMemoryBlock({
      id: `summary-global`,
      kind: 'project_fact',
      scope: 'global',
      confidence: 1,
      importance: 1,
      source: { type: 'summary' },
      tags: ['summary'],
      content: summary,
      createdAt: null,
      updatedAt: null
    });
  }

  // 项目摘要作为 kind=summary 记忆块
  if (projectSummary) {
    writeMemoryBlock({
      id: `summary-project-${projectId}`,
      kind: 'project_fact',
      scope: 'project',
      confidence: 1,
      importance: 1,
      source: { type: 'summary' },
      tags: ['summary'],
      content: projectSummary,
      createdAt: null,
      updatedAt: null
    });
  }

  // 工作记忆
  if (memories && memories.length > 0) {
    for (const memory of memories) {
      writeMemoryBlock(memory);
    }
  }
}

/**
 * 以 [MEMORY]...[/MEMORY] 格式输出单条记忆块。
 * 与 recall.js 的 outputMemories 函数使用相同的块格式。
 */
function writeMemoryBlock(memory) {
  const score = typeof memory._contextScore === 'number'
    ? memory._contextScore.toFixed(2)
    : '1.00';

  const attrs = [
    `id=${memory.id}`,
    `rank=${score}`,
    `kind=${memory.kind}`,
    `scope=${memory.scope}`,
    `confidence=${memory.confidence ?? 1}`,
    `importance=${memory.importance ?? 0.5}`
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
