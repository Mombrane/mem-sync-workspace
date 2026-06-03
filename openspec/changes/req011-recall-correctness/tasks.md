# REQ-011 实施清单

## Task 1: 添加质量评分基础设施
**文件**: `src/schema.js`
- 添加 `VERACITY_SCORES` 常量映射
- 添加 `getQualityMultiplier(record)` 辅助函数
- 导出两个新符号

**依赖**: 无
**预计**: 简单

## Task 2: 实现 Supersedes 排除
**文件**: `src/index-store.js`
- 添加 `excludeSuperseded(results)` 函数
- 在 `searchIndex()` 结果处理中调用
- 在 `searchIndexHybrid()` 结果处理中调用

**依赖**: 无
**预计**: 简单

## Task 3: 质量加权 Hybrid Score + MMR
**文件**: `src/embedding-cache.js`
- 修改 `computeHybridScore` 添加 `qualityMultiplier` 参数
- 修改 `searchIndexHybrid()` 调用处传入质量乘数
- 修改 `mmrRerank()` 的 relevance 计算包含质量因子

**依赖**: Task 1 (需要 getQualityMultiplier)
**预计**: 中等

## Task 4: 纯 FTS 路径质量排序
**文件**: `src/index-store.js`
- 修改 `searchIndex()` 的结果排序，替代纯 BM25 rank
- 调用 `excludeSuperseded` 和 `getQualityMultiplier`

**依赖**: Task 1, Task 2
**预计**: 简单

## Task 5: 测试覆盖
**文件**: `tests/cli-recall.test.js` (或新文件 `tests/recall-quality.test.js`)
- 测试 supersedes 排除
- 测试 confidence 排序
- 测试 importance 排序
- 测试 veracity 排序
- 测试 MMR 质量感知

**依赖**: Task 1-4
**预计**: 中等

## 执行顺序
- Wave 1 (并行): Task 1, Task 2
- Wave 2 (顺序): Task 3 (依赖 Task 1), Task 4 (依赖 Task 1+2)
- Wave 3 (顺序): Task 5 (依赖所有)
