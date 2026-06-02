# mem-sync 自动开发定时任务

## 任务目标
每小时检查 mem-sync-workspace 仓库的待办需求，按照 hermes-technical-lead-workflow 流程进行开发。

## 工作流程
0. **Git 同步** — 执行 `git pull --rebase` 拉取远程最新代码，确保本地分支是最新的
   - 如果出现冲突，使用 Claude Code 协商解决（`claude -p "..."`），解决后继续
1. **检查历史任务** — 查看是否有未完成的任务
2. **获取下一个需求** — 扫描 `openspec/changes/` 目录，按文件名排序，取第一个未归档的 change
   - **每次只做一个需求**，做完归档后再做下一个，避免半成品堆积
3. **执行开发流程**：
   1. Explore — 和 Claude Code 讨论方案可行性
   2. Propose — 生成 OpenSpec 规格文档
   3. Delegate — 委托 Claude Code 实现
   4. Review — 检查代码变更
   5. Verify — 运行测试验证
   6. Archive — 提交并汇报
4. **全面测试** — 运行所有测试，确保没有回归
5. **Git 推送** — 执行 `git push` 将本地提交推送到远程仓库

## 项目位置
~/.hermes/repos/mem-sync-workspace

## 设计文档
~/.hermes/repos/mem-sync-workspace/docs/memcli-design.md

## 当前进度
- ✅ 步骤 1: 定义 repo layout 和 memory schema
- ✅ 步骤 2: 实现 repo-store 读写 JSONL
- ✅ 步骤 3: 实现 SQLite/FTS local index
- ✅ 步骤 4: 实现 remember 和 recall
- ✅ 步骤 5: 实现 prepare：sync + index update (2026-06-02)
- ✅ 步骤 6: 实现 context：summary + top recent memories (2026-06-02)
- ✅ 步骤 7: 实现 retain --pending (2026-06-02)
- ✅ 步骤 8: 实现 flush：pending merge + summary + commit/push (2026-06-02)
- ✅ 步骤 9: 实现 doctor 和 redaction (2026-06-02)
- ✅ 步骤 10: compact + summarize + review pending (2026-06-02)
- ✅ 步骤 11: init, sync, status, log, show, forget CLI commands (2026-06-02)
- ✅ 步骤 12: embedding cache with hybrid search (2026-06-02)
- ✅ 步骤 13: MMR rerank for recall engine (2026-06-02)

## P2 待实现
- ✅ LLM extractor/reranker (2026-06-02)
- encrypted repo support
- generated skills
- interactive review UI

## 关键约束
- 必须使用 OpenSpec 流程
- explore 阶段必须和 Claude Code 多轮讨论
- 使用 DeepSeek V4 pro 模型，max 强度
- 每次执行结束进行全面 review 和测试
- 测试必须全部通过才能提交
- 开始前必须 git pull --rebase 同步远程
- 完成后必须 git push 推送到远程
