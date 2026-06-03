# REQ-012: Canonical Key 与合并语义统一

## 问题背景

`schema.js:createCanonicalKey()` 生成 5 字段 key（`kind:scope:projectId:agentId:contentHash`），用于记录创建时的身份标识。而 `merge.js:buildCanonicalKey()` 生成 3 字段 key（`scope:kind:contentHash`），用于合并/去重/compact 的分组。

当两个不同项目（projectId 不同）或不同 agent 的记忆具有相同文案时，`buildCanonicalKey` 会将它们视为同一条记录，导致静默丢弃。

## 影响范围

- `mergeByCanonicalKey()` — 数组去重，跨项目/Agent 记录会误合并
- `mergePendingToStore()` — pending → JSONL 合并，同上
- `compactMemories()` — compact 分组，同上

## 目标

删除 `buildCanonicalKey`，统一使用 `createCanonicalKey`，确保跨项目/Agent 的同文案记忆不会被错误合并。

## 收益

- 消除跨项目/Agent 的误合并风险
- 统一身份模型，减少维护复杂度
- 为后续 provenance 和 bank/namespace 模型打下基础
