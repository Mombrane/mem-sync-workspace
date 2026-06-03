# REQ-011: Recall 正确性治理与排序约束

## 问题
当前 recall 的排序纯粹基于文本相关性（BM25 + embedding cosine similarity），不考虑记忆的质量信号（confidence、importance、veracity）和生命周期关系（supersedes）。这导致：
- 低置信度的旧错误记忆因关键词匹配更强而排在高置信度正确记忆之前
- 被替代的记忆仍然出现在召回结果中
- MMR rerank 和 LLM rerank 对质量信号完全无感知

## 目标
将 deletedAt / validUntil / supersedes / confidence / veracity / importance 纳入统一召回约束，确保 recall 只返回有效且高质量的记忆。

## 范围
- 修改 `src/index-store.js`：searchIndexHybrid 中添加 supersedes 后处理过滤
- 修改 `src/embedding-cache.js`：computeHybridScore 和 mmrRerank 中注入质量乘数
- 修改 `src/schema.js`：添加 VERACITY_SCORES 映射
- 添加测试覆盖所有新行为

## 不在范围内
- Scope bank/namespace 模型（REQ-014）
- Canonical key 统一（REQ-012）
- LLM rerank 质量感知（低优先级，可后续做）
