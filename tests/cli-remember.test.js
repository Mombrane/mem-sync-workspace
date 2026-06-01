import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：创建隔离的 MEM_SYNC_HOME 临时目录。
 */
async function setupTestEnv() {
  return mkdtemp(join(tmpdir(), 'mem-sync-cli-remember-'));
}

/**
 * 辅助函数：读取 JSONL 文件中的记录。
 */
async function readJSONLFile(dir) {
  const raw = await readFile(join(dir, 'memories.jsonl'), 'utf8');
  return raw.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

// ─── 默认值测试 ─────────────────────────────────────────────────────

test('remember "hello world" uses defaults (kind=episode, scope=global)', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', 'hello world'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /^mem_/, 'stdout should output mem_ id');

    // 验证 JSONL 中的记录
    const records = await readJSONLFile(memSyncHome);
    assert.equal(records.length, 1);
    assert.equal(records[0].content, 'hello world');
    assert.equal(records[0].kind, 'episode');
    assert.equal(records[0].scope, 'global');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 显式 kind/scope 测试 ────────────────────────────────────────────

test('remember with --kind and --scope applies them to the record', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '用户偏好暗色主题',
      '--kind', 'preference',
      '--scope', 'user'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'preference');
    assert.equal(records[0].scope, 'user');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 可重复 --tag 测试 ───────────────────────────────────────────────

test('remember with repeatable --tag accumulates all tags', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', 'Python 测试框架偏好',
      '--tag', 'python',
      '--tag', 'testing'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.deepEqual(records[0].tags, ['python', 'testing']);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 数值字段测试 ────────────────────────────────────────────────────

test('remember with --confidence and --importance parses and validates them', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '高置信度决策',
      '--confidence', '0.8',
      '--importance', '0.9'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records[0].confidence, 0.8);
    assert.equal(records[0].importance, 0.9);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 字符串 ID 字段测试 ──────────────────────────────────────────────

test('remember with --project-id and --agent-id passes them through', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '项目使用 React 19',
      '--project-id', 'myproject',
      '--agent-id', 'claude'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records[0].projectId, 'myproject');
    assert.equal(records[0].agentId, 'claude');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── source 对象构建测试 ─────────────────────────────────────────────

test('remember with --source-type and --source-agent constructs source object', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '从 agent 获取的信息',
      '--source-type', 'agent',
      '--source-agent', 'codex'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records[0].source.type, 'agent');
    assert.equal(records[0].source.agent, 'codex');
    // 来源为 agent 时，confidence 默认为 0.5
    assert.equal(records[0].confidence, 0.5);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── valid-until 时间戳测试 ───────────────────────────────────────────

test('remember with --valid-until accepts ISO timestamp', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '临时有效的备忘录',
      '--valid-until', '2027-01-01T00:00:00.000Z'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records[0].validUntil, '2027-01-01T00:00:00.000Z');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── summary 覆盖测试 ─────────────────────────────────────────────────

test('remember with --summary overrides auto-generated summary', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '这是一段很长的内容，用于验证自定义摘要覆盖默认截断行为',
      '--summary', '自定义摘要'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records[0].summary, '自定义摘要');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 可重复 --supersedes 测试 ────────────────────────────────────────

test('remember with repeatable --supersedes accumulates supersedes IDs', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '更新后的记忆',
      '--supersedes', 'mem_abc',
      '--supersedes', 'mem_def'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.deepEqual(records[0].supersedes, ['mem_abc', 'mem_def']);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 空内容错误测试 ──────────────────────────────────────────────────

test('remember with empty content exits with code 1', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', ''
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1 for empty content');
    assert.match(result.stderr, /content cannot be empty/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 无效 kind 测试 ───────────────────────────────────────────────────

test('remember with invalid --kind exits with code 1', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '测试内容',
      '--kind', 'invalid_kind'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1 for invalid kind');
    assert.match(result.stderr, /must be one of/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 范围外 confidence 测试 ──────────────────────────────────────────

test('remember with out-of-range --confidence exits with code 1', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '测试内容',
      '--confidence', '1.5'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be between 0 and 1/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 非数值 confidence 测试 ──────────────────────────────────────────

test('remember with non-numeric --confidence exits with code 1', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '测试内容',
      '--confidence', 'notanumber'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be a number/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 未知标志测试 ────────────────────────────────────────────────────

test('remember with unknown flag exits with code 1', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '测试内容',
      '--unknown-flag', 'value'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown option/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 诊断日志到 stderr 测试 ──────────────────────────────────────────

test('remember emits schema diagnostics to stderr, memory id to stdout', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '诊断日志测试',
      '--scope', 'user'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    // 诊断日志到 stderr
    assert.match(result.stderr, /\[mem-sync:schema\] normalize:start/);
    assert.match(result.stderr, /\[mem-sync:schema\] validate:ok/);
    assert.match(result.stderr, /\[mem-sync:store\] memory:accepted/);
    // stdout 仅包含记忆 ID
    assert.match(result.stdout, /^mem_/);
    assert.doesNotMatch(result.stdout, /\[mem-sync:/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 结果写入 JSONL 文件测试 ──────────────────────────────────────────

test('remember result appears in JSONL file after command', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    spawnSync(process.execPath, [
      CLI_PATH, 'remember', 'JSONL 持久化测试内容',
      '--kind', 'decision',
      '--scope', 'project'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records.length, 1);
    assert.equal(records[0].content, 'JSONL 持久化测试内容');
    assert.equal(records[0].kind, 'decision');
    assert.equal(records[0].schemaVersion, 1);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 内容规范化测试 ──────────────────────────────────────────────────

test('remember normalizes whitespace in content', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'remember', '  hello   world  '
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readJSONLFile(memSyncHome);
    assert.equal(records[0].content, 'hello world');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
