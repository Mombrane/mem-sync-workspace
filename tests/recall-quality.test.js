import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：创建隔离的 MEM_SYNC_HOME 临时目录并写入 JSONL 测试数据。
 */
async function setupTestEnv(records) {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'mem-sync-recall-quality-'));
  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(memSyncHome, 'memories.jsonl'), lines, 'utf8');
  return memSyncHome;
}

/**
 * 辅助函数：创建标准的 v1 记忆记录。
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
 * 辅助函数：在指定目录中创建索引（调用 CLI index rebuild）。
 */
function rebuildIndex(memSyncHome) {
  return spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Supersedes 排除
// ══════════════════════════════════════════════════════════════════════════════

test('supersedes 排除 — 当 A 和 B 都在结果中时，B 被排除', async () => {
  // A supersedes B，两者内容相似 → FTS 查询两者都命中
  const records = [
    makeRecord({
      id: 'mem_A',
      canonicalKey: 'episode:global:::supersede_a',
      content: 'Python 是常用的脚本语言适合快速开发原型验证',
      summary: 'Python 脚本快速开发',
      confidence: 1.0,
      importance: 0.8,
      supersedes: ['mem_B']
    }),
    makeRecord({
      id: 'mem_B',
      canonicalKey: 'episode:global:::supersede_b',
      content: 'Python 是常用的脚本语言可以快速开发项目测试',
      summary: 'Python 脚本快速开发',
      confidence: 0.9,
      importance: 0.7
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python 脚本', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.count >= 1, 'should have at least 1 result');

    const ids = output.results.map(r => r.memory.id);
    // A 应在结果中
    assert.ok(ids.includes('mem_A'), 'mem_A（superseder）应在结果中');
    // B 应被排除，因为 A supersedes B 且两者都在结果中
    assert.equal(ids.includes('mem_B'), false, 'mem_B 被 superseded，应从结果中排除');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

test('supersedes 排除 — 当 A 不在结果中时，B 保持', async () => {
  // A supersedes B，但 A 的内容完全不同 → 查询仅匹配 B
  const records = [
    makeRecord({
      id: 'mem_A',
      canonicalKey: 'episode:global:::supersede_a_only',
      content: 'Rust 是系统编程语言注重内存安全和并发性能优化',
      summary: 'Rust 系统编程',
      confidence: 1.0,
      importance: 0.8,
      supersedes: ['mem_B']
    }),
    makeRecord({
      id: 'mem_B',
      canonicalKey: 'episode:global:::supersede_b_only',
      content: 'Python 是常用的脚本语言可以快速开发项目',
      summary: 'Python 脚本快速开发',
      confidence: 0.9,
      importance: 0.7
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);

  try {
    // 查询仅匹配 B 的内容（Python），不匹配 A（Rust）
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', 'Python 脚本', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.ok(output.count >= 1, 'should have at least 1 result');

    const ids = output.results.map(r => r.memory.id);
    // B 应在结果中，因为 A 不在当前结果集中 — supersedes 排除不触发
    assert.ok(ids.includes('mem_B'), 'mem_B 应在结果中——A 不在此次搜索结果中');
    // A 不应出现（内容不匹配 Python 查询）
    assert.equal(ids.includes('mem_A'), false, 'mem_A 不应出现——查询不匹配其内容');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Confidence 排序
// ══════════════════════════════════════════════════════════════════════════════

test('confidence 排序 — 高 confidence 排在前面', async () => {
  // 两条内容完全相同的记忆，仅 confidence 不同
  const records = [
    makeRecord({
      id: 'mem_low_conf',
      canonicalKey: 'episode:global:::low_conf',
      content: '使用版本控制系统管理代码变更跟踪和协作开发流程',
      summary: '版本控制代码管理',
      confidence: 0.1,
      importance: 0.5
    }),
    makeRecord({
      id: 'mem_high_conf',
      canonicalKey: 'episode:global:::high_conf',
      content: '使用版本控制系统管理代码变更跟踪和协作开发流程',
      summary: '版本控制代码管理',
      confidence: 1.0,
      importance: 0.5
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '版本控制', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.count, 2, `expected 2 results, got ${output.count}`);

    // 高 confidence 的应在前面：质量分数 = (confidence + importance + veracityScore) / 3
    // mem_high_conf: (1.0 + 0.5 + 1.0) / 3 ≈ 0.833
    // mem_low_conf:  (0.1 + 0.5 + 1.0) / 3 ≈ 0.533
    const ids = output.results.map(r => r.memory.id);
    assert.equal(ids[0], 'mem_high_conf',
      `expected high confidence record first, got ${ids[0]}`);
    assert.equal(ids[1], 'mem_low_conf',
      `expected low confidence record second, got ${ids[1]}`);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Importance 排序
// ══════════════════════════════════════════════════════════════════════════════

test('importance 排序 — 高 importance 排在前面', async () => {
  // 两条内容完全相同的记忆，仅 importance 不同
  const records = [
    makeRecord({
      id: 'mem_low_imp',
      canonicalKey: 'episode:global:::low_imp',
      content: '数据库索引优化可以显著提升查询性能和响应速度',
      summary: '数据库索引优化性能',
      confidence: 0.5,
      importance: 0.1
    }),
    makeRecord({
      id: 'mem_high_imp',
      canonicalKey: 'episode:global:::high_imp',
      content: '数据库索引优化可以显著提升查询性能和响应速度',
      summary: '数据库索引优化性能',
      confidence: 0.5,
      importance: 1.0
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '数据库索引', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.count, 2, `expected 2 results, got ${output.count}`);

    // 高 importance 的应在前面：质量分数 = (confidence + importance + veracityScore) / 3
    // mem_high_imp: (0.5 + 1.0 + 1.0) / 3 ≈ 0.833
    // mem_low_imp:  (0.5 + 0.1 + 1.0) / 3 ≈ 0.533
    const ids = output.results.map(r => r.memory.id);
    assert.equal(ids[0], 'mem_high_imp',
      `expected high importance record first, got ${ids[0]}`);
    assert.equal(ids[1], 'mem_low_imp',
      `expected low importance record second, got ${ids[1]}`);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Veracity 排序
// ══════════════════════════════════════════════════════════════════════════════

test('veracity 排序 — stated 排在 unknown 前面', async () => {
  // 两条内容完全相同的记忆，仅 veracity 不同
  // stated=1.0, unknown=0.3 (from VERACITY_SCORES)
  const records = [
    makeRecord({
      id: 'mem_unknown_ver',
      canonicalKey: 'episode:global:::unknown_ver',
      content: '微服务架构通过服务拆分实现独立部署和弹性扩展能力',
      summary: '微服务架构独立部署',
      confidence: 0.5,
      importance: 0.5,
      veracity: 'unknown'
    }),
    makeRecord({
      id: 'mem_stated_ver',
      canonicalKey: 'episode:global:::stated_ver',
      content: '微服务架构通过服务拆分实现独立部署和弹性扩展能力',
      summary: '微服务架构独立部署',
      confidence: 0.5,
      importance: 0.5,
      veracity: 'stated'
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '微服务架构', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.count, 2, `expected 2 results, got ${output.count}`);

    // veracity=stated (score 1.0) 应在 unknown (score 0.3) 前面
    // mem_stated_ver:  (0.5 + 0.5 + 1.0) / 3 ≈ 0.667
    // mem_unknown_ver: (0.5 + 0.5 + 0.3) / 3 ≈ 0.433
    const ids = output.results.map(r => r.memory.id);
    assert.equal(ids[0], 'mem_stated_ver',
      `expected stated veracity record first, got ${ids[0]}`);
    assert.equal(ids[1], 'mem_unknown_ver',
      `expected unknown veracity record second, got ${ids[1]}`);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. 综合质量排序
// ══════════════════════════════════════════════════════════════════════════════

test('综合质量排序 — 高质量 > 中质量 > 低质量', async () => {
  // 三条内容完全相同的记忆，质量参数不同
  // 质量分数 = (confidence + importance + veracityScore) / 3
  // 高质量: (1.0 + 1.0 + 1.0) / 3 = 1.0    (confidence=1, importance=1, veracity=stated)
  // 中质量: (0.5 + 0.5 + 0.5) / 3 ≈ 0.5    (confidence=0.5, importance=0.5, veracity=inferred)
  // 低质量: (0.1 + 0.1 + 0.3) / 3 ≈ 0.167   (confidence=0.1, importance=0.1, veracity=unknown)
  const records = [
    makeRecord({
      id: 'mem_low_quality',
      canonicalKey: 'episode:global:::low_quality',
      content: '自动化测试是保障软件质量的重要手段包括单元测试和集成测试',
      summary: '自动化测试保障软件质量',
      confidence: 0.1,
      importance: 0.1,
      veracity: 'unknown'
    }),
    makeRecord({
      id: 'mem_mid_quality',
      canonicalKey: 'episode:global:::mid_quality',
      content: '自动化测试是保障软件质量的重要手段包括单元测试和集成测试',
      summary: '自动化测试保障软件质量',
      confidence: 0.5,
      importance: 0.5,
      veracity: 'inferred'
    }),
    makeRecord({
      id: 'mem_high_quality',
      canonicalKey: 'episode:global:::high_quality',
      content: '自动化测试是保障软件质量的重要手段包括单元测试和集成测试',
      summary: '自动化测试保障软件质量',
      confidence: 1.0,
      importance: 1.0,
      veracity: 'stated'
    })
  ];
  const memSyncHome = await setupTestEnv(records);
  rebuildIndex(memSyncHome);

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'recall', '自动化测试', '--format', 'json'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.count, 3, `expected 3 results, got ${output.count}`);

    // 验证排序：高质量 > 中质量 > 低质量
    const ids = output.results.map(r => r.memory.id);
    assert.equal(ids[0], 'mem_high_quality',
      `expected high quality first, got ${ids[0]}`);
    assert.equal(ids[1], 'mem_mid_quality',
      `expected mid quality second, got ${ids[1]}`);
    assert.equal(ids[2], 'mem_low_quality',
      `expected low quality third, got ${ids[2]}`);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
