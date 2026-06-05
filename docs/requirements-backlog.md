# Mem Sync 需求待办清单

> 由定时任务自动分析生成，也可手动编辑调整优先级
> 最后更新: 2026-06-05（新增 REQ-016 ~ REQ-023，覆盖加密错误优先级、密码模式、索引增量、CJK 查询、redaction 拦截、pending 隔离等）

---

## 📊 需求统计
- 总计: 3 个待处理需求
- 🔴 高优先级: 0 个
- 🟡 中优先级: 3 个
- 🟢 低优先级: 0 个
- ✅ 已完成: 33 个

---

## 🔴 高优先级
| ID | 需求描述 | 来源文档 | 状态 | 依赖 | 子需求 |
|----|----------|----------|------|------|--------|
| REQ-016 | 加密函数错误优先级修复：`encryptLine`/`decryptLine` 模式校验应优先于 age 二进制检查 | 代码分析 + 测试失败 | ✅ 已完成 | - | 2026-06-05 |
| REQ-017 | `checkAgeBinary` 测试修正：不应假定本机已安装 age 二进制 | 测试失败 | ✅ 已完成 | - | 2026-06-05 |
| REQ-018 | 加密测试全量恢复：安装 age 二进制或引入 mock | 测试框架 | ✅ 已完成 | REQ-016, REQ-017 | 2026-06-05 |

## 🟡 中优先级
| ID | 需求描述 | 来源文档 | 状态 | 依赖 | 子需求 |
|----|----------|----------|------|------|--------|
| REQ-019 | 密码加密模式（password mode）实现 | SKILL.md + memcli-design.md | ✅ 已完成 | REQ-016 | 2026-06-05 |
| REQ-020 | 增量索引更新验收：确认 updateIndex 使用 git diff 增量而非全量 rebuild | memcli-design.md §8.2 | ⬜ 待验证 | - | 设计文档描述增量更新流程为 `git diff --name-only last..current` 只重建变更文件，但当前 `updateIndex` 可能在 HEAD 变化时 fallback 到全量 rebuild。需阅读代码确认实际行为，若为全量则实现真增量逻辑，并补充针对性测试 |
| REQ-021 | FTS5 trigram CJK 两字查询修复 | remember-recall-design.md §5.6 | ✅ 已完成 | - | 2026-06-05 |
| REQ-022 | Redaction 拦截验证：确认 flush 流程对 redaction 命中的阻断行为 | memcli-design.md §13 + §17 | ⬜ 待验证 | - | 设计文档声明 write path 在写入 GitHub 前须经过 secret detector + redaction rules 拦截。当前 redaction 在 remember/retain 中有拦截，但需确认 flush 合并 pending 到 store 时是否也执行 redaction 检查，以及检查命中时能否阻止 commit/push |
| REQ-023 | Pending 记忆 recall 隔离验证 | 测试矩阵（recall 端到端） | ⬜ 待验证 | - | 未 review 的 pending 记忆理论上不应出现在正式 recall 结果中。需在 `retain --pending → recall → review approve → recall` 全链路中验证隔离行为，并补充端到端回归测试 |

## 🟢 低优先级
- 当前无低优先级待处理需求

---

## 🔎 代码审计发现（2026-06-03，已大部分修复）
- ~~`README.md` 仍使用 `node ./src/cli.js add ...`~~ → ✅ 已修复（REQ-005 部分修复 + 2026-06-04 维护补全，9 处 `node ./src/cli.js` → `npx mem-sync`）
- ~~`README.md` 仍声称 `.memcli/memories.json`~~ → ✅ 已修复，现在正确引用 `.mem-sync/memories.jsonl`（REQ-005）
- ~~`compact.js`/`summarize.js`/`review.js` 默认指向 `~/.memcli/default`~~ → ✅ 已修复（REQ-009）
- ~~`src/git.js` shell-string 调用 + 硬编码 `origin/main`~~ → ✅ 已修复（REQ-006）
- ~~`src/commands/import.js` 不存在~~ → ✅ 已修复（REQ-008）
- ~~`encryption.test.js` 5 个失败~~ → ✅ 已修复，18/18 全绿（REQ-007）

---

## 🔧 已知技术债（不阻塞功能，但建议关注）

### CJK 两字查询
- FTS5 trigram tokenizer 对 2 字符 CJK 无法生成 token，详见 REQ-021。
- 当前 workaround：追加通配符或切换到 `LIKE` 查询；长期考虑 bigram 方案。

### 加密测试对真实 age 二进制的依赖
- 11 个加密测试在无 age 环境直接 skip，不能跑在纯 CI 环境。REQ-018 提议引入 mock/stub 机制。

