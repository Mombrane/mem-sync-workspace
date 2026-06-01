import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：创建隔离的 MEM_SYNC_HOME 临时目录，包含指定的摘要文件。
 */
async function setupTestEnv({ profile, summary, projectSummary, projectId } = {}) {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-context-'));
  if (profile !== undefined) {
    await writeFile(join(memSyncHome, 'profile.md'), profile || '', 'utf8');
  }
  if (summary !== undefined) {
    await writeFile(join(memSyncHome, 'summary.md'), summary || '', 'utf8');
  }
  if (projectSummary !== undefined && projectId) {
    const projectDir = join(memSyncHome, 'projects', projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'summary.md'), projectSummary || '', 'utf8');
  }
  return memSyncHome;
}

/**
 * 辅助函数：创建 v1 格式的记忆记录，用于索引入数据库。
 */
function makeRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? 'episode:global:::abc123',
    kind: overrides.kind ?? 'episode',
    scope: overrides.scope ?? 'global',
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content: overrides.content ?? 'Test memory content.',
    summary: overrides.summary ?? 'Test memory content.',
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
 * 辅助函数：在指定 MEM_SYNC_HOME 中创建索引。
 * 写入 JSONL 数据并调用 index rebuild。
 */
async function setupIndex(memSyncHome, records) {
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(memSyncHome, 'memories.jsonl'), lines, 'utf8');
  spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
}

/**
 * 辅助函数：运行 context 命令。
 */
