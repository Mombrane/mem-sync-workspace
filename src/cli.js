#!/usr/bin/env node
import { createMemoryStore } from './memory-store.js';
import {
  readMemories,
  readJSONLStream,
  resolveStorePath
} from './file-store.js';

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'add') {
    await addMemory(args);
  } else if (command === 'list') {
    await listMemories();
  } else if (command === 'export') {
    await exportMemories();
  } else {
    printHelp();
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`mem-sync: ${error.message}`);
  process.exitCode = 1;
}

/**
 * add 命令：JSONL 追加模式
 *
 * JSONL 追加写入的核心优势：
 * - 不需要全量读取 → 合并 → 覆盖写入
 * - 直接将新记录追加到文件末尾，O(1) 写入
 * - 后续 Git 同步时 diff 只显示新增行
 * - 重复记录由读取时 mergeMemorySets 去重处理
 *
 * store.add() 内部已处理 appendJSONL 持久化，
 * CLI 层无需再单独调用存储 API。
 */
async function addMemory(args) {
  const { text, options } = parseAddArgs(args);
  const store = createMemoryStore({ logger: (message) => console.error(message) });
  const memory = await store.add(text, options);

  console.log(`Added ${memory.id} to ${resolveStorePath()}`);
}

/**
 * list 命令：流式读取 JSONL
 *
 * 使用 readJSONLStream 逐条 yield，内存友好，
 * 即使 JSONL 文件很大也能正常输出。
 */
async function listMemories() {
  for await (const memory of readJSONLStream()) {
    console.log(`${memory.id}\t${memory.scope}\t${formatSource(memory.source)}\t${memory.content ?? memory.text}`);
  }
}

/**
 * export 命令：流式读取 JSONL，汇总后输出格式化 JSON
 *
 * 读取使用流式避免一次性加载大文件，
 * 输出保持与旧格式兼容的 { memories: [...] } 结构。
 */
async function exportMemories() {
  // 使用 readMemories 读取（含向后兼容：优先 JSONL，回退旧 JSON）
  const memories = await readMemories();
  console.log(JSON.stringify({ memories }, null, 2));
}

function parseAddArgs(args) {
  const textParts = [];
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scope') {
      options.scope = requireValue(args, index, '--scope');
      index += 1;
    } else if (arg === '--source') {
      options.source = requireValue(args, index, '--source');
      index += 1;
    } else {
      textParts.push(arg);
    }
  }

  return { text: textParts.join(' '), options };
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printHelp() {
  console.log(`mem-sync\n\nUsage:\n  mem-sync add <text> [--scope name] [--source name]\n  mem-sync list\n  mem-sync export`);
}

function formatSource(source) {
  if (typeof source === 'string') return source;
  return source?.agent ?? source?.type ?? 'unknown';
}