### 增量索引的代码路径
- 设计文档描述增量更新，但 `updateIndex` 当前实现需要代码审查确认是否真正增量（REQ-020）。

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
| REQ-015 | Recall 回归测试矩阵与黄金语料集 | 2026-06-04 | 质量设计 | [change](../openspec/changes/req015-recall-regression) |
| REQ-016 | 加密函数错误优先级修复 | 2026-06-05 | 代码分析 + 测试失败 | - |
| REQ-017 | checkAgeBinary 测试修正 | 2026-06-05 | 测试失败 | - |
| REQ-018 | 加密测试全量恢复 | 2026-06-05 | 测试框架 | - |
| REQ-021 | FTS5 trigram CJK 两字查询修复 | 2026-06-05 | remember-recall-design.md | - |
| REQ-019 | 密码加密模式（password mode）实现 | 2026-06-05 | SKILL.md + memcli-design.md | - |

---

## 📚 来源文档索引
| 文档路径 | 修改时间 | 提取需求数 |
|----------|----------|------------|
| docs/requirements/p2-backlog.md | 2026-06-02 | 4 个已完成需求 |
| docs/requirements/2026-06-02-completion-plan.md | 2026-06-02 | 13 个已完成需求，4 个待收口项 |
| 代码审计（README / src / tests） | 2026-06-03 | 1 个新增问题，5 处实现证据补充 |
| 记忆治理 / recall 质量分析（mem-sync × OMP） | 2026-06-03 | 5 个新增需求，1 组开发流程建议，1 组测试矩阵 |
| 全面代码走查与测试分析（mem-sync） | 2026-06-05 | 8 个新增需求（REQ-016 ~ REQ-023） |

---

## 🔄 更新日志
- 2026-06-05: 完成 REQ-019 密码加密模式实现 — age-encryption JS 库 passphrase 加密/解密，MEM_SYNC_PASSWORD 环境变量，709 测试全绿
- 2026-06-05: 完成 REQ-021 FTS5 trigram CJK 两字查询修复 — LIKE fallback for short CJK queries，4 新测试，707 测试全绿
- 2026-06-05: 完成 REQ-016/017/018 — 加密函数错误优先级修复（mode validation before binary check）、checkAgeBinary 测试修正、加密测试全量恢复，703 测试全绿
- 2026-06-05: 新增 REQ-016 ~ REQ-023 — 加密错误优先级修复、checkAgeBinary 测试修正、加密测试全量恢复、密码模式实现、增量索引验收、CJK 两字查询修复、redaction 拦截验证、pending 隔离验证。当前测试状态：691 pass / 5 fail / 11 skip（总计 707）
- 2026-06-04: 完成 REQ-015 Recall 回归测试矩阵与黄金语料集 — 22 条黄金语料覆盖 8 种场景，9 个回归测试，696 测试全绿
- 2026-06-04: 完成 REQ-014 Scope 升级为 bank / namespace 召回模型 — personal/team scope，user→personal 自动迁移，scope 优先级加权排序，687 测试全绿
- 2026-06-03: 完成 REQ-012 Canonical key 与合并语义统一 — 删除 buildCanonicalKey，统一使用 createCanonicalKey，655 测试全绿
- 2026-06-03: 完成 REQ-011 Recall 正确性治理与排序约束 — supersedes 排除、confidence/importance/veracity 质量加权排序、MMR 质量感知，652 测试全绿
- 2026-06-03: 完成 REQ-008 旧格式导入命令 — 添加 `import legacy` 子命令，支持 `--from`/`--to` 参数
- 2026-06-03: 完成 REQ-007 加密能力测试稳定性修复（已由之前的会话修复）
- 2026-06-03: 完成 REQ-006 Git 同步分支安全与命令执行硬化 — 添加 getDefaultBranch()，消除 origin/main 硬编码，shell-string 改为参数数组
- 2026-06-03: 完成 REQ-005 CLI 兼容性与 README 一致性修复 + REQ-009 默认仓库路径统一（一并完成）
- 2026-06-03: 完成 REQ-010 计划文档状态与当前实现对齐
- 2026-06-03: 新增 REQ-011 ~ REQ-015，补充 recall 正确性、身份合并、provenance、bank 模型与测试矩阵需求
- 2026-06-03: 完成 REQ-004 interactive review UI — 添加 review approve/reject 命令
- 2026-06-02 20:00: 初始化，从 p2-backlog.md 导入 4 个需求，从 completion-plan.md 导入 13 个已完成需求
