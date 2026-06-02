import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStorePath, readJSONL, writeJSONL } from '../repo-store.js';

/**
 * mem-sync forget <id> — soft-delete a memory record.
 *
 * Checks pending/ first: if the ID is found in a pending file,
 * removes it from that file. Otherwise soft-deletes from JSONL
 * by setting deletedAt.
 *
 * Output: JSON { forgotten, action } to stdout.
 *
 * @param {string[]} args - CLI arguments (<id> required, --reason <text>, --repo <path>)
 */
export async function forgetCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';

  // Parse --reason
  const reasonIdx = args.indexOf('--reason');
  const reason =
    reasonIdx !== -1 && reasonIdx + 1 < args.length
      ? args[reasonIdx + 1]
      : null;

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const repoPath =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // Parse positional <id> (first non-flag argument)
  const id = args.find(a => !a.startsWith('--'));
  if (!id) {
    throw new Error('forget requires a memory id. Usage: mem-sync forget <id>');
  }

  // 1. Check pending/ first
  const pendingDir = join(memSyncHome, 'pending');

  // Scan pending files directly to find and remove the record
  let foundInPending = false;
  try {
    const entries = readdirSync(pendingDir).filter(
      f => f.endsWith('.json') || f.endsWith('.jsonl')
    );

    for (const entry of entries) {
      const filePath = join(pendingDir, entry);
      let raw;
      try {
        raw = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }

      if (entry.endsWith('.jsonl')) {
        const lines = raw.split('\n').filter(l => l.trim());
        const remaining = lines.filter(line => {
          try {
            return JSON.parse(line).id !== id;
          } catch {
            return false;
          }
        });
        if (remaining.length < lines.length) {
          foundInPending = true;
          writeFileSync(filePath, remaining.join('\n') + (remaining.length > 0 ? '\n' : ''), 'utf8');
          break;
        }
      } else if (entry.endsWith('.json')) {
        try {
          const parsed = JSON.parse(raw);
          const records = Array.isArray(parsed) ? parsed : [parsed];
          const remaining = records.filter(r => r.id !== id);
          if (remaining.length < records.length) {
            foundInPending = true;
            if (remaining.length === 0) {
              unlinkSync(filePath);
            } else {
              writeFileSync(
                filePath,
                JSON.stringify(remaining.length === 1 ? remaining[0] : remaining) + '\n',
                'utf8'
              );
            }
            break;
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    // pending dir may not exist — that's fine
  }

  if (foundInPending) {
    console.log(JSON.stringify({ forgotten: id, action: 'removed-from-pending' }));
    return;
  }

  // 2. Soft-delete from JSONL
  const storePath = resolveStorePath(memSyncHome);
  const records = await readJSONL(storePath);

  let found = false;
  for (const record of records) {
    if (record.id === id) {
      record.deletedAt = new Date().toISOString();
      if (reason) {
        if (!Array.isArray(record.evidence)) {
          record.evidence = [];
        }
        record.evidence.push({ type: 'user_message', text: reason });
      }
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`Memory not found: ${id}`);
  }

  await writeJSONL(records, storePath);

  console.log(JSON.stringify({ forgotten: id, action: 'soft-deleted' }));
}
