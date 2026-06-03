# REQ-006: Git 同步分支安全与命令执行硬化

## 背景
`src/git.js` 混合使用 shell-string (`execGit`) 和 argument-array (`execGitArgs`) 两种 Git 命令执行方式。`fetch`、`pullRebase`、`push` 三个函数硬编码 `origin/main`，不支持其他默认分支名。

## 目标
1. 将涉及参数拼接的 `execGit` 调用改为 `execGitArgs`（安全）
2. 添加 `getDefaultBranch(cwd)` 动态发现默认分支
3. 消除 `origin/main` 硬编码
4. 新增测试覆盖新功能

## 变更范围

### src/git.js
- 新增 `getDefaultBranch(cwd)` — 动态发现远程默认分支
- 修改 `fetch(cwd)` — 使用 `getDefaultBranch` 代替硬编码
- 修改 `pullRebase(cwd)` — 使用 `execGitArgs` + `getDefaultBranch`
- 修改 `push(cwd)` — 使用 `execGitArgs` + `getDefaultBranch`
- 修改 `stashSave(cwd)` — 使用 `execGitArgs` 代替 shell-string（消除引号拼接）
- 修改 `commit(cwd)` — `rev-parse --short HEAD` 也改用 `execGitArgs` 保持一致性

### 不改动的函数（安全，无用户输入）
- `hasRemote` — `remote get-url origin`（固定参数）
- `getHead` — `rev-parse HEAD`（固定参数）
- `stashPop` — `stash pop`（固定参数）
- `rebaseAbort` — `rebase --abort`（固定参数）
- `ensureClone` — 已用 `execGitArgs`

### tests/git.test.js
- 新增 `getDefaultBranch` 测试（有 remote / 无 remote / fallback）
- 新增 `fetch` 非 main 分支测试
- 新增 `pullRebase` 非 main 分支测试
- 新增 `push` 非 main 分支测试

### 不需要修改的文件
- 调用者（prepare.js, sync.js, flush.js 等）— 接口不变
- 测试辅助函数中的 `git init -b main` — 测试控制的，不需改

## getDefaultBranch 实现策略

```js
export function getDefaultBranch(cwd) {
  // 1. Try remote HEAD
  try {
    const ref = execGitArgs(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], cwd);
    return ref.trim().replace('origin/', '');
  } catch {}
  
  // 2. Try local HEAD
  try {
    const ref = execGitArgs(['symbolic-ref', 'HEAD', '--short'], cwd);
    return ref.trim();
  } catch {}
  
  // 3. Fallback: try main, then master
  try {
    execGitArgs(['rev-parse', '--verify', 'refs/heads/main'], cwd);
    return 'main';
  } catch {}
  try {
    execGitArgs(['rev-parse', '--verify', 'refs/heads/master'], cwd);
    return 'master';
  } catch {}
  
  // 4. Ultimate fallback
  return 'main';
}
```

## 验证标准
- `npm test` 全量通过（除已知 encryption 测试环境问题外）
- `node --test tests/git.test.js` 全部通过
- 无 shell-string 涉及参数拼接的调用
- 无 `origin/main` 硬编码
