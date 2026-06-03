# REQ-012 技术方案

## 方案概述

删除 `merge.js:buildCanonicalKey()`，让 merge 和 compact 路径统一使用 `schema.js:createCanonicalKey()`。

## 变更清单

### 1. `src/merge.js`

**删除** `buildCanonicalKey` 函数（第 20-26 行）和相关注释（第 6-19 行）。

**修改 import**：从 `'./schema.js'` 导入 `createCanonicalKey`（替代本地 `buildCanonicalKey`）。

**修改调用点**：
- 第 41 行 `mergeByCanonicalKey`：`buildCanonicalKey(record)` → `createCanonicalKey(record)`
- 第 301 行 `mergePendingToStore`：`buildCanonicalKey(r)` → `createCanonicalKey(r)`
- 第 308 行 `mergePendingToStore`：`buildCanonicalKey(r)` → `createCanonicalKey(r)`

**保留 export**：`buildCanonicalKey` 不再需要导出（compact-engine 改用 schema.js 的版本）。

### 2. `src/compact-engine.js`

**修改 import**（第 2 行）：
```js
// 旧：import { buildCanonicalKey } from './merge.js';
// 新：import { createCanonicalKey } from './schema.js';
```

**修改调用**（第 43 行）：
```js
// 旧：const key = buildCanonicalKey(record);
// 新：const key = createCanonicalKey(record);
```

### 3. `tests/merge.test.js`

**修改 import**：
```js
// 旧：import { buildCanonicalKey, ... } from '../src/merge.js';
// 新：import { mergeByCanonicalKey, readPendingFiles, mergePendingToStore } from '../src/merge.js';
//     import { createCanonicalKey } from '../src/schema.js';
```

**修改测试用例**（4 个 `buildCanonicalKey` 测试改为 `createCanonicalKey`）：
- 测试名称：`buildCanonicalKey` → `createCanonicalKey`
- 正则匹配：`/^user:preference:[a-f0-9]{12}$/` → `/^preference:user:::[a-f0-9]{12}$/`（字段顺序和空 projectId/agentId）
- 所有 `buildCanonicalKey(record)` 调用改为 `createCanonicalKey(record)`

**新增测试**（2 个）：
- 不同 projectId 产生不同 key
- mergeByCanonicalKey 不合并跨项目同文案记录

### 4. `tests/compact-engine.test.js`

检查是否需要更新 — 当前不直接导入 `buildCanonicalKey`，无需修改。

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 已有数据误合并（历史） | 中 | 低 | 数据已丢失，无法恢复；统一后不再发生 |
| 测试正则不匹配新格式 | 高 | 低 | 更新测试中的正则表达式 |
| createCanonicalKey 对 null source 处理 | 低 | 低 | normalizeSource 已处理 null/undefined |

## 不需要迁移

- JSONL 记录：canonicalKey 字段已是 5 字段格式
- SQLite 索引：不存储 canonicalKey
- Pending 文件：由 normalizeMemoryInput 生成，格式正确
