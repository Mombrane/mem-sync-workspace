/**
 * LLM-based memory extraction from agent session transcripts.
 *
 * Pure functions for extracting candidate memories using an LLM.
 * Supports single-pass (short transcripts) and two-pass CoT (long transcripts).
 */

import { normalizeMemoryInput, MEMORY_KINDS } from './schema.js';

// ─── 常量 ────────────────────────────────────────────────────────────────

const MAX_TOKENS_DEFAULT = 8000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const SHORT_TRANSCRIPT_THRESHOLD = 5; // ≤5 user messages → single-pass

// ─── 转录本准备 ─────────────────────────────────────────────────────────

/**
 * 截断转录本以控制 token 用量。
 * 从开头截断（保留最近的对话），使用字符数估算 token 数。
 *
 * @param {Array<{role: string, content: string}>} transcript - 完整转录本
 * @param {number} [maxTokens=8000] - 最大 token 数
 * @returns {Array<{role: string, content: string}>} - 截断后的转录本
 */
export function prepareTranscript(transcript, maxTokens = MAX_TOKENS_DEFAULT) {
  if (!Array.isArray(transcript)) return [];

  const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
  let totalChars = 0;
  const result = [];

  // 从末尾向前收集，保留最近的对话
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i];
    const contentLen = typeof msg.content === 'string' ? msg.content.length : 0;
    if (totalChars + contentLen > maxChars && result.length > 0) break;
    totalChars += contentLen;
    result.unshift(msg); // 保持原始顺序
  }

  return result;
}

/**
 * 计算转录本中用户消息的数量。
 *
 * @param {Array<{role: string}>} transcript - 转录本
 * @returns {number} - 用户消息计数
 */
function countUserMessages(transcript) {
  return transcript.filter(m => m && m.role === 'user').length;
}

// ─── JSON 解析防御 ──────────────────────────────────────────────────────

/**
 * 多阶段解析 LLM 响应中的 JSON。
 *
 * 防御策略——按顺序尝试：
 * 1. 去除 markdown 代码围栏
 * 2. 直接 JSON.parse
 * 3. 正则提取 JSON 数组
 * 4. 逐行解析
 *
 * @param {string} rawText - LLM 原始响应文本
 * @returns {Array|null} - 解析出的数组，或 null
 */
export function parseLLMResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  let text = rawText.trim();

  // Stage 1: 去除 markdown 代码围栏
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Stage 2: 直接 JSON.parse
  try {
    const result = JSON.parse(text);
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object') {
      // 尝试从对象中提取数组字段
      const arr = result.memories || result.candidates || result.results;
      if (Array.isArray(arr)) return arr;
    }
    return null;
  } catch {
    // 继续下一个策略
  }

  // Stage 3: 正则提取 JSON 数组
  const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // 继续下一个策略
    }
  }

  // Stage 4: 逐行解析——寻找看起来像 JSON 对象的行
  const lines = text.split(/[\r\n]+/).filter(Boolean);
  const objects = [];
  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*\d]+\.?\s*/, '').replace(/,\s*$/, '');
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        objects.push(obj);
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  return objects.length > 0 ? objects : null;
}

// ─── 提示词模板 ─────────────────────────────────────────────────────────

/**
 * 构建单遍提取的系统提示词。
 * 适用于简短转录本（≤5 条用户消息）。
 */
function buildSinglePassPrompt(transcript) {
  const transcriptStr = formatTranscriptForPrompt(transcript);
  const kindsStr = MEMORY_KINDS.join(', ');

  return {
    role: 'system',
    content: `你是一个记忆提取系统。从以下对话转录本中提取所有值得记住的信息。

允许的记忆类型：${kindsStr}

返回一个 JSON 对象数组，每个对象包含：
- "content"：一条简洁、事实性的记忆陈述（不要用"用户说..."这类前缀）
- "kind"：${kindsStr} 之一
- "scope"："personal"、"project"、"team" 或 "global"
- "confidence"：0.0 到 1.0 之间的数字，表示你对这条记忆的信心
- "importance"：0.0 到 1.0 之间的数字，表示这条记忆有多重要

规则：
- 只提取可验证的事实陈述，忽略闲聊和暂态内容
- 如果转录本中没有可提取的内容，返回空数组 []
- 只返回 JSON 数组，不要包含其他文本`,
  };
}

/**
 * 构建两遍 CoT 的系统提示词——第一遍：消息分类。
 */
function buildClassificationPrompt(transcript) {
  const lines = [];
  let msgIndex = 0;
  for (const msg of transcript) {
    if (!msg || typeof msg.content !== 'string') continue;
    const role = msg.role || 'unknown';
    const preview = msg.content.slice(0, 200).replace(/\n/g, ' ');
    lines.push(`[${msgIndex}] ${role}: ${preview}`);
    msgIndex++;
  }

  const kindsStr = MEMORY_KINDS.join(', ');

  return {
    role: 'system',
    content: `分析以下对话转录本中的每条消息，并按如下方式分类：

消息类型（kind）为 ${kindsStr} 之一，或者 "ignore" 表示该消息不含值得记忆的内容。

消息索引：
${lines.join('\n')}

返回一个 JSON 对象数组，每个对象包含：
- "index"：消息的数字索引
- "kind"：分类结果，为 ${kindsStr} 之一或 "ignore"

只返回 JSON 数组，不要包含其他文本。`,
  };
}

/**
 * 构建两遍 CoT 的系统提示词——第二遍：分类别提取。
 */
