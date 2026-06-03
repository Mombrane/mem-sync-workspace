# REQ-012 需求规格

## 核心需求

### FR-012-1: 统一 canonicalKey 生成
- `merge.js` 和 `compact-engine.js` 必须使用 `schema.js:createCanonicalKey()` 生成 canonicalKey
- 删除 `merge.js:buildCanonicalKey()` 函数
- 所有 canonicalKey 格式统一为 `kind:scope:projectId:agentId:contentHash`

### FR-012-2: 跨项目/Agent 记录不被误合并
- 相同 content 但不同 projectId 的记忆必须保留为独立记录
- 相同 content 但不同 agentId 的记忆必须保留为独立记录
- `mergeByCanonicalKey` 去重逻辑使用完整 5 字段 key

### FR-012-3: 向后兼容
- 已有 JSONL 中的 `canonicalKey` 字段（5 字段格式）无需迁移
- SQLite 索引不存储 canonicalKey，无需重建
- pending 文件中的记录已由 `normalizeMemoryInput` 生成正确格式

## 测试场景

### TS-012-1: mergeByCanonicalKey 跨项目隔离
- 两条记录 content 相同，projectId 不同 → 保留两条

### TS-012-2: mergeByCanonicalKey 跨 Agent 隔离
- 两条记录 content 相同，agentId 不同 → 保留两条

### TS-012-3: mergePendingToStore 不误合并跨项目记录
- JSONL 中有 project A 的记录，pending 中有 project B 的同文案记录 → 保留两条

### TS-012-4: compact 不误合并跨项目记录
- compact 操作中，不同 projectId 的同文案记录分在不同组

### TS-012-5: 向后兼容 — 已有记录的 canonicalKey 不变
- 已有记录的 canonicalKey 字段仍为 5 字段格式，merge 后保持一致
