import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStorePath } from '../repo-store.js';
import { getHead, hasRemote } from '../git.js';
import { getIndexStatus } from '../index-store.js';
import { readPendingFiles } from '../merge.js';

/**
 * mem-sync status — report repository state.
 *
 * Output: JSON status to stdout.
 *
 * @param {string[]} args - CLI arguments (supports --repo <path>)
 */
export async function statusCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const cacheDir = join(memSyncHome, '.cache');
  const pendingDir = join(memSyncHome, 'pending');

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const repoPath =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // 1. Repo info
  const initialized = existsSync(join(memSyncHome, '.git'));
  const head = initialized ? getHead(memSyncHome) : null;

  const repo = {
    initialized,
    head,
    branch: 'main'
  };

  // 2. Remote
  const remote = {
    configured: initialized ? hasRemote(memSyncHome) : false
  };

  // 3. Pending records
  const pendingRecords = readPendingFiles(pendingDir);
  // Count unique files in pending dir
  let pendingFileCount = 0;
  try {
    pendingFileCount = readdirSync(pendingDir).filter(
      f => f.endsWith('.json') || f.endsWith('.jsonl')
    ).length;
  } catch {
    // pending dir doesn't exist
  }

  const pending = {
    files: pendingFileCount,
    records: pendingRecords.length
  };

  // 4. Index status
  const indexStatus = getIndexStatus(cacheDir);
  const index = {
    exists: indexStatus.exists,
    records: indexStatus.recordCount,
    stale: indexStatus.exists && indexStatus.repoHead !== null &&
           head !== null && head !== 'unknown' && indexStatus.repoHead !== head
  };

  // 5. Rebase in progress
  const rebaseInProgress =
    existsSync(join(memSyncHome, '.git', 'rebase-merge')) ||
    existsSync(join(memSyncHome, '.git', 'rebase-apply'));

  const status = {
    repo,
    remote,
    pending,
    index,
    rebaseInProgress
  };

  console.log(JSON.stringify(status));
}
