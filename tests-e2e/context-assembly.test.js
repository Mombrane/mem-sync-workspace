/**
 * Context 组装测试 — 验证 context 命令的上下文组装能力
 *
 * context 命令是 LLM agent 启动时的关键入口，
 * 需要验证它在各种数据状态下的输出质量和降级行为。
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
  writeJSONL
} from './helpers.js';

// ─── 三种摘要文件的组装 ──────────────────────────────────────────────

test('context startup 模式组装 profile + summary + project summary', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入 profile.md
  writeFileSync(join(env.repo, 'profile.md'), '# 用户画像\n\n喜欢简洁回复，偏好中文。', 'utf8');

  // 写入 summary.md
  writeFileSync(join(env.repo, 'summary.md'), '# 全局摘要\n\n这是一个 AI 助手的记忆仓库。', 'utf8');

  // 写入项目摘要
  const projectsDir = join(env.repo, 'projects', 'my-project');
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(join(projectsDir, 'summary.md'), '# 项目摘要\n\nmy-project 使用 Node.js 开发。', 'utf8');

  // 运行 context
  const result = runCli(env.repo, [
    'context',
    '--mode', 'startup',
    '--format', 'markdown',
    '--project-id', 'my-project'
  ]);
  assert.equal(result.status, 0, `context 失败: ${result.stderr}`);

  // 验证输出包含三个摘要的内容
  assert.ok(result.stdout.includes('用户画像'), '应包含 profile 内容');
  assert.ok(result.stdout.includes('全局摘要'), '应包含 summary 内容');
  assert.ok(result.stdout.includes('项目摘要'), '应包含 project summary 内容');
});

test('context recall 模式除了摘要还会返回工作记忆', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入摘要文件
  writeFileSync(join(env.repo, 'profile.md'), '用户偏好中文。', 'utf8');

  // 写入一些记忆
  const records = [
    makeRecord({ id: 'mem_ctx_001', content: '最近在做性能优化', importance: 0.9, updatedAt: '2026-06-02T10:00:00.000Z' }),
    makeRecord({ id: 'mem_ctx_002', content: '数据库查询需要加索引', importance: 0.7, updatedAt: '2026-06-01T10:00:00.000Z' }),
  ];
  writeJSONL(join(env.repo, 'memories.jsonl'), records);

  // 重建索引
  runCli(env.repo, ['index', 'rebuild']);

  // 运行 context recall 模式
  const result = runCli(env.repo, [
    'context',
    '--mode', 'recall',
    '--format', 'markdown',
    '--limit', '5'
  ]);
  assert.equal(result.status, 0);

  // 验证包含摘要和工作记忆
  assert.ok(result.stdout.includes('用户偏好中文'), '应包含 profile');
  assert.ok(result.stdout.includes('Recent Working Memories'), '应包含工作记忆标题');
});

// ─── 降级行为 ────────────────────────────────────────────────────────

test('context 在三个摘要文件都缺失时仍能正常输出', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 不写入任何摘要文件
  const result = runCli(env.repo, [
    'context',
    '--mode', 'startup',
    '--format', 'markdown'
  ]);
  assert.equal(result.status, 0);
  // 应该有提示信息但不报错
  assert.ok(result.stdout.includes('no profile configured') || result.stdout.includes('Profile'), '应提示无 profile');
});

test('context 在索引未构建时 recall 模式降级到 startup', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  writeFileSync(join(env.repo, 'profile.md'), '测试用户。', 'utf8');

  // 不建索引，直接用 recall 模式
  const result = runCli(env.repo, [
    'context',
    '--mode', 'recall',
    '--format', 'markdown'
  ]);
  assert.equal(result.status, 0);
  // 应该有 profile 内容但没有工作记忆
  assert.ok(result.stdout.includes('测试用户'), '应包含 profile');
  assert.ok(result.stderr.includes('index not built') || result.stdout.includes('Recent Working Memories'),
    '应提示索引未构建或显示空的工作记忆');
});

// ─── JSON 格式输出 ──────────────────────────────────────────────────

test('context --format json 输出合法 JSON', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  writeFileSync(join(env.repo, 'profile.md'), 'JSON 格式测试。', 'utf8');

  const result = runCli(env.repo, [
    'context',
    '--mode', 'startup',
    '--format', 'json',
    '--project-id', 'test-project'
  ]);
  assert.equal(result.status, 0);

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.projectId, 'test-project');
  assert.ok('profile' in parsed, '应包含 profile 字段');
  assert.ok('summary' in parsed, '应包含 summary 字段');
  assert.ok('projectSummary' in parsed, '应包含 projectSummary 字段');
  assert.ok(Array.isArray(parsed.memories), '应包含 memories 数组');
});

// ─── memories 格式输出（LLM 友好）────────────────────────────────────

test('context --format memories 输出 [MEMORY] 块', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  writeFileSync(join(env.repo, 'profile.md'), 'LLM 格式测试。', 'utf8');

  const result = runCli(env.repo, [
    'context',
    '--mode', 'startup',
    '--format', 'memories'
  ]);
  assert.equal(result.status, 0);

  // profile 应该作为 [MEMORY] 块输出
  assert.ok(result.stdout.includes('[MEMORY '), '应包含 [MEMORY 开始标签');
  assert.ok(result.stdout.includes('[/MEMORY]'), '应包含 [/MEMORY] 结束标签');
  assert.ok(result.stdout.includes('kind=preference'), 'profile 应标记为 preference kind');
});

// ─── importance 排序 ─────────────────────────────────────────────────

test('context recall 模式按 importance + recency 复合分数排序', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const records = [
    makeRecord({
      id: 'mem_low_imp',
      content: '低重要性旧记录',
      importance: 0.2,
      updatedAt: '2026-01-01T00:00:00.000Z'  // 很旧
    }),
    makeRecord({
      id: 'mem_high_imp',
      content: '高重要性新记录',
      importance: 0.95,
      updatedAt: '2026-06-02T00:00:00.000Z'  // 最新
    }),
    makeRecord({
      id: 'mem_mid_imp',
      content: '中等重要性中等时间',
      importance: 0.5,
      updatedAt: '2026-05-01T00:00:00.000Z'
    }),
  ];
  writeJSONL(join(env.repo, 'memories.jsonl'), records);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, [
    'context',
    '--mode', 'recall',
    '--format', 'json',
    '--limit', '3'
  ]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);

  // 高重要性新记录应该排在最前面
  assert.ok(parsed.memories.length >= 1);
  assert.equal(parsed.memories[0].memory.id, 'mem_high_imp',
    '高重要性新记录应该排第一');
});
