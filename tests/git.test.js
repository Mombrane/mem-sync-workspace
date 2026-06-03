import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  getDefaultBranch,
  hasRemote,
  getHead,
  fetch,
  pullRebase,
  stashSave,
  stashPop,
  rebaseAbort,
  ensureClone,
  stageFile,
  commit,
  push,
  RebaseConflictError
} from '../src/git.js';

/**
 * 辅助函数：在临时目录创建 Git 仓库。
 * 返回仓库路径。
 */
function createTempRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `mem-sync-git-${name}-`));
  execSync('git init -b main', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
  return dir;
}

/**
 * 辅助函数：创建 bare 仓库作为 remote。
 */
function createBareRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `mem-sync-git-bare-${name}-`));
  execSync('git init --bare -b main', { cwd: dir, encoding: 'utf8' });
  return dir;
}

/**
 * 辅助函数：在仓库中创建文件并提交。
 */
function commitFile(repoDir, filename, content) {
  writeFileSync(join(repoDir, filename), content, 'utf8');
  execSync(`git add ${filename}`, { cwd: repoDir, encoding: 'utf8' });
  execSync(`git commit -m "add ${filename}"`, { cwd: repoDir, encoding: 'utf8' });
}

/**
 * 辅助函数：设置远程 origin 并推送。
 */
function setupRemote(localDir, bareDir) {
  execSync(`git remote add origin "${bareDir}"`, { cwd: localDir, encoding: 'utf8' });
  execSync('git push -u origin main', { cwd: localDir, encoding: 'utf8' });
}

// ─── ensureClone ──────────────────────────────────────────────────────

