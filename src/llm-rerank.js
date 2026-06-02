/**
 * LLM-based reranking of recall search results.
 *
 * Uses an LLM to score candidate-result relevance, then fuses
 * LLM scores with existing hybrid scores via Reciprocal Rank Fusion (RRF).
 */

// ─── 常量 ────────────────────────────────────────────────────────────────

const DEFAULT_LLM_WEIGHT = 0.7;
const DEFAULT_RRF_K = 60;
const VARIANCE_GUARD_THRESHOLD = 0.01;

// ─── 统计辅助函数 ───────────────────────────────────────────────────────

/**
 * 计算数组的标准差。
 *
 * @param {number[]} values - 数值数组
 * @returns {number} - 标准差
 */
function standardDeviation(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── LLM 评分 ────────────────────────────────────────────────────────────

/**
 * 使用 LLM 为候选记忆评分。
 *
 * 构建包含查询和候选记忆列表的提示词，要求 LLM 返回
 * 每个候选记忆相对于查询的相关性分数（0.0–1.0）。
 *
 * @param {Array<object>} candidates - 候选记忆列表
 * @param {string} query - 搜索查询
 * @param {import('./llm-provider.js').LLMProvider} llmProvider - LLM provider
 * @param {object} [options] - 评分选项
 * @param {number} [options.llmTopN] - 传递给 LLM 的候选数上限
 * @returns {Promise<Array<{index: number, score: number}>>} - 评分结果
 */
export async function scoreCandidatesWithLLM(candidates, query, llmProvider, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const topN = options.llmTopN ?? candidates.length;
  const scoringCandidates = candidates.slice(0, topN);

  // 构建候选记忆的文本表示
  const itemsText = scoringCandidates
    .map((c, i) => `[${i}] [${c.kind ?? 'unknown'}] ${(c.summary ?? c.content ?? '').slice(0, 200)}`)
    .join('\n----\n');

  const systemMsg = {
    role: 'system',
    content: `你是一个记忆相关性评分器。给定一个搜索查询和一列候选记忆，为每条记忆分配一个相关性分数（0.0 到 1.0）。

查询：${query}

候选记忆：
${itemsText}

返回一个 JSON 数组，每个元素包含：
- "index"：候选记忆的编号（整数）
- "score"：0.0 到 1.0 之间的相关性分数，1.0 表示完全匹配

规则：
- 基于语义相关性评分，而不仅仅是关键词匹配
- 如果记忆与查询完全无关，给 0.0
- 只返回 JSON 数组，不要包含其他文本`,
  };

  const userMsg = {
    role: 'user',
    content: '为以上候选记忆评分。只返回 JSON 数组。',
  };

  const response = await llmProvider.chat([systemMsg, userMsg], {
    temperature: 0,
  });

  // 解析 LLM 响应
  const scores = parseScoreResponse(response);
  return scores;
}

/**
 * 解析 LLM 评分响应。
 * 多阶段防御解析策略。
 *
 * @param {string} rawText - LLM 原始响应
 * @returns {Array<{index: number, score: number}>} - 解析出的评分
 */
function parseScoreResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  let text = rawText.trim();

  // Stage 1: 去除 markdown 代码围栏
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Stage 2: 直接 JSON.parse
  try {
    const result = JSON.parse(text);
    if (Array.isArray(result)) {
      return result
        .filter(item => item && typeof item.index === 'number' && typeof item.score === 'number')
        .map(item => ({ index: item.index, score: Math.max(0, Math.min(1, item.score)) }));
    }
  } catch {
    // 继续下一个策略
  }

  // Stage 3: 正则提取 JSON 数组
  const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      const result = JSON.parse(arrayMatch[0]);
      if (Array.isArray(result)) {
        return result
          .filter(item => item && typeof item.index === 'number' && typeof item.score === 'number')
          .map(item => ({ index: item.index, score: Math.max(0, Math.min(1, item.score)) }));
      }
    } catch {
      // 继续下一个策略
    }
  }

  return [];
}

