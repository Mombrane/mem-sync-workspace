import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { resolveProjectId } from '../src/project-resolver.js';

/**
 * 辅助函数：在指定目录初始化一个带 origin remote 的 Git 仓库。
 * 返回 remoteUrl 用于验证哈希一致性。
 */
function initGitRepo(dir, remoteUrl) {
  execSync('git init', { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  // 提交一个文件以便有 HEAD
  execSync('git commit --allow-empty -m "init"', { cwd: dir });
  execSync(`git remote add origin ${remoteUrl}`, { cwd: dir });
}

test('resolveProjectId returns explicit ID directly, ignoring all other sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-resolver-'));
  try {
    // 即使存在 Git remote 和 package.json，显式 ID 始终胜出
    initGitRepo(dir, 'https://github.com/user/repo.git');
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-package' }), 'utf8');

    const result = resolveProjectId(dir, 'explicit-my-project');
    assert.equal(result, 'explicit-my-project');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProjectId returns consistent SHA256 hash from git remote URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-resolver-'));
  try {
    const remoteUrl = 'https://github.com/user/my-repo.git';
    initGitRepo(dir, remoteUrl);

    const result1 = resolveProjectId(dir);
    const result2 = resolveProjectId(dir);

    // 同一 remote URL 应产生一致的哈希
    assert.equal(result1, result2);
    // 应为 12 字符的十六进制字符串
    assert.match(result1, /^[a-f0-9]{12}$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProjectId uses package.json name when no git remote exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-resolver-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-npm-package' }), 'utf8');

    const result = resolveProjectId(dir);
    assert.equal(result, 'my-npm-package');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProjectId returns directory basename as final fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-resolver-'));
  try {
    // 没有 Git remote，没有 package.json → 回退到目录名
    const result = resolveProjectId(dir);
    const expected = join(dir).split('/').pop(); // basename
    assert.equal(result, expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProjectId falls back to directory basename when package.json has no name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-no-name-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');

    const result = resolveProjectId(dir);

    assert.equal(result, basename(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProjectId with --project path overrides cwd for derivation but --project-id still wins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mem-sync-project-resolver-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'other-package' }), 'utf8');

    // --project 设置不同的 cwd；cwd 中无 package.json 但有 Git remote
    const otherDir = await mkdtemp(join(tmpdir(), 'mem-sync-project-resolver-other-'));
    try {
      initGitRepo(otherDir, 'https://github.com/user/specific-repo.git');

      // 使用 otherDir 作为 cwd 应从 Git remote 派生
      const result = resolveProjectId(otherDir);
      assert.match(result, /^[a-f0-9]{12}$/);
      assert.notEqual(result, 'other-package', 'should use git remote, not the package.json in dir');
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }

    // 同时使用 --project-id 和 --project：显式 ID 必须胜出
    const resultWithId = resolveProjectId(dir, 'override-id');
    assert.equal(resultWithId, 'override-id');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
