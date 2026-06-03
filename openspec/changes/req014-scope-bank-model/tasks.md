# Tasks: REQ-014 Scope 升级为 Bank / Namespace 召回模型

## Task 1: Schema + Memory Store — scope 枚举扩展与向后兼容
**文件:** `src/schema.js`, `src/memory-store.js`
**依赖:** 无
**内容:**
1. `schema.js`: `MEMORY_SCOPES` 新增 `'personal'`, `'team'`；保留 `'user'` 但标记为 deprecated
2. `memory-store.js`: `normalizeLegacyScope()` 添加 `'user' → 'personal'` 映射
3. `schema.js`: `normalizeMemoryInput` 中 scope 默认值改为 `'personal'`（如果之前是 `user`）

## Task 2: Retain Engine — 硬编码 scope 更新
**文件:** `src/retain-engine.js`
**依赖:** Task 1
**内容:**
1. `explicit-remember` 规则: `scope: 'user'` → `scope: 'personal'`
2. `preference-pattern` 规则: `scope: 'user'` → `scope: 'personal'`
3. 验证：所有 5 条规则路径的 scope 值都使用新枚举

## Task 3: Index Store — searchIndex scope 优先级加权
**文件:** `src/index-store.js`
**依赖:** Task 1
**内容:**
1. 在 `searchIndexHybrid` 和 `searchIndex` 的结果排序中，添加 scope 优先级权重
2. 权重定义：`personal=1.0, project=0.8, team=0.6, global=0.4, agent=0.3, local-only=0.2`
3. scope 权重作为最终得分的乘法因子（不影响 FTS/bm25/embedding 原始分数）
4. 保持 `--scope` 精确过滤功能不变

## Task 4: Context Command — scope 过滤与优先级
**文件:** `src/commands/context.js`
**依赖:** Task 1, Task 3
**内容:**
1. `parseContextArgs`: 添加 `--scope` 参数支持
2. `queryWorkingMemories`: 添加 scope 过滤
3. `computeContextScore`: 集成 scope 优先级权重
4. `writeMemoryBlock`: 将硬编码的 `scope: 'user'` 改为 `scope: 'personal'`

## Task 5: CLI 验证一致性修复
**文件:** `src/commands/recall.js`, `src/commands/remember.js`
**依赖:** Task 1
**内容:**
1. `recall.js` `parseRecallArgs`: `--scope` 添加 `validateEnum` 验证
2. `recall.js` `parseRecallArgs`: `--kind` 添加 `validateEnum` 验证
3. `recall.js` `parseRecallArgs`: `--veracity` 添加 `validateEnum` 验证
4. `remember.js`: 已验证，无需修改

## Task 6: LLM Extract — prompt 中的 scope 更新
**文件:** `src/llm-extract.js`
**依赖:** Task 1
**内容:**
1. LLM prompt 中的 scope 枚举描述：`user` → `personal`，新增 `team`
2. 默认 scope 值：如果 LLM 返回 `user`，在 normalizeLegacyScope 中自动映射

## Task 7: 测试覆盖
**文件:** `tests/schema.test.js`, `tests/index-store.test.js`, `tests/cli-recall.test.js`, 新增 `tests/scope-priority.test.js`
**依赖:** Task 1-6
**内容:**
1. schema.test.js: `personal` 和 `team` 枚举验证，`user` → `personal` 映射测试
2. scope-priority.test.js: scope 优先级排序验证
3. cli-recall.test.js: `--scope personal` 端到端测试
4. index-store.test.js: searchIndex scope 过滤 + 优先级测试
