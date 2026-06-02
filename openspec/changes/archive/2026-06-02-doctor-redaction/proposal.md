# Proposal: doctor + redaction

## Why

mem-sync 当前缺少两个关键的运维和安全能力：

1. **doctor** — 没有统一的健康检查命令。当 JSONL 文件损坏、索引过期、锁文件残留时，用户无法快速诊断问题。
2. **redaction** — 没有秘密检测机制。用户或 agent 写入的记忆可能包含 API key、token、password 等敏感信息，直接提交到 Git 仓库。

## What

实现两个新功能：

- `mem-sync doctor` — 只读诊断命令，输出结构化健康报告
- `mem-sync redact --check` — 扫描已有记忆中的敏感信息
- redaction engine — 纯函数模块，在写入管道中自动拦截敏感内容

## Scope

- 新增 3 个文件：`redaction-engine.js`、`commands/doctor.js`、`commands/redact.js`
- 修改 3 个文件：`cli.js`（注册命令）、`memory-store.js`（写入拦截）、`retain.js`（写入拦截）
- 新增 3 个测试文件：对应每个新模块
- 不引入新依赖（使用 Node.js 内置 regex）
