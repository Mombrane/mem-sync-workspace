import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';

/**
 * 文件锁超时错误：在配置的超时时间内无法获取锁时抛出。
 * 调用方可通过 instanceof 区分超时错误与其他致命错误。
 */
export class LockTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LockTimeoutError';
  }
}

/**
 * 检测锁文件是否过期（对应 PID 的进程已不存在）。
 *
 * 使用 process.kill(pid, 0) 系统调用检测进程是否存在：
 * - 如果信号 0 发送成功，进程存在 → 锁有效
 * - 如果抛出 ESRCH 错误，进程不存在 → 锁过期
 * - 如果锁文件无法读取或 PID 非法 → 视为过期
 */
function isStaleLock(lockPath) {
  let raw;
  try {
    raw = readFileSync(lockPath, 'utf8');
  } catch {
    // 锁文件存在但无法读取 → 视为过期
    return true;
  }

  const pid = parseInt(raw.trim(), 10);
  if (isNaN(pid) || pid <= 0) {
    return true;
  }

  try {
    // 信号 0：不发送实际信号，只检查进程权限是否存在
    process.kill(pid, 0);
    return false; // 进程存在，锁有效
  } catch (err) {
    if (err.code === 'ESRCH') {
      return true; // 进程不存在，锁过期
    }
    // EPERM 或其他错误 → 进程存在但我们没有权限发信号
    return false;
  }
}

/**
 * Promise-based sleep，用于锁重试间隔。
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取排他文件锁。
 *
 * 使用 O_EXCL|O_CREAT（通过 'wx' 标志）实现原子锁创建：
 * - 如果锁文件不存在，原子创建并写入当前 PID
 * - 如果锁文件已存在，检测是否过期（PID 对应的进程已退出）
 * - 过期锁会被移除并立即重试
 * - 有效锁会等待 pollInterval 后重试
 * - 超时后抛出 LockTimeoutError
 *
 * @param {string} lockPath - 锁文件路径
 * @param {Object} [options]
 * @param {number} [options.timeout=10000] - 最大等待时间（毫秒）
 * @param {number} [options.pollInterval=100] - 重试间隔（毫秒）
 * @returns {Promise<string>} 锁文件路径（获取成功时）
 * @throws {LockTimeoutError} 超时无法获取锁
 */
export async function acquireLock(lockPath, { timeout = 10000, pollInterval = 100 } = {}) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      // 'wx' = O_WRONLY | O_CREAT | O_EXCL → 原子创建，文件存在则失败
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return lockPath;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err; // 非预期的文件系统错误
      }

      // 锁文件已存在，检测是否过期
      if (isStaleLock(lockPath)) {
        // 过期锁：移除后立即重试（不消耗 sleep 时间）
        try {
          unlinkSync(lockPath);
        } catch {
          // 其他进程可能已经移除了
        }
        continue;
      }

      // 锁有效，等待后重试
      await sleep(pollInterval);
    }
  }

  throw new LockTimeoutError(`Could not acquire lock within ${timeout}ms: ${lockPath}`);
}

/**
 * 释放排他文件锁。
 *
 * 移除锁文件。如果文件已经被移除（其他进程或手动清理），
 * 静默跳过，不抛出错误——这是正常的并发竞争场景。
 *
 * @param {string} lockPath - 锁文件路径
 */
export function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // 锁已被释放或不存在，无需处理
  }
}
