/**
 * tests-e2e/helpers.js — 端到端测试辅助函数
 *
 * 基于 tests/helpers.js 扩展，提供端到端场景所需的工具函数。
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 创建临时的 MEM_SYNC_HOME 目录（含 .mem-sync 子目录结构）。
 * 返回 { home, repo }，其中 home 是环境根目录，repo 是 .mem-sync 路径。
 */
export function createTestHome() {
  const home = mkdtempSync(join(tmpdir(), 'mem-sync-e2e-'));
  const repo = join(home, '.mem-sync');
  mkdirSync(repo, { recursive: true });

  // 初始化 git 仓库
  execSync('git init -b main', { cwd: repo, encoding: 'utf8' });
  execSync('git config user.email "e2e@test"', { cwd: repo, encoding: 'utf8' });
  execSync('git config user.name "E2E Test"', { cwd: repo, encoding: 'utf8' });

  // 初始提交
  writeFileSync(join(repo, 'README.md'), '# mem-sync e2e', 'utf8');
  execSync('git add .', { cwd: repo, encoding: 'utf8' });
  execSync('git commit -m "init"', { cwd: repo, encoding: 'utf8' });

  return { home, repo };
}

/**
 * 创建带远程仓库的测试环境。
 * 返回 { home, repo, bareRepo }。
 */
export function createTestHomeWithRemote() {
  const env = createTestHome();
  const bareRepo = mkdtempSync(join(tmpdir(), 'mem-sync-e2e-bare-'));

  execSync('git init --bare -b main', { cwd: bareRepo, encoding: 'utf8' });
  execSync(`git remote add origin "${bareRepo}"`, { cwd: env.repo, encoding: 'utf8' });
  execSync('git push -u origin main', { cwd: env.repo, encoding: 'utf8' });

  return { ...env, bareRepo };
}

/**
 * 清理测试环境。
 */
export function cleanupTestHome(env) {
  if (env.bareRepo) {
    rmSync(env.bareRepo, { recursive: true, force: true });
  }
  if (env.home) {
    rmSync(env.home, { recursive: true, force: true });
  }
}

/**
 * 运行 CLI 命令，使用指定的 MEM_SYNC_HOME。
 */
export function runCli(repo, args, opts = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, MEM_SYNC_HOME: repo },
    encoding: 'utf8',
    ...opts
  });
}

/**
 * 创建符合 Schema v1 的记忆记录（用于直接写入 JSONL）。
 */
export function makeRecord(overrides = {}) {
  const scope = overrides.scope ?? 'global';
  const kind = overrides.kind ?? 'episode';
  const content = overrides.content ?? '默认测试内容。';
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);

  return {
    schemaVersion: 1,
    id: overrides.id ?? `mem_${hash}`,
    canonicalKey: overrides.canonicalKey ?? `${kind}:${scope}:::${hash}`,
    kind,
    scope,
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content,
    summary: overrides.summary ?? content.slice(0, 120),
    source: overrides.source ?? { type: 'manual' },
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 1,
    importance: overrides.importance ?? 0.5,
    veracity: overrides.veracity ?? 'stated',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T10:00:00.000Z',
    validUntil: overrides.validUntil ?? null,
    deletedAt: overrides.deletedAt ?? null,
    supersedes: overrides.supersedes ?? []
  };
}

/**
 * 写入 JSONL 文件到指定路径。
 */
export function writeJSONL(filePath, records) {
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(filePath, lines, 'utf8');
}

/**
 * 读取 JSONL 文件并返回记录数组。
 */
export function readJSONL(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  return raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

/**
 * 在 git 仓库中提交文件。
 */
export function commitInRepo(repo, filepath, content, message) {
  writeFileSync(join(repo, filepath), content, 'utf8');
  execSync(`git add "${filepath}"`, { cwd: repo, encoding: 'utf8' });
  execSync(`git commit -m "${message}"`, { cwd: repo, encoding: 'utf8' });
}
