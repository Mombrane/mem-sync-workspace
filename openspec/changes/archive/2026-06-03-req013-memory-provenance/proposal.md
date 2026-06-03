# REQ-013: Memory Provenance 与审核轨迹补强

## 问题陈述
当前 mem-sync 的记忆记录缺少来源追踪和审核审计字段。remember 写入时不记录 author/device/session，review approve/reject 不记录 reviewer/ReviewedAt。这导致：
- 无法追溯记忆的创建者和创建上下文
- 无法审计谁批准/拒绝了某条记忆
- 无法按来源过滤 recall 结果
- 团队协作下"谁批准了什么"不可追溯

## 目标
1. 为记忆记录新增 author、device、session、reviewer、reviewedAt、trustTier 字段
2. remember/retain 命令支持 --author/--device/--session 标志
3. review approve/reject 自动注入 reviewer + reviewedAt
4. recall 支持按 provenance 字段过滤
5. trustTier 在 approve 时自动计算

## 范围
- Schema 扩展（optional 字段，保持 v1）
- SQLite 索引新增列
- CLI 命令参数扩展
- 测试覆盖

## 不在范围内
- schemaVersion 升级到 v2（暂不，保持向后兼容）
- trustTier 动态重算（存储时固化）
- canonicalKey 变更（不纳入 provenance 字段）
