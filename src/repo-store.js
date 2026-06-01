import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

// JSONL 格式的优势：
// 1. 每行一条独立 JSON 记录，Git diff 按行生效，适合版本控制
// 2. 追加写入不需要全量读取 → 合并 → 重写，O(1) 写入成本
// 3. 流式读取内存友好，大文件也能逐条处理
// 4. 向后兼容：旧 JSON 格式仍可读取，写入统一为 JSONL

const STORE_FILE = 'memories.jsonl';
const LEGACY_STORE_FILE = 'memories.json';

/**
 * 解析 JSONL 存储路径（新格式 .jsonl）。
 * 可通过 MEM_SYNC_HOME 环境变量自定义存储目录。
 */
export function resolveStorePath(baseDirectory = process.env.MEM_SYNC_HOME ?? '.mem-sync') {
  return join(baseDirectory, STORE_FILE);
}

/**
 * 解析旧 JSON 存储路径（向后兼容 .json）。
 * 迁移期间用于读取旧数据，写入不再使用此路径。
 */
export function resolveLegacyStorePath(baseDirectory = process.env.MEM_SYNC_HOME ?? '.mem-sync') {
  return join(baseDirectory, LEGACY_STORE_FILE);
}

/**
 * 逐行读取 JSONL 文件，返回解析后的记录数组。
 * 空行和损坏行静默跳过，不做全量解析错误中断。
 */
export async function readJSONL(storePath = resolveStorePath()) {
  const records = [];
  try {
    const raw = await readFile(storePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        // JSONL 行损坏时跳过并继续，避免单行错误阻塞全部读取
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // 文件不存在时返回空数组，调用方无需额外判空
  }
  return records;
}

/**
 * 流式读取 JSONL 文件，逐条 yield 记录。
 * 使用 readline 按行流式解析，适合大文件或只需要逐条处理的场景（如 list）。
 * 文件不存在时生成器自然结束，调用方可安全使用 for-await-of。
 */
export async function* readJSONLStream(storePath = resolveStorePath()) {
  let rl;
  try {
    const stream = createReadStream(storePath, { encoding: 'utf8' });
    rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed);
      } catch {
        // 跳过损坏行，不中断流式读取
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // 文件不存在时生成器自动结束
  }
}

/**
 * 追加一行 JSON 记录到 JSONL 文件末尾。
 * 追加模式是 JSONL 的核心优势：不需要读取整个文件再重写，
 * 直接 O(1) 追加，为后续 Git 同步和增量索引提供原子化的单行写入。
 */
export async function appendJSONL(record, storePath = resolveStorePath()) {
  await mkdir(dirname(storePath), { recursive: true });
  const line = JSON.stringify(record) + '\n';
  await appendFile(storePath, line, 'utf8');
}

/**
 * 覆盖写入全部记录。
 * 用于 merge/compact 场景：读取全部记录、去重、合并后全量写回。
 * 空数组写入空字符串，清空存储。
 */
export async function writeJSONL(records, storePath = resolveStorePath()) {
  await mkdir(dirname(storePath), { recursive: true });
  if (records.length === 0) {
    await writeFile(storePath, '', 'utf8');
    return;
  }
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(storePath, lines, 'utf8');
}

/**
 * 向后兼容的读取函数：
 * 1. 优先读取 JSONL 格式（新格式）
 * 2. JSONL 为空或不存在时，回退读旧 JSON 格式
 * 3. 旧 JSON 格式中读取 { memories: [...] } 包装的对象
 *
 * 这样已有调用方无需改动即可平滑迁移到 JSONL 存储。
 *
 * 关键修复：当 storePath 参数指定了自定义路径时，
 * 旧 JSON 回退路径应从同一目录派生，而非使用默认 .mem-sync 目录。
 */
export async function readMemories(storePath) {
  // 优先尝试 JSONL 路径
  const jsonlPath = storePath ?? resolveStorePath();
  const records = await readJSONL(jsonlPath);
  if (records.length > 0) return records;

  // JSONL 无数据时尝试旧 JSON 格式（迁移兼容）
  // 从 jsonlPath 所在目录派生旧 JSON 路径，确保自定义目录测试也能正确回退
  const legacyPath = resolveLegacyStorePath(dirname(jsonlPath));
  try {
    const raw = await readFile(legacyPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.memories)) {
      return parsed.memories;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return records;
}

/**
 * 向后兼容的写入函数（内部委托到 writeJSONL）。
 * 写出的格式统一为 JSONL，不再产生旧 JSON 格式。
 */
export async function writeMemories(memories, storePath = resolveStorePath()) {
  await writeJSONL(memories, storePath);
}
