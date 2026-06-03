# REQ-012 实施清单

## Task 1: 修改 `src/merge.js` — 删除 buildCanonicalKey，改用 createCanonicalKey

**文件**: `src/merge.js`

**变更**:
1. 删除 `buildCanonicalKey` 函数（第 6-26 行，包括 JSDoc 注释）
2. 修改 import：添加 `import { createCanonicalKey } from './schema.js'`
3. 修改 3 处调用：
   - `mergeByCanonicalKey` 中 `buildCanonicalKey(record)` → `createCanonicalKey(record)`
   - `mergePendingToStore` 中两处 `buildCanonicalKey(r)` → `createCanonicalKey(r)`
4. 保留 `normalizeContent` 的 import（仍被其他函数使用）

**依赖**: 无
**预计变更**: ~15 行删除，~4 行修改

## Task 2: 修改 `src/compact-engine.js` — 改用 createCanonicalKey

**文件**: `src/compact-engine.js`

**变更**:
1. 修改 import（第 2 行）：`import { buildCanonicalKey } from './merge.js'` → `import { createCanonicalKey } from './schema.js'`
2. 修改调用（第 43 行）：`buildCanonicalKey(record)` → `createCanonicalKey(record)`

**依赖**: Task 1（buildCanonicalKey 被删除后 compact-engine 不能继续导入）
**预计变更**: 2 行

## Task 3: 更新 `tests/merge.test.js` — 适配新 key 格式 + 新增跨项目测试

**文件**: `tests/merge.test.js`

**变更**:
1. 修改 import：移除 `buildCanonicalKey`，添加 `import { createCanonicalKey } from '../src/schema.js'`
2. 更新 4 个 `buildCanonicalKey` 测试：
   - 名称改为 `createCanonicalKey`
   - 正则从 `/^user:preference:[a-f0-9]{12}$/` 改为 `/^preference:user:::[a-f0-9]{12}$/`
   - 所有 `buildCanonicalKey(...)` 调用改为 `createCanonicalKey(...)`
3. 新增测试：不同 projectId 产生不同 key
4. 新增测试：mergeByCanonicalKey 不合并跨项目同文案记录

**依赖**: Task 1
**预计变更**: ~30 行修改，~20 行新增

## 执行顺序

```
Task 1 (merge.js) ──→ Task 2 (compact-engine.js) ──→ Task 3 (tests)
```

Task 1 和 Task 2 可以合并为一个 Claude Code 调用（修改量小）。Task 3 单独执行（测试验证）。
