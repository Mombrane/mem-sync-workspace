import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { resolveStorePath } from '../repo-store.js';

/**
 * mem-sync log — show recent git commits.
 *
 * Output: JSON { entries: [...] } to stdout.
 *
 * @param {string[]} args - CLI arguments (supports --limit <n>, --repo <path>)
 */
export async function logCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';

  // Parse --limit
  const limitIdx = args.indexOf('--limit');
  let limit = 10;
  if (limitIdx !== -1 && limitIdx + 1 < args.length) {
    const val = parseInt(args[limitIdx + 1], 10);
    if (!Number.isFinite(val) || val <= 0) {
      throw new Error('--limit must be a positive integer.');
    }
    limit = val;
  }

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const repoPath =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // Verify git repository exists
  if (!existsSync(join(memSyncHome, '.git'))) {
    throw new Error('Not a mem-sync repository. Run `mem-sync init` first.');
  }

  // Run git log
  let raw;
  try {
    raw = execSync(
      `git log --oneline -n ${limit} --format='%H%x00%s%x00%ci'`,
      { cwd: memSyncHome, encoding: 'utf8' }
    );
  } catch (err) {
    throw new Error(`Failed to read git log: ${err.message}`);
  }

  // Parse each line
  const entries = [];
  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\0');
    if (parts.length >= 3) {
      entries.push({
        hash: parts[0],
        message: parts[1],
        date: parts[2]
      });
    }
  }

  console.log(JSON.stringify({ entries }));
}
