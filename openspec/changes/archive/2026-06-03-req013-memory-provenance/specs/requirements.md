# REQ-013 需求规格

## 功能需求

### FR-01: Schema 新增字段
- `author` (string|null): 记忆创建者身份，默认 null
- `device` (string|null): 创建设备标识，默认 null
- `session` (string|null): 创建会话标识，默认 null
- `reviewer` (string|null): 审核者身份，默认 null（未审核）
- `reviewedAt` (ISO timestamp|null): 审核时间，默认 null（未审核）
- `trustTier` ('high'|'medium'|'low'|'untrusted'|null): 可信等级，默认 null

### FR-02: remember 命令扩展
- 新增 `--author <id>` 标志
- 新增 `--device <id>` 标志
- 新增 `--session <id>` 标志
- 写入时填充对应字段

### FR-03: retain 命令扩展
- 新增 `--author <id>` 标志
- 新增 `--session <id>` 标志
- 已有 `--device` 标志，保持不变

### FR-04: review approve 注入审核信息
- approve 时自动设置 `reviewer`（来自 --reviewer 标志或 MEM_SYNC_REVIEWER 环境变量或 USER 环境变量）
- approve 时自动设置 `reviewedAt`（当前时间 ISO）
- approve 时自动计算 `trustTier`
- 新增 `--reviewer <id>` 标志

### FR-05: review reject 注入审核信息
- reject 时记录 reviewer（写入 rejected log 或标记）
- 新增 `--reviewer <id>` 标志

### FR-06: recall 过滤扩展
- 新增 `--author <id>` 过滤
- 新增 `--device <id>` 过滤
- 新增 `--trust-tier <tier>` 过滤
- 新增 `--reviewer <id>` 过滤

### FR-07: trustTier 自动计算规则
- `high`: reviewer 明确审核 + confidence >= 0.7
- `medium`: reviewer 审核 或 source.type='manual' + confidence >= 0.5
- `low`: source.type='inferred'/'imported'，无 reviewer
- `untrusted`: confidence < 0.3 且无 reviewer

### FR-08: SQLite 索引扩展
- memories 表新增 author、session、device、reviewer、reviewed_at、trust_tier 列
- searchIndex WHERE 子句支持新过滤条件
- rebuildIndex 映射新字段

## 非功能需求

### NFR-01: 向后兼容
- 旧 JSONL 记录缺少新字段时，validateMemory 不拒绝
- SQLite 缺列时自动 rebuild

### NFR-02: 测试覆盖
- 每个 FR 对应至少 1 个测试
- 新增约 10-15 个测试