test('ensureClone clones when directory does not exist', () => {
  const bareDir = createBareRepo('clone-source');
  const targetDir = join(tmpdir(), `mem-sync-git-clone-${Date.now()}`);

  try {
    // 在 bare 仓库中创建一个初始提交
    const tempClone = createTempRepo('tmp');
    try {
      commitFile(tempClone, 'test.txt', 'hello');
      execSync(`git remote add origin "${bareDir}"`, { cwd: tempClone, encoding: 'utf8' });
      execSync('git push -u origin main', { cwd: tempClone, encoding: 'utf8' });
    } finally {
      rmSync(tempClone, { recursive: true, force: true });
    }

    ensureClone(bareDir, targetDir);

    assert.ok(existsSync(join(targetDir, '.git')));
    // 应该包含我们推送的文件
    assert.ok(existsSync(join(targetDir, 'test.txt')));
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('ensureClone initializes empty repo when no remote URL', () => {
  const targetDir = join(tmpdir(), `mem-sync-git-init-${Date.now()}`);

  try {
    ensureClone(null, targetDir);

    assert.ok(existsSync(join(targetDir, '.git')));
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('ensureClone does nothing if repo already exists', () => {
  const repoDir = createTempRepo('existing');

  try {
    commitFile(repoDir, 'keep.txt', 'data');
    ensureClone(null, repoDir);

    // 文件应仍在
    assert.ok(existsSync(join(repoDir, 'keep.txt')));
    assert.ok(existsSync(join(repoDir, '.git')));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

// ─── hasRemote ───────────────────────────────────────────────────────

test('hasRemote returns true when origin exists', () => {
  const repoDir = createTempRepo('remote-true');
  const bareDir = createBareRepo('origin');

  try {
    execSync(`git remote add origin "${bareDir}"`, { cwd: repoDir, encoding: 'utf8' });
    assert.equal(hasRemote(repoDir), true);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

test('hasRemote returns false when no origin', () => {
  const repoDir = createTempRepo('remote-false');

  try {
    assert.equal(hasRemote(repoDir), false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

// ─── getHead ─────────────────────────────────────────────────────────

test('getHead returns commit hash for git repo', () => {
  const repoDir = createTempRepo('head');

  try {
    commitFile(repoDir, 'test.txt', 'content');
    const head = getHead(repoDir);
    assert.ok(typeof head === 'string');
    assert.ok(head.length === 40, `expected 40-char hash, got ${head.length}: ${head}`);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('getHead returns unknown for non-git directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-git-nogit-'));

  try {
    assert.equal(getHead(dir), 'unknown');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── fetch ──────────────────────────────────────────────────────────

test('fetch returns 0 when no remote', () => {
  const repoDir = createTempRepo('fetch-noremote');

  try {
    const pulled = fetch(repoDir);
    assert.equal(pulled, 0);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('fetch works with remote', () => {
  const bareDir = createBareRepo('fetch-remote');
  const repoDir = createTempRepo('fetch-local');

  try {
    commitFile(repoDir, 'test.txt', 'initial');
    setupRemote(repoDir, bareDir);

    // 创建另一个克隆，添加新提交并推送
    const otherDir = mkdtempSync(join(tmpdir(), 'mem-sync-git-fetch-other-'));
    try {
      execSync(`git clone "${bareDir}" "${otherDir}"`, { encoding: 'utf8' });
      execSync('git config user.email "test@test"', { cwd: otherDir, encoding: 'utf8' });
      execSync('git config user.name "Test"', { cwd: otherDir, encoding: 'utf8' });
      commitFile(otherDir, 'new.txt', 'new content');
      execSync('git push origin main', { cwd: otherDir, encoding: 'utf8' });
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }

    const pulled = fetch(repoDir);
    assert.ok(pulled >= 1, `expected at least 1 pulled, got ${pulled}`);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

// ─── pullRebase ─────────────────────────────────────────────────────

test('pullRebase pulls new commits', () => {
  const bareDir = createBareRepo('pull-base');
  const repoDir = createTempRepo('pull-local');

  try {
    commitFile(repoDir, 'test.txt', 'initial');
    setupRemote(repoDir, bareDir);

    // 在其他克隆中添加新提交并推送
    const otherDir = mkdtempSync(join(tmpdir(), 'mem-sync-git-pull-other-'));
    try {
      execSync(`git clone "${bareDir}" "${otherDir}"`, { encoding: 'utf8' });
      execSync('git config user.email "test@test"', { cwd: otherDir, encoding: 'utf8' });
      execSync('git config user.name "Test"', { cwd: otherDir, encoding: 'utf8' });
      commitFile(otherDir, 'new.txt', 'new content');
      execSync('git push origin main', { cwd: otherDir, encoding: 'utf8' });
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }

    // 先 fetch
    execSync('git fetch origin', { cwd: repoDir, encoding: 'utf8' });
    const pulled = pullRebase(repoDir);

    assert.ok(pulled >= 1, `expected at least 1 pulled, got ${pulled}`);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

test('pullRebase returns 0 when no new commits', () => {
  const bareDir = createBareRepo('pull-nop');
  const repoDir = createTempRepo('pull-nop-local');

  try {
    commitFile(repoDir, 'test.txt', 'initial');
    setupRemote(repoDir, bareDir);

    execSync('git fetch origin', { cwd: repoDir, encoding: 'utf8' });
    const pulled = pullRebase(repoDir);

    assert.equal(pulled, 0);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

// ─── stash/pop ───────────────────────────────────────────────────────

test('stashSave and stashPop preserve local changes', () => {
  const repoDir = createTempRepo('stash');

  try {
    commitFile(repoDir, 'tracked.txt', 'original');

    // 修改已跟踪的文件
    writeFileSync(join(repoDir, 'tracked.txt'), 'modified', 'utf8');

    // 暂存
    const stashed = stashSave(repoDir);
    assert.equal(stashed, true);

    // 文件应恢复到原始内容
    const content = readFileSync(join(repoDir, 'tracked.txt'), 'utf8').trim();
    assert.equal(content, 'original');

    // 恢复
    stashPop(repoDir);
    const restored = readFileSync(join(repoDir, 'tracked.txt'), 'utf8').trim();
    assert.equal(restored, 'modified');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('stashSave returns false when no changes', () => {
  const repoDir = createTempRepo('stash-empty');

  try {
    commitFile(repoDir, 'clean.txt', 'content');
    const stashed = stashSave(repoDir);
    assert.equal(stashed, false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

// ─── stageFile/commit/push ─────────────────────────────────────────

test('stageFile stages an existing file', () => {
  const repoDir = createTempRepo('stage-file');

  try {
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');

    stageFile(repoDir, 'memory.jsonl');

    const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8' });
    assert.match(status, /^A\s+memory\.jsonl/m);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('stageFile throws when file does not exist', () => {
  const repoDir = createTempRepo('stage-missing');

  try {
    assert.throws(() => stageFile(repoDir, 'missing.jsonl'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('commit creates a commit with the requested message', () => {
  const repoDir = createTempRepo('commit-message');

  try {
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');

    const hash = commit(repoDir, 'mem-sync: test commit');

    assert.match(hash, /^[0-9a-f]{7,}$/);
    const message = execSync('git log -1 --format=%s', { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(message, 'mem-sync: test commit');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('commit throws when there are no staged changes', () => {
  const repoDir = createTempRepo('commit-empty');

  try {
    assert.throws(() => commit(repoDir, 'mem-sync: empty'));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('push returns false when no remote is configured', () => {
  const repoDir = createTempRepo('push-no-remote');

  try {
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');
    commit(repoDir, 'mem-sync: local only');

    assert.equal(push(repoDir), false);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('push sends committed changes to origin', () => {
  const bareDir = createBareRepo('push-origin');
  const repoDir = createTempRepo('push-origin-local');

  try {
    execSync(`git remote add origin "${bareDir}"`, { cwd: repoDir, encoding: 'utf8' });
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');
    commit(repoDir, 'mem-sync: push test');

    assert.equal(push(repoDir), true);

    const remoteLog = execSync('git log --oneline --all', { cwd: bareDir, encoding: 'utf8' });
    assert.match(remoteLog, /mem-sync: push test/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

test('stageFile and commit handle quotes in file names and messages', () => {
  const repoDir = createTempRepo('git-safe-args');

  try {
    const filename = 'quote"file.txt';
    writeFileSync(join(repoDir, filename), 'content', 'utf8');

    stageFile(repoDir, filename);
    const hash = commit(repoDir, 'message with "quotes"');

    assert.match(hash, /^[0-9a-f]{7,}$/);
    const message = execSync('git log -1 --format=%s', { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(message, 'message with "quotes"');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

// ─── rebaseAbort ────────────────────────────────────────────────────

test('rebaseAbort aborts in-progress rebase', () => {
  const repoDir = createTempRepo('rebase-abort');

  try {
    commitFile(repoDir, 'file.txt', 'base');

    // 创建新分支
    execSync('git checkout -b feature', { cwd: repoDir, encoding: 'utf8' });
    writeFileSync(join(repoDir, 'file.txt'), 'feature change', 'utf8');
    execSync('git add file.txt', { cwd: repoDir, encoding: 'utf8' });
    execSync('git commit -m "feature"', { cwd: repoDir, encoding: 'utf8' });

    // 回到 main 分支，做冲突修改
    execSync('git checkout main', { cwd: repoDir, encoding: 'utf8' });
    writeFileSync(join(repoDir, 'file.txt'), 'main change', 'utf8');
    execSync('git add file.txt', { cwd: repoDir, encoding: 'utf8' });
    execSync('git commit -m "main update"', { cwd: repoDir, encoding: 'utf8' });

    // 尝试 rebase feature 到 main（预期冲突）
    let conflict = false;
    try {
      execSync('git rebase feature', { cwd: repoDir, encoding: 'utf8' });
    } catch {
      conflict = true;
    }
    assert.equal(conflict, true, 'expected rebase conflict');

    // 现在测试 rebaseAbort
    rebaseAbort(repoDir);

    // 验证 rebase 已中止：HEAD 应在 main 分支
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
    assert.equal(branch, 'main');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

// ─── getDefaultBranch ───────────────────────────────────────────────

test('getDefaultBranch returns current branch for local repo', () => {
  const repoDir = createTempRepo('default-branch-local');
  try {
    const branch = getDefaultBranch(repoDir);
    assert.equal(branch, 'main');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test('getDefaultBranch discovers remote default branch', () => {
  const bareDir = createBareRepo('default-branch-remote');
  const repoDir = createTempRepo('default-branch-local2');
  try {
    commitFile(repoDir, 'test.txt', 'content');
    setupRemote(repoDir, bareDir);
    const branch = getDefaultBranch(repoDir);
    // Should return main (the branch we pushed)
    assert.equal(branch, 'main');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

test('push works on non-main default branch', () => {
  const bareDir = createBareRepo('push-nonmain');
  const repoDir = createTempRepo('push-nonmain-local');
  try {
    // Initialize with 'develop' branch
    execSync('git checkout -b develop', { cwd: repoDir, encoding: 'utf8' });
    execSync(`git remote add origin "${bareDir}"`, { cwd: repoDir, encoding: 'utf8' });
    writeFileSync(join(repoDir, 'memory.jsonl'), '{"id":"mem_1"}\n', 'utf8');
    stageFile(repoDir, 'memory.jsonl');
    commit(repoDir, 'mem-sync: test on develop');

    const result = push(repoDir);
    assert.equal(result, true);

    const remoteLog = execSync('git log --oneline --all', { cwd: bareDir, encoding: 'utf8' });
    assert.match(remoteLog, /mem-sync: test on develop/);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});

test('stashSave handles special characters in stash message', () => {
  const repoDir = createTempRepo('stash-special');
  try {
    commitFile(repoDir, 'tracked.txt', 'original');
    writeFileSync(join(repoDir, 'tracked.txt'), 'modified', 'utf8');

    const stashed = stashSave(repoDir);
    assert.equal(stashed, true);

    // Verify stash exists
    const stashList = execSync('git stash list', { cwd: repoDir, encoding: 'utf8' });
    assert.match(stashList, /mem-sync prepare auto-stash/);

    stashPop(repoDir);
    const restored = readFileSync(join(repoDir, 'tracked.txt'), 'utf8').trim();
    assert.equal(restored, 'modified');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

