# REQ-015: Recall 回归测试矩阵与黄金语料集

## 问题
当前 recall 测试覆盖了 CLI 参数解析、输出格式和单一维度排序（confidence/importance/veracity/scope 各自独立测试），但缺少：
1. 多信号交错的综合排序回归保护（新旧冲突、真假冲突、跨项目、相似文本、团队共享）
2. 固定的黄金语料集用于可重复的回归验证
3. 统一的测试 helper 和数据创建模式

## 目标
- 建立固定 fixture / JSONL 语料，覆盖 6 种冲突场景
- 为每个 query 固定预期 top-k 结果
- 补充 provenance 过滤器测试（--author, --device, --reviewer, --trust-tier）
- 补充链式 supersedes、team scope、validUntil 边界测试

## 价值
每次 recall 引擎改动后，可在 5 秒内验证排序是否被破坏。
