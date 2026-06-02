# Requirements: LLM Extractor/Reranker

## REQ-001: LLM Provider Interface

### Requirement
创建统一的 LLM provider 接口，支持多种后端（mock、OpenAI-compatible）。

### Acceptance Criteria
- [ ] `src/llm-provider.js` 导出 `noopLLMProvider`、`createMockLLMProvider()`、`createOpenAILLMProvider()`
- [ ] Provider 接口：`{ name, model, chat(messages, options) → Promise<string> }`
- [ ] `resolveLLMProvider()` 从环境变量解析：`MEM_SYNC_LLM_PROVIDER`、`MEM_SYNC_LLM_API_KEY`、`MEM_SYNC_LLM_MODEL`、`MEM_SYNC_LLM_BASE_URL`
- [ ] Mock provider 返回确定性响应（基于输入 hash）
- [ ] OpenAI provider 使用 `/v1/chat/completions` 端点
- [ ] 所有 provider 实现有测试覆盖

## REQ-002: LLM Extractor

### Requirement
使用 LLM 从对话记录中提取候选记忆，与现有规则引擎互补。

### Acceptance Criteria
- [ ] `src/llm-extract.js` 导出 `extractWithLLM(transcript, llmProvider, options)`
- [ ] 短对话（≤5 条用户消息）：单阶段提取
- [ ] 长对话（>5 条用户消息）：两阶段 CoT（分类 → kind-specific 提取）
- [ ] 输出经过 `normalizeMemoryInput()` schema 验证
- [ ] 多层 JSON 解析防御：strip markdown fences、regex 提取数组、逐行解析
- [ ] `--max-tokens` 控制输入大小，默认 8000，从头部截断
- [ ] LLM 提取的记忆标记 `extractor: 'llm'` 在 source 中
- [ ] 所有函数有测试覆盖

## REQ-003: LLM Reranker

### Requirement
使用 LLM 对召回结果进行语义重排序，提升查询相关性。

### Acceptance Criteria
- [ ] `src/llm-rerank.js` 导出 `rerankWithLLM(candidates, query, llmProvider, options)`
- [ ] 使用 Reciprocal Rank Fusion（RRF）融合 LLM 分数和 hybrid 分数
- [ ] 方差保护：LLM 分数方差 < 0.01 时跳过融合
- [ ] 可配置参数：`llmWeight`（默认 0.7）、`llmTopN`、`rrfK`（默认 60）
- [ ] 输出候选集增加 `_llmScore`、`_llmRank`、`_fusedScore` 字段
- [ ] 所有函数有测试覆盖

## REQ-004: CLI Integration

### Requirement
将 LLM 功能集成到现有 CLI 命令中。

### Acceptance Criteria
- [ ] `retain` 命令新增 `--llm-extract` 标志（默认关闭）
- [ ] `recall` 命令新增 `--llm-rerank`、`--llm-weight`、`--llm-top-n` 标志
- [ ] LLM 管道位置：FTS → Hybrid → MMR → LLM Rerank → truncate
- [ ] 所有新标志有 argparse 验证
- [ ] CLI help 文本更新
- [ ] 集成测试覆盖

## REQ-005: Testing

### Requirement
全面测试覆盖，所有测试通过。

### Acceptance Criteria
- [ ] `tests/llm-provider.test.js`：provider 接口、mock 确定性、错误处理
- [ ] `tests/llm-extract.test.js`：单阶段/两阶段提取、JSON 解析防御、截断
- [ ] `tests/llm-rerank.test.js`：RRF 计算、方差保护、边界情况
- [ ] 所有现有 484 个测试不回归
- [ ] 新增测试全部通过
