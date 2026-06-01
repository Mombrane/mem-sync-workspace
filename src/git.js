import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Rebase 冲突错误：pull/rebase 期间检测到冲突时抛出。
 * 调用方通过 instanceof 可区分冲突与其他 Git 错误。
 */
export class RebaseConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RebaseConflictError';
  }
}

/**
 * 执行 Git 命令内部辅助函数。
 *
 * 所有 Git 命令通过此函数执行，确保一致的编码、错误处理和输出处理。
 * 使用 execSync（同步），与现有 index-store.js 中的 Git 调用保持一致。
 *
 * @param {string} command - Git 子命令和参数（不含 'git' 前缀）
 * @param {string} cwd - 工作目录（Git 仓库路径）
 * @returns {string} stdout 输出
 * @throws {Error} 命令执行失败时抛出
 */
function execGit(command, cwd) {
  return execSync(`git ${command}`, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

// ─── 公开 API ────────────────────────────────────────────────────────────

/**
 * 检查 Git 仓库是否有远程 origin。
 *
 * @param {string} cwd - 工作目录
 * @returns {boolean} true 表示远端存在
 */
export function hasRemote(cwd) {
  try {
    execGit('remote get-url origin', cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前 HEAD 提交哈希。
 *
 * @param {string} cwd - 工作目录
 * @returns {string} HEAD 提交哈希，非 Git 仓库时返回 'unknown'
 */
export function getHead(cwd) {
  try {
    return execGit('rev-parse HEAD', cwd).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * 从远程获取最新提交。
 *
 * 网络错误被捕获为非致命——fetch 失败时返回 0，
 * 调用方可将返回值 0 与网络不可用状态关联。
 *
 * @param {string} cwd - 工作目录
 * @returns {number} origin/main 领先于本地 HEAD 的提交数，失败时返回 0
 */
export function fetch(cwd) {
  try {
    execGit('fetch origin', cwd);
  } catch {
    // 网络错误非致命
    return 0;
  }

  try {
    const count = execGit('rev-list --count HEAD..origin/main', cwd).trim();
    return Number(count);
  } catch {
    return 0;
  }
}

/**
 * 执行 git pull --rebase origin main。
 *
 * 内部步骤：
 * 1. 记录 rebase 前的 HEAD
 * 2. 运行 git pull --rebase origin main
 * 3. 如果失败且 rebase 正在进行中，abort 并抛出 RebaseConflictError
 * 4. 比较 rebase 前后的 HEAD，计算拉取的提交数
 *
 * @param {string} cwd - 工作目录
 * @returns {number} 拉取的提交数
 * @throws {RebaseConflictError} rebase 冲突
 */
export function pullRebase(cwd) {
  const headBefore = getHead(cwd);

  try {
    execGit('pull --rebase origin main', cwd);
  } catch (err) {
    // 检测是否为 rebase 冲突：尝试 abort，成功则说明 rebase 正在进行
    let isConflict = false;
    try {
      execGit('rebase --abort', cwd);
      isConflict = true;
    } catch {
      // rebase --abort 失败表示没有进行中的 rebase，是其他 Git 错误
    }
    if (isConflict) {
      throw new RebaseConflictError('Rebase conflict during pull --rebase');
    }
    // 非冲突错误直接向上传播
    throw err;
  }

  const headAfter = getHead(cwd);
  let pulled = 0;

  if (headBefore !== 'unknown' &&
      headAfter !== 'unknown' &&
      headBefore !== headAfter) {
    try {
      pulled = Number(
        execGit(`rev-list --count ${headBefore}..${headAfter}`, cwd).trim()
      );
    } catch {
      pulled = 0;
    }
  }

  return pulled;
}

/**
 * 保存本地未提交变更到 stash。
 *
 * 仅在 git status --porcelain 有输出时执行 stash push。
 * 不进行 stash save 也会检查，避免空 stash 导致后续 pop 失败。
 *
 * @param {string} cwd - 工作目录
 * @returns {boolean} true 表示有变更被暂存，false 表示无变更
 */
export function stashSave(cwd) {
  try {
    const status = execGit('status --porcelain', cwd).trim();
    if (!status) return false;
  } catch {
    return false;
  }

  execGit('stash push -m "mem-sync prepare auto-stash"', cwd);
  return true;
}

/**
 * 从 stash 恢复最近暂存的变更。
 *
 * @param {string} cwd - 工作目录
 */
export function stashPop(cwd) {
  execGit('stash pop', cwd);
}

/**
 * 中止进行中的 rebase 操作。
 *
 * @param {string} cwd - 工作目录
 */
export function rebaseAbort(cwd) {
  execGit('rebase --abort', cwd);
}

/**
 * 暂存指定文件到 Git 暂存区。
 *
 * @param {string} cwd - 工作目录（Git 仓库路径）
 * @param {string} filePath - 相对于 cwd 的文件路径
 */
export function stageFile(cwd, filePath) {
  execGit(`add "${filePath}"`, cwd);
}

/**
 * 提交暂存区变更。
 *
 * 执行 git commit 后，通过 rev-parse --short HEAD 获取短提交哈希并返回。
 *
 * @param {string} cwd - 工作目录（Git 仓库路径）
 * @param {string} message - 提交信息
 * @returns {string} 短提交哈希（7 位字符）
 */
export function commit(cwd, message) {
  execGit(`commit -m "${message}"`, cwd);
  return execGit('rev-parse --short HEAD', cwd).trim();
}

/**
 * 推送到远程 origin main 分支。
 *
 * 网络错误被捕获为非致命——push 失败时返回 false，
 * 不抛出异常，确保调用方流程不被中断。
 *
 * @param {string} cwd - 工作目录（Git 仓库路径）
 * @returns {boolean} true 表示推送成功，false 表示失败
 */
export function push(cwd) {
  try {
    execGit('push origin main', cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保 Git 仓库存在。
 *
 * 如果目录不存在或不包含 .git，则从远端克隆或初始化为空仓库。
 *
 * @param {string|null} remoteUrl - 远端 URL，为 null 时本地初始化
 * @param {string} cwd - 目标目录
 */
export function ensureClone(remoteUrl, cwd) {
  if (existsSync(join(cwd, '.git'))) {
    return; // 已存在且是 Git 仓库
  }

  if (remoteUrl) {
    // 移除可能存在的非 Git 目录
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // 目录可能不存在或无法删除
    }
    execGit(`clone "${remoteUrl}" "${cwd}"`, process.cwd());
  } else {
    // 无远端 URL 时初始化为空 Git 仓库
    try {
      mkdirSync(cwd, { recursive: true });
    } catch {
      // 目录已存在
    }
    execGit('init -b main', cwd);
  }
}
