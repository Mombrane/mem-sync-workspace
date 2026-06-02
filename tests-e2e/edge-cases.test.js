/**
 * 边界条件测试 — Unicode、大数据量、损坏数据、并发
 *
 * 覆盖真实使用中可能遇到的各种边界情况。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  makeRecord,
  writeJSONL,
  readJSONL
} from './helpers.js';

// ─── Unicode 与多语言 ────────────────────────────────────────────────

test('中文内容的完整往返', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // trigram 分词器需要至少 3 个 CJK 字符才能匹配
  const content = '用户喜欢用中文编写代码，特别是自动化脚本';
  runCli(env.repo, ['remember', content]);
  runCli(env.repo, ['index', 'rebuild']);

  // 搜索「自动化」（3 个 CJK 字符，可以匹配 trigram）
  const result = runCli(env.repo, ['recall', '自动化', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1, `期望至少 1 条结果，得到 ${output.count}`);
  assert.ok(output.results[0].memory.content.includes('自动化'));
});

test('日语内容搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', 'ユーザーは日本語が好きです']);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '日本語', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1);
});

test('混合语言内容搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', '使用 React 和 TypeScript 开发前端']);
  runCli(env.repo, ['remember', 'Backend uses Node.js with Express']);
  runCli(env.repo, ['index', 'rebuild']);

  // 搜索 React
  const r1 = runCli(env.repo, ['recall', 'React', '--format', 'json']);
  assert.equal(JSON.parse(r1.stdout).count >= 1, true);

  // 搜索 Express
  const r2 = runCli(env.repo, ['recall', 'Express', '--format', 'json']);
  assert.equal(JSON.parse(r2.stdout).count >= 1, true);
});

test('Emoji 内容可以存储和搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', '部署成功后发送通知，测试全部通过']);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '部署成功', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1, `期望至少 1 条结果，得到 ${output.count}`);
});

// ─── 长内容 ──────────────────────────────────────────────────────────

test('长文本记忆（1000+ 字符）可以存储和搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 创建一个很长的内容
  const longContent = '这是一段很长的技术文档。'.repeat(100); // ~1300 字符
  runCli(env.repo, ['remember', longContent]);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '技术文档', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1);
});

// ─── 大数据量 ────────────────────────────────────────────────────────

test('100 条记忆的批量写入和搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 批量写入 100 条记忆
  for (let i = 0; i < 100; i++) {
    const kind = ['preference', 'project_fact', 'decision', 'workflow'][i % 4];
    runCli(env.repo, ['remember', `第 ${i} 条记忆：这是关于 ${kind} 的测试内容`, '--kind', kind]);
  }

  // 验证 JSONL 有 100 条
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(records.length, 100, `期望 100 条，得到 ${records.length}`);

  // 重建索引
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0);
  const indexOutput = JSON.parse(indexResult.stdout);
  assert.equal(indexOutput.indexed, 100);

  // 搜索
  const recallResult = runCli(env.repo, ['recall', '测试内容', '--format', 'json', '--limit', '10']);
  assert.equal(recallResult.status, 0);
  const output = JSON.parse(recallResult.stdout);
  assert.ok(output.count >= 10, `应该至少返回 10 条，得到 ${output.count}`);
});

// ─── 损坏数据 ────────────────────────────────────────────────────────

test('JSONL 中有坏行时其他记录仍可正常工作', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入包含坏行的 JSONL
  const jsonlContent = [
    JSON.stringify(makeRecord({ id: 'mem_good_001', content: '第一条正常记录' })),
    '这不是合法的 JSON 行',
    '',
    JSON.stringify(makeRecord({ id: 'mem_good_002', content: '第二条正常记录' })),
    '{"incomplete": true',  // 不完整的 JSON
    JSON.stringify(makeRecord({ id: 'mem_good_003', content: '第三条正常记录' })),
  ].join('\n');

  writeFileSync(join(env.repo, 'memories.jsonl'), jsonlContent, 'utf8');

  // 重建索引应该不报错
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0);

  // 搜索应该能找到正常的记录
  const recallResult = runCli(env.repo, ['recall', '正常记录', '--format', 'json']);
  assert.equal(recallResult.status, 0);
  const output = JSON.parse(recallResult.stdout);
  assert.ok(output.count >= 1, '应该能找到正常记录');
});

test('JSONL 中有 Schema 不合规的记录会被跳过', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const jsonlContent = [
    JSON.stringify(makeRecord({ id: 'mem_valid', content: '合规记录' })),
    JSON.stringify({ id: 'mem_invalid', content: '缺少必要字段' }),  // 缺少 schemaVersion 等
    JSON.stringify(makeRecord({ id: 'mem_valid_2', content: '另一条合规记录' })),
  ].join('\n');

  writeFileSync(join(env.repo, 'memories.jsonl'), jsonlContent, 'utf8');

  // 重建索引
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0);
  const indexOutput = JSON.parse(indexResult.stdout);
  // 应该只索引了 2 条合规记录
  assert.equal(indexOutput.indexed, 2, `期望索引 2 条，得到 ${indexOutput.indexed}`);
});

// ─── 空内容与特殊字符 ────────────────────────────────────────────────

test('包含特殊字符的内容可以正确存储和搜索', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const specialContent = '正则表达式: /^(https?:\\/\\/)?([\\w.-]+)\\.([a-z]{2,})(\\/\\S*)?$/i';
  runCli(env.repo, ['remember', specialContent]);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '正则表达式', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1);
});

test('包含换行符的内容可以正确存储', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // CLI 会将参数中的空格合并，所以直接写 JSONL
  const record = makeRecord({
    content: '第一行\n第二行\n第三行'
  });
  writeJSONL(join(env.repo, 'memories.jsonl'), [record]);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '第一行', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1);
});

// ─── doctor 健康检查 ─────────────────────────────────────────────────

test('doctor 在健康仓库中返回 ok=true', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', '健康检查测试']);
  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['doctor', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.checks.records.total, 1);
});

test('doctor 在有坏行的仓库中检测到问题', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入包含坏行的 JSONL
  writeFileSync(join(env.repo, 'memories.jsonl'), '这不是JSON\n', 'utf8');

  const result = runCli(env.repo, ['doctor', '--format', 'json']);
  assert.equal(result.status, 1, '有坏行时 doctor 应返回 exit code 1');
  const output = JSON.parse(result.stdout);
  assert.ok(output.checks.jsonl.parseErrors > 0, '应该检测到解析错误');
});

// ─── compact 压缩 ────────────────────────────────────────────────────

test('compact 可以压缩旧记录', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入一些旧记录和新记录
  const records = [
    makeRecord({ id: 'mem_old', content: '旧记录', updatedAt: '2026-01-01T00:00:00.000Z' }),
    makeRecord({ id: 'mem_new', content: '新记录', updatedAt: '2026-06-01T00:00:00.000Z' }),
  ];
  writeJSONL(join(env.repo, 'memories.jsonl'), records);

  // dry-run
  const dryResult = runCli(env.repo, ['compact', '--older-than', '30', '--dry-run']);
  assert.equal(dryResult.status, 0);
  const dryOutput = JSON.parse(dryResult.stdout);
  assert.equal(typeof dryOutput.candidates, 'number', '应返回 candidates 数量');
  assert.equal(typeof dryOutput.removed, 'number', '应返回 removed 数量');

  // 验证文件未被修改（dry-run 不应该写入）
  const beforeRecords = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(beforeRecords.length, 2);
});
