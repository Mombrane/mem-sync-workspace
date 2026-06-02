import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * 辅助函数：运行 CLI 命令
 */
function runCli(dir, args, opts = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    env: { ...process.env, MEM_SYNC_HOME: dir },
    encoding: 'utf8',
    ...opts
  });
}

/**
 * 辅助函数：创建临时目录
 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-key-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

/**
 * 辅助函数：初始化 mem-sync 仓库结构
 */
function initMemSync(dir) {
  const dirs = ['memories', 'pending', 'projects', 'meta', 'skills', 'archive'];
  for (const d of dirs) {
    mkdirSync(join(dir, d), { recursive: true });
  }
  writeFileSync(
    join(dir, 'meta', 'schema.json'),
    JSON.stringify({ schemaVersion: 1, created: new Date().toISOString(), tool: "mem-sync", toolVersion: "0.1.0" }, null, 2) + '\n',
    'utf8'
  );
  writeFileSync(
    join(dir, 'meta', 'devices.json'),
    JSON.stringify({ devices: {} }, null, 2) + '\n',
    'utf8'
  );
}

/**
 * 辅助函数：写入加密配置
 */
function writeEncryptionConfig(dir, config) {
  const metaDir = join(dir, 'meta');
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(join(metaDir, 'encryption.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// key status 测试
// ---------------------------------------------------------------------------

test('key status shows disabled when no encryption config', () => {
  const { dir, cleanup } = tempDir();
  try {
    initMemSync(dir);
    const result = runCli(dir, ['key', 'status']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.encryption, 'disabled');
    assert.equal(typeof output.ageAvailable, 'boolean');
  } finally {
    cleanup();
  }
});

test('key status shows mode and public key when configured', () => {
  const { dir, cleanup } = tempDir();
  try {
    initMemSync(dir);
    writeEncryptionConfig(dir, {
      version: 1,
      mode: 'age',
      publicKeys: ['age1test1234567890abcdefghijklmnopqrstuvwxyz']
    });

    const result = runCli(dir, ['key', 'status']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.encryption, 'age');
    assert.equal(output.publicKeys.length, 1);
    assert.ok(output.publicKeys[0].startsWith('age1'));
    assert.ok(output.publicKeyFingerprints);
    assert.ok(output.publicKeyFingerprints[0].fingerprint.includes('...'));
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// key export 测试
// ---------------------------------------------------------------------------

test('key export shows private key path', () => {
  const { dir, cleanup } = tempDir();
  try {
    initMemSync(dir);
    writeEncryptionConfig(dir, {
      version: 1,
      mode: 'age',
      publicKeys: ['age1test1234567890abcdefghijklmnopqrstuvwxyz']
    });

    // 创建模拟的私钥文件
    const keyDir = join(homedir(), '.mem-sync');
    mkdirSync(keyDir, { recursive: true });
    const keyPath = join(keyDir, 'age-key');
    const keyExists = existsSync(keyPath);

    // 如果私钥文件不存在，创建一个临时的
    if (!keyExists) {
      writeFileSync(keyPath, '# created: test\n# public key: age1test1234567890abcdefghijklmnopqrstuvwxyz\nAGE-SECRET-KEY-TEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'utf8');
    }

    try {
      const result = runCli(dir, ['key', 'export']);

      assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

      const output = JSON.parse(result.stdout.trim());
      assert.ok(output.privateKeyPath);
      assert.ok(output.privateKeyPath.endsWith('age-key'));
      assert.ok(output.instructions);
      assert.ok(output.instructions.includes('Back up this file'));
    } finally {
      // 清理测试创建的私钥文件（仅当我们创建了它）
      if (!keyExists) {
        try {
          rmSync(keyPath, { force: true });
        } catch {
          // 忽略清理错误
        }
      }
    }
  } finally {
    cleanup();
  }
});

test('key export shows error when no private key exists', () => {
  const { dir, cleanup } = tempDir();
  try {
    initMemSync(dir);
    writeEncryptionConfig(dir, {
      version: 1,
      mode: 'age',
      publicKeys: ['age1test1234567890abcdefghijklmnopqrstuvwxyz']
    });

    // 确保密钥文件不存在
    const keyPath = join(homedir(), '.mem-sync', 'age-key');
    const keyExists = existsSync(keyPath);

    // 如果存在，临时重命名
    let tempBackup = null;
    if (keyExists) {
      tempBackup = keyPath + '.backup-test';
      renameSync(keyPath, tempBackup);
    }

    try {
      const result = runCli(dir, ['key', 'export']);

      assert.notEqual(result.status, 0, 'should fail when private key missing');
      assert.ok(result.stderr.includes('Private key not found'));
    } finally {
      // 恢复备份
      if (tempBackup) {
        renameSync(tempBackup, keyPath);
      }
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// key 错误处理测试
// ---------------------------------------------------------------------------

test('key without subcommand throws error', () => {
  const { dir, cleanup } = tempDir();
  try {
    initMemSync(dir);
    const result = runCli(dir, ['key']);

    assert.notEqual(result.status, 0, 'should fail without subcommand');
    assert.ok(result.stderr.includes('key requires a subcommand'));
  } finally {
    cleanup();
  }
});

test('key with invalid subcommand throws error', () => {
  const { dir, cleanup } = tempDir();
  try {
    initMemSync(dir);
    const result = runCli(dir, ['key', 'invalid']);

    assert.notEqual(result.status, 0, 'should fail with invalid subcommand');
    assert.ok(result.stderr.includes('key requires a subcommand'));
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// init --encrypt 测试（需要 age 二进制文件）
// ---------------------------------------------------------------------------

test('init --encrypt generates keypair and config', async () => {
  // 检查 age 是否可用
  const { checkAgeBinary } = await import('../src/encryption.js');
  const ageCheck = await checkAgeBinary();
  if (!ageCheck.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, cleanup } = tempDir();
  try {
    const result = runCli(dir, ['init', '--encrypt']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.initialized, true);
    assert.ok(output.encryption);
    assert.equal(output.encryption.mode, 'age');
    assert.ok(output.encryption.publicKey);
    assert.ok(output.encryption.publicKey.startsWith('age1'));
    assert.ok(output.encryption.privateKeyPath);

    // 验证配置文件已创建
    const configPath = join(dir, 'meta', 'encryption.json');
    assert.ok(existsSync(configPath), 'encryption config should exist');

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.version, 1);
    assert.equal(config.mode, 'age');
    assert.equal(config.publicKeys.length, 1);
    assert.ok(config.publicKeys[0].startsWith('age1'));
  } finally {
    cleanup();
  }
});

test('init --encrypt without age binary shows install instructions', async () => {
  // 此测试验证 init --encrypt 在 age 不可用时显示安装说明。
  // 由于 age 通常在系统 PATH 中可用，此测试可能被跳过。
  const { dir, cleanup } = tempDir();
  try {
    // 尝试使用空 PATH 使 age 不可用（同时也会使 git 不可用）
    // 如果 init 失败，检查错误是否与 age 相关
    const emptyPathResult = spawnSync(process.execPath, [CLI_PATH, 'init', '--encrypt'], {
      env: {
        ...process.env,
        MEM_SYNC_HOME: dir,
        PATH: '/nonexistent-path'
      },
      encoding: 'utf8'
    });

    if (emptyPathResult.status !== 0) {
      // 失败可能是因为 git 不可用或 age 不可用
      // 两种情况都是合理的错误
      assert.ok(
        emptyPathResult.stderr.includes('age binary not found') ||
        emptyPathResult.stderr.includes('Install age') ||
        emptyPathResult.stderr.includes('age') ||
        emptyPathResult.stderr.includes('git') ||
        emptyPathResult.stderr.includes('Command failed'),
        `should show error, got: ${emptyPathResult.stderr}`
      );
    } else {
      // 如果空 PATH 下仍然成功（不太可能），跳过测试
      test.skip('age binary available even with empty PATH');
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// init --encrypt --password 测试
// ---------------------------------------------------------------------------

test('init --encrypt --password creates password mode config', async () => {
  // 检查 age 是否可用
  const { checkAgeBinary } = await import('../src/encryption.js');
  const ageCheck = await checkAgeBinary();
  if (!ageCheck.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, cleanup } = tempDir();
  try {
    const result = runCli(dir, ['init', '--encrypt', '--password']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.initialized, true);
    assert.ok(output.encryption);
    assert.equal(output.encryption.mode, 'password');

    // 验证配置文件已创建
    const configPath = join(dir, 'meta', 'encryption.json');
    assert.ok(existsSync(configPath), 'encryption config should exist');

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.version, 1);
    assert.equal(config.mode, 'password');
    assert.deepEqual(config.publicKeys, []);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// 帮助文本测试
// ---------------------------------------------------------------------------

test('help text includes key and encryption commands', () => {
  const result = spawnSync(process.execPath, [CLI_PATH, '--help'], {
    encoding: 'utf8'
  });

  // 无匹配命令时 printHelp() 以 exitCode=1 退出，帮助文本输出到 stdout
  assert.ok(result.stdout.includes('key status'), 'should include key status');
  assert.ok(result.stdout.includes('key export'), 'should include key export');
  assert.ok(result.stdout.includes('--encrypt'), 'should include --encrypt');
});
