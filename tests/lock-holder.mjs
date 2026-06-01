/**
 * lock-holder.mjs — 用于 lock.test.js 的辅助子进程脚本。
 *
 * 获取锁、持有指定毫秒数、然后释放。
 * 用法: node lock-holder.mjs <lockPath> <holdMs>
 */
import { openSync, writeSync, closeSync, unlinkSync } from 'node:fs';

const lockPath = process.argv[2];
const holdMs = parseInt(process.argv[3], 10) || 500;

// 获取锁
const fd = openSync(lockPath, 'wx');
writeSync(fd, String(process.pid));
closeSync(fd);

// 持有锁
await new Promise(resolve => setTimeout(resolve, holdMs));

// 释放锁
try {
  unlinkSync(lockPath);
} catch {
  // 可能已被移除
}
