# Proposal: LLM Extractor/Reranker

## 为什么做

mem-sync CLI 的 `retain` 命令当前使用规则模式匹配（4 条 regex 规则）从对话记录中提取候选记忆。这种方式只能捕获显式触发词（如"记住"、"决定"）匹配的内容，无法识别隐含的偏好、决策和项目事实。

同样，`recall` 命令使用 FTS BM25 + embedding cosine + MMR 进行召回排序，缺乏对查询意图的深层语义理解。

添加 LLM-based 的提取和重排序能力可以：
1. **提取质量提升**：识别隐含偏好、微妙决策、上下文相关的项目事实
2. **召回质量提升**：基于查询意图的语义相关性排序，而非仅靠关键词和向量相似度
3. **渐进增强**：所有 LLM 功能均为 opt-in，默认行为完全不变

## 做什么

### LLM Extractor
- 新增 `src/llm-provider.js`：LLM provider 接口（mock + OpenAI-compatible）
- 新增 `src/llm-extract.js`：两阶段 CoT 提取（分类 → kind-specific 提取）
- 修改 `retain` 命令：添加 `--llm-extract` 标志

### LLM Reranker
- 新增 `src/llm-rerank.js`：Reciprocal Rank Fusion + 方差保护
- 修改 `recall` 命令：添加 `--llm-rerank`、`--llm-weight`、`--llm-top-n` 标志

## 范围约束

- 不替换现有规则提取引擎，而是互补
- 不改变默认行为，所有 LLM 功能 opt-in
- 不引入第三方 LLM SDK，使用原生 fetch
- mock provider 用于测试，无需 API key
