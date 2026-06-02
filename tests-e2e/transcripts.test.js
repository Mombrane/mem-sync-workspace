/**
 * 真实对话 Transcript 测试 — 模拟多轮对话，验证 retain 引擎的记忆提取能力
 *
 * 使用真实的对话场景，测试 retain-engine 的规则匹配和记忆提取。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCandidates } from '../src/retain-engine.js';
import {
  createTestHome,
  cleanupTestHome,
  runCli,
  readJSONL
} from './helpers.js';

// ─── 场景1：用户偏好收集对话 ──────────────────────────────────────────

test('场景1：用户偏好收集对话 — 提取偏好和决策', async (t) => {
  const transcript = [
    { role: 'assistant', content: '你好！有什么可以帮你的？' },
    { role: 'user', content: '记住：以后代码注释默认用中文' },
    { role: 'assistant', content: '好的，已记录你的偏好。' },
    { role: 'user', content: '我决定采用 pnpm 作为包管理器' },
    { role: 'assistant', content: '了解，pnpm 是个好选择。' },
    { role: 'user', content: '以后不要在 commit message 里加 emoji' },
    { role: 'assistant', content: '明白，我会记住这个偏好。' },
    { role: 'user', content: '今天天气不错' },
  ];

  const candidates = extractCandidates(transcript);

  // 应该提取出 4 条候选记忆（3 条规则匹配 + 1 条 fallback episode）
  assert.ok(candidates.length >= 3, `期望至少 3 条候选，得到 ${candidates.length}`);

  // 第1条：explicit-remember → preference
  const pref1 = candidates.find(c => c.content.includes('代码注释'));
  assert.ok(pref1, '应该提取出「代码注释」偏好');
  assert.equal(pref1.kind, 'preference');
  assert.ok(pref1.confidence >= 0.9);

  // 第2条：decision-pattern → decision
  const decision = candidates.find(c => c.content.includes('pnpm'));
  assert.ok(decision, '应该提取出「pnpm」决策');
  assert.equal(decision.kind, 'decision');

  // 第3条：preference-pattern → preference
  const pref2 = candidates.find(c => c.content.includes('emoji'));
  assert.ok(pref2, '应该提取出「emoji」偏好');
  assert.equal(pref2.kind, 'preference');

  // 第4条：fallback → episode
  const episode = candidates.find(c => c.content.includes('天气'));
  assert.ok(episode, '应该有「天气」的 episode');
  assert.equal(episode.kind, 'episode');
  assert.ok(episode.confidence <= 0.5, 'episode 的置信度应该较低');
});

// ─── 场景2：技术讨论对话 ─────────────────────────────────────────────

test('场景2：技术讨论对话 — 提取项目事实和架构决策', async (t) => {
  const transcript = [
    { role: 'user', content: '这个项目架构是微服务，用的是 gRPC 通信' },
    { role: 'assistant', content: '了解，微服务 + gRPC 的组合。' },
    { role: 'user', content: '有个坑点：SQLite 的 WAL 模式在 NFS 上有兼容问题' },
    { role: 'assistant', content: '这是个重要的注意事项。' },
    { role: 'user', content: '我选择使用 better-sqlite3 而不是 sql.js' },
    { role: 'assistant', content: 'better-sqlite3 性能确实更好。' },
    { role: 'user', content: '部署流程需要先跑 CI 再 merge' },
    { role: 'assistant', content: '明白，CI-first 的流程。' },
  ];

  const candidates = extractCandidates(transcript, { projectId: 'mem-sync' });

  // 验证项目事实提取
  const arch = candidates.find(c => c.content.includes('微服务'));
  assert.ok(arch, '应该提取出架构信息');
  assert.equal(arch.kind, 'project_fact');
  assert.equal(arch.scope, 'project');
  assert.equal(arch.projectId, 'mem-sync');

  const pitfall = candidates.find(c => c.content.includes('坑点'));
  assert.ok(pitfall, '应该提取出坑点');
  assert.equal(pitfall.kind, 'project_fact');

  // 验证决策提取
  const choice = candidates.find(c => c.content.includes('better-sqlite3'));
  assert.ok(choice, '应该提取出技术选择');
  assert.equal(choice.kind, 'decision');

  // 验证工作流提取
  const workflow = candidates.find(c => c.content.includes('部署流程'));
  assert.ok(workflow, '应该提取出部署流程');
  // 注意：deploy 匹配 decision-pattern（"采用"没出现），可能走 fallback
  assert.ok(['workflow', 'decision', 'episode'].includes(workflow.kind));
});

// ─── 场景3：纠错对话 ─────────────────────────────────────────────────

test('场景3：混合对话 — 用户指令和闲聊混合', async (t) => {
  const transcript = [
    { role: 'user', content: '请记住：测试覆盖率目标是 80%' },
    { role: 'assistant', content: '好的，已记录。' },
    { role: 'user', content: '帮我看看这段代码有没有 bug' },
    { role: 'assistant', content: '我看一下...' },
    { role: 'user', content: '算了我自己看吧' },
    { role: 'user', content: '记住：PR 标题要用 conventional commits 格式' },
    { role: 'assistant', content: '已记录。' },
    { role: 'user', content: '今天加班到几点？' },
  ];

  const candidates = extractCandidates(transcript);

  // 应该有明确的偏好提取
  const coverage = candidates.find(c => c.content.includes('80%'));
  assert.ok(coverage, '应该提取出覆盖率目标');
  assert.equal(coverage.kind, 'preference');
  assert.ok(coverage.confidence >= 0.9);

  const prTitle = candidates.find(c => c.content.includes('conventional commits'));
  assert.ok(prTitle, '应该提取出 PR 标题格式');
  assert.equal(prTitle.kind, 'preference');

  // 闲聊应该走 fallback（episode，低置信度）
  const chat = candidates.find(c => c.content.includes('加班'));
  assert.ok(chat, '应该有「加班」的 episode');
  assert.equal(chat.kind, 'episode');
  assert.equal(chat.confidence, 0.3);
});

// ─── 场景4：英文对话 ─────────────────────────────────────────────────

test('场景4：英文对话 — 英文触发词匹配', async (t) => {
  const transcript = [
    { role: 'user', content: 'Remember: always use TypeScript strict mode' },
    { role: 'assistant', content: 'Noted.' },
    { role: 'user', content: 'I decided to adopt Vitest instead of Jest' },
    { role: 'assistant', content: 'Good choice.' },
    { role: 'user', content: 'Never use var, always use const or let' },
    { role: 'assistant', content: 'Understood.' },
  ];

  const candidates = extractCandidates(transcript);

  // Remember → preference
  const ts = candidates.find(c => c.content.includes('TypeScript'));
  assert.ok(ts, '应该提取出 TypeScript 偏好');
  assert.equal(ts.kind, 'preference');

  // Decided → decision
  const vitest = candidates.find(c => c.content.includes('Vitest'));
  assert.ok(vitest, '应该提取出 Vitest 决策');
  assert.equal(vitest.kind, 'decision');

  // Never → preference
  const varRule = candidates.find(c => c.content.includes('var'));
  assert.ok(varRule, '应该提取出 var 规则');
  assert.equal(varRule.kind, 'preference');
});

// ─── 场景5：retain 端到端流程 ─────────────────────────────────────────

test('场景5：transcript → retain → flush → recall 完整链路', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 创建真实的对话 transcript
  const transcript = [
    { role: 'user', content: '记住：代码风格用 ESLint + Prettier' },
    { role: 'assistant', content: '好的。' },
    { role: 'user', content: '我决定采用 monorepo 架构' },
    { role: 'assistant', content: '了解。' },
    { role: 'user', content: '以后测试用 vitest 不用 jest' },
    { role: 'assistant', content: '已记录。' },
  ];

  // 写入 transcript 文件
  const transcriptPath = join(env.home, 'transcript.json');
  writeFileSync(transcriptPath, JSON.stringify(transcript), 'utf8');

  // 运行 retain
  const retainResult = runCli(env.repo, [
    'retain',
    '--transcript-file', transcriptPath,
    '--pending',
    '--device', 'test-session-001'
  ]);
  assert.equal(retainResult.status, 0, `retain 失败: ${retainResult.stderr}`);

  // 检查 pending 文件
  const pendingRecords = readJSONL(join(env.repo, 'pending', 'test-session-001.jsonl'));
  assert.ok(pendingRecords.length >= 2, `期望至少 2 条 pending 记录，得到 ${pendingRecords.length}`);

  // 验证提取的类型
  const kinds = pendingRecords.map(r => r.kind);
  assert.ok(kinds.includes('preference'), '应该有 preference 类型');
  assert.ok(kinds.includes('decision'), '应该有 decision 类型');

  // flush 合并到主存储
  const flushResult = runCli(env.repo, ['flush']);
  assert.equal(flushResult.status, 0, `flush 失败: ${flushResult.stderr}`);

  // 验证 JSONL 中有记录
  const mainRecords = readJSONL(join(env.repo, 'memories.jsonl'));
  assert.ok(mainRecords.length >= 2, `期望至少 2 条主记录，得到 ${mainRecords.length}`);

  // 重建索引并 recall
  runCli(env.repo, ['index', 'rebuild']);
  const recallResult = runCli(env.repo, ['recall', 'ESLint', '--format', 'json']);
  assert.equal(recallResult.status, 0);
  const output = JSON.parse(recallResult.stdout);
  assert.ok(output.count >= 1, '应该能搜索到 ESLint 相关记忆');
});

// ─── 场景6：projectId 作用域隔离 ──────────────────────────────────────

test('场景6：不同 projectId 的记忆互相隔离', async (t) => {
  const env = createTestHome();
  t.after(() => cleanupTestHome(env));

  // 使用不同内容避免 canonicalKey 去重
  const transcriptA = [
    { role: 'user', content: '记住：项目 A 使用 PostgreSQL 数据库' },
  ];
  const transcriptB = [
    { role: 'user', content: '记住：项目 B 使用 MongoDB 数据库' },
  ];

  // 项目 A 的 retain
  const transcriptPathA = join(env.home, 'transcript-a.json');
  writeFileSync(transcriptPathA, JSON.stringify(transcriptA), 'utf8');
  runCli(env.repo, [
    'retain', '--transcript-file', transcriptPathA,
    '--pending', '--device', 'device-a', '--project-id', 'project-a'
  ]);

  // 项目 B 的 retain（不同项目 ID 和不同内容）
  const transcriptPathB = join(env.home, 'transcript-b.json');
  writeFileSync(transcriptPathB, JSON.stringify(transcriptB), 'utf8');
  runCli(env.repo, [
    'retain', '--transcript-file', transcriptPathB,
    '--pending', '--device', 'device-b', '--project-id', 'project-b'
  ]);

  // flush
  runCli(env.repo, ['flush']);

  const records = readJSONL(join(env.repo, 'memories.jsonl'));

  // 验证两个项目的记忆都有各自的 projectId
  const projectARecords = records.filter(r => r.projectId === 'project-a');
  const projectBRecords = records.filter(r => r.projectId === 'project-b');

  assert.ok(projectARecords.length >= 1, `应该有 project-a 的记忆，总共 ${records.length} 条`);
  assert.ok(projectBRecords.length >= 1, '应该有 project-b 的记忆');

  // 验证内容不同
  assert.ok(projectARecords[0].content.includes('PostgreSQL'), 'project-a 应该包含 PostgreSQL');
  assert.ok(projectBRecords[0].content.includes('MongoDB'), 'project-b 应该包含 MongoDB');
});
