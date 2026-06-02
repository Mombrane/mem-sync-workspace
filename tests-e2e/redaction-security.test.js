/**
 * 安全与 Redaction 测试 — 真实敏感信息的拦截验证
 *
 * 使用真实的 API key、token、密码格式测试 redaction-engine 的拦截能力。
 * 验证 mem-sync 在写入前能正确阻止敏感信息。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { redactContent, DEFAULT_PATTERNS } from '../src/redaction-engine.js';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  readJSONL
} from './helpers.js';

// ─── 真实敏感信息拦截 ────────────────────────────────────────────────

test('GitHub Personal Access Token 被拦截', () => {
  const content = '我的 GitHub token 是 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
  const result = redactContent(content);
  assert.equal(result.blocked, true, 'GitHub token 应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'github-token'));
});

test('AWS Access Key 被拦截', () => {
  const content = 'AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE';
  const result = redactContent(content);
  assert.equal(result.blocked, true, 'AWS key 应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'aws-key'));
});

test('Private Key 被拦截', () => {
  const content = `
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE2I2yPB
-----END RSA PRIVATE KEY-----
  `;
  const result = redactContent(content);
  assert.equal(result.blocked, true, 'Private key 应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'private-key'));
});

test('JWT Token 被拦截', () => {
  const content = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const result = redactContent(content);
  assert.equal(result.blocked, true, 'JWT token 应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'jwt-token'));
});

test('MongoDB 连接字符串被拦截', () => {
  const content = '数据库地址：mongodb+srv://admin:password123@cluster0.example.mongodb.net/mydb';
  const result = redactContent(content);
  assert.equal(result.blocked, true, 'MongoDB 连接字符串应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'mongodb-connection'));
});

test('密码字段被拦截', () => {
  const content = 'database_password: mySuperSecret123!';
  const result = redactContent(content);
  assert.equal(result.blocked, true, '密码字段应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'password'));
});

test('API Key 字段被拦截', () => {
  const content = 'api_key: "sk-1234567890abcdef1234567890abcdef"';
  const result = redactContent(content);
  assert.equal(result.blocked, true, 'API key 字段应该被拦截');
  assert.ok(result.matches.some(m => m.rule === 'api-key'));
});

// ─── 正常内容不被误拦 ────────────────────────────────────────────────

test('普通技术讨论不被误拦', () => {
  const content = '我决定采用 better-sqlite3 作为数据库驱动，因为它性能更好';
  const result = redactContent(content);
  assert.equal(result.blocked, false, '正常技术讨论不应该被拦截');
  assert.equal(result.matches.length, 0);
});

test('包含 "key" 但不是敏感信息的内容不被误拦', () => {
  const content = '这个设计的关键点在于使用 canonicalKey 进行去重';
  const result = redactContent(content);
  assert.equal(result.blocked, false, '包含 key 的正常内容不应该被拦截');
});

test('包含 "password" 但不是赋值的内容不被误拦', () => {
  const content = '用户忘记了密码，需要重置流程';
  const result = redactContent(content);
  assert.equal(result.blocked, false, '讨论密码功能不应该被拦截');
});

// ─── 多个敏感信息同时拦截 ────────────────────────────────────────────

test('同一内容中多个敏感信息都被检测到', () => {
  const content = `
api_key: "sk-1234567890abcdef"
AWS key: AKIAIOSFODNN7EXAMPLE
password: secret123
  `;
  const result = redactContent(content);
  assert.equal(result.blocked, true);
  assert.ok(result.matches.length >= 2, `应该检测到多个匹配，得到 ${result.matches.length}`);
});

// ─── 端到端：remember 拦截敏感信息 ──────────────────────────────────

test('remember 写入敏感信息被 CLI 拦截', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const result = runCli(env.repo, [
    'remember',
    '我的 GitHub token 是 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
  ]);

  assert.notEqual(result.status, 0, '写入敏感信息应该失败');
  assert.match(result.stderr, /blocked by redaction rule/, '应该提示被 redaction 拦截');
});

test('remember --skip-redaction 可以绕过检查', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const result = runCli(env.repo, [
    'remember',
    '测试用的 API key 是 sk-test1234567890abcdef',
    '--skip-redaction'
  ]);

  // skip-redaction 应该允许写入
  assert.equal(result.status, 0, `skip-redaction 应该允许写入: ${result.stderr}`);
  const records = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.ok(records.length >= 1);
});

// ─── 端到端：retain 拦截敏感信息 ────────────────────────────────────

test('retain 从 transcript 中提取的候选如果含敏感信息会被跳过', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  const transcript = [
    { role: 'user', content: '记住：测试覆盖率目标是 80%' },  // 正常
    { role: 'user', content: '记住：GitHub token 是 ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' },  // 敏感
    { role: 'user', content: '记住：代码风格用 Prettier' },  // 正常
  ];

  const transcriptPath = join(env.home, 'transcript.json');
  writeFileSync(transcriptPath, JSON.stringify(transcript), 'utf8');

  const result = runCli(env.repo, [
    'retain',
    '--transcript-file', transcriptPath,
    '--pending',
    '--device', 'test-device'
  ]);

  assert.equal(result.status, 0, `retain 不应该失败: ${result.stderr}`);

  // 检查 pending 文件 — 应该只有 2 条（敏感的被跳过）
  const pendingRecords = readJSONL(join(env.repo, 'pending', 'test-device.jsonl'));
  assert.equal(pendingRecords.length, 2, `应该有 2 条记录（敏感的被跳过），得到 ${pendingRecords.length}`);

  // 验证没有敏感信息
  for (const record of pendingRecords) {
    assert.ok(!record.content.includes('ghp_'), '不应该包含 GitHub token');
  }
});

// ─── 自定义 Redaction 规则 ───────────────────────────────────────────

test('自定义 redaction 规则可以扩展内置规则', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 创建自定义规则文件
  const metaDir = join(env.repo, 'meta');
  mkdirSync(metaDir, { recursive: true });

  const customRules = {
    version: 1,
    rules: [
      {
        name: 'internal-hostname',
        pattern: 'internal\\.company\\.com',
        severity: 'block'
      }
    ]
  };
  writeFileSync(
    join(metaDir, 'redaction-rules.json'),
    JSON.stringify(customRules, null, 2),
    'utf8'
  );

  // 测试自定义规则
  const { loadRedactionRules } = await import('../src/redaction-engine.js');
  const rules = loadRedactionRules(env.repo);

  // 应该包含内置规则 + 自定义规则
  assert.ok(rules.length > DEFAULT_PATTERNS.length, '应该有更多规则');

  // 测试自定义规则的拦截
  const content = '请连接 internal.company.com 获取数据';
  const { redactContent: redact } = await import('../src/redaction-engine.js');
  const result = redact(content, rules);
  assert.equal(result.blocked, true, '自定义规则应该拦截 internal.company.com');
});
