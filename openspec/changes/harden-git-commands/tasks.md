# Tasks: Git 命令硬化

## Task 1: 新增 getDefaultBranch + 修改 fetch/push/pullRebase
**文件:** `src/git.js`
**依赖:** 无

- 添加 `getDefaultBranch(cwd)` 函数
- 修改 `fetch()`: `HEAD..origin/main` → `HEAD..origin/${branch}`
- 修改 `pullRebase()`: `pull --rebase origin main` → `execGitArgs(['pull', '--rebase', 'origin', branch])`
- 修改 `push()`: `push origin main` → `execGitArgs(['push', 'origin', branch])`
- 修改 `stashSave()`: shell-string → `execGitArgs(['stash', 'push', '-m', msg])`
- 修改 `commit()`: `rev-parse --short HEAD` → `execGitArgs(['rev-parse', '--short', 'HEAD'])`

## Task 2: 新增 git.js 测试
**文件:** `tests/git.test.js`
**依赖:** Task 1

- 测试 `getDefaultBranch` 有 remote 时返回正确分支名
- 测试 `getDefaultBranch` 无 remote 时返回当前分支
- 测试 `fetch` 在非 main 分支下正确计数
- 测试 `pullRebase` 在非 main 分支下正确工作
- 测试 `push` 在非 main 分支下正确推送
- 测试 `stashSave` 消息中含特殊字符时正确执行
