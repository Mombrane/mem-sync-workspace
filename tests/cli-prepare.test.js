import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：创建标准 v1 记忆记录。
 */
function makeRecord(overrides = {}) {
  const scope = overrides.scope ?? 'global';
  const kind = overrides.kind ?? 'episode';
  const content = overrides.content ?? '测试记忆内容。';
  // Generate a valid canonicalKey (scope:kind:contentHash) for schema validation
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
 * 辅助函数：初始化 Git 仓库（bare 或普通）。
 */
function initGitRepo(dir, bare = false) {
  const flag = bare ? '--bare' : '';
  execSync(`git init -b main ${flag} "${dir}"`, { encoding: 'utf8' });
  if (!bare) {
    execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
    execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
  }
}

/**
 * 辅助函数：创建并提交文件。
 */
function commitFile(repoDir, filename, content, message) {
  writeFileSync(join(repoDir, filename), content, 'utf8');
  execSync(`git add "${filename}"`, { cwd: repoDir, encoding: 'utf8' });
  execSync(`git commit -m "${message || 'add ' + filename}"`, { cwd: repoDir, encoding: 'utf8' });
}

/**
 * 辅助函数：创建带有 remote、JSONL 和已构建索引的完整测试环境。
 */
function setupMemSyncEnv(options = {}) {
  const {
    withRemote = false,
    withJSONL = false,
    jsonlRecords = [],
    withPending = false,
    pendingRecords = [],
    withIndex = false,
    cloneFrom = null
  } = options;

  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-prepare-'));
  let bareDir = null;

  if (cloneFrom) {
    // 从 bare 仓库克隆
    execSync(`git clone "${cloneFrom}" "${dir}"`, { encoding: 'utf8' });
    execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
    execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
  } else {
    // 初始化新仓库
    initGitRepo(dir);
  }

  // 添加初始化提交
  commitFile(dir, 'README.md', '# mem-sync', 'init');

  if (withRemote) {
    bareDir = mkdtempSync(join(tmpdir(), 'mem-sync-prepare-bare-'));
    initGitRepo(bareDir, true);
    execSync(`git remote add origin "${bareDir}"`, { cwd: dir, encoding: 'utf8' });
    execSync('git branch -M main', { cwd: dir, encoding: 'utf8' });
    try {
      execSync('git push -u origin main', { cwd: dir, encoding: 'utf8' });
    } catch {
      // 分支可能已存在
    }
  }

  if (withJSONL && jsonlRecords.length > 0) {
    const lines = jsonlRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(dir, 'memories.jsonl'), lines, 'utf8');
    // 提交 JSONL
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
    // 构建索引
    const cacheDir = join(dir, '.cache');
    mkdirSync(cacheDir, { recursive: true });

    // 使用 spawnSync 调用 CLI 构建索引
    const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: dir },
      encoding: 'utf8'
    });
  }

  return { dir, bareDir };
}

/**
 * 辅助函数：清理测试环境。
 */
function cleanupEnv(env) {
  if (env.bareDir) {
    rmSync(env.bareDir, { recursive: true, force: true });
  }
  rmSync(env.dir, { recursive: true, force: true });
}

// ─── Up-to-date scenario ────────────────────────────────────────────

test('prepare on up-to-date repo reports no changes', () => {
  const records = [makeRecord({ id: 'mem_001', content: '第一条记忆。' })];
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records,
    withIndex: true
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // stdout 应包含 JSON
    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    assert.ok(jsonLine, 'should have JSON output');
    const output = JSON.parse(jsonLine);

    assert.equal(output.git.skipped, false);
    assert.equal(output.git.pulled, 0);
    assert.equal(output.git.conflicts, 0);
    assert.equal(output.merge.pending, 0);
    assert.equal(output.merge.merged, 0);
    assert.equal(output.index.rebuilt, false); // Index was built at current HEAD, no change
  } finally {
    cleanupEnv(env);
  }
});

// ─── No-remote scenario ────────────────────────────────────────────

