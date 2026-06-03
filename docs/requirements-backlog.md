# Mem Sync 需求待办清单

> 由定时任务自动分析生成，也可手动编辑调整优先级
> 最后更新: 2026-06-04（REQ-014 scope bank model 完成）

---

## 📊 需求统计
- 总计: 1 个待处理需求
- 🔴 高优先级: 0 个
- 🟡 中优先级: 1 个
- 🟢 低优先级: 0 个
- ✅ 已完成: 27 个

---

## 🔴 高优先级
| ID | 需求描述 | 来源文档 | 状态 | 依赖 | 子需求 |
|----|----------|----------|------|------|--------|
| REQ-011 | Recall 正确性治理与排序约束 | 代码分析 + OMP 对照分析 | ✅ 已完成 | REQ-004 | supersedes 排除 + 质量加权排序 + veracity 评分 + MMR 质量感知 |
| REQ-012 | Canonical key 与合并语义统一 | 代码分析 + OMP 对照分析 | ✅ 已完成 | REQ-011 | 统一 `schema.js:createCanonicalKey` 与 `merge.js:buildCanonicalKey` 的身份模型；避免跨 `projectId` / `agentId` / scope 的同文案记忆被错误合并；补齐 supersede / conflict review 语义 |

## 🟡 中优先级
| ID | 需求描述 | 来源文档 | 状态 | 依赖 | 子需求 |
|----|----------|----------|------|------|--------|
| REQ-013 | Memory provenance 与审核轨迹补强 | OMP 对照分析 | ✅ 已完成 | REQ-011 | author/device/session/reviewer/reviewedAt/trustTier 字段 + review 注入 + recall 过滤 |
| REQ-014 | Scope 升级为 bank / namespace 召回模型 | OMP 对照分析 | ✅ 已完成 | REQ-011, REQ-013 | personal/team 枚举 + user→personal 迁移 + scope 优先级加权 + CLI 验证修复 |
| REQ-015 | Recall 回归测试矩阵与黄金语料集 | 质量设计 | 🔄 待处理 | REQ-011 | 建立固定 fixture / JSONL 语料，覆盖新旧冲突、真假冲突、跨项目冲突、相似文本冲突、团队共享冲突；为每个 query 固定预期 top-k 结果 |

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

## 🧭 记忆治理与召回完善方向（2026-06-03）
- 当前最需要优先保证的是 **错误召回**，而不是继续增强 embedding 或 rerank 复杂度；当旧错记忆被召回时，会污染后续 retain、review 与团队同步。
- `src/schema.js` 中的 `createCanonicalKey()` 包含 `kind/scope/projectId/agentId/contentHash`，但 `src/merge.js` 中的 `buildCanonicalKey()` 只使用 `scope/kind/contentHash`；这会在团队协作与多项目共存时造成误合并风险。
- 现有 `pending -> approve/reject` 流程已能支撑基础 review，但还缺少对 `superseded` / `invalidated` / `expired` 等记忆生命周期的正式治理，因此 recall 过滤规则仍不够完整。
- 现有 schema 已具备 `confidence`、`veracity`、`importance`、`validUntil`、`deletedAt`、`supersedes` 字段，但测试与排序约束尚未系统化，导致“字段已存在，行为未被强约束”。
- 对照 OMP / Mnemopi，更适合借鉴的是 bank/scoping、validation、invalidate 与 provenance 轨迹，而不是直接替换成另一套存储引擎。

---

## 🧪 待补全测试矩阵（2026-06-03）

### Recall 正确性
- `deletedAt` 非空的记忆不得进入 recall 结果。
- `validUntil` 已过期的记忆不得进入 recall 结果。
- 被 `supersedes` 指向替代后的旧记忆，在默认 recall 中应被压制或降权。
- 高 `veracity` / 高 `confidence` / 高 `importance` 的有效记忆，应稳定压过低可信旧记忆。
- 当 query 带有“current / latest / 现在 / 当前”语义时，应明显偏向最新且未失效的记忆。
- 当无高质量结果时，宁可返回更少结果，也不要回填低可信脏记忆。

### Merge / Identity 安全
- 文本相同但 `projectId` 不同的记忆，不能在 merge 时被错误合并。
- 文本相同但 `agentId` 或来源不同的记忆，不能因当前 merge key 过粗而丢失。
- 同一事实多次修订时，应保留可追踪替代链，而不是简单 last-write-win 覆盖。
- pending 目录与已入库 JSONL 同时存在相似记录时，合并后结果应稳定且可解释。

### Review / Lifecycle 一致性
- 未批准的 pending 记忆默认不得参与正式 recall。
- approve 后记忆进入 store 与 index；reject 后记忆不应残留在 recall 路径中。
- 未来引入 invalidated / superseded / expired 状态后，状态迁移需要有回归测试覆盖。
- review 操作应保留 reviewer 与时间轨迹，避免团队协作下“谁批准了什么”不可追溯。

### Scope / Bank / 协作隔离
- `personal` / `project` / `team` / `global` 共存时，默认 recall 应优先当前项目与当前用户上下文。
- 团队共享记忆不应错误压过项目私有新记忆。
- 多设备写入相同内容但不同上下文时，召回应保持隔离或可解释合并。
- 跨项目同文案场景下，query 在项目 A 内不应把项目 B 记忆排在前面。

