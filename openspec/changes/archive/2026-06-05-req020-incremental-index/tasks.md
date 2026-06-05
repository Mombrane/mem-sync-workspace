# REQ-020 实施清单

## Task 1: 添加辅助函数 + 修改 updateIndex
**文件:** `src/index-store.js`
**依赖:** 无

- [ ] 添加 `gitDiffFiles(oldHead, newHead, repoDir)` 辅助函数
- [ ] 添加 `indexFileToRows(filePath, repoCommit)` — 从文件提取记录行
- [ ] 添加 `incrementalUpdate(repoDir, cacheDir, changedFiles, newHead, logger)` — 增量更新核心
- [ ] 添加 `updateRepoHead(cacheDir, head)` — 更新 index_meta
- [ ] 修改 `updateIndex` — HEAD 变化时尝试增量，失败回退全量
- [ ] 保持 `rebuildIndex` 不变（回退路径）

## Task 2: 添加测试
**文件:** `test/index-store.test.js`
**依赖:** Task 1

- [ ] T1: 增量更新基本功能（修改文件 → 只重建该文件）
- [ ] T2: 文件删除处理（删除文件 → 清理记录）
- [ ] T3: 回退到全量重建（无索引/无 repo_head）
- [ ] T4: git diff 失败回退
- [ ] T5: FTS 重建后搜索正常

## 验收标准
- 所有现有测试通过（709 tests）
- 新增测试通过
- `npm test` 全绿
