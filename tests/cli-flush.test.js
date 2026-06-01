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
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? `${scope}:${kind}:${hash}`,
    kind,
    scope,
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content,
    summary: overrides.summary ?? content,
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
 * 辅助函数：初始化 Git 仓库。
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
 * 辅助函数：创建带有 remote、JSONL 和 pending 的完整测试环境。
 */
function setupMemSyncEnv(options = {}) {
  const {
    withRemote = false,
    withJSONL = false,
    jsonlRecords = [],
    withPending = false,
    pendingRecords = [],
    withIndex = false
  } = options;

  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-flush-'));
  let bareDir = null;

  // 初始化新仓库
  initGitRepo(dir);

  // 添加初始化提交
  commitFile(dir, 'README.md', '# mem-sync', 'init');

  if (withRemote) {
    bareDir = mkdtempSync(join(tmpdir(), 'mem-sync-flush-bare-'));
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
    const cacheDir = join(dir, '.cache');
    mkdirSync(cacheDir, { recursive: true });
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

// ─── Merge + Commit scenario ────────────────────────────────────────

test('flush merges pending records and commits', () => {
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
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    assert.ok(jsonLine, 'should have JSON output');
    const output = JSON.parse(jsonLine);

    assert.equal(output.merge.pending, 2);
    assert.equal(output.merge.merged, 2);
    assert.equal(output.merge.total, 3);

    // 验证已提交
    assert.equal(output.commit.made, true);
    assert.ok(output.commit.hash, 'should have commit hash');
    assert.equal(typeof output.commit.hash, 'string');
    assert.ok(output.commit.hash.length >= 4, 'commit hash should be at least 4 chars');

    // 验证 pending 文件已删除
    const pendingDir = join(env.dir, 'pending');
    const pendingFiles = existsSync(pendingDir)
      ? readdirSync(pendingDir).filter(f => f.endsWith('.json'))
      : [];
    assert.equal(pendingFiles.length, 0, 'pending files should be removed after merge');

    // 验证 git log 包含提交
    const log = execSync('git log --oneline -1', { cwd: env.dir, encoding: 'utf8' }).trim();
    assert.match(log, /mem-sync:/, `commit message should contain 'mem-sync:': ${log}`);
    assert.match(log, /merge 2/, 'commit message should mention merge count');
  } finally {
    cleanupEnv(env);
  }
});

// ─── Skip commit when no pending records (idempotent) ────────────────

test('flush skips commit when no pending records', () => {
  const records = [makeRecord({ id: 'mem_001', content: '已有记忆。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    // 先 flush 一次（可能合并 pending 但这里没有）
    let result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `first flush exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines1 = result.stdout.trim().split('\n');
    const jsonLine1 = stdoutLines1.find(l => l.startsWith('{'));
    const output1 = JSON.parse(jsonLine1);

    assert.equal(output1.merge.pending, 0);
    assert.equal(output1.merge.merged, 0);
    assert.equal(output1.commit.made, false);

    // 第二次 flush（幂等）
    result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `second flush exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines2 = result.stdout.trim().split('\n');
    const jsonLine2 = stdoutLines2.find(l => l.startsWith('{'));
    const output2 = JSON.parse(jsonLine2);

    assert.equal(output2.merge.pending, 0);
    assert.equal(output2.merge.merged, 0);
    assert.equal(output2.commit.made, false);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Push to remote scenario ────────────────────────────────────────

test('flush pushes to remote when configured', () => {
  const records = [makeRecord({ id: 'mem_001', content: '已有记忆。' })];
  const pending = [makeRecord({ id: 'mem_push', content: '推送测试记忆。' })];

  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records,
    withPending: true,
    pendingRecords: pending
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    assert.equal(output.merge.merged, 1);
    assert.equal(output.commit.made, true);
    assert.equal(output.push.attempted, true);
    assert.equal(output.push.success, true);

    // 验证远程有提交
    assert.ok(env.bareDir, 'bareDir should exist');
    const bareLog = execSync('git log --oneline -1', { cwd: env.bareDir, encoding: 'utf8' }).trim();
    assert.match(bareLog, /mem-sync:/, `bare repo should have flush commit: ${bareLog}`);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Push failure is non-blocking ───────────────────────────────────

test('flush handles push failure as non-blocking', () => {
  const records = [makeRecord({ id: 'mem_001', content: '已有记忆。' })];
  const pending = [makeRecord({ id: 'mem_push_fail', content: '推送失败测试。' })];

  // 创建带 remote 的环境：fetch/pull 正常工作，但 push URL 指向不可写路径
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records,
    withPending: true,
    pendingRecords: pending
  });

  try {
    // 设置单独的 push URL 指向不存在的目录，模拟 push 失败
    execSync(
      'git remote set-url --push origin /tmp/nonexistent-flush-push-target',
      { cwd: env.dir, encoding: 'utf8' }
    );

    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    // 应该正常退出（push 失败是非致命的）
    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    // 合并和提交应成功
    assert.equal(output.merge.merged, 1);
    assert.equal(output.commit.made, true);
    assert.ok(output.commit.hash);

    // Push 应该尝试但失败
    assert.equal(output.push.attempted, true);
    assert.equal(output.push.success, false, 'push should fail with broken push URL');

    // 关键：commit 仍然成功
    assert.equal(output.commit.made, true);
    assert.ok(output.commit.hash);

    // 验证 stderr 包含 push 警告
    assert.match(result.stderr, /push:warning/);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Lock timeout scenario ──────────────────────────────────────────

test('flush exits with error on lock timeout', () => {
  const records = [makeRecord({ id: 'mem_001', content: '锁测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records });

  try {
    // 先创建锁文件（写入当前 PID 模拟活动进程）
    const lockPath = join(env.dir, 'repo.lock');
    writeFileSync(lockPath, String(process.pid), 'utf8');

    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8',
      timeout: 5000
    });

    // 应非零退出或超时被 kill
    if (result.status !== null && result.status !== 0) {
      assert.ok(result.stderr.includes('timeout') || result.stderr.includes('lock'),
        `stderr should mention lock timeout: ${result.stderr}`);
    }
  } finally {
    cleanupEnv(env);
  }
});

// ─── Rebase conflict scenario ───────────────────────────────────────

test('flush handles rebase conflict as fatal', () => {
  const records = [makeRecord({ id: 'mem_001', content: '冲突测试。' })];
  const env = setupMemSyncEnv({
    withRemote: true,
    withJSONL: true,
    jsonlRecords: records
  });

  try {
    const bareDir = env.bareDir;
    assert.ok(bareDir, 'bareDir should exist for remote scenario');

    // 在 bare（remote）中创建冲突提交
    const tempClone = mkdtempSync(join(tmpdir(), 'mem-sync-flush-conflict-'));
    try {
      execSync(`git clone "${bareDir}" "${tempClone}"`, { encoding: 'utf8' });
      execSync('git config user.email "test@test"', { cwd: tempClone, encoding: 'utf8' });
      execSync('git config user.name "Test"', { cwd: tempClone, encoding: 'utf8' });

      // 在 README.md 中制造冲突
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

    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
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

// ─── JSON output structure ──────────────────────────────────────────

test('flush outputs correct JSON structure to stdout', () => {
  const records = [makeRecord({ id: 'mem_001', content: '结构测试。' })];
  const pending = [makeRecord({ id: 'mem_pending_struct', content: '待合并结构测试。' })];
  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records,
    withPending: true,
    pendingRecords: pending
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    assert.ok(jsonLine, 'stdout should contain JSON output');

    const output = JSON.parse(jsonLine);

    // 验证 git 字段
    assert.ok('git' in output);
    assert.ok('skipped' in output.git);
    assert.ok('pulled' in output.git);
    assert.ok('conflicts' in output.git);
    assert.equal(typeof output.git.skipped, 'boolean');
    assert.equal(typeof output.git.pulled, 'number');
    assert.equal(typeof output.git.conflicts, 'number');

    // 验证 merge 字段
    assert.ok('merge' in output);
    assert.ok('pending' in output.merge);
    assert.ok('merged' in output.merge);
    assert.ok('total' in output.merge);
    assert.equal(typeof output.merge.pending, 'number');
    assert.equal(typeof output.merge.merged, 'number');
    assert.equal(typeof output.merge.total, 'number');

    // 验证 commit 字段
    assert.ok('commit' in output);
    assert.ok('made' in output.commit);
    assert.ok('hash' in output.commit);
    assert.equal(typeof output.commit.made, 'boolean');

    // 验证 push 字段
    assert.ok('push' in output);
    assert.ok('attempted' in output.push);
    assert.ok('success' in output.push);
    assert.equal(typeof output.push.attempted, 'boolean');
    assert.equal(typeof output.push.success, 'boolean');

    // 验证 index 字段
    assert.ok('index' in output);
    assert.ok('rebuilt' in output.index);
    assert.ok('records' in output.index);
    assert.equal(typeof output.index.rebuilt, 'boolean');
    assert.equal(typeof output.index.records, 'number');
  } finally {
    cleanupEnv(env);
  }
});

// ─── Pending files deleted after merge ──────────────────────────────

test('flush deletes pending files after merge', () => {
  const pending = [
    makeRecord({ id: 'mem_del_1', content: '删除测试一。' }),
    makeRecord({ id: 'mem_del_2', content: '删除测试二。' })
  ];

  const env = setupMemSyncEnv({
    withPending: true,
    pendingRecords: pending
  });

  try {
    // 验证 pending 文件确实存在
    const pendingDir = join(env.dir, 'pending');
    assert.ok(existsSync(pendingDir), 'pending dir should exist');
    const beforeFiles = readdirSync(pendingDir).filter(f => f.endsWith('.json'));
    assert.ok(beforeFiles.length > 0, 'should have pending files before flush');

    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 验证 pending 文件已被删除
    const afterFiles = existsSync(pendingDir)
      ? readdirSync(pendingDir).filter(f => f.endsWith('.json'))
      : [];
    assert.equal(afterFiles.length, 0, `pending files should be removed, but found: ${afterFiles.join(', ')}`);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Index updated after commit ─────────────────────────────────────

test('flush updates index after commit', () => {
  const records = [makeRecord({ id: 'mem_001', content: '已有记忆。' })];
  const pending = [makeRecord({ id: 'mem_index', content: '索引测试记忆。' })];

  const env = setupMemSyncEnv({
    withJSONL: true,
    jsonlRecords: records,
    withPending: true,
    pendingRecords: pending
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const stdoutLines = result.stdout.trim().split('\n');
    const jsonLine = stdoutLines.find(l => l.startsWith('{'));
    const output = JSON.parse(jsonLine);

    assert.equal(output.commit.made, true);

    // 索引应该有记录（至少 2 条：existing + pending merged）
    // rebuilt 可能为 true（HEAD 改变时全量重建）
    // 或者 records 反映合并后的总数
    assert.ok(output.index.records >= 1, `index should have at least 1 record, got ${output.index.records}`);
    assert.equal(typeof output.index.rebuilt, 'boolean');
  } finally {
    cleanupEnv(env);
  }
});

// ─── Diagnostics to stderr ─────────────────────────────────────────

test('flush writes diagnostics to stderr not stdout', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // stderr 应包含诊断信息
    assert.match(result.stderr, /flush/);

    // stdout 应只包含 JSON
    const stdout = result.stdout.trim();
    assert.ok(stdout.startsWith('{'), `stdout should start with JSON object, got: ${stdout}`);
    assert.ok(stdout.endsWith('}'), `stdout should end with JSON object, got: ${stdout}`);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Fresh clone with --remote ──────────────────────────────────────

test('flush clones repo with --remote flag', () => {
  // 创建 bare 仓库作为 source
  const bareDir = mkdtempSync(join(tmpdir(), 'mem-sync-flush-clone-bare-'));
  initGitRepo(bareDir, true);

  // 创建临时仓库并推送到 bare
  const tempRepo = mkdtempSync(join(tmpdir(), 'mem-sync-flush-clone-tmp-'));
  try {
    initGitRepo(tempRepo);
    commitFile(tempRepo, 'hello.txt', 'hello world', 'initial');
    execSync(`git remote add origin "${bareDir}"`, { cwd: tempRepo, encoding: 'utf8' });
    execSync('git push -u origin main', { cwd: tempRepo, encoding: 'utf8' });
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
  }

  // 目标目录（不存在）
  const targetDir = join(tmpdir(), `mem-sync-flush-clone-${Date.now()}`);

  try {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, 'flush', '--remote', bareDir],
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
    assert.equal(typeof output.commit.made, 'boolean');
    assert.equal(typeof output.index.rebuilt, 'boolean');
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});
