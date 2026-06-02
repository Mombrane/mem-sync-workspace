import { join } from 'node:path';
import { resolveStorePath, readJSONLStream } from '../repo-store.js';
import { readPendingFiles } from '../merge.js';

/**
 * mem-sync show <id> — display a single memory record by ID.
 *
 * Searches memories/*.jsonl first (streaming), then pending/ files.
 *
 * Output: JSON record to stdout.
 *
 * @param {string[]} args - CLI arguments (<id> required, --repo <path> optional)
 */
export async function showCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const repoPath =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // Parse positional <id> (first non-flag argument)
  const id = args.find(a => !a.startsWith('--'));
  if (!id) {
    throw new Error('show requires a memory id. Usage: mem-sync show <id>');
  }

  // 1. Search memories.jsonl via streaming
  const storePath = resolveStorePath(memSyncHome);
  for await (const record of readJSONLStream(storePath)) {
    if (record.id === id) {
      console.log(JSON.stringify(record));
      return;
    }
  }

  // 2. Search pending files
  const pendingDir = join(memSyncHome, 'pending');
  const pendingRecords = readPendingFiles(pendingDir);
  for (const record of pendingRecords) {
    if (record.id === id) {
      console.log(JSON.stringify(record));
      return;
    }
  }

  // 3. Not found
  throw new Error(`Memory not found: ${id}`);
}