// ─── RRF 融合 ────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion：将 LLM 评分与现有混合评分融合。
 *
 * RRF 公式：
 *   fusedScore = alpha / (k + rank_llm) + (1 - alpha) / (k + rank_hybrid)
 *
 * 其中 rank_llm 和 rank_hybrid 从 1 开始（越小越好）。
 *
 * 如果 LLM 分数的标准差低于 VARIANCE_GUARD_THRESHOLD，
 * 则跳过融合（分数差异太小，不值得重新排序）。
 *
 * @param {Array<object>} candidates - 候选记忆，已按现有排序排列
 * @param {string} query - 搜索查询
 * @param {import('./llm-provider.js').LLMProvider} llmProvider - LLM provider
 * @param {object} [options] - 选项
 * @param {number} [options.llmWeight=0.7] - LLM 分数的融合权重 (0–1)
 * @param {number} [options.llmTopN] - 传递给 LLM 的候选数上限
 * @param {number} [options.rrfK=60] - RRF 常数 k
 * @returns {Promise<Array<object>>} - 带有 _llmScore, _llmRank, _fusedScore 的候选记忆
 */
export async function rerankWithLLM(candidates, query, llmProvider, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const llmWeight = options.llmWeight ?? DEFAULT_LLM_WEIGHT;
  const rrfK = options.rrfK ?? DEFAULT_RRF_K;
  const llmTopN = options.llmTopN ?? candidates.length;

  // 获取 LLM 评分
  const llmScoresList = await scoreCandidatesWithLLM(candidates, query, llmProvider, {
    llmTopN,
  });

  // 构建 index → LLM score 的映射
  const llmScoreMap = new Map();
  for (const item of llmScoresList) {
    llmScoreMap.set(item.index, item.score);
  }

  // 为候选记忆附加 LLM 评分
  const scored = candidates.map((candidate, index) => {
    const llmScore = llmScoreMap.has(index)
      ? llmScoreMap.get(index)
      : 0;
    return {
      ...candidate,
      _llmScore: parseFloat(llmScore.toFixed(4)),
      _llmIndex: index,
    };
  });

  // 方差守护：如果 LLM 分数差异太小，跳过融合
  const llmScores = scored.map(c => c._llmScore);
  const stddev = standardDeviation(llmScores);

  if (stddev < VARIANCE_GUARD_THRESHOLD) {
    // 分数差异不足——保持原有排序，仅附加 LLM 分数
    return scored.map((c, i) => ({
      ...c,
      _llmRank: i + 1,
      _fusedScore: c._hybridScore ?? 0,
    }));
  }

  // 计算 LLM 排名（分数越高排名越靠前）
  const llmRanked = [...scored].sort((a, b) => b._llmScore - a._llmScore);
  const llmRankMap = new Map();
  llmRanked.forEach((c, i) => llmRankMap.set(c._llmIndex, i + 1));

  // 计算混合排名（基于现有 _hybridScore，分数越高排名越靠前）
  const hybridRanked = [...scored].sort((a, b) => {
    const aScore = a._hybridScore ?? (a._rank ? 1 / a._rank : 0);
    const bScore = b._hybridScore ?? (b._rank ? 1 / b._rank : 0);
    return bScore - aScore;
  });
  const hybridRankMap = new Map();
  hybridRanked.forEach((c, i) => hybridRankMap.set(c._llmIndex, i + 1));

  // RRF 融合
  const fused = scored.map((c) => {
    const llmRank = llmRankMap.get(c._llmIndex) || scored.length;
    const hybridRank = hybridRankMap.get(c._llmIndex) || scored.length;

    const fusedScore =
      llmWeight / (rrfK + llmRank) +
      (1 - llmWeight) / (rrfK + hybridRank);

    return {
      ...c,
      _llmRank: llmRank,
      _fusedScore: parseFloat(fusedScore.toFixed(6)),
    };
  });

  // 按融合分数降序排序
  fused.sort((a, b) => b._fusedScore - a._fusedScore);

  return fused;
}
