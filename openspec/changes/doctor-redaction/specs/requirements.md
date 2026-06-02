# Requirements: doctor + redaction

## R1: doctor 命令

### R1.1 基本功能
- CLI: `mem-sync doctor`
- 只读命令，不修改任何文件
- stdout 输出 JSON 格式健康报告
- stderr 输出人类可读诊断信息

### R1.2 检查项
1. **JSONL 完整性** — 逐行扫描 `memories.jsonl`，报告解析错误和 schema 验证错误（含行号）
2. **记录统计** — 总数、活跃数、已删除数、已过期数
3. **索引状态** — 是否存在、是否过期（HEAD 比较）、记录数
4. **锁文件** — 是否存在、是否过期（PID 检测）
5. **Git 仓库** — 是否初始化、HEAD、是否在 rebase 中
6. **待合并记录** — pending 文件数和记录数
7. **远端连通性** — 是否配置 remote、能否 fetch

### R1.3 边界场景
- `.mem-sync` 目录不存在 → `{ ok: false, status: 'not_initialized' }`
- `memories.jsonl` 为空 → `{ ok: true, records: { total: 0 } }`
- 非 Git 仓库 → git 相关检查返回 warning，不报错

### R1.4 输出格式
```json
{
  "ok": true,
  "checks": {
    "jsonl": { "ok": true, "totalLines": 100, "validRecords": 98, "parseErrors": 1, "validationErrors": 1, "details": [...] },
    "records": { "total": 98, "active": 95, "deleted": 2, "expired": 1 },
    "index": { "ok": true, "exists": true, "stale": false, "records": 95 },
    "lock": { "ok": true, "exists": false },
    "repo": { "ok": true, "initialized": true, "head": "abc123", "rebaseInProgress": false },
    "pending": { "ok": true, "files": 0, "records": 0 },
    "remote": { "ok": true, "configured": true, "reachable": true }
  }
}
```

## R2: redaction engine

### R2.1 内置检测模式
| 名称 | 匹配目标 | severity |
|------|----------|----------|
| api-key | API key 赋值模式 | block |
| github-token | gh[pousr]_ 前缀 | block |
| aws-key | AKIA 前缀 | block |
| private-key | PEM 私钥头 | block |
| password | password/passwd/pwd 赋值 | block |
| jwt-token | JWT 三段式 | block |
| mongodb-connection | mongodb:// 含凭据 | block |

### R2.2 severity 层级
- `block` — 拒绝写入，抛出错误
- `warn` — 写入但自动降级为 `scope: local-only`

### R2.3 API
```javascript
// 纯函数：扫描文本
redactContent(content, rules?) → { blocked, severity, matches: [{ rule, match, index }] }

// 加载规则（内置 + 自定义）
loadRedactionRules(repoPath?) → compiled rules array
```

### R2.4 自定义规则
- 可选文件：`meta/redaction-rules.json`
- 不存在时只使用内置模式，不报错
- 格式：`{ version: 1, rules: [{ name, pattern, flags?, severity, message? }] }`
- malformed JSON → hard fail

## R3: redact --check 命令

### R3.1 基本功能
- CLI: `mem-sync redact --check`
- 扫描 `memories.jsonl` 中所有已有记录
- stdout 输出 JSON 格式扫描结果

### R3.2 输出格式
```json
{
  "ok": false,
  "scanned": 100,
  "findings": [
    { "line": 42, "id": "mem_abc123", "rule": "api-key", "severity": "block" }
  ]
}
```

## R4: 写入管道集成

### R4.1 remember 命令
- 在 `memory-store.js` 的 `add()` 方法中，`normalizeText()` 之前调用 `redactContent()`
- `block` severity → throw Error，阻止写入
- 支持 `--skip-redaction` 标志跳过检查

### R4.2 retain 命令
- 在 `retainCommand()` 中，`normalizeMemoryInput()` 之前逐个检查候选记忆
- `block` → 跳过该候选，stderr 输出警告，不中断其他候选
- 支持 `--skip-redaction` 标志
