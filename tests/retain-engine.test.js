import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from '../src/retain-engine.js';

// ─── Explicit 记住 / remember extraction ───────────────────────────────────

test('extractCandidates detects explicit 记住 pattern', () => {
  const transcript = [
    { role: 'user', content: '记住我更喜欢暗色主题' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[0].scope, 'personal');
  assert.equal(candidates[0].confidence, 0.95);
  assert.equal(candidates[0].veracity, 'stated');
  assert.equal(candidates[0].source.type, 'retain');
  assert.equal(candidates[0].content, '我更喜欢暗色主题');
});

test('extractCandidates detects explicit 请记住 pattern', () => {
  const transcript = [
    { role: 'user', content: '请记住这个项目使用 pnpm' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[0].scope, 'personal');
  assert.equal(candidates[0].content, '这个项目使用 pnpm');
});

test('extractCandidates detects explicit 记一下 pattern', () => {
  const transcript = [
    { role: 'user', content: '记一下：部署前要运行 npm test' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[0].content, '部署前要运行 npm test');
});

// ─── Preference patterns ──────────────────────────────────────────────────

test('extractCandidates detects 以后 preference pattern', () => {
  const transcript = [
    { role: 'user', content: '以后都使用 pnpm 而不是 npm' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[0].scope, 'personal');
  assert.equal(candidates[0].confidence, 0.85);
  assert.equal(candidates[0].veracity, 'stated');
});

test('extractCandidates detects 默认 preference pattern', () => {
  const transcript = [
    { role: 'user', content: '默认使用 2 空格缩进' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[0].content, '默认使用 2 空格缩进');
});

test('extractCandidates detects 不要 preference pattern', () => {
  const transcript = [
    { role: 'user', content: '不要在生产环境使用 console.log' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
});

test('extractCandidates detects 总是 preference pattern', () => {
  const transcript = [
    { role: 'user', content: '总是先写测试再写实现' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
});

// ─── Decision patterns ────────────────────────────────────────────────────

test('extractCandidates detects 决定 decision with project scope when projectId given', () => {
  const transcript = [
    { role: 'user', content: '我决定使用 React 作为前端框架' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'myproject' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'decision');
  assert.equal(candidates[0].scope, 'project');
  assert.equal(candidates[0].confidence, 0.8);
  assert.equal(candidates[0].veracity, 'stated');
});

test('extractCandidates detects 决定 decision with global scope when no projectId', () => {
  const transcript = [
    { role: 'user', content: '我决定使用 React' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'decision');
  assert.equal(candidates[0].scope, 'global');
});

test('extractCandidates detects 采用 decision pattern', () => {
  const transcript = [
    { role: 'user', content: '我们采用敏捷开发流程' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'decision');
});

test('extractCandidates detects 选择 decision pattern', () => {
  const transcript = [
    { role: 'user', content: '选择 TypeScript 而非 JavaScript' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'decision');
});

// ─── Project fact patterns ────────────────────────────────────────────────

test('extractCandidates detects 架构 as project_fact', () => {
  const transcript = [
    { role: 'user', content: '这个项目的架构是微服务' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'myproject' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'project_fact');
  assert.equal(candidates[0].scope, 'project');
  assert.equal(candidates[0].confidence, 0.6);
  assert.equal(candidates[0].veracity, 'inferred');
});

test('extractCandidates detects 命令 as project_fact', () => {
  const transcript = [
    { role: 'user', content: '部署命令是 npm run deploy' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'project_fact');
});

test('extractCandidates detects 坑点 as project_fact', () => {
  const transcript = [
    { role: 'user', content: '这个库有个坑点：不支持 ESM' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'project_fact');
});

test('extractCandidates detects constraint as project_fact', () => {
  const transcript = [
    { role: 'user', content: 'constraint: must use Node.js 20+' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'project_fact');
});

test('extractCandidates detects architecture as project_fact', () => {
  const transcript = [
    { role: 'user', content: 'the architecture is event-driven' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'project_fact');
});

// ─── English patterns ─────────────────────────────────────────────────────

test('extractCandidates detects English remember pattern', () => {
  const transcript = [
    { role: 'user', content: 'remember I prefer dark theme' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[0].content, 'I prefer dark theme');
});

test('extractCandidates detects English always and never patterns', () => {
  const transcript = [
    { role: 'user', content: 'always use tabs for indentation' },
    { role: 'user', content: 'never deploy on Fridays' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'preference');
  assert.equal(candidates[1].kind, 'preference');
});

test('extractCandidates detects English decided and chose', () => {
  const transcript = [
    { role: 'user', content: 'I decided to use PostgreSQL' },
    { role: 'user', content: 'we chose Rust for the backend' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'decision');
  assert.equal(candidates[1].kind, 'decision');
});

test('extractCandidates detects English adopted', () => {
  const transcript = [
    { role: 'user', content: 'we adopted Trunk-Based Development' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'proj' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'decision');
});

test('extractCandidates detects English default pattern', () => {
  const transcript = [
    { role: 'user', content: 'my default choice is VS Code' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'preference');
});

// ─── Empty and edge cases ─────────────────────────────────────────────────

test('extractCandidates returns empty array for empty transcript', () => {
  assert.deepEqual(extractCandidates([]), []);
});

test('extractCandidates skips assistant messages', () => {
  const transcript = [
    { role: 'assistant', content: '记住这个重要的信息' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 0);
});

test('extractCandidates skips system messages', () => {
  const transcript = [
    { role: 'system', content: '记住系统配置' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 0);
});

test('extractCandidates only processes user messages among mixed roles', () => {
  const transcript = [
    { role: 'assistant', content: '记住A' },
    { role: 'system', content: '记住B' },
    { role: 'user', content: '记住用户偏好' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].content, /用户偏好/);
});

test('extractCandidates handles transcript with unknown fields gracefully', () => {
  const transcript = [
    { role: 'user', content: '记住测试内容', extraField: 'ignored', anotherField: 42 }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].content, '测试内容');
});

// ─── Multiple candidates from one message ─────────────────────────────────

test('extractCandidates produces multiple candidates from one message matching multiple rules', () => {
  const transcript = [
    { role: 'user', content: '记住我以后都使用暗色主题' }
  ];
  const candidates = extractCandidates(transcript);
  // 记住 → explicit-remember, 以后 → preference-pattern
  assert.equal(candidates.length, 2);
  // First rule (explicit-remember) should have higher confidence
  assert.equal(candidates[0].confidence, 0.95);
  assert.equal(candidates[1].confidence, 0.85);
});

// ─── Fallback episode for unmatched messages ──────────────────────────────

test('extractCandidates creates fallback episode for unmatched user messages', () => {
  const transcript = [
    { role: 'user', content: '今天天气真好' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'episode');
  assert.equal(candidates[0].scope, 'global');
  assert.equal(candidates[0].confidence, 0.3);
  assert.equal(candidates[0].veracity, 'inferred');
  assert.equal(candidates[0].content, '今天天气真好');
});

test('extractCandidates creates fallback for messages without any trigger words', () => {
  const transcript = [
    { role: 'user', content: '请问如何配置 webpack？' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].kind, 'episode');
});

// ─── Source and evidence structure ────────────────────────────────────────

test('extractCandidates includes source object with type retain', () => {
  const transcript = [
    { role: 'user', content: '记住测试' }
  ];
  const candidates = extractCandidates(transcript, { agentId: 'claude' });
  assert.equal(candidates[0].source.type, 'retain');
  assert.equal(candidates[0].source.agent, 'claude');
});

test('extractCandidates includes source.agent as null when no agentId', () => {
  const transcript = [
    { role: 'user', content: '记住测试' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates[0].source.agent, null);
});

test('extractCandidates includes evidence with user_message type', () => {
  const transcript = [
    { role: 'user', content: '记住测试内容' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates[0].evidence.length, 1);
  assert.equal(candidates[0].evidence[0].type, 'user_message');
  assert.equal(candidates[0].evidence[0].text, '记住测试内容');
});

test('extractCandidates includes projectId in candidate when provided', () => {
  const transcript = [
    { role: 'user', content: '记住项目配置' }
  ];
  const candidates = extractCandidates(transcript, { projectId: 'myproject' });
  assert.equal(candidates[0].projectId, 'myproject');
});

test('extractCandidates sets projectId to null when not provided', () => {
  const transcript = [
    { role: 'user', content: '记住配置' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates[0].projectId, null);
});

// ─── Validation ───────────────────────────────────────────────────────────

test('extractCandidates throws for non-array transcript', () => {
  assert.throws(
    () => extractCandidates('not an array'),
    /transcript must be an array/
  );
});

test('extractCandidates skips entries without role', () => {
  const transcript = [
    { content: 'no role field' },
    { role: 'user', content: '记住有效消息' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 1);
});

test('extractCandidates skips user messages with empty content', () => {
  const transcript = [
    { role: 'user', content: '' },
    { role: 'user', content: '   ' }
  ];
  const candidates = extractCandidates(transcript);
  assert.equal(candidates.length, 0);
});
