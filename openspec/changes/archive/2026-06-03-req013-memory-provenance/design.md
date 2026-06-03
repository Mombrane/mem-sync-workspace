# REQ-013 技术设计

## 架构决策

### 1. 字段位置：顶层
author、device、session、reviewer、reviewedAt、trustTier 全部放在记忆记录顶层，与 agentId 同级。不塞进 source 对象。

### 2. schemaVersion：保持 v1
新字段全部 optional (default null)。validateMemory 不拒绝缺少新字段的旧记录。

### 3. trustTier：存储时计算
approve 时计算并固化。recall 时不再动态重算。

### 4. canonicalKey：不纳入 provenance
相同内容由不同 author 创建仍视为同一记忆。

### 5. SQLite 迁移：ALTER TABLE + 自动 rebuild
每次 createIndexDatabase 时检测列是否存在，缺列则 ALTER TABLE ADD COLUMN。

## 文件修改清单

### 核心修改

| # | 文件 | 修改内容 |
|---|------|---------|
| 1 | `src/schema.js` | 新增 6 个 optional 字段定义 + validateMemory + normalizeMemoryInput + computeTrustTier |
| 2 | `src/index-store.js` | CREATE TABLE 新增 6 列 + INSERT 映射 + searchIndex WHERE + mapRow |
| 3 | `src/commands/remember.js` | parseRememberArgs 新增 --author/--device/--session |
| 4 | `src/commands/retain.js` | parseRetainArgs 新增 --author/--session |
| 5 | `src/commands/review.js` | approve 注入 reviewer/reviewedAt/trustTier；reject 记录 reviewer |
| 6 | `src/commands/recall.js` | parseRecallArgs 新增 --author/--device/--trust-tier/--reviewer |

### 测试修改

| # | 文件 | 修改内容 |
|---|------|---------|
| 7 | `tests/schema.test.js` | 测试新字段默认值、validateMemory 兼容性、computeTrustTier |
| 8 | `tests/index-store.test.js` | 测试新列、新过滤条件 |
| 9 | `tests/review.test.js` | 测试 reviewer 注入、trustTier 计算 |
| 10 | `tests/recall-quality.test.js` | 测试 provenance 过滤 |

## 实施顺序

1. **Task 1**: schema.js — 新增字段定义 + computeTrustTier + 测试
2. **Task 2**: index-store.js — SQLite 列 + 映射 + 过滤 + 测试
3. **Task 3**: remember.js + retain.js — CLI 标志 + 测试
4. **Task 4**: review.js — 审核注入 + 测试
5. **Task 5**: recall.js — 过滤标志 + 测试