function buildKindSpecificPrompt(transcript, classifications) {
  const transcriptStr = formatTranscriptForPrompt(transcript);
  const kindMap = {};

  for (const c of classifications) {
    if (c.kind === 'ignore') continue;
    if (!kindMap[c.kind]) kindMap[c.kind] = [];
    kindMap[c.kind].push(c.index);
  }

  const targetKinds = Object.keys(kindMap).join(', ');

  return {
    role: 'system',
    content: `从以下对话转录本中提取指定类型的记忆。

目标类型：${targetKinds}

相关消息索引（按类型）：
${Object.entries(kindMap).map(([kind, indices]) => `  ${kind}: [${indices.join(', ')}]`).join('\n')}

对话转录本：
${transcriptStr}

对于每条匹配的记忆，返回一个 JSON 对象：
- "content"：一条简洁、事实性的记忆陈述
- "kind"：${targetKinds} 之一
- "scope"："personal"、"project"、"team" 或 "global"
- "confidence"：0.0 到 1.0 之间的信心分数
- "importance"：0.0 到 1.0 之间的重要性分数

只提取有实质内容的记忆。只返回 JSON 数组，不要包含其他文本。`,
  };
}

/**
 * 将转录本格式化为提示词可用的文本。
 */
function formatTranscriptForPrompt(transcript) {
  return transcript
    .filter(m => m && typeof m.content === 'string')
    .map((m, i) => `[${i}] ${m.role || 'unknown'}: ${m.content}`)
    .join('\n');
}

// ─── 主入口 ─────────────────────────────────────────────────────────────

/**
 * 使用 LLM 从转录本中提取候选记忆。
 *
 * 策略：
 * - 短转录本（≤5 条用户消息）：单遍提取
 * - 长转录本（>5 条用户消息）：两遍 CoT
 *   - 第一遍：分类所有消息
 *   - 第二遍：按分类类型提取记忆
 *
 * @param {Array<{role: string, content: string}>} transcript - 转录本
 * @param {import('./llm-provider.js').LLMProvider} llmProvider - LLM provider
 * @param {object} [options] - 选项
 * @param {string} [options.projectId] - 项目 ID
 * @param {string} [options.agentId] - Agent ID
 * @param {number} [options.maxTokens=8000] - 转录本最大 token 数
 * @param {Date} [options.now] - 当前时间戳
 * @returns {Promise<Array<object>>} - 规范化的候选记忆数组
 */
export async function extractWithLLM(transcript, llmProvider, options = {}) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return [];
  }

  const maxTokens = options.maxTokens ?? MAX_TOKENS_DEFAULT;
  const prepared = prepareTranscript(transcript, maxTokens);

  if (prepared.length === 0) return [];

  // 统计用户消息数，决定使用单遍还是两遍策略
  const userMsgCount = countUserMessages(prepared);
  let rawCandidates;

  if (userMsgCount <= SHORT_TRANSCRIPT_THRESHOLD) {
    // 单遍提取
    rawCandidates = await extractSinglePass(prepared, llmProvider);
  } else {
    // 两遍 CoT 提取
    rawCandidates = await extractTwoPass(prepared, llmProvider);
  }

  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return [];
  }

  // 规范化每个候选记忆
  const now = options.now ?? new Date();
  const records = [];

  for (const candidate of rawCandidates) {
    try {
      const memory = normalizeMemoryInput({
        content: candidate.content,
        kind: candidate.kind,
        scope: candidate.scope ?? 'global',
        confidence: candidate.confidence,
        importance: candidate.importance,
        veracity: 'inferred',
        source: {
          type: 'retain',
          extractor: 'llm',
          agent: options.agentId ?? null,
        },
        evidence: [
          { type: 'llm_extraction', text: candidate.content },
        ],
        projectId: options.projectId ?? null,
        now,
      });
      records.push(memory);
    } catch {
      // 跳过无法规范化的候选（如 schema 校验失败）
    }
  }

  return records;
}

/**
 * 单遍提取。
 */
async function extractSinglePass(transcript, llmProvider) {
  const systemMsg = buildSinglePassPrompt(transcript);
  const userMsg = {
    role: 'user',
    content: '从以上转录本中提取所有值得记住的信息。只返回 JSON 数组。',
  };

  const response = await llmProvider.chat([systemMsg, userMsg], {
    temperature: 0.1,
  });
  return parseLLMResponse(response) ?? [];
}

/**
 * 两遍 CoT 提取。
 * 第一遍：分类消息 → [{index, kind}, ...]
 * 第二遍：按类型提取记忆
 */
async function extractTwoPass(transcript, llmProvider) {
  // 第一遍：分类
  const classSysMsg = buildClassificationPrompt(transcript);
  const classUserMsg = {
    role: 'user',
    content: '对以上消息进行分类。只返回 JSON 数组。',
  };

  const classResponse = await llmProvider.chat([classSysMsg, classUserMsg], {
    temperature: 0.1,
  });
  const classifications = parseLLMResponse(classResponse) ?? [];

  // 过滤掉 ignore 分类
  const relevant = classifications.filter(c => c && c.kind !== 'ignore');
  if (relevant.length === 0) return [];

  // 第二遍：分类别提取
  const extractSysMsg = buildKindSpecificPrompt(transcript, classifications);
  const extractUserMsg = {
    role: 'user',
    content: '从以上转录本中提取指定类型的记忆。只返回 JSON 数组。',
  };

  const extractResponse = await llmProvider.chat([extractSysMsg, extractUserMsg], {
    temperature: 0.1,
  });
  return parseLLMResponse(extractResponse) ?? [];
}
