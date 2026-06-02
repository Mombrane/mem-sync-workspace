/**
 * 端到端往返测试 — remember → store → index → recall
 *
 * 验证完整的数据流是否正确：CLI 写入 → JSONL 存储 → FTS 索引 → 召回。
 * 这是 mem-sync 最核心的使用路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  readJSONL
} from './helpers.js';

// ─── 完整往返 ────────────────────────────────────────────────────────

test('完整往返：remember → JSONL 存储 → index rebuild → recall', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // Step 1: 写入多条记忆
  const memories = [
    { content: '用户喜欢简洁的中文回复', kind: 'preference', scope: 'user' },
    { content: '项目使用 TypeScript 5.0', kind: 'project_fact', scope: 'project' },
    { content: '测试策略采用 pytest + snapshot', kind: 'workflow', scope: 'project' },
    { content: '部署流程需要先跑 CI 再 merge', kind: 'decision', scope: 'project' },
    { content: 'API 设计遵循 RESTful 规范', kind: 'project_fact', scope: 'project' },
  ];

  for (const mem of memories) {
    const result = runCli(env.repo, ['remember', mem.content, '--kind', mem.kind, '--scope', mem.scope]);
    assert.equal(result.status, 0, `remember 失败: ${result.stderr}`);
  }

  // Step 2: 验证 JSONL 文件已创建且有 5 条记录
  const jsonlPath = join(env.repo, 'memories.jsonl');
  assert.ok(existsSync(jsonlPath), 'JSONL 文件应该已创建');
  const records = readJSONL(jsonlPath);
  assert.equal(records.length, 5, `期望 5 条记录，得到 ${records.length}`);

  // Step 3: 验证每条记录都符合 Schema v1
  for (const record of records) {
    assert.equal(record.schemaVersion, 1);
    assert.ok(record.id.startsWith('mem_'), `ID 格式错误: ${record.id}`);
    assert.ok(record.canonicalKey, 'canonicalKey 不能为空');
    assert.ok(record.content, 'content 不能为空');
    assert.ok(record.createdAt, 'createdAt 不能为空');
    assert.ok(record.updatedAt, 'updatedAt 不能为空');
  }

  // Step 4: 重建索引
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0, `index rebuild 失败: ${indexResult.stderr}`);
  const indexOutput = JSON.parse(indexResult.stdout);
  assert.equal(indexOutput.indexed, 5, `期望索引 5 条，得到 ${indexOutput.indexed}`);

  // Step 5: 通过 recall 验证每条记忆都能被搜到
  for (const mem of memories) {
    // 取内容前几个字作为搜索词
    const query = mem.content.slice(0, 4);
    const recallResult = runCli(env.repo, ['recall', query, '--format', 'json']);
    assert.equal(recallResult.status, 0, `recall "${query}" 失败: ${recallResult.stderr}`);
    const output = JSON.parse(recallResult.stdout);
    assert.ok(output.count >= 1, `recall "${query}" 应该至少有 1 条结果`);
  }
});

test('list 命令可以列出所有记忆', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', '记忆一']);
  runCli(env.repo, ['remember', '记忆二']);
  runCli(env.repo, ['remember', '记忆三']);

  const result = runCli(env.repo, ['list']);
  assert.equal(result.status, 0);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 3, `期望 3 行输出，得到 ${lines.length}`);

  // 每行格式: id\tscope\tsource\tcontent
  for (const line of lines) {
    const parts = line.split('\t');
    assert.ok(parts.length >= 4, `list 输出格式不对: ${line}`);
    assert.ok(parts[0].startsWith('mem_'), `ID 格式错误: ${parts[0]}`);
  }
});

test('export 命令输出合法 JSON', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', '导出测试记忆']);

  const result = runCli(env.repo, ['export']);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed.memories), 'export 输出应包含 memories 数组');
  assert.equal(parsed.memories.length, 1);
  assert.equal(parsed.memories[0].content, '导出测试记忆');
});

// ─── 输出格式测试 ────────────────────────────────────────────────────

test('recall --format markdown 输出人类可读格式', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', 'Markdown 格式测试']);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', 'Markdown', '--format', 'markdown']);
  assert.equal(result.status, 0);
  // Markdown 格式应包含标题
  assert.ok(result.stdout.includes('# Recall:'), '应包含标题');
  assert.ok(result.stdout.includes('**Score:**'), '应包含分数');
  assert.ok(result.stdout.includes('**Scope:**'), '应包含 scope');
});

test('recall --format memories 输出 LLM 友好的 [MEMORY] 块', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', 'Memory 块格式测试', '--kind', 'preference']);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', 'Memory', '--format', 'memories']);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('[MEMORY '), '应包含 [MEMORY 开始标签');
  assert.ok(result.stdout.includes('[/MEMORY]'), '应包含 [/MEMORY] 结束标签');
  assert.ok(result.stdout.includes('kind=preference'), '应包含 kind 属性');
});

// ─── 中文搜索精度 ────────────────────────────────────────────────────

test('FTS5 trigram 分词支持中文短语搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', '用户偏好使用 Python 编写自动化脚本']);
  runCli(env.repo, ['remember', '项目采用微服务架构设计']);
  runCli(env.repo, ['remember', '数据库使用 PostgreSQL 存储用户数据']);
  runCli(env.repo, ['index', 'rebuild']);

  // 搜索「自动化」
  const r1 = runCli(env.repo, ['recall', '自动化', '--format', 'json']);
  const o1 = JSON.parse(r1.stdout);
  assert.ok(o1.count >= 1, '中文「自动化」应该有结果');

  // 搜索「微服务」
  const r2 = runCli(env.repo, ['recall', '微服务', '--format', 'json']);
  const o2 = JSON.parse(r2.stdout);
  assert.ok(o2.count >= 1, '中文「微服务」应该有结果');

  // 搜索「PostgreSQL」
  const r3 = runCli(env.repo, ['recall', 'PostgreSQL', '--format', 'json']);
  const o3 = JSON.parse(r3.stdout);
  assert.ok(o3.count >= 1, '英文「PostgreSQL」应该有结果');
});

// ─── 空仓库场景 ──────────────────────────────────────────────────────

test('空仓库 recall 应该优雅返回空结果', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 先建索引（空的）
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '不存在的内容', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 0, '空仓库应该返回 0 条结果');
});

test('未建索引时 recall 应该给出友好提示', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 不建索引，直接 recall
  const result = runCli(env.repo, ['recall', '测试', '--format', 'markdown']);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('Index not built'), '应提示索引未构建');
});
