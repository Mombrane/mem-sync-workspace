# Technical Design: doctor + redaction

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           src/redaction-engine.js    │
                    │  - DEFAULT_PATTERNS (built-in)       │
                    │  - loadRedactionRules(repoPath?)     │
                    │  - redactContent(content, rules?)    │
                    └──────────┬──────────┬───────────────┘
                               │          │
              ┌────────────────┘          └────────────────┐
              ▼                                            ▼
   src/memory-store.js                          src/commands/redact.js
   (remember write path)                        (redact --check scan)
   add() calls redactContent()                  reads JSONL, scans each
   before normalizeText()
                                                    
   src/commands/retain.js                       src/commands/doctor.js
   (retain write path)                          (health check)
   per-candidate redactContent()                7 diagnostic checks
   before normalizeMemoryInput()
```

## File Changes

### New Files

#### 1. `src/redaction-engine.js` (~120 lines)

纯模块，无 I/O 依赖（除 loadRedactionRules 读配置文件）。

```javascript
// 内置模式
export const DEFAULT_PATTERNS = [
  { name: 'api-key', regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i, severity: 'block' },
  { name: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/, severity: 'block' },
  { name: 'aws-key', regex: /AKIA[0-9A-Z]{16}/, severity: 'block' },
  { name: 'private-key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, severity: 'block' },
  { name: 'password', regex: /(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/i, severity: 'block' },
  { name: 'jwt-token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, severity: 'block' },
  { name: 'mongodb-connection', regex: /mongodb:\/\/[^@]+@/, severity: 'block' },
];

// 加载规则：内置 + meta/redaction-rules.json（可选）
export function loadRedactionRules(repoPath) { ... }

// 扫描文本
export function redactContent(content, rules?) → { blocked, severity, matches }
```

#### 2. `src/commands/doctor.js` (~200 lines)

7 个检查函数 + 聚合输出。

检查列表：
1. `checkJsonlIntegrity(memSyncHome)` — 逐行扫描 JSONL
2. `checkRecords(memSyncHome)` — 统计记录状态
3. `checkIndex(cacheDir, memSyncHome)` — 索引存在性和新鲜度
4. `checkLock(lockPath)` — 锁文件状态
5. `checkRepo(memSyncHome)` — Git 仓库状态
6. `checkPending(pendingDir)` — 待合并记录
7. `checkRemote(memSyncHome)` — 远端连通性

#### 3. `src/commands/redact.js` (~80 lines)

只读扫描命令。

### Modified Files

#### 4. `src/cli.js` — 注册新命令

在命令分发中添加 `doctor` 和 `redact` 分支。
在 help 输出中添加新命令。

#### 5. `src/memory-store.js` — remember 写入拦截

在 `add()` 方法的 `normalizeText()` 之前插入 redaction 检查：
```javascript
if (!options.skipRedaction) {
  const result = redactContent(text);
  if (result.blocked) {
    throw new Error(`content blocked by redaction: ${result.matches[0].rule}`);
  }
}
```

#### 6. `src/commands/retain.js` — retain 写入拦截

在候选循环中，`normalizeMemoryInput()` 之前逐个检查：
```javascript
const redactResult = redactContent(candidate.content);
if (redactResult.blocked) {
  console.error(`[mem-sync:redact] blocked candidate: ${redactResult.matches[0].rule}`);
  continue; // skip, don't abort
}
```

## Implementation Order

1. `redaction-engine.js` + tests (pure module, no dependencies)
2. `commands/redact.js` + tests (uses engine, reads JSONL)
3. `commands/doctor.js` + tests (independent, read-only)
4. `cli.js` registration (minimal changes)
5. `memory-store.js` integration (15 lines)
6. `retain.js` integration (15 lines)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Redaction location in remember | Before normalizeText() | Scan raw input before whitespace folding |
| Redaction in retain | Per-candidate, skip blocked | Don't kill all candidates for one bad one |
| Doctor scope | Read-only, no --fix | MVP scope; --fix is P1 |
| Rules file missing | Silent fallback to built-in | Config is optional |
| Malformed rules JSON | Hard fail | Safety-critical config |
| Severity tiers | block + warn | warn → scope:local-only |
