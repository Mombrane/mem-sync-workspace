import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStorePath } from '../repo-store.js';
import { acquireLock, releaseLock, LockTimeoutError } from '../lock.js';
import {
  ensureClone,
  hasRemote,
  fetch,
  pullRebase,
  stashSave,
  stashPop,
  RebaseConflictError,
  getHead
} from '../git.js';
import { mergePendingToStore } from '../merge.js';
import { rebuildIndex, updateIndex, getIndexStatus } from '../index-store.js';

/**
 * mem-sync prepare 命令：初始化同步序列。
 *
 * 6 步序列：
 * 1. 确保 .mem-sync 仓库存在（clone 或 init）
 * 2. 获取排他文件锁
 * 3. Git 同步：fetch + pull/rebase（stash 保护）
 * 4. 确定性合并：pending/ → memories.jsonl
 * 5. 索引更新/重建（基于 HEAD 变化）
 * 6. 释放锁（finally 保证）
 *
 * 输出：JSON 结果写入 stdout；诊断/进度/警告写入 stderr。
 *
 * @param {string[]} args - CLI 参数（支持 --remote <url>）
 */
export async function prepareCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const lockPath = join(memSyncHome, 'repo.lock');
  const pendingDir = join(memSyncHome, 'pending');
  const storePath = resolveStorePath(memSyncHome);
  const cacheDir = join(memSyncHome, '.cache');

  // 解析 --remote 参数
  const remoteIdx = args.indexOf('--remote');
  const remoteUrl =
    remoteIdx !== -1 && remoteIdx + 1 < args.length
      ? args[remoteIdx + 1]
      : null;

  // 结果对象
  const result = {
    git: { skipped: false, pulled: 0, conflicts: 0 },
    merge: { pending: 0, merged: 0, total: 0 },
    index: { rebuilt: false, records: 0 }
  };

  let lockAcquired = false;

  try {
    // ── Step 1: Ensure repository exists ──────────────────────────
    if (!existsSync(join(memSyncHome, '.git'))) {
      ensureClone(remoteUrl, memSyncHome);
      console.error('[mem-sync:prepare] ensure:repository ready');
    }

    // ── Step 2: Acquire repository lock ──────────────────────────
    console.error('[mem-sync:prepare] lock:acquiring');
    try {
      await acquireLock(lockPath);
      lockAcquired = true;
      console.error('[mem-sync:prepare] lock:acquired');
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        console.error(`mem-sync: lock timeout — another process may be using the repository`);
        process.exitCode = 1;
        return; // 不输出 JSON
      }
      throw err;
    }

    // ── Step 3: Git sync ─────────────────────────────────────────
    if (hasRemote(memSyncHome)) {
      console.error('[mem-sync:prepare] git:syncing');

      // Fetch
      let fetchCount;
      try {
        fetchCount = fetch(memSyncHome);
        console.error(`[mem-sync:prepare] git:fetched ${fetchCount} new commits`);
      } catch {
        console.error('[mem-sync:prepare] git:fetch failed, continuing with local state');
        fetchCount = 0;
      }

      // Pull/rebase with stash protection
      const stashed = stashSave(memSyncHome);
      if (stashed) {
        console.error('[mem-sync:prepare] git:stashed local changes');
      }

      try {
        const pulled = pullRebase(memSyncHome);
        result.git.pulled = pulled;
        console.error(`[mem-sync:prepare] git:pulled ${pulled} commits`);
      } catch (err) {
        if (err instanceof RebaseConflictError) {
          result.git.conflicts = 1;
          console.error('mem-sync: rebase conflict — manual resolution required');
          process.exitCode = 1;
          return;
        }
        throw err;
      } finally {
        if (stashed) {
          try {
            stashPop(memSyncHome);
            console.error('[mem-sync:prepare] git:stash popped');
          } catch (popErr) {
            console.error(`[mem-sync:prepare] git:stash pop failed: ${popErr.message}`);
          }
        }
      }
    } else {
      result.git.skipped = true;
      console.error('[mem-sync:prepare] git:skipped (no remote configured)');
    }

    // ── Step 4: Deterministic merge ──────────────────────────────
    console.error('[mem-sync:prepare] merge:starting');
    const mergeResult = mergePendingToStore(pendingDir, storePath);
    result.merge = mergeResult;
    console.error(
      `[mem-sync:prepare] merge:complete pending=${mergeResult.pending} merged=${mergeResult.merged} total=${mergeResult.total}`
    );

    // ── Step 5: Index update/rebuild ─────────────────────────────
    console.error('[mem-sync:prepare] index:checking');
    try {
      const currentHead = getHead(memSyncHome);
      const indexStatus = getIndexStatus(cacheDir);

      if (currentHead !== indexStatus.repoHead || !indexStatus.exists) {
        // HEAD 已更改或索引不存在 → 全量重建
        console.error('[mem-sync:prepare] index:rebuilding');
        const rebuildResult = rebuildIndex(memSyncHome, cacheDir, {
          logger: (msg) => console.error(msg)
        });
        result.index = {
          rebuilt: true,
          records: rebuildResult.recordCount
        };
        console.error(`[mem-sync:prepare] index:rebuilt ${rebuildResult.recordCount} records`);
      } else {
        // HEAD 未更改 → 增量更新
        console.error('[mem-sync:prepare] index:updating');
        const updateResult = updateIndex(memSyncHome, cacheDir, {
          logger: (msg) => console.error(msg)
        });
        result.index = {
          rebuilt: updateResult.rebuilt ?? false,
          records: updateResult.recordCount ?? indexStatus.recordCount
        };
        if (updateResult.skipped) {
          console.error('[mem-sync:prepare] index:uptodate (no changes)');
        } else {
          console.error(`[mem-sync:prepare] index:updated ${result.index.records} records`);
        }
      }
    } catch (err) {
      console.error(`[mem-sync:prepare] index:warning — ${err.message}`);
      // 非致命：索引过时但仍可操作
      result.index = { rebuilt: false, records: 0 };
    }

    // ── Step 6: Output result ────────────────────────────────────
    console.log(JSON.stringify(result));
  } catch (err) {
    // 致命错误
    console.error(`mem-sync: ${err.message}`);
    process.exitCode = 1;
  } finally {
    // ── Guaranteed lock release ──────────────────────────────────
    if (lockAcquired) {
      releaseLock(lockPath);
      console.error('[mem-sync:prepare] lock:released');
    }
  }
}
