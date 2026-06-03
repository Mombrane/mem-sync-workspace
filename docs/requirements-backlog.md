# Mem Sync 需求待办清单

> 由定时任务自动分析生成，也可手动编辑调整优先级
> 最后更新: 2026-06-03（人工校准：结合代码、测试与计划文档）

---

## 📊 需求统计
- 总计: 5 个待处理需求
- 🔴 高优先级: 3 个
- 🟡 中优先级: 2 个
- 🟢 低优先级: 0 个
- ✅ 已完成: 18 个

---

## 🔴 高优先级
| ID | 需求描述 | 来源文档 | 状态 | 依赖 | 子需求 |
|----|----------|----------|------|------|--------|
| REQ-005 | CLI 兼容性与 README 一致性修复 | `2026-06-02-completion-plan.md` + 代码审计 | 🔄 待处理 | - | 为 `remember` 增加 `add` alias；修正 README Quick Start；移除“JSONL 仍未落地”的过时 roadmap 描述；补齐帮助文本与真实命令的一致性 |
| REQ-006 | Git 同步分支安全与命令执行硬化 | `2026-06-02-completion-plan.md` + 代码审计 | 🔄 待处理 | - | 将 `src/git.js` 剩余 shell-string Git 调用改为参数数组；取消硬编码 `origin/main`；支持默认分支发现；同步修正测试辅助中的硬编码 `main` |
| REQ-007 | 加密能力测试稳定性修复 | 代码审计 | 🔄 待处理 | REQ-003 | 修复 `tests/encryption.test.js` 对本机 `age` 可用性的强假设；调整 `encryptLine` / `decryptLine` 的校验顺序；恢复 `npm test` 全量通过 |

## 🟡 中优先级
| ID | 需求描述 | 来源文档 | 状态 | 依赖 | 子需求 |
|----|----------|----------|------|------|--------|
| REQ-008 | 旧格式导入命令（legacy import） | `2026-06-02-completion-plan.md` | 🔄 待处理 | - | 提供 `.mem-sync/memories.json` → `memories.jsonl` 导入迁移命令与测试，完成 legacy 数据升级路径 |
| REQ-009 | 维护命令默认仓库路径统一 | `2026-06-02-completion-plan.md` + 代码审计 | 🔄 待处理 | - | 将 `compact`、`summarize`、`review` 从 `~/.memcli/default` 统一到 `MEM_SYNC_HOME ?? '.mem-sync'`，避免与其他命令默认行为不一致 |

## 🟢 低优先级
- 当前无低优先级待处理需求

---

## 🔎 代码审计发现（2026-06-03）
- `README.md` 仍使用 `node ./src/cli.js add ...` 作为 Quick Start，但 `src/cli.js` 当前没有 `add` 路由；实际执行会打印 help 并退出。
- `README.md` 仍声称“当前 prototype 还在使用 `.mem-sync/memories.json`，后续再迁移到 JSONL”，与 `repo-store.js` / `remember.js` 的现实实现不一致。
- `src/commands/compact.js`、`src/commands/summarize.js`、`src/commands/review.js` 仍默认指向 `~/.memcli/default`，与大多数命令已经采用的 `.mem-sync` / `MEM_SYNC_HOME` 约定不一致。
- `src/git.js` 只对 `stageFile()` 和 `commit()` 做了参数数组防护；`fetch()`、`pullRebase()`、`push()` 仍依赖 shell-string 调用，并硬编码 `origin/main`。
- `src/commands/import.js` 与 `tests/cli-import.test.js` 仍不存在，legacy `memories.json` 只有读取兼容，没有显式迁移入口。
- 当前全量测试未全绿：`npm test` 共有 5 个失败，全部集中在 `tests/encryption.test.js`。其中 1 个来自本机未安装 `age` / `age-keygen`，其余 4 个来自 `src/encryption.js` 在校验 `mode` 之前先检查二进制可用性。

---

## ✅ 已完成
| ID | 需求描述 | 完成日期 | 来源文档 | OpenSpec |
|----|----------|----------|----------|----------|
| REQ-000 | repo layout 和 memory schema | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | repo-store 读写 JSONL | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | SQLite/FTS local index | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | remember 和 recall | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | prepare: sync + index update | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | context: summary + top recent | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | retain --pending | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | flush: pending merge + commit | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | doctor 和 redaction | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | compact + summarize + review | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | init, sync, status, log 等 CLI | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | embedding cache with hybrid search | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-000 | MMR rerank for recall engine | 2026-06-02 | completion-plan.md | [archive](../openspec/changes/archive/) |
| REQ-001 | LLM extractor/reranker | 2026-06-02 | p2-backlog.md | [archive](../openspec/changes/archive/2026-06-02-llm-extractor-reranker) |
| REQ-002 | generated skills | 2026-06-02 | p2-backlog.md | [archive](../openspec/changes/archive/2026-06-02-generated-skills) |
| REQ-003 | encrypted repo support | 2026-06-02 | p2-backlog.md | [archive](../openspec/changes/archive/2026-06-02-encrypted-repo-support) |
| REQ-004 | interactive review UI | 2026-06-03 | p2-backlog.md | [archive](../openspec/changes/archive/2026-06-03-interactive-review-ui) |
| REQ-010 | 计划文档状态与当前实现对齐 | 2026-06-03 | completion-plan.md + 代码审计 | - |

---

## 📚 来源文档索引
| 文档路径 | 修改时间 | 提取需求数 |
|----------|----------|------------|
| docs/requirements/p2-backlog.md | 2026-06-02 | 4 个已完成需求 |
| docs/requirements/2026-06-02-completion-plan.md | 2026-06-02 | 13 个已完成需求，4 个待收口项 |
| 代码审计（README / src / tests） | 2026-06-03 | 1 个新增问题，5 处实现证据补充 |

---

## 🔄 更新日志
- 2026-06-03: 完成 REQ-010 计划文档状态与当前实现对齐
- 2026-06-03: 人工回填待办，新增 REQ-005 ~ REQ-010，反映当前代码与计划的真实未完成项
- 2026-06-03: 完成 REQ-004 interactive review UI — 添加 review approve/reject 命令
- 2026-06-02 20:00: 初始化，从 p2-backlog.md 导入 4 个需求，从 completion-plan.md 导入 13 个已完成需求
