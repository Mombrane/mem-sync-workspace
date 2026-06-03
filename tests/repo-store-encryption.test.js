import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readJSONL,
  readJSONLStream,
  appendJSONL,
  writeJSONL,
  resolveStorePath
} from '../src/repo-store.js';
import {
  checkAgeBinary,
  generateKeypair,
  isEncrypted
} from '../src/encryption.js';

/**
 * 辅助函数：创建临时目录，生成密钥对并写入加密配置。
 * 返回目录路径、storePath、密钥信息和清理函数。
 */
async function setupEncryptedStore(name) {
  const dir = await mkdtemp(join(tmpdir(), `mem-sync-enc-${name}-`));
  const storePath = resolveStorePath(dir);

  // 生成密钥对
  const keyPath = join(dir, 'key.txt');
  const { publicKey } = await generateKeypair(keyPath);

  // 写入加密配置
  const metaDir = join(dir, 'meta');
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, 'encryption.json'),
    JSON.stringify({
      version: 1,
      mode: 'age',
      publicKeys: [publicKey],
      privateKeyPath: keyPath
    }),
    'utf8'
  );

  return {
    dir,
    storePath,
    publicKey,
    keyPath,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

/**
 * 辅助函数：创建无加密配置的临时存储。
 */
async function setupPlaintextStore(name) {
  const dir = await mkdtemp(join(tmpdir(), `mem-sync-plain-${name}-`));
  const storePath = resolveStorePath(dir);
  return {
    dir,
    storePath,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

// ---------------------------------------------------------------------------
// 加密集成测试（需要 age 二进制文件）
// ---------------------------------------------------------------------------

test('appendJSONL encrypts when config exists', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, storePath, cleanup } = await setupEncryptedStore('append-enc');
  try {
    const record = { id: 'mem_1', content: 'secret data', scope: 'personal' };
    await appendJSONL(record, storePath);

    // 验证文件内容包含 age 加密头部（非明文 JSON）
    const raw = await readFile(storePath, 'utf8');
    assert.ok(isEncrypted(raw), 'file content should be age-encrypted');
    assert.ok(!raw.includes('"id":"mem_1"'), 'file should not contain plaintext JSON');
  } finally {
    await cleanup();
  }
});

test('readJSONL decrypts encrypted lines', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, storePath, cleanup } = await setupEncryptedStore('read-enc');
  try {
    const record = { id: 'mem_1', content: 'hello world', scope: 'personal' };
    await appendJSONL(record, storePath);

    const records = await readJSONL(storePath);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], record);
  } finally {
    await cleanup();
  }
});

test('readJSONL handles mixed plain/encrypted lines', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, storePath, cleanup } = await setupEncryptedStore('mixed');
  try {
    // 先以加密模式写入一条记录
    const encRecord = { id: 'mem_enc', content: 'encrypted data' };
    await appendJSONL(encRecord, storePath);

    // 手动追加一条明文记录（模拟混合场景）
    const plainRecord = { id: 'mem_plain', content: 'plain data' };
    await writeFile(storePath, JSON.stringify(plainRecord) + '\n', { flag: 'a' });

    const records = await readJSONL(storePath);
    assert.equal(records.length, 2);

    // 加密记录应被正确解密
    const enc = records.find(r => r.id === 'mem_enc');
    assert.ok(enc, 'encrypted record should be readable');
    assert.equal(enc.content, 'encrypted data');

    // 明文记录应正常读取
    const plain = records.find(r => r.id === 'mem_plain');
    assert.ok(plain, 'plain record should be readable');
    assert.equal(plain.content, 'plain data');
  } finally {
    await cleanup();
  }
});

test('writeJSONL encrypts all lines', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, storePath, cleanup } = await setupEncryptedStore('write-enc');
  try {
    const records = [
      { id: 'mem_1', content: 'first' },
      { id: 'mem_2', content: 'second' },
      { id: 'mem_3', content: 'third' }
    ];
    await writeJSONL(records, storePath);

    // 验证文件内容全部为加密格式
    const raw = await readFile(storePath, 'utf8');
    // 不应包含任何明文 JSON
    assert.ok(!raw.includes('"id":"mem_1"'), 'should not contain plaintext record 1');
    assert.ok(!raw.includes('"id":"mem_2"'), 'should not contain plaintext record 2');
    assert.ok(!raw.includes('"id":"mem_3"'), 'should not contain plaintext record 3');

    // 通过 readJSONL 验证可以正确解密回原数据
    const readBack = await readJSONL(storePath);
    assert.equal(readBack.length, 3);
    assert.equal(readBack[0].id, 'mem_1');
    assert.equal(readBack[0].content, 'first');
    assert.equal(readBack[1].id, 'mem_2');
    assert.equal(readBack[1].content, 'second');
    assert.equal(readBack[2].id, 'mem_3');
    assert.equal(readBack[2].content, 'third');
  } finally {
    await cleanup();
  }
});

test('readJSONLStream decrypts encrypted lines', async () => {
  const ageAvailable = await checkAgeBinary();
  if (!ageAvailable.available) {
    test.skip('age binary not available');
    return;
  }

  const { dir, storePath, cleanup } = await setupEncryptedStore('stream-enc');
  try {
    const records = [
      { id: 'mem_1', seq: 1 },
      { id: 'mem_2', seq: 2 },
      { id: 'mem_3', seq: 3 }
    ];
    for (const r of records) {
      await appendJSONL(r, storePath);
    }

    const readBack = [];
    for await (const record of readJSONLStream(storePath)) {
      readBack.push(record);
    }

    assert.equal(readBack.length, 3);
    assert.equal(readBack[0].id, 'mem_1');
    assert.equal(readBack[0].seq, 1);
    assert.equal(readBack[1].id, 'mem_2');
    assert.equal(readBack[1].seq, 2);
    assert.equal(readBack[2].id, 'mem_3');
    assert.equal(readBack[2].seq, 3);
  } finally {
    await cleanup();
  }
});

test('plaintext repos work without encryption config (no regression)', async () => {
  const { dir, storePath, cleanup } = await setupPlaintextStore('no-regression');
  try {
    const record1 = { id: 'mem_a', content: 'hello', scope: 'personal' };
    const record2 = { id: 'mem_b', content: 'world', scope: 'global' };

    // appendJSONL 应以明文写入
    await appendJSONL(record1, storePath);
    await appendJSONL(record2, storePath);

    // 验证文件内容为明文 JSON
    const raw = await readFile(storePath, 'utf8');
    assert.ok(!isEncrypted(raw), 'plaintext repo should not have encrypted content');
    assert.ok(raw.includes('"id":"mem_a"'), 'should contain plaintext JSON');

    // readJSONL 应正确读取
    const records = await readJSONL(storePath);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], record1);
    assert.deepEqual(records[1], record2);

    // readJSONLStream 应正确读取
    const streamRecords = [];
    for await (const r of readJSONLStream(storePath)) {
      streamRecords.push(r);
    }
    assert.equal(streamRecords.length, 2);
    assert.deepEqual(streamRecords[0], record1);
    assert.deepEqual(streamRecords[1], record2);

    // writeJSONL 应以明文写入
    const newRecords = [
      { id: 'mem_x', content: 'new' },
      { id: 'mem_y', content: 'data' }
    ];
    await writeJSONL(newRecords, storePath);
    const readBack = await readJSONL(storePath);
    assert.equal(readBack.length, 2);
    assert.deepEqual(readBack, newRecords);
  } finally {
    await cleanup();
  }
});
