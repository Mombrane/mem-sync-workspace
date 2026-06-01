import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const STORE_FILE = 'memories.json';

export function resolveStorePath(baseDirectory = process.env.MEM_SYNC_HOME ?? '.mem-sync') {
  return join(baseDirectory, STORE_FILE);
}

export async function readMemories(storePath = resolveStorePath()) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.memories)) {
      throw new Error('Store file must contain a memories array.');
    }
    return parsed.memories;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function writeMemories(memories, storePath = resolveStorePath()) {
  await mkdir(dirname(storePath), { recursive: true });
  const payload = `${JSON.stringify({ memories }, null, 2)}\n`;
  await writeFile(storePath, payload, 'utf8');
}
