# MMR Rerank — 2026-06-02

## 概要
为 recall 引擎添加 MMR（最大边际相关性）多样性重排序功能。

## 变更内容
- 新增 `trigramJaccard()` — 字符三元组 Jaccard 相似度计算
- 新增 `mmrRerank()` — 贪心 MMR 重排序算法
- `searchIndexHybrid()` 支持 `--mmr` 和 `--mmr-lambda` 选项
- `searchIndex()` 支持 `--mmr` 和 `--mmr-lambda` 选项（FTS-only 模式使用 trigram Jaccard 回退）
- CLI 新增 `--mmr` 布尔标志和 `--mmr-lambda` 浮点参数（默认 0.7）
- 输出格式（markdown/json/memories）显示 MMR 分数

## 修改文件
- `src/embedding-cache.js` — 新增 trigramJaccard 和 mmrRerank（+136 行）
- `src/index-store.js` — 集成 MMR 到 searchIndex 和 searchIndexHybrid（+31 行）
- `src/commands/recall.js` — CLI 参数解析和输出格式化（+24 行）
- `tests/embedding-cache.test.js` — 22 个新测试

## 测试结果
437 tests, 437 pass, 0 fail
