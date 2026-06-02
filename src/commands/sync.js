import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStorePath } from '../repo-store.js';
import { acquireLock, releaseLock, LockTimeoutError } from '../lock.js';
import {
  fetch,
  pullRebase,
  stashSave,
  stashPop,
  getHead,
  hasRemote,
  RebaseConflictError
} from '../git.js';
import { updateIndex } from '../index-store.js';

/**
 * mem-sync sync — pull latest changes from remote and update index.
 *
 * Sequence:
 * 1. Resolve store path and verify .git exists
 * 2. Acquire lock
 * 3. Fetch from remote (non-fatal if fails)
 * 4. Stash local changes
 * 5. Pull rebase
 * 6. Update index if HEAD changed
 * 7. Release lock
 *
 * Output: JSON result to stdout.
 *
 * @param {string[]} args - CLI arguments (supports --repo <path>)
 */
export async function syncCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const cacheDir = join(memSyncHome, '.cache');
  const lockPath = join(memSyncHome, 'repo.lock');

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const repoPath =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // 1. Verify git repository exists
  if (!existsSync(join(memSyncHome, '.git'))) {
    throw new Error('Not a mem-sync repository. Run `mem-sync init` first.');
  }

  let lockAcquired = false;
  let pulled = 0;
  let indexUpdated = false;
  let headAfter = 'unknown';

  try {
    // 2. Acquire lock
    console.error('[mem-sync:sync] lock:acquiring');
    try {
      await acquireLock(lockPath);
      lockAcquired = true;
      console.error('[mem-sync:sync] lock:acquired');
    } catch (err) {
      if (err instanceof LockTimeoutError) {
        console.error('mem-sync: lock timeout — another process may be using the repository');
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // 3. Fetch
    if (hasRemote(memSyncHome)) {
      console.error('[mem-sync:sync] git:fetching');
      try {
        fetch(memSyncHome);
        console.error('[mem-sync:sync] git:fetched');
      } catch {
        console.error('[mem-sync:sync] git:fetch failed, continuing with local state');
      }
    }

    // 4. Stash local changes
    const headBefore = getHead(memSyncHome);
    const stashed = stashSave(memSyncHome);
    if (stashed) {
      console.error('[mem-sync:sync] git:stashed local changes');
    }

    // 5. Pull rebase
    try {
      if (hasRemote(memSyncHome)) {
        pulled = pullRebase(memSyncHome);
        console.error(`[mem-sync:sync] git:pulled ${pulled} commits`);
      }
    } catch (err) {
      if (err instanceof RebaseConflictError) {
        console.error('mem-sync: rebase conflict — manual resolution required');
        process.exitCode = 1;
        return;
      }
      throw err;
    } finally {
      if (stashed) {
        try {
          stashPop(memSyncHome);
          console.error('[mem-sync:sync] git:stash popped');
        } catch (popErr) {
          console.error(`[mem-sync:sync] git:stash pop failed: ${popErr.message}`);
        }
      }
    }

    // 6. Update index if HEAD changed
    headAfter = getHead(memSyncHome);
    if (headBefore !== 'unknown' && headAfter !== 'unknown' && headBefore !== headAfter) {
      console.error('[mem-sync:sync] index:updating');
      try {
        const result = updateIndex(memSyncHome, cacheDir, {
          logger: (msg) => console.error(msg)
        });
        indexUpdated = result.rebuilt === true;
        if (result.skipped) {
          console.error('[mem-sync:sync] index:uptodate');
        } else {
          console.error(`[mem-sync:sync] index:updated (${result.recordCount ?? '?'} records)`);
        }
      } catch (err) {
        console.error(`[mem-sync:sync] index:warning — ${err.message}`);
      }
    } else {
      console.error('[mem-sync:sync] index:skipped (HEAD unchanged)');
    }
  } finally {
    // 7. Release lock
    if (lockAcquired) {
      releaseLock(lockPath);
      console.error('[mem-sync:sync] lock:released');
    }
  }

  // Output result
  console.log(JSON.stringify({
    pulled,
    indexUpdated,
    head: headAfter
  }));
}
