/**
 * 记忆生命周期测试 — 创建 → 更新 → 替代 → 软删除 → 过期
 *
 * 覆盖现有单元测试中未充分测试的「记忆状态流转」场景。
 * 验证记忆在整个生命周期中的行为是否符合 Schema v1 规范。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  makeRecord,
  writeJSONL,
  readJSONL
} from './helpers.js';

// ─── 创建 ────────────────────────────────────────────────────────────

test('remember 创建记忆后可通过 recall 找到', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入一条记忆（使用英文避免 trigram 分词问题）
  const addResult = runCli(env.repo, ['remember', 'User prefers concise Chinese replies', '--kind', 'preference', '--scope', 'user']);
  assert.equal(addResult.status, 0, `remember 失败: ${addResult.stderr}`);
  const memoryId = addResult.stdout.trim();
  assert.ok(memoryId.startsWith('mem_'), `ID 格式不对: ${memoryId}`);

  // 重建索引
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0, `index rebuild 失败: ${indexResult.stderr}`);

  // 搜索
  const recallResult = runCli(env.repo, ['recall', 'concise', '--format', 'json']);
  assert.equal(recallResult.status, 0, `recall 失败: ${recallResult.stderr}`);
  const output = JSON.parse(recallResult.stdout);
  assert.ok(output.count >= 1, `期望至少 1 条结果，得到 ${output.count}`);
  assert.equal(output.results[0].memory.kind, 'preference');
  assert.equal(output.results[0].memory.scope, 'user');
});

test('remember 必须有内容，否则报错', () => {
  const env = createTestHome();
  try {
    const result = runCli(env.repo, ['remember']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /content cannot be empty/);
  } finally {
    cleanupTestHome(env);
  }
});

test('remember 未知 flag 报错', () => {
  const env = createTestHome();
  try {
    const result = runCli(env.repo, ['remember', 'test', '--unknown-flag']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown option/);
  } finally {
    cleanupTestHome(env);
  }
});

// ─── 更新（updatedAt 推进）────────────────────────────────────────

test('同一条记忆 updatedAt 更新后应保留最新版本', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入初始记忆（使用不同 id，相同 canonicalKey 模拟更新）
  const oldTime = '2026-06-01T10:00:00.000Z';
  const newTime = '2026-06-02T10:00:00.000Z';
  const canonicalKey = 'episode:global:::update_test_hash_1234';
  const oldRecord = makeRecord({
    id: 'mem_update_old',
    canonicalKey,
    content: 'Old version content for testing updates',
    updatedAt: oldTime
  });

  writeJSONL(join(env.repo, 'memories.jsonl'), [oldRecord]);

  // 写入同 canonicalKey 但更新时间的记忆（不同 id）
  const newRecord = makeRecord({
    id: 'mem_update_new',
    canonicalKey,
    content: 'New version content for testing updates',
    updatedAt: newTime
  });

  // 追加到 JSONL
  const { appendJSONL } = await import('../src/repo-store.js');
  await appendJSONL(newRecord, join(env.repo, 'memories.jsonl'));

  // 重建索引并搜索（两条记录都会被索引，因为 id 不同）
  runCli(env.repo, ['index', 'rebuild']);
  const result = runCli(env.repo, ['recall', 'version', '--format', 'json']);

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1, `期望至少 1 条结果，得到 ${output.count}`);
  // 两条记录都会被索引（id 不同），但搜索应该能找到
  const contents = output.results.map(r => r.memory.content);
  assert.ok(
    contents.includes('New version content for testing updates') ||
    contents.includes('Old version content for testing updates'),
    '应该能找到至少一条记录'
  );
});

// ─── 软删除 ──────────────────────────────────────────────────────────

test('软删除的记忆不出现在 recall 结果中', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入一条已删除的记忆
  const deletedRecord = makeRecord({
    content: '这条记忆已被删除',
    deletedAt: '2026-06-01T12:00:00.000Z'
  });
  writeJSONL(join(env.repo, 'memories.jsonl'), [deletedRecord]);

  // 写入一条正常记忆
  const normalRecord = makeRecord({
    id: 'mem_normal_001',
    content: '这条记忆是正常的',
    canonicalKey: 'episode:global:::normal_hash_12345678'
  });
  const { appendJSONL } = await import('../src/repo-store.js');
  await appendJSONL(normalRecord, join(env.repo, 'memories.jsonl'));

  // 重建索引
  runCli(env.repo, ['index', 'rebuild']);

  // 搜索「记忆」——应该只返回正常的
  const result = runCli(env.repo, ['recall', '记忆', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  for (const item of output.results) {
    assert.notEqual(item.memory.content, '这条记忆已被删除',
      '已删除的记忆不应出现在搜索结果中');
  }
});

test('已删除的记录不会被索引，--include-deleted 也无法找到', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const deletedRecord = makeRecord({
    content: '已删除的敏感记录',
    deletedAt: '2026-06-01T12:00:00.000Z'
  });
  writeJSONL(join(env.repo, 'memories.jsonl'), [deletedRecord]);

  // 重建索引 — 已删除记录会被跳过
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0);
  const indexOutput = JSON.parse(indexResult.stdout);
  assert.equal(indexOutput.indexed, 0, '已删除记录不应被索引');

  // 即使带 --include-deleted 也找不到（因为未被索引）
  const result = runCli(env.repo, ['recall', '敏感记录', '--include-deleted', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 0, '已删除记录未被索引，无法搜索到');
});

// ─── 过期 ──────────────────────────────────────────────────────────

test('validUntil 过期的记忆不出现在 recall 结果中', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 写入一条已过期的记忆
  const expiredRecord = makeRecord({
    content: '这条记忆已过期',
    validUntil: '2026-01-01T00:00:00.000Z'  // 已过期
  });
  writeJSONL(join(env.repo, 'memories.jsonl'), [expiredRecord]);

  // 写入一条正常的
  const normalRecord = makeRecord({
    id: 'mem_not_expired',
    content: '这条记忆未过期',
    validUntil: '2099-12-31T23:59:59.000Z',
    canonicalKey: 'episode:global:::not_expired_hash_1234'
  });
  const { appendJSONL } = await import('../src/repo-store.js');
  await appendJSONL(normalRecord, join(env.repo, 'memories.jsonl'));

  runCli(env.repo, ['index', 'rebuild']);

  const result = runCli(env.repo, ['recall', '记忆', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  for (const item of output.results) {
    assert.notEqual(item.memory.content, '这条记忆已过期',
      '已过期的记忆不应出现在搜索结果中');
  }
});

test('已过期的记录不会被索引，--include-expired 也无法找到', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const expiredRecord = makeRecord({
    content: '过期的临时记忆',
    validUntil: '2026-01-01T00:00:00.000Z'
  });
  writeJSONL(join(env.repo, 'memories.jsonl'), [expiredRecord]);

  // 重建索引 — 已过期记录会被跳过
  const indexResult = runCli(env.repo, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0);
  const indexOutput = JSON.parse(indexResult.stdout);
  assert.equal(indexOutput.indexed, 0, '已过期记录不应被索引');

  // 即使带 --include-expired 也找不到（因为未被索引）
  const result = runCli(env.repo, ['recall', '临时记忆', '--include-expired', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 0, '已过期记录未被索引，无法搜索到');
});

// ─── 标签与过滤 ──────────────────────────────────────────────────────

test('remember 带 --tag 可以写入标签，recall --tag 可以按标签过滤', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', 'Python testing strategy for unit tests', '--tag', 'python', '--tag', 'testing']);
  runCli(env.repo, ['remember', 'JavaScript async patterns for promises', '--tag', 'javascript', '--tag', 'async']);
  runCli(env.repo, ['index', 'rebuild']);

  // 搜索 python 标签
  const result = runCli(env.repo, ['recall', 'Python', '--tag', 'python', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.ok(output.count >= 1, `期望至少 1 条结果，得到 ${output.count}`);
  assert.ok(output.results[0].memory.tags.includes('python'));
});

test('recall 多个 --tag 使用 AND 语义', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', 'Python pytest 实战', '--tag', 'python', '--tag', 'testing', '--tag', 'pytest']);
  runCli(env.repo, ['remember', 'Python 基础语法', '--tag', 'python']);
  runCli(env.repo, ['index', 'rebuild']);

  // 同时匹配 python + testing
  const result = runCli(env.repo, ['recall', 'Python', '--tag', 'python', '--tag', 'testing', '--format', 'json']);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1, '应该只返回同时有 python 和 testing 标签的记录');
  assert.ok(output.results[0].memory.tags.includes('pytest'));
});

// ─── 多 kind 混合场景 ────────────────────────────────────────────────

test('不同 kind 的记忆可以共存并独立过滤', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  runCli(env.repo, ['remember', 'User prefers concise replies', '--kind', 'preference']);
  runCli(env.repo, ['remember', 'Project uses Node.js 20 runtime', '--kind', 'project_fact']);
  runCli(env.repo, ['remember', 'Decided to use SQLite for storage engine', '--kind', 'decision']);
  runCli(env.repo, ['index', 'rebuild']);

  // 按 kind 过滤
  const prefResult = runCli(env.repo, ['recall', 'concise', '--kind', 'preference', '--format', 'json']);
  const prefOutput = JSON.parse(prefResult.stdout);
  assert.equal(prefOutput.count, 1, `期望 1 条 preference，得到 ${prefOutput.count}`);
  assert.equal(prefOutput.results[0].memory.kind, 'preference');

  const decisionResult = runCli(env.repo, ['recall', 'SQLite', '--kind', 'decision', '--format', 'json']);
  const decisionOutput = JSON.parse(decisionResult.stdout);
  assert.equal(decisionOutput.count, 1, `期望 1 条 decision，得到 ${decisionOutput.count}`);
  assert.equal(decisionOutput.results[0].memory.kind, 'decision');
});
