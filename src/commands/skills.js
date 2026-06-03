import fs from 'node:fs';
import path from 'node:path';
import { generateSkills } from '../skills-engine.js';

const DEFAULT_REPO = path.resolve(process.env.MEM_SYNC_HOME ?? '.mem-sync');

/**
 * skills 命令：解析命令行参数，调用 skills engine 或读取已有 SKILL.md。
 *
 * 这是 `mem-sync skills [subcommand] [options]` 的入口点。
 *
 * Subcommands:
 *   generate  — 从记忆库生成 SKILL.md 文件
 *   list      — 列出所有已有技能及其 frontmatter
 *   show      — 显示指定技能的完整 SKILL.md 内容
 *
 * @param {string[]} args - 命令行参数数组（不含命令名）
 * @returns {Promise<void>}
 */
export async function skillsCommand(args) {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help') {
    printSkillsHelp();
    return;
  }

  switch (subcommand) {
    case 'generate': {
      const opts = parseGenerateArgs(rest);
      const result = await generateSkills(opts);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'list': {
      const opts = parseListArgs(rest);
      const result = listSkills(opts);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'show': {
      const { name, opts } = parseShowArgs(rest);
      const content = showSkill(name, opts);
      console.log(content);
      break;
    }
    default:
      console.error(`mem-sync: unknown skills subcommand: ${subcommand}`);
      console.error('Available: skills generate | skills list | skills show <name>');
      process.exitCode = 1;
  }
}

function printSkillsHelp() {
  console.log(`mem-sync skills

Usage:
  mem-sync skills generate [--repo <path>] [--force] [--project <id>]
  mem-sync skills list [--repo <path>]
  mem-sync skills show <name> [--repo <path>]

Subcommands:
  generate   Generate SKILL.md files from memories
  list       List all generated skills with frontmatter
  show       Display full SKILL.md content for a named skill`);
}

/**
 * 解析 skills generate 子命令的命令行参数。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ repoPath: string, projectId?: string, force: boolean }}
 */
export function parseGenerateArgs(args) {
  let projectId;
  let force = false;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--project') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--project requires a value.');
      }
      projectId = raw;
      index += 2;
    } else if (arg === '--force') {
      force = true;
      index += 1;
    } else if (arg === '--repo') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--repo requires a value.');
      }
      repo = raw;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      index += 1;
    }
  }

  const opts = { repoPath: repo, force };
  if (projectId !== undefined) {
    opts.projectId = projectId;
  }
  return opts;
}

/**
 * 解析 skills list 子命令的命令行参数。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ repoPath: string }}
 */
export function parseListArgs(args) {
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--repo') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--repo requires a value.');
      }
      repo = raw;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      index += 1;
    }
  }

  return { repoPath: repo };
}

/**
 * 解析 skills show 子命令的命令行参数。
 *
 * @param {string[]} args - 命令行参数数组
 * @returns {{ name: string, opts: { repoPath: string } }}
 */
export function parseShowArgs(args) {
  let name;
  let repo = DEFAULT_REPO;

  let index = 0;
  while (index < args.length) {
    const arg = args[index];

    if (arg === '--repo') {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error('--repo requires a value.');
      }
      repo = raw;
      index += 2;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      // First positional argument is the skill name
      if (name === undefined) {
        name = arg;
      }
      index += 1;
    }
  }

  if (!name) {
    throw new Error('skills show requires a skill name.');
  }

  return { name, opts: { repoPath: repo } };
}

/**
 * Parse simple YAML frontmatter between --- markers.
 * Returns an object with the parsed key-value pairs.
 *
 * @param {string} content - raw SKILL.md content
 * @returns {{ name?: string, description?: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fm = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return fm;
}

/**
 * List all generated skills by scanning the skills/ directory.
 *
 * @param {{ repoPath: string }} opts
 * @returns {Array<{ name: string, description: string, path: string }>}
 */
function listSkills(opts) {
  const skillsDir = path.join(opts.repoPath, 'skills');

  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(content);

    results.push({
      name: fm.name || entry.name,
      description: fm.description || '',
      path: path.relative(process.cwd(), skillFile)
    });
  }

  return results;
}

/**
 * Show the full content of a named skill's SKILL.md.
 *
 * @param {string} name - skill name (slug)
 * @param {{ repoPath: string }} opts
 * @returns {string} raw markdown content
 */
function showSkill(name, opts) {
  const skillFile = path.join(opts.repoPath, 'skills', name, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    throw new Error(`skill not found: ${name}`);
  }

  return fs.readFileSync(skillFile, 'utf8');
}
