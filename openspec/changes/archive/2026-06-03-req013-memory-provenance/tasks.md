# REQ-013 实施清单

## Task 1: Schema 扩展 + computeTrustTier
**文件**: `src/schema.js`, `tests/schema.test.js`
**依赖**: 无
**内容**:
- 在 `normalizeMemoryInput` 中新增 author, device, session, reviewer, reviewedAt, trustTier 字段
- 在 `validateMemory` 中允许这些字段为 null/undefined（不拒绝旧记录）
- 实现 `computeTrustTier(record)` 函数
- 新增测试：默认值、validateMemory 兼容性、computeTrustTier 各规则

## Task 2: SQLite 索引扩展
**文件**: `src/index-store.js`, `tests/index-store.test.js`
**依赖**: Task 1
**内容**:
- `createIndexDatabase`: memories 表新增 author, session, device, reviewer, reviewed_at, trust_tier 列
- `rebuildIndex`: INSERT 语句新增列映射
- `searchIndex`: WHERE 子句支持 author, device, trustTier, reviewer 过滤
- `mapRow`: 返回新字段
- 新增测试：新列写入/读取、过滤条件

## Task 3: remember + retain CLI 扩展
**文件**: `src/commands/remember.js`, `src/commands/retain.js`, `tests/`
**依赖**: Task 1
**内容**:
- `parseRememberArgs`: 新增 --author, --device, --session 标志
- `parseRetainArgs`: 新增 --author, --session 标志
- 写入时填充对应字段
- 新增测试

## Task 4: review 审核注入
**文件**: `src/commands/review.js`, `tests/review.test.js`
**依赖**: Task 1, Task 2
**内容**:
- `approveCommand`: 注入 reviewer, reviewedAt, 计算 trustTier
- `rejectCommand`: 记录 reviewer（rejected log）
- 新增 --reviewer 标志
- 环境变量 fallback: MEM_SYNC_REVIEWER → USER
- 新增测试

## Task 5: recall 过滤扩展
**文件**: `src/commands/recall.js`, `tests/recall-quality.test.js`
**依赖**: Task 2
**内容**:
- `parseRecallArgs`: 新增 --author, --device, --trust-tier, --reviewer 标志
- 传递过滤参数到 searchIndex
- 新增测试
