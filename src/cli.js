#!/usr/bin/env node
import { rememberCommand } from './commands/remember.js';
import { recallCommand } from './commands/recall.js';
import { prepareCommand } from './commands/prepare.js';
import { contextCommand } from './commands/context.js';
import { retainCommand } from './commands/retain.js';
import { flushCommand } from './commands/flush.js';
import { doctorCommand } from './commands/doctor.js';
import { redactCommand } from './commands/redact.js';
import { compactCommand } from './commands/compact.js';
import { summarizeCommand } from './commands/summarize.js';
import { reviewCommand } from './commands/review.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { statusCommand as repoStatusCommand } from './commands/status.js';
import { logCommand } from './commands/log.js';
import { showCommand } from './commands/show.js';
import { forgetCommand } from './commands/forget.js';
import {
  readMemories,
  readJSONLStream,
  resolveStorePath
} from './file-store.js';
import {
  rebuildCommand,
  statusCommand,
  updateCommand
} from './commands/index.js';

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'remember') {
    await rememberCommand(args);
  } else if (command === 'recall') {
    await recallCommand(args);
  } else if (command === 'prepare') {
    await prepareCommand(args);
  } else if (command === 'context') {
    await contextCommand(args);
  } else if (command === 'retain') {
    await retainCommand(args);
  } else if (command === 'flush') {
    await flushCommand(args);
  } else if (command === 'doctor') {
    process.exitCode = await doctorCommand(args);
  } else if (command === 'redact') {
    redactCommand(args);
  } else if (command === 'compact') {
    await compactCommand(args);
  } else if (command === 'summarize') {
    await summarizeCommand(args);
  } else if (command === 'review') {
    await reviewCommand(args);
  } else if (command === 'init') {
    await initCommand(args);
  } else if (command === 'sync') {
    await syncCommand(args);
  } else if (command === 'status') {
    await repoStatusCommand(args);
  } else if (command === 'log') {
    await logCommand(args);
  } else if (command === 'show') {
    await showCommand(args);
  } else if (command === 'forget') {
    await forgetCommand(args);
  } else if (command === 'list') {
    await listMemories();
  } else if (command === 'export') {
    await exportMemories();
  } else if (command === 'index') {
    handleIndexCommand(args);
  } else {
    printHelp();
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`mem-sync: ${error.message}`);
  process.exitCode = 1;
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

function handleIndexCommand(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'rebuild') {
    rebuildCommand();
  } else if (subcommand === 'status') {
    statusCommand(rest);
  } else if (subcommand === 'update') {
    updateCommand();
  } else {
    console.error(`mem-sync: unknown index subcommand: ${subcommand ?? '(none)'}`);
    console.error('Available: index rebuild | index status | index update');
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`mem-sync

Usage:
  mem-sync init [--repo <url>]
  mem-sync sync [--repo <path>]
  mem-sync status [--repo <path>]
  mem-sync log [--limit <n>] [--repo <path>]
  mem-sync show <id> [--repo <path>]
  mem-sync forget <id> [--reason <text>] [--repo <path>]
  mem-sync remember <content> [--kind kind] [--scope scope] [--tag tag] [...]
  mem-sync recall <query> [--format markdown|json|memories] [--limit n] [...]
  mem-sync retain --transcript-file <path> --pending --device <id> [--project-id id] [--agent-id id]
  mem-sync context [--mode startup|recall] [--format markdown|json|memories] [--limit n] [--project-id id] [--project path]
  mem-sync flush [--remote <url>]
  mem-sync redact --check
  mem-sync compact [--older-than <days>] [--dry-run] [--repo <path>]
  mem-sync summarize [--project <path>] [--force] [--repo <path>]
  mem-sync review pending [--kind <kind>] [--full] [--repo <path>]
  mem-sync doctor
  mem-sync list
  mem-sync export
  mem-sync index rebuild
  mem-sync index status [--format json]
  mem-sync index update`);
}

function formatSource(source) {
  if (typeof source === 'string') return source;
  return source?.agent ?? source?.type ?? 'unknown';
}
