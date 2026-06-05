# REQ-020 需求规格

## 核心需求

### R1: 增量索引更新
- 当 HEAD 变化时，使用 `git diff --name-only <old_head> <new_head>` 获取变更文件列表
- 仅对变更的 `.jsonl` 文件执行索引更新（DELETE 旧记录 + INSERT 新记录）
- 不变更的文件保持索引不变

### R2: 文件删除检测
- 如果 `git diff` 显示某 `.jsonl` 文件被删除，删除该文件在索引中的所有记录
- 使用 `DELETE FROM memories WHERE file_path = ?` 按文件路径清理

### R3: 回退机制
- 如果 `git diff` 执行失败（如非 git 仓库、损坏的 git 状态），回退到全量重建
- 如果索引不存在或 `repo_head` 缺失，回退到全量重建（保持现有行为）

### R4: FTS 索引同步
- 增量更新后执行 `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` 重建 FTS
- 这是外部内容 FTS5 的必要步骤，无法增量

### R5: repo_head 更新
- 增量更新完成后更新 `index_meta.repo_head` 为新的 HEAD

### R6: API 不变
- `updateIndex(repoDir, cacheDir, options)` 函数签名不变
- 返回值不变：`{ skipped: true }` | `{ rebuilt: true, recordCount }` | `{ updated: true, recordCount }` (新增)

## 测试需求

### T1: 增量更新基本功能
- 修改一个 JSONL 文件，验证 updateIndex 只重建该文件的记录
- 验证未修改文件的记录保持不变

### T2: 文件删除处理
- 删除一个 JSONL 文件，验证 updateIndex 清理该文件的记录
- 验证其他文件的记录不受影响

### T3: 回退到全量重建
- 索引不存在时回退到全量重建
- repo_head 缺失时回退到全量重建

### T4: git diff 失败回退
- 模拟 git diff 失败，验证回退到全量重建

### T5: FTS 重建验证
- 增量更新后验证 FTS 搜索正常工作
