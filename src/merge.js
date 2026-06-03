import { readFileSync, readdirSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeContent, createCanonicalKey } from './schema.js';


/**
 * 按 canonicalKey 去重合并记录数组。
 *
 * 同一 canonicalKey 的记录只保留一条：选择 updatedAt 最新的。
 * 如果 updatedAt 相同，先前出现在数组中的记录优先（稳定排序）。
 *
 * @param {Object[]} records - 记忆记录数组
 * @returns {Object[]} 去重后的记录数组
 */
export function mergeByCanonicalKey(records) {
  const byKey = new Map();

  for (const record of records) {
    const key = createCanonicalKey(record);
    const existing = byKey.get(key);
    if (!existing || new Date(record.updatedAt) > new Date(existing.updatedAt)) {
      byKey.set(key, record);
    }
  }

  return [...byKey.values()];
}

/**
 * 读取 JSONL 文件（同步版本）。
 * 返回记录数组。文件不存在时返回空数组。
 */
function readJSONLSync(storePath) {
  const records = [];
  try {
    const raw = readFileSync(storePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // 跳过损坏行
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return records;
}

/**
 * 从 pending/ 目录读取所有待合并记录。
 *
 * 支持两种文件格式：
 * - .json：JSON 对象或数组，可用作单条记忆或记忆数组
 * - .jsonl：每行一条 JSON 记录
 *
 * 无效/损坏文件静默跳过。
 *
 * @param {string} pendingDir - pending 目录路径
 * @returns {Object[]} 扁平化的记忆记录数组
 */
export function readPendingFiles(pendingDir) {
  const records = [];
  let entries;
  try {
    entries = readdirSync(pendingDir);
  } catch (err) {
    if (err.code === 'ENOENT') return records;
    throw err;
  }

  for (const entry of entries) {
    const filePath = join(pendingDir, entry);

    if (entry.endsWith('.jsonl')) {
      try {
        const raw = readFileSync(filePath, 'utf8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            records.push(JSON.parse(trimmed));
          } catch {
            // 跳过损坏行
          }
        }
      } catch {
        // 跳过无法读取的文件
      }
    } else if (entry.endsWith('.json')) {
      try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          records.push(...parsed);
        } else {
          records.push(parsed);
        }
      } catch {
        // 跳过无效 JSON 文件
      }
    }
    // 忽略非 .json/.jsonl 文件
  }

  return records;
}

/**
 * 在 pendingDir 目录中查找并移除指定 id 的记录。
 *
 * 扫描目录中所有 .jsonl 和 .json 文件，找到匹配记录后从文件中移除。
 * 空文件保留（不删除），匹配当前 forget.js 的 JSONL 行为。
 * 只移除第一个匹配项，匹配后立即返回。
 *
 * @param {string} pendingDir - pending 目录路径
 * @param {string} id - 要查找的记忆记录 ID
 * @returns {{ found: boolean, record: object|null, filePath: string|null }}
 */
export function findAndRemoveFromPending(pendingDir, id) {
  let entries;
  try {
    entries = readdirSync(pendingDir);
  } catch (err) {
    if (err.code === 'ENOENT') return { found: false, record: null, filePath: null };
    throw err;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json') && !entry.endsWith('.jsonl')) continue;

    const filePath = join(pendingDir, entry);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    if (entry.endsWith('.jsonl')) {
      const lines = raw.split('\n').filter(l => l.trim());
      let foundRecord = null;
      const remaining = [];
      for (const line of lines) {
        try {
          const r = JSON.parse(line.trim());
          if (!foundRecord && r.id === id) {
            foundRecord = r;
          } else {
            remaining.push(line);
          }
        } catch {
          // 保留损坏的行（不匹配的记录静默保留）
          remaining.push(line);
        }
      }
      if (foundRecord) {
        writeFileSync(filePath, remaining.join('\n') + (remaining.length > 0 ? '\n' : ''), 'utf8');
        return { found: true, record: foundRecord, filePath };
      }
    } else if (entry.endsWith('.json')) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const records = Array.isArray(parsed) ? parsed : [parsed];
      let foundRecord = null;
      const remaining = records.filter(r => {
        if (!foundRecord && r.id === id) {
          foundRecord = r;
          return false;
        }
        return true;
      });
      if (foundRecord) {
        if (remaining.length === 0) {
          // 保留空文件（与 JSONL 行为一致，不删除）
          writeFileSync(filePath, '[]\n', 'utf8');
        } else {
          writeFileSync(
            filePath,
            JSON.stringify(remaining.length === 1 ? remaining[0] : remaining, null, 2) + '\n',
            'utf8'
          );
        }
        return { found: true, record: foundRecord, filePath };
      }
    }
  }

  return { found: false, record: null, filePath: null };
}