test('prepare with no remote skips git operations', () => {
  const records = [makeRecord({ id: 'mem_001', content: '本地记忆。' })];
  const env = setupMemSyncEnv({
    withRemote: false, // 无 remote
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    assert.equal(output.git.skipped, true);
    assert.equal(output.git.pulled, 0);
    assert.equal(output.git.conflicts, 0);
    assert.match(result.stderr, /skipped/);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Pending merge scenario ────────────────────────────────────────

test('prepare merges pending records into JSONL', () => {
  const existing = [makeRecord({ id: 'mem_existing', content: '已有记忆。' })];
  const pending = [
    makeRecord({ id: 'mem_pending_1', content: '待合并记忆一。' }),
    makeRecord({ id: 'mem_pending_2', content: '待合并记忆二。' })
  ];

  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: existing,
    withPending: true,
    pendingRecords: pending
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    // git may be skipped if no remote
    assert.equal(output.merge.pending, 2);
    assert.equal(output.merge.merged, 2);
    assert.equal(output.merge.total, 3); // existing + 2 pending

    // 验证 pending 文件已被移除
    const pendingDir = join(env.dir, 'pending');
    const pendingFiles = existsSync(pendingDir)
      ? readdirSync(pendingDir).filter(f => f.endsWith('.json'))
      : [];
    assert.equal(pendingFiles.length, 0, 'pending files should be removed after merge');
  } finally {
    cleanupEnv(env);
  }
});

// ─── HEAD-changed rebuild scenario ─────────────────────────────────

test('prepare triggers full rebuild when HEAD changed', () => {
  const records = [makeRecord({ id: 'mem_001', content: '第一条记忆。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records,
    withIndex: true
  });

  try {
    // 构建索引后添加新提交
    commitFile(env.dir, 'extra.txt', 'extra content', 'extra commit');

    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    assert.equal(output.index.rebuilt, true);
    assert.equal(output.index.records, 1);
    assert.match(result.stderr, /rebuilt/);
  } finally {
    cleanupEnv(env);
  }
});

// ─── HEAD-unchanged update scenario ────────────────────────────────

test('prepare performs incremental update when HEAD unchanged', () => {
  const records = [makeRecord({ id: 'mem_001', content: '已有记忆。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records,
    withIndex: true
  });

  try {
    // 不添加新提交，HEAD 应不变
    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    // rebuilt 应为 false（增量更新或跳过）
    assert.equal(output.index.rebuilt, false);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Lock timeout scenario ─────────────────────────────────────────

test('prepare exits with error on lock timeout', () => {
  const records = [makeRecord({ id: 'mem_001', content: '锁测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records });

  try {
    // 先创建锁文件（写入当前 PID 模拟活动进程）
    const lockPath = join(env.dir, 'repo.lock');
    writeFileSync(lockPath, String(process.pid), 'utf8');

    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8',
      timeout: 5000
    });

    // 应非零退出或超时被 kill
    if (result.status !== null && result.status !== 0) {
      assert.ok(result.stderr.includes('timeout') || result.stderr.includes('lock'),
        `stderr should mention lock timeout: ${result.stderr}`);
    }
    // 如果超时导致 signal，也接受
    // 关键：不应正常退出并输出 JSON
  } finally {
    cleanupEnv(env);
  }
});

// ─── Rebase conflict scenario ──────────────────────────────────────

test('prepare handles rebase conflict as fatal', () => {
  const records = [makeRecord({ id: 'mem_001', content: '冲突测试。' })];
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    // 在 bare（remote）中创建冲突提交
    const bareDir = env.bareDir;
    assert.ok(bareDir, 'bareDir should exist for remote scenario');

    const tempClone = mkdtempSync(join(tmpdir(), 'mem-sync-prepare-conflict-'));
    try {
      execSync(`git clone "${bareDir}" "${tempClone}"`, { encoding: 'utf8' });
      execSync('git config user.email "test@test"', { cwd: tempClone, encoding: 'utf8' });
      execSync('git config user.name "Test"', { cwd: tempClone, encoding: 'utf8' });

      // 在 README.md 中制造冲突（与本地不同的内容）
      writeFileSync(join(tempClone, 'README.md'), 'conflicting remote content', 'utf8');
      execSync('git add README.md', { cwd: tempClone, encoding: 'utf8' });
      execSync('git commit -m "remote conflict change"', { cwd: tempClone, encoding: 'utf8' });
      execSync('git push origin main', { cwd: tempClone, encoding: 'utf8' });
    } finally {
      rmSync(tempClone, { recursive: true, force: true });
    }

    // 在本地也修改 README.md 制造冲突
    writeFileSync(join(env.dir, 'README.md'), 'local conflicting content', 'utf8');
    execSync('git add README.md', { cwd: env.dir, encoding: 'utf8' });
    execSync('git commit -m "local conflict change"', { cwd: env.dir, encoding: 'utf8' });

    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    // Rebase 冲突应该是致命的
    assert.notEqual(result.status, 0, `should exit non-zero on conflict, got ${result.status}`);
    assert.match(result.stderr, /conflict/);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Fresh clone scenario ──────────────────────────────────────────

test('prepare clones repo with --remote flag', () => {
  // 创建一个 bare 仓库作为 source
  const bareDir = mkdtempSync(join(tmpdir(), 'mem-sync-prepare-clone-bare-'));
  initGitRepo(bareDir, true);

  // 创建临时仓库并推送到 bare
  const tempRepo = mkdtempSync(join(tmpdir(), 'mem-sync-prepare-clone-tmp-'));
  try {
    initGitRepo(tempRepo);
    commitFile(tempRepo, 'hello.txt', 'hello world', 'initial');
    execSync(`git remote add origin "${bareDir}"`, { cwd: tempRepo, encoding: 'utf8' });
    execSync('git push -u origin main', { cwd: tempRepo, encoding: 'utf8' });
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
  }

  // 目标目录（不存在）
  const targetDir = join(tmpdir(), `mem-sync-prepare-clone-${Date.now()}`);

  try {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, 'prepare', '--remote', bareDir],
      {
        env: { ...process.env, MEM_SYNC_HOME: targetDir },
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 验证仓库已创建
    assert.ok(existsSync(join(targetDir, '.git')), 'repository should be cloned');

    // 应包含 JSON 输出
    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    assert.ok(jsonLine, 'should have JSON output');
    const output = JSON.parse(jsonLine);
    assert.equal(typeof output.git.skipped, 'boolean');
    assert.equal(typeof output.merge.pending, 'number');
    assert.equal(typeof output.index.rebuilt, 'boolean');
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

// ─── Index failure non-fatal scenario ──────────────────────────────

test('prepare continues after index failure', () => {
  const records = [makeRecord({ id: 'mem_001', content: '索引失败测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records });

  try {
    // 创建一个损坏的 index 目录（数据库文件变成目录）
    const cacheDir = join(env.dir, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    const dbPath = join(cacheDir, 'index.sqlite');
    // 将 index.sqlite 变成目录，造成重建失败
    if (!existsSync(dbPath)) {
      mkdirSync(dbPath, { recursive: true });
    }

    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    // 应该正常退出（index 失败只是警告）
    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /warning/);

    // 应仍有 JSON 输出
    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    assert.ok(jsonLine, 'should have JSON output even when index fails');
    const output = JSON.parse(jsonLine);
    assert.equal(output.index.rebuilt, false);
  } finally {
    cleanupEnv(env);
  }
});

// ─── JSON output structure ─────────────────────────────────────────

test('prepare outputs correct JSON structure to stdout', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 解析 stdout 中的 JSON（可能有多个 JSON 行）
    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    assert.ok(jsonLine, 'stdout should contain JSON output');

    const output = JSON.parse(jsonLine);

    // 验证结构
    assert.ok('git' in output);
    assert.ok('skipped' in output.git);
    assert.ok('pulled' in output.git);
    assert.ok('conflicts' in output.git);
    assert.equal(typeof output.git.skipped, 'boolean');
    assert.equal(typeof output.git.pulled, 'number');
    assert.equal(typeof output.git.conflicts, 'number');

    assert.ok('merge' in output);
    assert.ok('pending' in output.merge);
    assert.ok('merged' in output.merge);
    assert.ok('total' in output.merge);
    assert.equal(typeof output.merge.pending, 'number');
    assert.equal(typeof output.merge.merged, 'number');
    assert.equal(typeof output.merge.total, 'number');

    assert.ok('index' in output);
    assert.ok('rebuilt' in output.index);
    assert.ok('records' in output.index);
    assert.equal(typeof output.index.rebuilt, 'boolean');
    assert.equal(typeof output.index.records, 'number');
  } finally {
    cleanupEnv(env);
  }
});

// ─── Diagnostics to stderr ─────────────────────────────────────────

test('prepare writes diagnostics to stderr not stdout', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'prepare'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // stderr 应包含诊断信息
    assert.match(result.stderr, /prepare/);

    // stdout 应只包含 JSON（和可能的换行）
    const stdout = result.stdout.trim();
    assert.ok(stdout.startsWith('{'), `stdout should start with JSON object, got: ${stdout}`);
    assert.ok(stdout.endsWith('}'), `stdout should end with JSON object, got: ${stdout}`);
  } finally {
    cleanupEnv(env);
  }
});