### Hybrid Search 稳定性
- 开启/关闭 embeddings 时，已失效记忆都不应重新进入 top-k。
- 开启/关闭 MMR 时，top-k 可有重排，但不应突破状态过滤与可信度下限。
- FTS 命中为空时的向量 fallback，不应绕过 lifecycle / scope / veracity 约束。

### CLI / E2E Smoke
- `retain -> review -> approve -> flush -> prepare -> recall` 应有稳定的端到端 smoke test。
- `retain --pending` 写入后、未 review 前，不应在正式 recall 中可见。
- `forget` / 软删除后，重建索引与 recall 结果应保持一致。
- `sync` / `prepare` / `flush` 多次重复执行应保持幂等，不产生重复召回结果。

---

## 🔧 建议的开发流程补强（2026-06-03）
- 建立 **recall 黄金语料集**：每个高风险 query 固定预期 top-k，用于回归保护。
- 将测试分层为 `fast unit`、`recall regression`、`merge/sync safety`、`cli e2e smoke` 四组，在 CI 中分层执行。
- 建立 bug -> fixture -> regression test 的闭环：凡是出现一次错误召回，都必须沉淀为最小复现样例。
- 在 PR 模板中增加一项：本次改动是否影响 recall 排序、过滤或 merge 身份语义；若影响，必须更新黄金语料或回归测试。
- 发布前增加固定 smoke checklist：临时 repo 上完整执行 retain/review/flush/prepare/recall，全链路验证结果。

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
| REQ-005 | CLI 兼容性与 README 一致性修复 | 2026-06-03 | completion-plan.md + 代码审计 | [archive](../openspec/changes/archive/) |
| REQ-009 | 维护命令默认仓库路径统一 | 2026-06-03 | completion-plan.md + 代码审计 | - |
| REQ-010 | 计划文档状态与当前实现对齐 | 2026-06-03 | completion-plan.md + 代码审计 | - |
| REQ-006 | Git 同步分支安全与命令执行硬化 | 2026-06-03 | completion-plan.md + 代码审计 | [archive](../openspec/changes/archive/2026-06-03-harden-git-commands) |
| REQ-007 | 加密能力测试稳定性修复 | 2026-06-03 | 代码审计 | - |
| REQ-008 | 旧格式导入命令（legacy import） | 2026-06-03 | completion-plan.md | - |
| REQ-011 | Recall 正确性治理与排序约束 | 2026-06-03 | 代码分析 + OMP 对照分析 | [change](../openspec/changes/req011-recall-correctness) |
| REQ-012 | Canonical key 与合并语义统一 | 2026-06-03 | 代码分析 + OMP 对照分析 | [change](../openspec/changes/req012-canonical-key-unification) |
| REQ-013 | Memory provenance 与审核轨迹补强 | 2026-06-03 | OMP 对照分析 | [change](../openspec/changes/req013-memory-provenance) |
| REQ-014 | Scope 升级为 bank / namespace 召回模型 | 2026-06-04 | OMP 对照分析 | [change](../openspec/changes/req014-scope-bank-model) |

---

## 📚 来源文档索引
| 文档路径 | 修改时间 | 提取需求数 |
|----------|----------|------------|
| docs/requirements/p2-backlog.md | 2026-06-02 | 4 个已完成需求 |
| docs/requirements/2026-06-02-completion-plan.md | 2026-06-02 | 13 个已完成需求，4 个待收口项 |
| 代码审计（README / src / tests） | 2026-06-03 | 1 个新增问题，5 处实现证据补充 |
| 记忆治理 / recall 质量分析（mem-sync × OMP） | 2026-06-03 | 5 个新增需求，1 组开发流程建议，1 组测试矩阵 |

---

## 🔄 更新日志
- 2026-06-04: 完成 REQ-014 Scope 升级为 bank / namespace 召回模型 — 新增 personal/team scope，user→personal 自动迁移，scope 优先级加权排序（personal>project>team>global），CLI 验证一致性修复，687 测试全绿
- 2026-06-03: 完成 REQ-012 Canonical key 与合并语义统一 — 删除 buildCanonicalKey，统一使用 createCanonicalKey，655 测试全绿
- 2026-06-03: 完成 REQ-011 Recall 正确性治理与排序约束 — supersedes 排除、confidence/importance/veracity 质量加权排序、MMR 质量感知，6 个新测试，652 测试全绿
- 2026-06-03: 完成 REQ-008 旧格式导入命令 — 添加 `import legacy` 子命令，支持 `--from`/`--to` 参数，2 个新测试
- 2026-06-03: 完成 REQ-007 加密能力测试稳定性修复（已由之前的会话修复，所有 encryption 测试通过）
- 2026-06-03: 完成 REQ-006 Git 同步分支安全与命令执行硬化 — 添加 getDefaultBranch()，消除 origin/main 硬编码，shell-string 改为参数数组
- 2026-06-03: 完成 REQ-005 CLI 兼容性与 README 一致性修复 + REQ-009 默认仓库路径统一（一并完成）
- 2026-06-03: 完成 REQ-010 计划文档状态与当前实现对齐
- 2026-06-03: 新增 REQ-011 ~ REQ-015，补充 recall 正确性、身份合并、provenance、bank 模型与测试矩阵需求
- 2026-06-03: 人工回填待办，新增 REQ-005 ~ REQ-010，反映当前代码与计划的真实未完成项
- 2026-06-03: 完成 REQ-004 interactive review UI — 添加 review approve/reject 命令
- 2026-06-02 20:00: 初始化，从 p2-backlog.md 导入 4 个需求，从 completion-plan.md 导入 13 个已完成需求
