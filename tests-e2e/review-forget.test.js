/**
 * Review 与 Forget 工作流测试
 *
 * 验证 pending 记录的审查和记忆的遗忘/归档流程。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  makeRecord,
  writeJSONL,
  readJSONL
} from './helpers.js';

// ─── Review 命令 ─────────────────────────────────────────────────────

test('review pending 显示 pending 目录中的待合并记录', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 创建 pending 记录
  const pendingDir = join(env.repo, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makeRecord({
      id: 'mem_review_001',
      content: '待审查的偏好记录',
      kind: 'preference',
      scope: 'user'
    }),
    makeRecord({
      id: 'mem_review_002',
      content: '待审查的决策记录',
      kind: 'decision',
      scope: 'project',
      canonicalKey: 'decision:project:::review_hash_23456789'
    }),
  ];
  writeJSONL(join(pendingDir, 'device-001.jsonl'), records);

  // 运行 review（review 命令需要 --repo 参数指定路径）
  const result = runCli(env.repo, ['review', 'pending', '--repo', env.repo]);
  assert.equal(result.status, 0, `review 失败: ${result.stderr}`);

  // 验证输出包含记录信息
  assert.ok(result.stdout.includes('preference'), '应该显示 preference 类型');
  assert.ok(result.stdout.includes('decision'), '应该显示 decision 类型');
  assert.ok(result.stdout.includes('待审查'), '应该显示记录内容');
});

test('review pending --kind 按类型过滤', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const pendingDir = join(env.repo, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const records = [
    makeRecord({
      id: 'mem_pref',
      content: '偏好记录',
      kind: 'preference',
      canonicalKey: 'preference:global:::pref_hash_12345678'
    }),
    makeRecord({
      id: 'mem_dec',
      content: '决策记录',
      kind: 'decision',
      canonicalKey: 'decision:global:::dec_hash_123456789'
    }),
  ];
  writeJSONL(join(pendingDir, 'device-001.jsonl'), records);

  // 只看 preference（review 命令需要 --repo 参数指定路径）
  const result = runCli(env.repo, ['review', 'pending', '--kind', 'preference', '--repo', env.repo]);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('preference'), '应该显示 preference');
  assert.ok(!result.stdout.includes('决策记录'), '不应该显示 decision 记录');
});

test('review pending --full 显示完整内容', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const pendingDir = join(env.repo, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const longContent = '这是一段很长的记忆内容'.repeat(20);
  writeJSONL(join(pendingDir, 'device-001.jsonl'), [
    makeRecord({ id: 'mem_long', content: longContent })
  ]);

  // 不带 --full（应该截断）
  const resultShort = runCli(env.repo, ['review', 'pending', '--repo', env.repo]);
  assert.equal(resultShort.status, 0);

  // 带 --full（应该完整显示）
  const resultFull = runCli(env.repo, ['review', 'pending', '--full', '--repo', env.repo]);
  assert.equal(resultFull.status, 0);
  assert.ok(resultFull.stdout.length >= resultShort.stdout.length,
    '--full 输出应该更长或相等');
});

test('review pending 无记录时显示友好提示', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const result = runCli(env.repo, ['review', 'pending', '--repo', env.repo]);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('No pending records'), '应该提示无记录');
});

// ─── Forget 命令 ─────────────────────────────────────────────────────

test('forget 软删除指定记忆', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入记忆
  runCli(env.repo, ['remember', '这是一条要被遗忘的记忆']);
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(records.length, 1);
  const memoryId = records[0].id;

  // 遗忘
  const forgetResult = runCli(env.repo, ['forget', memoryId, '--reason', '不再需要']);
  assert.equal(forgetResult.status, 0, `forget 失败: ${forgetResult.stderr}`);

  // 验证记录被标记为 deletedAt
  const afterRecords = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(afterRecords.length, 1, '记录应该仍然存在（软删除）');
  assert.ok(afterRecords[0].deletedAt, 'deletedAt 应该被设置');
});

test('forget 后 recall 找不到该记忆', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入两条记忆
  runCli(env.repo, ['remember', 'This memory will be forgotten']);
  runCli(env.repo, ['remember', 'This memory will remain']);

  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(records.length, 2);

  // 遗忘第一条
  runCli(env.repo, ['forget', records[0].id]);

  // 重建索引
  runCli(env.repo, ['index', 'rebuild']);

  // 搜索 — 应该只找到第二条
  const result = runCli(env.repo, ['recall', 'memory', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1, `应该只有 1 条结果，得到 ${output.count}`);
  assert.ok(output.results[0].memory.content.includes('remain'));
});

test('forget 不存在的 ID 报错', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const result = runCli(env.repo, ['forget', 'mem_nonexistent']);
  assert.notEqual(result.status, 0, 'forget 不存在的 ID 应该失败');
});

// ─── Show 命令 ───────────────────────────────────────────────────────

test('show 显示指定记忆的详情', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入记忆
  runCli(env.repo, ['remember', 'Show 命令测试记忆', '--kind', 'preference']);
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  const memoryId = records[0].id;

  // show
  const result = runCli(env.repo, ['show', memoryId]);
  assert.equal(result.status, 0, `show 失败: ${result.stderr}`);
  assert.ok(result.stdout.includes(memoryId), '应该显示记忆 ID');
  assert.ok(result.stdout.includes('preference'), '应该显示 kind');
});

// ─── Log 命令 ────────────────────────────────────────────────────────

test('log 显示记忆变更历史', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入几条记忆
  runCli(env.repo, ['remember', 'Log 测试记忆 1']);
  runCli(env.repo, ['remember', 'Log 测试记忆 2']);

  // log
  const result = runCli(env.repo, ['log']);
  assert.equal(result.status, 0, `log 失败: ${result.stderr}`);
});

// ─── Status 命令 ─────────────────────────────────────────────────────

test('status 显示仓库状态信息', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入记忆
  runCli(env.repo, ['remember', 'Status 测试记忆']);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['status']);
  assert.equal(result.status, 0, `status 失败: ${result.stderr}`);
});
