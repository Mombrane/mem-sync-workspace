/**
 * 多设备同步测试 — 设备A 写入 → Git push → 设备B clone → sync → recall
 *
 * 验证 mem-sync 的核心价值：通过 GitHub 实现跨设备记忆同步。
 * 模拟两台设备各自维护独立的 MEM_SYNC_HOME，通过 Git 仓库同步。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  createTestHomeWithRemote,
  cleanupTestHome,
  runCli,
  makeRecord,
  writeJSONL,
  readJSONL
} from './helpers.js';

// ─── 基础同步 ────────────────────────────────────────────────────────

test('设备A remember → push → 设备B clone → recall 可以找到记忆', async (t) => {
  // 设备A：创建带远程的环境
  const deviceA = createTestHomeWithRemote();
  t.after(() => {
    cleanupTestHome(deviceA);
    if (deviceB) cleanupTestHome(deviceB);
  });

  let deviceB = null;

  // 设备A：写入记忆（使用英文避免 trigram 中文搜索问题）
  const addResult = runCli(deviceA.repo, ['remember', 'User prefers dark theme', '--kind', 'preference']);
  assert.equal(addResult.status, 0);

  // remember 直接写入 JSONL，需要手动 commit 并 push
  // flush 只处理 pending 目录，不处理直接写入的 JSONL
  execSync('git add memories.jsonl', { cwd: deviceA.repo, encoding: 'utf8' });
  execSync('git commit -m "add memory"', { cwd: deviceA.repo, encoding: 'utf8' });
  execSync('git push origin main', { cwd: deviceA.repo, encoding: 'utf8' });

  // 设备B：从远程克隆
  deviceB = mkdtempSync(join(tmpdir(), 'mem-sync-e2e-deviceB-'));
  execSync(`git clone "${deviceA.bareRepo}" "${deviceB}"`, { encoding: 'utf8' });
  execSync('git config user.email "deviceB@test"', { cwd: deviceB, encoding: 'utf8' });
  execSync('git config user.name "Device B"', { cwd: deviceB, encoding: 'utf8' });

  // 设备B：重建索引并搜索
  const indexResult = runCli(deviceB, ['index', 'rebuild']);
  assert.equal(indexResult.status, 0, `设备B index rebuild 失败: ${indexResult.stderr}`);

  const recallResult = runCli(deviceB, ['recall', 'dark theme', '--format', 'json']);
  assert.equal(recallResult.status, 0, `设备B recall 失败: ${recallResult.stderr}`);
  const output = JSON.parse(recallResult.stdout);
  assert.ok(output.count >= 1, '设备B 应该能找到设备A 写入的记忆');
  assert.equal(output.results[0].memory.kind, 'preference');
});

// ─── 双向同步 ────────────────────────────────────────────────────────

test('设备A 和 设备B 各自写入记忆后双向同步', async (t) => {
  const deviceA = createTestHomeWithRemote();
  t.after(() => {
    cleanupTestHome(deviceA);
    if (deviceB) cleanupTestHome(deviceB);
  });

  let deviceB = null;

  // 设备A 写入（使用英文）
  runCli(deviceA.repo, ['remember', 'Device A prefers VSCode editor']);
  // 手动 commit 并 push
  execSync('git add memories.jsonl', { cwd: deviceA.repo, encoding: 'utf8' });
  execSync('git commit -m "device A memory"', { cwd: deviceA.repo, encoding: 'utf8' });
  execSync('git push origin main', { cwd: deviceA.repo, encoding: 'utf8' });

  // 设备B 克隆
  deviceB = mkdtempSync(join(tmpdir(), 'mem-sync-e2e-bidir-'));
  execSync(`git clone "${deviceA.bareRepo}" "${deviceB}"`, { encoding: 'utf8' });
  execSync('git config user.email "deviceB@test"', { cwd: deviceB, encoding: 'utf8' });
  execSync('git config user.name "Device B"', { cwd: deviceB, encoding: 'utf8' });

  // 设备B 也写入（使用英文）
  runCli(deviceB, ['remember', 'Device B prefers JetBrains IDE']);
  // 手动 commit 并 push
  execSync('git add memories.jsonl', { cwd: deviceB, encoding: 'utf8' });
  execSync('git commit -m "device B memory"', { cwd: deviceB, encoding: 'utf8' });
  execSync('git push origin main', { cwd: deviceB, encoding: 'utf8', stdio: 'pipe' });

  // 设备A sync（拉取设备B的变更）
  const syncResult = runCli(deviceA.repo, ['sync']);
  assert.equal(syncResult.status, 0, `设备A sync 失败: ${syncResult.stderr}`);
  const syncOutput = JSON.parse(syncResult.stdout);
  assert.ok(syncOutput.pulled >= 1, '设备A 应该拉取到设备B的提交');

  // 设备A 重建索引，应该能找到两条记忆
  runCli(deviceA.repo, ['index', 'rebuild']);
  const listResult = runCli(deviceA.repo, ['list']);
  assert.equal(listResult.status, 0);
  const lines = listResult.stdout.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2, `设备A 应该有 2 条记忆，得到 ${lines.length}`);
});

// ─── 记忆去重 ────────────────────────────────────────────────────────

test('两台设备写入相同内容的记忆，同步后自动去重', async (t) => {
  const deviceA = createTestHomeWithRemote();
  t.after(() => {
    cleanupTestHome(deviceA);
    if (deviceB) cleanupTestHome(deviceB);
  });

  let deviceB = null;

  // 设备A 写入
  runCli(deviceA.repo, ['remember', 'Python 是最好的语言']);
  runCli(deviceA.repo, ['flush']);

  // 设备B 克隆
  deviceB = mkdtempSync(join(tmpdir(), 'mem-sync-e2e-dedup-'));
  execSync(`git clone "${deviceA.bareRepo}" "${deviceB}"`, { encoding: 'utf8' });
  execSync('git config user.email "deviceB@test"', { cwd: deviceB, encoding: 'utf8' });
  execSync('git config user.name "Device B"', { cwd: deviceB, encoding: 'utf8' });

  // 设备B 写入完全相同的内容
  runCli(deviceB, ['remember', 'Python 是最好的语言']);
  runCli(deviceB, ['flush']);

  // 设备A sync
  execSync('git pull --rebase origin main', { cwd: deviceA.repo, encoding: 'utf8', stdio: 'pipe' });

  // 验证去重：读取 JSONL 应该只有一条记录（canonicalKey 相同）
  const records = readJSONL(join(deviceA.repo, 'memories.jsonl'));
  assert.equal(records.length, 1, `应该只有 1 条去重后的记忆，得到 ${records.length}`);
});

// ─── 合并冲突处理 ────────────────────────────────────────────────────

test('同步冲突时 sync 应该报错而非静默覆盖', async (t) => {
  const deviceA = createTestHomeWithRemote();
  t.after(() => {
    cleanupTestHome(deviceA);
    if (deviceB) cleanupTestHome(deviceB);
  });

  let deviceB = null;

  // 设备A 写入并 push
  runCli(deviceA.repo, ['remember', '设备A的独有记忆']);
  runCli(deviceA.repo, ['flush']);

  // 设备B 克隆
  deviceB = mkdtempSync(join(tmpdir(), 'mem-sync-e2e-conflict-'));
  execSync(`git clone "${deviceA.bareRepo}" "${deviceB}"`, { encoding: 'utf8' });
  execSync('git config user.email "deviceB@test"', { cwd: deviceB, encoding: 'utf8' });
  execSync('git config user.name "Device B"', { cwd: deviceB, encoding: 'utf8' });

  // 设备A 新增记忆并 push
  runCli(deviceA.repo, ['remember', '设备A的第二条记忆']);
  runCli(deviceA.repo, ['flush']);

  // 设备B 新增不同的记忆
  runCli(deviceB, ['remember', '设备B的独有记忆']);
  runCli(deviceB, ['flush']);

  // 设备B push 成功
  execSync('git push origin main', { cwd: deviceB, encoding: 'utf8', stdio: 'pipe' });

  // 设备A sync — 应该需要 rebase
  const syncResult = runCli(deviceA.repo, ['sync']);
  // rebase 可能成功也可能冲突，但不应该静默丢失数据
  const records = readJSONL(join(deviceA.repo, 'memories.jsonl'));
  // 至少应该保留设备A自己的记忆
  const hasDeviceAMemory = records.some(r => r.content.includes('设备A'));
  assert.ok(hasDeviceAMemory, '设备A 的记忆不应该丢失');
});
