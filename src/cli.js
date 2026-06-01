#!/usr/bin/env node
import { createMemoryStore, mergeMemorySets } from './memory-store.js';
import { readMemories, resolveStorePath, writeMemories } from './file-store.js';

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

async function addMemory(args) {
  const { text, options } = parseAddArgs(args);
  const store = createMemoryStore({ logger: (message) => console.error(message) });
  const current = await readMemories();
  const memory = store.add(text, options);
  const merged = mergeMemorySets([current, [memory]]);
  await writeMemories(merged);
  console.log(`Added ${memory.id} to ${resolveStorePath()}`);
}

async function listMemories() {
  const memories = await readMemories();
  for (const memory of memories) {
    console.log(`${memory.id}\t${memory.scope}\t${formatSource(memory.source)}\t${memory.content ?? memory.text}`);
  }
}

async function exportMemories() {
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
