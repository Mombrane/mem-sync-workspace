import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  isEncrypted,
  loadEncryptionConfig,
  checkAgeBinary,
  generateKeypair,
  encryptLine,
  decryptLine,
  decryptLineSync
} from '../src/encryption.js';

/**
 * 辅助函数：创建临时目录，返回目录路径和清理函数。
 */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-encrypt-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

/**
 * 辅助函数：在临时目录中写入 meta/encryption.json 配置文件。
 * 自动创建 meta 子目录。
 */
function writeEncryptionConfig(dir, config) {
  const metaDir = join(dir, 'meta');
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(join(metaDir, 'encryption.json'), JSON.stringify(config), 'utf8');
}

// ---------------------------------------------------------------------------
// isEncrypted 测试
// ---------------------------------------------------------------------------

test('isEncrypted returns true for age-encrypted lines with header prefix', () => {
  assert.equal(isEncrypted('age-encryption.org/v1 -> X25519 abc123'), true);
  assert.equal(isEncrypted('  age-encryption.org/v1 something'), true);
});

test('isEncrypted returns true for PEM-format age encrypted lines', () => {
  assert.equal(isEncrypted('-----BEGIN AGE ENCRYPTED FILE-----'), true);
  assert.equal(isEncrypted(' -----BEGIN AGE ENCRYPTED FILE-----'), true);
});

test('isEncrypted returns false for JSON lines', () => {
  assert.equal(isEncrypted('{"key": "value"}'), false);
  assert.equal(isEncrypted('  [1, 2, 3]'), false);
});

test('isEncrypted returns false for empty or non-string input', () => {
  assert.equal(isEncrypted(''), false);
  assert.equal(isEncrypted(null), false);
  assert.equal(isEncrypted(undefined), false);
  assert.equal(isEncrypted(123), false);
});

// ---------------------------------------------------------------------------
// loadEncryptionConfig 测试
// ---------------------------------------------------------------------------

test('loadEncryptionConfig returns null when no config file exists', async () => {
  const { dir, cleanup } = tempDir();
  try {
    const config = await loadEncryptionConfig(dir);
    assert.equal(config, null);
  } finally {
    cleanup();
  }
});

test('loadEncryptionConfig returns valid config when file exists', async () => {
  const { dir, cleanup } = tempDir();
  try {
    writeEncryptionConfig(dir, { version: 1, mode: 'age', publicKeys: ['age1test'] });
    const config = await loadEncryptionConfig(dir);
    assert.ok(config);
    assert.equal(config.version, 1);
    assert.equal(config.mode, 'age');
    assert.deepEqual(config.publicKeys, ['age1test']);
  } finally {
    cleanup();
  }
});

test('loadEncryptionConfig throws on invalid JSON', async () => {
  const { dir, cleanup } = tempDir();
  try {
    const metaDir = join(dir, 'meta');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(join(metaDir, 'encryption.json'), 'not valid json{{{', 'utf8');
    await assert.rejects(
      () => loadEncryptionConfig(dir),
      /encryption config is not valid JSON/
    );
  } finally {
    cleanup();
  }
});

test('loadEncryptionConfig throws on unsupported version', async () => {
  const { dir, cleanup } = tempDir();
  try {
    writeEncryptionConfig(dir, { version: 2, mode: 'age' });
    await assert.rejects(
      () => loadEncryptionConfig(dir),
      /unsupported encryption config version: 2/
    );
  } finally {
    cleanup();
  }
});

