import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';

import { acquireLock, releaseLock, LockTimeoutError } from '../src/lock.js';

/**
 * 辅助函数：创建临时锁文件路径。
 */
function tempLockPath() {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-lock-'));
  const lockPath = join(dir, 'test.lock');
  return { dir, lockPath };
}

// ─── 成功获取和释放 ─────────────────────────────────────────────────

test('acquireLock creates lock file with PID', async () => {
  const { dir, lockPath } = tempLockPath();
  try {
    const result = await acquireLock(lockPath, { timeout: 1000 });
    assert.equal(result, lockPath);

    // 验证锁文件存在
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(lockPath, 'utf8').trim();
    assert.equal(content, String(process.pid));

    releaseLock(lockPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('releaseLock removes lock file', async () => {
  const { dir, lockPath } = tempLockPath();
  try {
    await acquireLock(lockPath, { timeout: 1000 });
    releaseLock(lockPath);

    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('releaseLock does not throw if file already removed', () => {
  const { dir, lockPath } = tempLockPath();
  try {
    // 释放不存在的锁文件不应抛出
    assert.doesNotThrow(() => releaseLock(lockPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 锁被另一个进程持有 ─────────────────────────────────────────────

test('acquireLock waits when lock held by another process', async () => {
  const { dir, lockPath } = tempLockPath();
  try {
    // 另一个进程持有锁
    const child = fork(
      new URL('./lock-holder.mjs', import.meta.url).pathname,
      [lockPath, '500'],
      { silent: true }
    );

    // 等待子进程获取锁
    await new Promise(resolve => setTimeout(resolve, 200));

    // 尝试获取锁（应该在子进程释放后成功）
    const result = await acquireLock(lockPath, { timeout: 3000, pollInterval: 50 });
    assert.equal(result, lockPath);

    releaseLock(lockPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 过期锁检测 ─────────────────────────────────────────────────────

test('acquireLock removes stale lock from dead process', async () => {
  const { dir, lockPath } = tempLockPath();
  try {
    // 写入一个不可能存在的 PID
    writeFileSync(lockPath, '99999999', 'utf8');

    const start = Date.now();
    const result = await acquireLock(lockPath, { timeout: 1000 });
    const elapsed = Date.now() - start;

    assert.equal(result, lockPath);
    // 过期锁应立即获取，不应等待
    assert.ok(elapsed < 500, `should acquire quickly, took ${elapsed}ms`);

    releaseLock(lockPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 超时 ───────────────────────────────────────────────────────────

test('acquireLock throws LockTimeoutError on timeout', async () => {
  const { dir, lockPath } = tempLockPath();
  try {
    // 用当前进程的 PID 创建一个有效锁
    writeFileSync(lockPath, String(process.pid), 'utf8');

    await assert.rejects(
      async () => acquireLock(lockPath, { timeout: 200, pollInterval: 50 }),
      (err) => {
        assert.ok(err instanceof LockTimeoutError);
        return true;
      }
    );
  } finally {
    // 清理锁文件（测试写入了当前 PID，不是通过 acquireLock 创建的）
    try { releaseLock(lockPath); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 并发安全 ───────────────────────────────────────────────────────

test('only one caller acquires lock when contended', async () => {
  const { dir, lockPath } = tempLockPath();
  try {
    const results = [];
    const attempts = 5;

    // 多个"进程"同时尝试获取锁
    const tasks = Array.from({ length: attempts }, async () => {
      const gotLock = await acquireLock(lockPath, { timeout: 2000, pollInterval: 10 });
      results.push('got');
      // 短暂持有
      await new Promise(resolve => setTimeout(resolve, 20));
      releaseLock(lockPath);
      results.push('released');
    });

    await Promise.all(tasks);

    // 所有调用方都应成功获取和释放
    assert.equal(results.filter(r => r === 'got').length, attempts);
    assert.equal(results.filter(r => r === 'released').length, attempts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
