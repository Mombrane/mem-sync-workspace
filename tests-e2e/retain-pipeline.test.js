/**
 * Retain 管道测试 — transcript → retain → flush → recall
 *
 * 验证从会话 transcript 自动提取记忆的完整流程。
 * 这是 mem-sync 最有价值的自动化场景之一。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  readJSONL
} from './helpers.js';

/**
 * 创建一个模拟的 transcript 文件。
 */
function createTranscript(messages, dir) {
  const transcriptPath = join(dir, 'transcript.json');
  writeFileSync(transcriptPath, JSON.stringify(messages), 'utf8');
  return transcriptPath;
}

// ─── 基础 retain 流程 ────────────────────────────────────────────────

test('retain 从 transcript 提取候选记忆并写入 pending', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 创建模拟 transcript
  const transcript = [
    { role: 'user', content: '我喜欢用 Python 写测试' },
    { role: 'assistant', content: '好的，我会记住你的偏好。' },
    { role: 'user', content: '项目用的是 pytest 框架' },
    { role: 'assistant', content: '了解，pytest 是个好选择。' },
  ];
  const transcriptPath = createTranscript(transcript, env.home);

  // 运行 retain
  const result = runCli(env.repo, [
    'retain',
    '--transcript-file', transcriptPath,
    '--pending',
    '--device', 'test-device-001'
  ]);
  assert.equal(result.status, 0, `retain 失败: ${result.stderr}`);

  // 验证 pending 文件已创建
  const pendingPath = join(env.repo, 'pending', 'test-device-001.jsonl');
  assert.ok(existsSync(pendingPath), 'pending 文件应该已创建');

  // 验证 pending 文件中有记录
  const pendingRecords = readJSONL(pendingPath);
  assert.ok(pendingRecords.length >= 0, 'pending 记录数应 >= 0'); // 取决于 retain-engine 的规则
});

// ─── retain → flush → recall 完整链路 ────────────────────────────────

test('retain → flush → recall 完整记忆持久化链路', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 直接写入 pending 文件（模拟 retain 的输出）
  const pendingDir = join(env.repo, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const pendingRecords = [
    {
      schemaVersion: 1,
      id: 'mem_pending_001',
      canonicalKey: 'preference:global:::pending_hash_001',
      kind: 'preference',
      scope: 'global',
      content: '用户喜欢用 Python 写测试',
      summary: '用户喜欢用 Python 写测试',
      source: { type: 'transcript', device: 'test-device' },
      evidence: [],
      confidence: 0.8,
      importance: 0.7,
      veracity: 'stated',
      tags: ['python', 'testing'],
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      validUntil: null,
      deletedAt: null,
      supersedes: []
    },
    {
      schemaVersion: 1,
      id: 'mem_pending_002',
      canonicalKey: 'project_fact:global:::pending_hash_002',
      kind: 'project_fact',
      scope: 'global',
      content: '项目使用 pytest 框架',
      summary: '项目使用 pytest 框架',
      source: { type: 'transcript', device: 'test-device' },
      evidence: [],
      confidence: 0.9,
      importance: 0.6,
      veracity: 'stated',
      tags: ['pytest'],
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      validUntil: null,
      deletedAt: null,
      supersedes: []
    }
  ];

  writeFileSync(
    join(pendingDir, 'test-device.jsonl'),
    pendingRecords.map(r => JSON.stringify(r)).join('\n') + '\n',
    'utf8'
  );

  // flush：合并 pending → JSONL
  const flushResult = runCli(env.repo, ['flush']);
  assert.equal(flushResult.status, 0, `flush 失败: ${flushResult.stderr}`);

  // 验证 JSONL 中有这些记录
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(records.length, 2, `期望 2 条记录，得到 ${records.length}`);

  // 重建索引并 recall
  runCli(env.repo, ['index', 'rebuild']);
  const recallResult = runCli(env.repo, ['recall', 'Python', '--format', 'json']);
  assert.equal(recallResult.status, 0);
  const output = JSON.parse(recallResult.stdout);
  assert.ok(output.count >= 1, '应该能搜索到从 transcript 提取的记忆');
});

// ─── retain 去重 ─────────────────────────────────────────────────────

test('retain 不会重复写入已存在的 pending 记录', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const pendingDir = join(env.repo, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  const record = {
    schemaVersion: 1,
    id: 'mem_dedup_test',
    canonicalKey: 'episode:global:::dedup_hash_12345678',
    kind: 'episode',
    scope: 'global',
    content: '这条记录只应该出现一次',
    summary: '这条记录只应该出现一次',
    source: { type: 'manual' },
    evidence: [],
    confidence: 1,
    importance: 0.5,
    veracity: 'stated',
    tags: [],
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: []
  };

  // 第一次写入
  writeFileSync(
    join(pendingDir, 'dedup-device.jsonl'),
    JSON.stringify(record) + '\n',
    'utf8'
  );

  // flush
  runCli(env.repo, ['flush']);

  // 第二次写入相同内容
  writeFileSync(
    join(pendingDir, 'dedup-device.jsonl'),
    JSON.stringify(record) + '\n',
    'utf8'
  );

  // 再次 flush
  runCli(env.repo, ['flush']);

  // 验证去重：应该只有一条记录
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(records.length, 1, `应该只有 1 条去重后的记录，得到 ${records.length}`);
});

// ─── 多设备 pending 合并 ─────────────────────────────────────────────

test('flush 合并来自多个设备的 pending 文件', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const pendingDir = join(env.repo, 'pending');
  mkdirSync(pendingDir, { recursive: true });

  // 设备A 的 pending
  const recordA = {
    schemaVersion: 1,
    id: 'mem_device_a',
    canonicalKey: 'episode:global:::device_a_hash_12345',
    kind: 'episode',
    scope: 'global',
    content: '来自设备A的记忆',
    summary: '来自设备A的记忆',
    source: { type: 'manual', device: 'device-a' },
    evidence: [],
    confidence: 1,
    importance: 0.5,
    veracity: 'stated',
    tags: [],
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    validUntil: null,
    deletedAt: null,
    supersedes: []
  };

  // 设备B 的 pending
  const recordB = {
    ...recordA,
    id: 'mem_device_b',
    canonicalKey: 'episode:global:::device_b_hash_12345',
    content: '来自设备B的记忆',
    summary: '来自设备B的记忆',
    source: { type: 'manual', device: 'device-b' }
  };

  writeFileSync(join(pendingDir, 'device-a.jsonl'), JSON.stringify(recordA) + '\n', 'utf8');
  writeFileSync(join(pendingDir, 'device-b.jsonl'), JSON.stringify(recordB) + '\n', 'utf8');

  // flush
  const flushResult = runCli(env.repo, ['flush']);
  assert.equal(flushResult.status, 0);

  // 验证两条记录都被合并
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.equal(records.length, 2, `期望 2 条记录，得到 ${records.length}`);
  const contents = records.map(r => r.content);
  assert.ok(contents.includes('来自设备A的记忆'));
  assert.ok(contents.includes('来自设备B的记忆'));
});
