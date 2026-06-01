import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractCandidates } from '../retain-engine.js';
import { normalizeMemoryInput, createCanonicalKey } from '../schema.js';
import { appendJSONL, readJSONL } from '../repo-store.js';
import { requireValue } from '../argparse.js';

/**
 * retain 命令：从会话 transcript 中提取候选记忆，写入 pending 文件。
 *
 * 这是 `mem-sync retain --transcript-file <path> --pending --device <id>` 的入口点。
 * 使用规则引擎 extractCandidates 从 transcript 中提取候选记忆，
 * 通过 normalizeMemoryInput 规范化，去重后追加写入 pending/<device>.jsonl。
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function retainCommand(args) {
  const { pending, transcriptFile, deviceId, options } = parseRetainArgs(args);

  // Validate mandatory flags
  if (!pending) {
    throw new Error('retain requires --pending in v1');
  }
  if (!transcriptFile) {
    throw new Error('--transcript-file requires a value.');
  }
  if (!deviceId) {
    throw new Error('--device requires a value.');
  }

  // Read transcript file
  let transcript;
  try {
    const raw = await readFile(transcriptFile, 'utf8');
    transcript = JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`transcript file not found: ${transcriptFile}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error('invalid JSON in transcript file');
    }
    throw error;
  }

  // Extract candidates from transcript
  const candidates = extractCandidates(transcript, options);

  // Empty transcript: write nothing, print 0
  if (candidates.length === 0) {
    console.log('0');
    return;
  }

  // Normalize each candidate into a full Schema v1 record
  // Add deviceId to source before normalization
  const records = [];
  for (const candidate of candidates) {
    candidate.source.device = deviceId;
    const memory = normalizeMemoryInput(candidate);
    records.push(memory);
  }

  // Dedup against existing pending file
  const pendingDir = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const pendingPath = join(pendingDir, 'pending', `${deviceId}.jsonl`);
  const existingRecords = await readJSONL(pendingPath);
  const existingKeys = new Set(existingRecords.map((r) => r.canonicalKey));

  const newRecords = records.filter((r) => !existingKeys.has(r.canonicalKey));

  // Append new records to pending file
  for (const record of newRecords) {
    await appendJSONL(record, pendingPath);
  }

  // Print new record count to stdout
  console.log(String(newRecords.length));
}

/**
 * 解析 retain 命令的命令行参数。
 *
 * Required: --pending (flag), --transcript-file <path>, --device <id>
 * Optional: --project-id <id>, --agent-id <id>
 * Unknown flags trigger error.
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ pending: boolean, transcriptFile?: string, deviceId?: string, options: object }}
 * @throws {Error} 如果遇到未知标志或值缺失
 */
export function parseRetainArgs(args) {
  const options = {};
  let pending = false;
  let transcriptFile;
  let deviceId;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--pending') {
      pending = true;
      index += 1;
    } else if (arg === '--transcript-file') {
      transcriptFile = requireValue(args, index, '--transcript-file');
      index += 2;
    } else if (arg === '--device') {
      deviceId = requireValue(args, index, '--device');
      index += 2;
    } else if (arg === '--project-id') {
      options.projectId = requireValue(args, index, '--project-id');
      index += 2;
    } else if (arg === '--agent-id') {
      options.agentId = requireValue(args, index, '--agent-id');
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      // Ignore positional arguments (they don't apply to retain)
      index += 1;
    }
  }

  return { pending, transcriptFile, deviceId, options };
}