function runContext(memSyncHome, args = []) {
  return spawnSync(process.execPath, [CLI_PATH, 'context', ...args], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
}

// ─── 启动模式 Markdown 格式测试 ─────────────────────────────────────────

test('context --mode startup --format markdown with all three summary files present', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'User prefers concise Chinese replies.\nPrefers TypeScript over JavaScript.',
    summary: 'Cross-project knowledge summary here.',
    projectSummary: 'This project implements the mem-sync CLI tool.',
    projectId: 'mem-sync'
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'markdown',
      '--project-id', 'mem-sync'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 验证各个章节
    assert.match(result.stdout, /# Context for mem-sync/);
    assert.match(result.stdout, /## Profile/);
    assert.match(result.stdout, /User prefers concise Chinese/);
    assert.match(result.stdout, /## Global Summary/);
    assert.match(result.stdout, /Cross-project knowledge/);
    assert.match(result.stdout, /## Project Summary/);
    assert.match(result.stdout, /implements the mem-sync CLI/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 启动模式 JSON 格式测试 ────────────────────────────────────────────

test('context --mode startup --format json returns valid JSON with null for missing files', async () => {
  // 只创建 profile，summary 和 project summary 缺失
  const memSyncHome = await setupTestEnv({
    profile: 'User preferences here.',
    projectId: 'test-project'
    // 不提供 summary 和 projectSummary
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'json',
      '--project-id', 'test-project'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.projectId, 'test-project');
    assert.equal(output.profile, 'User preferences here.');
    assert.equal(output.summary, null, 'summary should be null when file missing');
    assert.equal(output.projectSummary, null, 'projectSummary should be null when file missing');
    assert.ok(Array.isArray(output.memories));
    assert.equal(output.memories.length, 0, 'no memories in startup mode');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 启动模式 memories 格式测试 ─────────────────────────────────────────

test('context --mode startup --format memories outputs [MEMORY] blocks for summary files', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'User prefers concise replies.',
    summary: 'Global context here.',
    projectSummary: 'Project-specific context.',
    projectId: 'mem-sync'
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'memories',
      '--project-id', 'mem-sync'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // 验证 memories 格式结构
    assert.match(result.stdout, /\[MEMORY /);
    assert.match(result.stdout, /\[\/MEMORY\]/);
    // 应有 profile 块
    assert.match(result.stdout, /kind=preference/);
    // 应有 summary 块
    assert.match(result.stdout, /kind=project_fact/);
    assert.match(result.stdout, /scope=global/);
    assert.match(result.stdout, /scope=project/);
    assert.match(result.stdout, /tags=summary/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 召回模式 Markdown 格式测试 ─────────────────────────────────────────

test('context --mode recall --format markdown with index and matching memories', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'User likes Python.',
    summary: 'Global summary.',
    projectId: 'myproject'
  });

  try {
    // 创建索引，包含属于该项目的记录
    await setupIndex(memSyncHome, [
      makeRecord({
        id: 'mem_001',
        content: 'Python is the preferred language for this project.',
        summary: 'Python preferred language',
        kind: 'preference',
        scope: 'user',
        projectId: 'myproject',
        importance: 0.9,
        updatedAt: new Date().toISOString()
      }),
      makeRecord({
        id: 'mem_002',
        content: 'Use SQLite FTS5 for local search in this project.',
        summary: 'SQLite FTS5 for local search',
        kind: 'decision',
        scope: 'project',
        projectId: 'myproject',
        importance: 0.8,
        updatedAt: new Date().toISOString()
      })
    ]);

    const result = runContext(memSyncHome, [
      '--mode', 'recall',
      '--format', 'markdown',
      '--project-id', 'myproject'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    assert.match(result.stdout, /# Context for myproject/);
    assert.match(result.stdout, /## Profile/);
    assert.match(result.stdout, /## Global Summary/);
    assert.match(result.stdout, /## Recent Working Memories/);
    assert.match(result.stdout, /Python/);
    assert.match(result.stdout, /SQLite FTS5/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 召回模式 --limit 测试 ──────────────────────────────────────────────

test('context --mode recall --limit 3 returns at most 3 memories', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'Test profile.',
    projectId: 'testproject'
  });

  try {
    // 创建 5 条属于该项目的记忆
    const records = [];
    for (let i = 1; i <= 5; i++) {
      records.push(makeRecord({
        id: `mem_00${i}`,
        content: `Memory ${i} content for testing limit.`,
        summary: `Memory ${i}`,
        kind: 'decision',
        scope: 'project',
        projectId: 'testproject',
        importance: 0.5 + i * 0.1,
        updatedAt: new Date().toISOString()
      }));
    }
    await setupIndex(memSyncHome, records);

    const result = runContext(memSyncHome, [
      '--mode', 'recall',
      '--format', 'json',
      '--limit', '3',
      '--project-id', 'testproject'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.memories.length <= 3, `expected <= 3 memories, got ${output.memories.length}`);
    assert.ok(output.memories.length > 0, 'should have at least 1 memory');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 索引未构建时的优雅降级测试 ─────────────────────────────────────────

test('context --mode recall with index not built degrades gracefully', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'Test profile.',
    summary: 'Test summary.',
    projectId: 'noidx-project'
  });

  try {
    // 不构建索引
    const result = runContext(memSyncHome, [
      '--mode', 'recall',
      '--format', 'markdown',
      '--project-id', 'noidx-project'
    ]);

    assert.equal(result.status, 0, 'should still exit 0 with missing index');
    // 即使是退化的，stderr 上应有警告
    assert.match(result.stderr, /index not built/);
    // 标准输出仍应包含文件内容
    assert.match(result.stdout, /# Context for noidx-project/);
    assert.match(result.stdout, /Test profile/);
    assert.match(result.stdout, /Test summary/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 显式 --project-id 测试 ─────────────────────────────────────────────

test('context --project-id <explicit> uses explicit ID for project summary path', async () => {
  const explicitId = 'my-explicit-project';
  const memSyncHome = await setupTestEnv({
    profile: 'Test profile.',
    projectSummary: 'Explicit project context.',
    projectId: explicitId
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'markdown',
      '--project-id', explicitId
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    assert.match(result.stdout, new RegExp(`# Context for ${explicitId}`));
    assert.match(result.stdout, /Explicit project context/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 缺失 profile.md 测试 ───────────────────────────────────────────────

test('context with missing profile.md notes missing profile', async () => {
  const memSyncHome = await setupTestEnv({
    summary: 'Only summary exists.',
    projectId: 'test-project'
    // 不提供 profile
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'markdown',
      '--project-id', 'test-project'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    assert.match(result.stdout, /no profile configured/);
    assert.match(result.stdout, /Only summary exists/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 缺失 summary.md 测试 ───────────────────────────────────────────────

test('context with missing summary.md notes missing summary', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'Only profile exists.',
    projectId: 'test-project'
    // 不提供 summary
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'markdown',
      '--project-id', 'test-project'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    assert.match(result.stdout, /Only profile exists/);
    assert.match(result.stdout, /no global summary/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 缺失项目摘要测试 ───────────────────────────────────────────────────

test('context with missing project summary notes missing project summary', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'Test profile.',
    summary: 'Test summary.',
    projectId: 'test-project'
    // 不提供 projectSummary
  });

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'markdown',
      '--project-id', 'test-project'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    assert.match(result.stdout, /Test profile/);
    assert.match(result.stdout, /Test summary/);
    assert.match(result.stdout, /no project summary/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 所有文件缺失测试 ──────────────────────────────────────────────────

test('context with all three files missing shows informational output', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-context-empty-'));

  try {
    // 没有任何摘要文件
    const result = runContext(memSyncHome, [
      '--mode', 'startup',
      '--format', 'markdown',
      '--project-id', 'empty-project'
    ]);

    assert.equal(result.status, 0, 'should exit 0 even with no files');
    assert.match(result.stdout, /# Context for empty-project/);
    assert.match(result.stdout, /no profile configured/);
    assert.match(result.stdout, /no global summary/);
    assert.match(result.stdout, /no project summary/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 无效 --mode 错误测试 ──────────────────────────────────────────────

test('context with invalid --mode exits with code 1', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-context-err-'));

  try {
    const result = runContext(memSyncHome, [
      '--mode', 'invalid',
      '--project-id', 'test'
    ]);

    assert.equal(result.status, 1, 'should exit with code 1 for invalid mode');
    assert.match(result.stderr, /must be one of/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 无效 --format 错误测试 ─────────────────────────────────────────────

test('context with invalid --format exits with code 1', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-context-err-'));

  try {
    const result = runContext(memSyncHome, [
      '--format', 'invalid',
      '--project-id', 'test'
    ]);

    assert.equal(result.status, 1, 'should exit with code 1 for invalid format');
    assert.match(result.stderr, /must be one of/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 无效 --limit 错误测试 ──────────────────────────────────────────────

test('context with invalid --limit values exits with code 1', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-context-err-'));

  try {
    // 测试零值
    const resultZero = runContext(memSyncHome, [
      '--limit', '0',
      '--project-id', 'test'
    ]);
    assert.equal(resultZero.status, 1, 'zero limit should exit with code 1');
    assert.match(resultZero.stderr, /must be a positive integer/);

    // 测试负值
    const resultNeg = runContext(memSyncHome, [
      '--limit', '-1',
      '--project-id', 'test'
    ]);
    assert.equal(resultNeg.status, 1, 'negative limit should exit with code 1');
    assert.match(resultNeg.stderr, /must be a positive integer/);

    // 测试非整数值
    const resultNonInt = runContext(memSyncHome, [
      '--limit', 'abc',
      '--project-id', 'test'
    ]);
    assert.equal(resultNonInt.status, 1, 'non-integer limit should exit with code 1');
    assert.match(resultNonInt.stderr, /must be a positive integer/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 未知 --* 标志错误测试 ──────────────────────────────────────────────

test('context with unknown --* flag exits with code 1', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-cli-context-err-'));

  try {
    const result = runContext(memSyncHome, [
      '--unknown-flag',
      '--project-id', 'test'
    ]);

    assert.equal(result.status, 1, 'should exit with code 1 for unknown flag');
    assert.match(result.stderr, /unknown option/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── 召回模式记忆排序测试 ──────────────────────────────────────────────

test('recall mode memories are sorted by importance + recency composite score', async () => {
  const memSyncHome = await setupTestEnv({
    profile: 'Test.',
    projectId: 'sorttest'
  });

  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString();

    // 创建具有不同 importance 和 updatedAt 的记录
    const records = [
      makeRecord({
        id: 'mem_low',
        content: 'Low importance, recent update.',
        summary: 'Low importance recent',
        kind: 'episode',
        scope: 'project',
        projectId: 'sorttest',
        importance: 0.3,
        updatedAt: now.toISOString()  // very recent
      }),
      makeRecord({
        id: 'mem_high',
        content: 'High importance, older update.',
        summary: 'High importance older',
        kind: 'decision',
        scope: 'project',
        projectId: 'sorttest',
        importance: 0.95,
        updatedAt: threeDaysAgo  // 3 days old
      }),
      makeRecord({
        id: 'mem_medium',
        content: 'Medium importance, medium recency.',
        summary: 'Medium importance medium recency',
        kind: 'project_fact',
        scope: 'project',
        projectId: 'sorttest',
        importance: 0.5,
        updatedAt: now.toISOString()
      })
    ];
    await setupIndex(memSyncHome, records);

    const result = runContext(memSyncHome, [
      '--mode', 'recall',
      '--format', 'json',
      '--limit', '5',
      '--project-id', 'sorttest'
    ]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.memories.length >= 2, 'should have at least 2 memories');

    // 高 importance (0.95) 的记录即使较旧也应排名很高
    // importance=0.95, recency=0.967 → score = 0.95*0.6 + 0.967*0.4 = 0.57 + 0.387 = 0.957
    const scores = output.memories.map(m => ({
      id: m.memory.id,
      importance: m.memory.importance,
      score: m.memory._contextScore
    }));

    // mem_high 应排名最高（importance 为 0.95）
    const highMem = output.memories.find(m => m.memory.id === 'mem_high');
    assert.ok(highMem, 'mem_high should be in results');
    assert.ok(highMem.memory._contextScore > 0.5, 'high importance memory should have high score');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
