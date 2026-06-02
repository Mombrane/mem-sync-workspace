import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * Create a valid v1 memory record with reasonable defaults.
 * @param {object} [overrides]
 * @returns {object}
 */
export function makeRecord(overrides = {}) {
  const scope = overrides.scope ?? 'global';
  const kind = overrides.kind ?? 'episode';
  const content = overrides.content ?? '测试记忆内容。';
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? `${scope}:${kind}:${hash}`,
    kind,
    scope,
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content: overrides.content ?? '测试记忆内容。',
    summary: overrides.summary ?? '测试记忆内容。',
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
 * Initialize a git repository (bare or normal) with user config.
 * @param {string} dir
 * @param {boolean} [bare=false]
 */
export function initGitRepo(dir, bare = false) {
  const flag = bare ? '--bare' : '';
  execSync(`git init -b main ${flag} "${dir}"`, { encoding: 'utf8' });
  if (!bare) {
    execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
    execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
  }
}

/**
 * Write a file, stage it, and commit.
 * @param {string} dir - repo directory
 * @param {string} filepath - relative path within the repo
 * @param {string} content - file content
 * @param {string} [message] - commit message
 */
export function commitFile(dir, filepath, content, message) {
  writeFileSync(join(dir, filepath), content, 'utf8');
  execSync(`git add "${filepath}"`, { cwd: dir, encoding: 'utf8' });
  execSync(`git commit -m "${message || 'add ' + filepath}"`, { cwd: dir, encoding: 'utf8' });
}

/**
 * Set up a full mem-sync test environment.
 *
 * @param {object} [options]
 * @param {boolean} [options.withRemote=false]
 * @param {boolean} [options.withJSONL=false]
 * @param {object[]} [options.jsonlRecords=[]]
 * @param {boolean} [options.withPending=false]
 * @param {object[]} [options.pendingRecords=[]]
 * @param {boolean} [options.withIndex=false]
 * @param {string} [options.cloneFrom]
 * @returns {{ dir: string, bareDir: string|null }}
 */
export function setupMemSyncEnv(options = {}) {
  const {
    withRemote = false,
    withJSONL = false,
    jsonlRecords = [],
    withPending = false,
    pendingRecords = [],
    withIndex = false,
    cloneFrom = null
  } = options;

  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-'));
  let bareDir = null;

  if (cloneFrom) {
    execSync(`git clone "${cloneFrom}" "${dir}"`, { encoding: 'utf8' });
    execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
    execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
  } else {
    initGitRepo(dir);
  }

  // Initial commit so HEAD is available
  commitFile(dir, 'README.md', '# mem-sync', 'init');

  if (withRemote) {
    bareDir = mkdtempSync(join(tmpdir(), 'mem-sync-bare-'));
    initGitRepo(bareDir, true);
    execSync(`git remote add origin "${bareDir}"`, { cwd: dir, encoding: 'utf8' });
    execSync('git branch -M main', { cwd: dir, encoding: 'utf8' });
    try {
      execSync('git push -u origin main', { cwd: dir, encoding: 'utf8' });
    } catch {
      // branch may already exist
    }
  }

  if (withJSONL && jsonlRecords.length > 0) {
    const lines = jsonlRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(dir, 'memories.jsonl'), lines, 'utf8');
    commitFile(dir, 'memories.jsonl', lines, 'add memories');
  }

  if (withPending && pendingRecords.length > 0) {
    const pendingDir = join(dir, 'pending');
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(
      join(pendingDir, 'device-test.json'),
      JSON.stringify(pendingRecords),
      'utf8'
    );
  }

  if (withIndex && jsonlRecords.length > 0) {
    const cacheDir = join(dir, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: dir },
      encoding: 'utf8'
    });
  }

  return { dir, bareDir };
}

/**
 * Clean up a test environment (remove temp dirs).
 * @param {{ dir: string, bareDir: string|null }} env
 */
export function cleanupEnv(env) {
  if (env.bareDir) {
    rmSync(env.bareDir, { recursive: true, force: true });
  }
  rmSync(env.dir, { recursive: true, force: true });
}

/**
 * Run the CLI with given arguments and MEM_SYNC_HOME.
 * @param {string} dir - MEM_SYNC_HOME value
 * @param {string[]} args - CLI arguments (first arg is the command name)
 * @param {object} [opts] - extra spawn options
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function runCli(dir, args, opts = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, MEM_SYNC_HOME: dir },
    encoding: 'utf8',
    ...opts
  });
}