/**
 * 移除 pendingDir 目录中所有记录。
 *
 * 清除所有 .jsonl 和 .json 文件的内容，保留文件本身。
 *
 * @param {string} pendingDir - pending 目录路径
 * @returns {{ count: number, ids: string[] }}
 */
export function removeAllPending(pendingDir) {
  const records = readPendingFiles(pendingDir);
  if (records.length === 0) {
    return { count: 0, ids: [] };
  }

  const ids = records.map(r => r.id);

  let entries;
  try {
    entries = readdirSync(pendingDir);
  } catch (err) {
    // readPendingFiles 已确认目录存在且可读，这里再次出错属极端情况
    if (err.code === 'ENOENT') return { count: 0, ids: [] };
    throw err;
  }

  for (const entry of entries) {
    const filePath = join(pendingDir, entry);
    if (entry.endsWith('.jsonl')) {
      try {
        writeFileSync(filePath, '', 'utf8');
      } catch {
        // 无法写入个别文件不阻塞流程
      }
    } else if (entry.endsWith('.json')) {
      try {
        writeFileSync(filePath, '[]\n', 'utf8');
      } catch {
        // 无法写入个别文件不阻塞流程
      }
    }
    // 忽略非 .json/.jsonl 文件
  }

  return { count: ids.length, ids };
}

/**
 * 将 pending/ 目录中的待合并记录合并到 JSONL 存储。
 *
 * 合并流程：
 * 1. 读取所有 pending 文件为扁平化记录数组
 * 2. 读取现有 JSONL 存储记录
 * 3. 合并两批记录（pending + existing）
 * 4. 按 canonicalKey 去重（latest updatedAt 胜出）
 * 5. 写回 JSONL
 * 6. 移除所有已合并的 pending 文件
 *
 * 如果 pending 目录不存在或为空，返回零统计。
 *
 * @param {string} pendingDir - pending 目录路径
 * @param {string} storePath - JSONL 存储文件路径
 * @returns {{ pending: number, merged: number, total: number }}
 * @throws {Error} 写入 JSONL 失败时抛出致命错误
 */
export function mergePendingToStore(pendingDir, storePath) {
  // 读取 pending 记录
  const pendingRecords = readPendingFiles(pendingDir);
  const pending = pendingRecords.length;

  // 读取现有 JSONL 记录
  const existingRecords = readJSONLSync(storePath);

  if (pending === 0) {
    return {
      pending: 0,
      merged: 0,
      total: existingRecords.length
    };
  }

  // 收集 pending records 的 canonicalKeys（去重）
  const pendingKeys = new Set(pendingRecords.map(r => createCanonicalKey(r)));

  // 合并所有记录并去重
  const allRecords = [...existingRecords, ...pendingRecords];
  const merged = mergeByCanonicalKey(allRecords);

  // 计算实际合并数量：pending 中有多少 canonicalKey 出现在最终结果中
  const mergedKeys = new Set(merged.map(r => createCanonicalKey(r)));
  let mergedCount = 0;
  for (const key of pendingKeys) {
    if (mergedKeys.has(key)) {
      mergedCount += 1;
    }
  }

  // 写入合并后的记录到 JSONL
  try {
    mkdirSync(dirname(storePath), { recursive: true });
    const content = merged.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(storePath, content, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to write merged records to ${storePath}: ${err.message}`
    );
  }

  // 移除已合并的 pending 文件
  try {
    const entries = readdirSync(pendingDir);
    for (const entry of entries) {
      if (entry.endsWith('.json') || entry.endsWith('.jsonl')) {
        try {
          unlinkSync(join(pendingDir, entry));
        } catch {
          // 无法删除个别文件不阻塞流程
        }
      }
    }
  } catch {
    // pending 目录可能在合并过程中被移除，忽略
  }

  return {
    pending,
    merged: mergedCount,
    total: merged.length
  };
}