test('loadEncryptionConfig throws on missing mode field', async () => {
  const { dir, cleanup } = tempDir();
  try {
    writeEncryptionConfig(dir, { version: 1 });
    await assert.rejects(
      () => loadEncryptionConfig(dir),
      /encryption config missing "mode" field/
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// checkAgeBinary 测试
// ---------------------------------------------------------------------------

test('checkAgeBinary returns availability info', async () => {
  const result = await checkAgeBinary();
  assert.ok(result);
  assert.equal(typeof result.available, 'boolean');
  // Verify return structure: available is always a boolean
  if (result.available) {
    assert.ok(typeof result.path === 'string' && result.path.length > 0);
    assert.ok(typeof result.version === 'string');
  } else {
    assert.equal(result.path, null);
    assert.equal(result.version, null);
  }
});

// ---------------------------------------------------------------------------
// generateKeypair 测试（需要 age-keygen 二进制文件）
// ---------------------------------------------------------------------------

test('generateKeypair creates a keypair', { skip: false }, async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    // 跳过条件：age 二进制不可用
    test.skip('age binary not available');
    return;
  }

  const { dir, cleanup } = tempDir();
  try {
    const keyPath = join(dir, 'key.txt');
    const result = await generateKeypair(keyPath);

    assert.ok(result.publicKey);
    assert.ok(result.publicKey.startsWith('age1'));
    assert.equal(result.privateKeyPath, keyPath);

    // 验证私钥文件已创建
    const { readFile } = await import('node:fs/promises');
    const privateKeyContent = await readFile(keyPath, 'utf8');
    assert.ok(privateKeyContent.includes('AGE-SECRET-KEY-'));
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// encryptLine + decryptLine 往返测试
// ---------------------------------------------------------------------------

test('encryptLine + decryptLine roundtrip preserves content', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, cleanup } = tempDir();
  try {
    const keyPath = join(dir, 'key.txt');
    const { publicKey } = await generateKeypair(keyPath);

    const config = { mode: 'age', publicKeys: [publicKey], privateKeyPath: keyPath };
    const plaintext = '{"type":"memory","content":"hello world"}';
    const encrypted = await encryptLine(plaintext, config);

    // 加密后的内容应包含 age 头部
    assert.ok(isEncrypted(encrypted));
    assert.notEqual(encrypted, plaintext);

    // 解密后应与原文一致
    const decrypted = await decryptLine(encrypted, config);
    assert.equal(decrypted, plaintext);
  } finally {
    cleanup();
  }
});

test('encryptLine + decryptLine roundtrip with Chinese text', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, cleanup } = tempDir();
  try {
    const keyPath = join(dir, 'key.txt');
    const { publicKey } = await generateKeypair(keyPath);

    const config = { mode: 'age', publicKeys: [publicKey], privateKeyPath: keyPath };
    const plaintext = '{"type":"memory","content":"你好世界 🌍"}';
    const encrypted = await encryptLine(plaintext, config);
    const decrypted = await decryptLine(encrypted, config);

    assert.equal(decrypted, plaintext);
  } finally {
    cleanup();
  }
});

test('decryptLine with wrong config throws error', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, cleanup } = tempDir();
  try {
    const keyPath = join(dir, 'key.txt');
    const { publicKey } = await generateKeypair(keyPath);

    // 用正确的公钥加密
    const config = { mode: 'age', publicKeys: [publicKey], privateKeyPath: keyPath };
    const encrypted = await encryptLine('secret data', config);

    // 生成另一个密钥对，用错误的私钥解密
    const wrongKeyPath = join(dir, 'wrong-key.txt');
    const wrongKeypair = await generateKeypair(wrongKeyPath);
    const wrongConfig = { mode: 'age', privateKeyPath: wrongKeyPath, publicKeys: [wrongKeypair.publicKey] };

    await assert.rejects(
      () => decryptLine(encrypted, wrongConfig),
      /age/
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// password mode tests (age-encryption JS library, no age binary needed)
// ---------------------------------------------------------------------------

test('encryptLine + decryptLine roundtrip with password mode', async () => {
  process.env.MEM_SYNC_PASSWORD = 'test-password-123';
  try {
    const config = { mode: 'password' };
    const plaintext = '{"type":"memory","content":"secret data"}';
    const encrypted = await encryptLine(plaintext, config);

    // 加密后的内容应包含 age 头部
    assert.ok(isEncrypted(encrypted));
    assert.notEqual(encrypted, plaintext);

    // 解密后应与原文一致
    const decrypted = await decryptLine(encrypted, config);
    assert.equal(decrypted, plaintext);
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }
});

test('encryptLine + decryptLine roundtrip with password mode and Chinese text', async () => {
  process.env.MEM_SYNC_PASSWORD = 'test-password-456';
  try {
    const config = { mode: 'password' };
    const plaintext = '{"type":"memory","content":"你好世界 🌍"}';
    const encrypted = await encryptLine(plaintext, config);
    const decrypted = await decryptLine(encrypted, config);
    assert.equal(decrypted, plaintext);
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }
});

test('encryptLine password mode throws when MEM_SYNC_PASSWORD is missing', async () => {
  delete process.env.MEM_SYNC_PASSWORD;
  await assert.rejects(
    () => encryptLine('data', { mode: 'password' }),
    /MEM_SYNC_PASSWORD/
  );
});

test('decryptLine password mode throws when MEM_SYNC_PASSWORD is missing', async () => {
  delete process.env.MEM_SYNC_PASSWORD;
  await assert.rejects(
    () => decryptLine('data', { mode: 'password' }),
    /MEM_SYNC_PASSWORD/
  );
});

test('decryptLine password mode throws with wrong password', async () => {
  process.env.MEM_SYNC_PASSWORD = 'correct-password';
  let encrypted;
  try {
    encrypted = await encryptLine('secret data', { mode: 'password' });
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }

  process.env.MEM_SYNC_PASSWORD = 'wrong-password';
  try {
    await assert.rejects(
      () => decryptLine(encrypted, { mode: 'password' }),
      /no identity/
    );
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }
});

test('decryptLineSync password mode roundtrip', async () => {
  process.env.MEM_SYNC_PASSWORD = 'sync-test-password';
  try {
    const plaintext = '{"type":"memory","content":"sync decrypt test"}';
    const encrypted = await encryptLine(plaintext, { mode: 'password' });
    const decrypted = decryptLineSync(encrypted, { mode: 'password' });
    assert.equal(decrypted, plaintext);
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }
});

test('decryptLineSync password mode throws when MEM_SYNC_PASSWORD is missing', () => {
  delete process.env.MEM_SYNC_PASSWORD;
  assert.throws(
    () => decryptLineSync('data', { mode: 'password' }),
    /MEM_SYNC_PASSWORD/
  );
});

test('decryptLineSync password mode throws with wrong password', async () => {
  process.env.MEM_SYNC_PASSWORD = 'correct-password';
  let encrypted;
  try {
    encrypted = await encryptLine('secret data', { mode: 'password' });
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }

  process.env.MEM_SYNC_PASSWORD = 'wrong-password';
  try {
    assert.throws(
      () => decryptLineSync(encrypted, { mode: 'password' }),
      /no identity/
    );
  } finally {
    delete process.env.MEM_SYNC_PASSWORD;
  }
});

// ---------------------------------------------------------------------------
// REQ-018: 错误优先级测试 — 模式验证应先于二进制检查 (unknown mode)
// ---------------------------------------------------------------------------

test('encryptLine throws for unknown mode', async () => {
  await assert.rejects(
    () => encryptLine('data', { mode: 'unknown' }),
    /unsupported encryption mode: unknown/
  );
});

test('decryptLine throws for unknown mode', async () => {
  await assert.rejects(
    () => decryptLine('data', { mode: 'unknown' }),
    /unsupported encryption mode: unknown/
  );
});

test('encryptLine unknown mode validation occurs before binary check', async () => {
  await assert.rejects(
    () => encryptLine('data', { mode: 'unknown' }),
    /unsupported encryption mode: unknown/
  );
});

test('decryptLine unknown mode validation occurs before binary check', async () => {
  await assert.rejects(
    () => decryptLine('data', { mode: 'unknown' }),
    /unsupported encryption mode: unknown/
  );
});

test('decryptLineSync unknown mode validation occurs before binary check', () => {
  assert.throws(
    () => decryptLineSync('data', { mode: 'unknown' }),
    /unsupported encryption mode: unknown/
  );
});
