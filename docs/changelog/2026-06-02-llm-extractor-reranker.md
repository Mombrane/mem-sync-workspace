# LLM Extractor/Reranker — 2026-06-02

## 概述
为 mem-sync CLI 添加 LLM-based 的记忆提取和召回重排序能力。

## 修改内容

### 新增文件
- `src/llm-provider.js` — LLM provider 接口（noop、mock、OpenAI-compatible）
- `src/llm-extract.js` — 两阶段 CoT 记忆提取（分类 → kind-specific 提取）
- `src/llm-rerank.js` — Reciprocal Rank Fusion 重排序 + 方差保护
- `tests/llm-provider.test.js` — 11 个测试
- `tests/llm-extract.test.js` — 15 个测试
- `tests/llm-rerank.test.js` — 10 个测试

### 修改文件
- `src/commands/retain.js` — 新增 `--llm-extract`、`--max-tokens` 标志
- `src/commands/recall.js` — 新增 `--llm-rerank`、`--llm-weight`、`--llm-top-n` 标志

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| Provider 模式 | 单一 LLMProvider 接口 + chat() 方法 | 与 embedding-provider.js 一致 |
| 提取策略 | 两阶段 CoT（分类 → kind-specific 提取） | 短对话单遍，长对话两遍 |
| 重排序算法 | Reciprocal Rank Fusion (RRF) | 跨分布归一化，生产级标准 |
| 方差保护 | stddev < 0.01 时跳过融合 | LLM 分数无差异时避免无意义重排 |
| 管道位置 | FTS → Hybrid → MMR → LLM Rerank | MMR 先确保多样性，LLM 最后做语义判断 |
| 所有功能 | Opt-in（默认关闭） | 向后兼容，无意外成本 |

## 环境变量
- `MEM_SYNC_LLM_PROVIDER`: noop | openai | mock
- `MEM_SYNC_LLM_API_KEY`: API key
- `MEM_SYNC_LLM_MODEL`: 模型名（默认 gpt-4o-mini）
- `MEM_SYNC_LLM_BASE_URL`: API base URL

## 测试结果
- 原有 484 个测试全部通过
- 新增 71 个测试全部通过（含 15 个已有 e2e 测试）
- 总计 555 个测试，0 个失败

## 费用
- Explore: ~$1.60（2 轮分析）
- Propose: $0（Hermes 直接编写）
- Delegate: ~$1.36（Claude Code 实现，31 turns）
- Review/Verify: $0
- 总计: ~$2.96
