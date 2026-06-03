# REQ-014: Scope 升级为 Bank / Namespace 召回模型

## 问题
当前 `scope` 枚举 (`user/project/agent/global/local-only`) 存在三个问题：
1. `user` 命名不精确 — 应为 `personal` 以区分个人记忆和用户输入
2. 缺少 `team` scope — 无法表达团队共享记忆
3. scope 在召回排序中不起作用 — `computeContextScore` 完全忽略 scope，导致个人记忆和全局记忆无优先级区分

## 目标
1. 扩展 scope 枚举：新增 `personal`（替代 `user`）和 `team`
2. 建立 scope 召回优先级：`personal > project > team > global`
3. 保持向后兼容：`user` 自动映射为 `personal`
4. 修复 CLI 验证不一致问题

## 范围
- 不新增 `teamId` 字段（后续需求）
- 不修改 canonicalKey 逻辑（scope 映射在读取时处理）
- 不做 JSONL 数据迁移脚本（`normalizeLegacyScope` 运行时兼容即可）
