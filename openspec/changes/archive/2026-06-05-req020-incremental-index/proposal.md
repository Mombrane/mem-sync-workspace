# REQ-020: 增量索引更新

## 问题

`updateIndex()` 当前在 HEAD 变化时执行全量重建（清空所有记录后重新插入全部 JSONL 文件）。设计文档（memcli-design.md §8.2）描述的增量更新流程为 `git diff --name-only last..current`，只重建变更文件。

## 方案

修改 `updateIndex` 实现真正的增量索引：
1. 使用 `git diff --name-only <old_head> <new_head>` 获取变更文件列表
2. 仅对变更的 `.jsonl` 文件执行 DELETE + 重新插入
3. 检测已删除的文件，清理其记录
4. 更新 `index_meta.repo_head`

## 收益

- 大型仓库（数百条记录分布在多个文件）中，只变更文件被重建，性能提升
- 保持 API 不变，调用方无需修改
- 全量重建 `rebuildIndex` 保留作为回退
