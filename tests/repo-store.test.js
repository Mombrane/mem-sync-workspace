import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readJSONL,
  readJSONLStream,
  appendJSONL,
  writeJSONL,
  readMemories,
  resolveStorePath,
  resolveLegacyStorePath
} from '../src/repo-store.js';

/**
 * 辅助函数：在临时目录中创建隔离的 JSONL 存储路径。
 * 每个测试使用独立目录，避免测试间数据污染。
 */
function tempPath(name) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), `mem-sync-repo-${name}-`));
    return { dir, storePath: resolveStorePath(dir) };
  };
}

test('appendJSONL + readJSONL roundtrip', async () => {
  const { dir, storePath } = await tempPath('roundtrip')();

  try {
    const record1 = { id: 'mem_a', content: 'hello', scope: 'personal' };
    const record2 = { id: 'mem_b', content: 'world', scope: 'global' };

    await appendJSONL(record1, storePath);
    await appendJSONL(record2, storePath);

    const records = await readJSONL(storePath);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], record1);
    assert.deepEqual(records[1], record2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appendJSONL creates parent directories automatically', async () => {
  const { dir, storePath } = await tempPath('mkdir')();

  try {
    // storePath 在 temp dir 下，目录尚未创建
    await appendJSONL({ id: 'mem_x', content: 'test' }, storePath);

    const records = await readJSONL(storePath);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'mem_x');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONL returns empty array for non-existent file', async () => {
  const { dir, storePath } = await tempPath('missing')();

  try {
    const records = await readJSONL(storePath);
    assert.deepEqual(records, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONL skips malformed lines and empty lines', async () => {
  const { dir, storePath } = await tempPath('malformed')();

  try {
    // 手动写入包含损坏行的 JSONL 文件
    const content = [
      JSON.stringify({ id: 'mem_a', content: 'valid' }),
      '',                          // 空行——跳过
      'not valid json',            // 损坏行——跳过
      JSON.stringify({ id: 'mem_b', content: 'also valid' }),
      '   ',                       // 空白行——跳过
      '{ broken: true }',          // 非法 JSON——跳过
      JSON.stringify({ id: 'mem_c', content: 'third' })
    ].join('\n') + '\n';

    // 确保目录存在
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(storePath, content, 'utf8');

    const records = await readJSONL(storePath);
    assert.equal(records.length, 3);
    assert.equal(records[0].id, 'mem_a');
    assert.equal(records[1].id, 'mem_b');
    assert.equal(records[2].id, 'mem_c');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeJSONL overwrites existing content', async () => {
  const { dir, storePath } = await tempPath('overwrite')();

  try {
    // 先写入旧数据
    await writeJSONL([
      { id: 'old_1', content: 'old' },
      { id: 'old_2', content: 'old' }
    ], storePath);

    // 覆盖写入新数据
    await writeJSONL([
      { id: 'new_1', content: 'new' },
      { id: 'new_2', content: 'new' },
      { id: 'new_3', content: 'new' }
    ], storePath);

    const records = await readJSONL(storePath);
    assert.equal(records.length, 3);
    assert.equal(records[0].content, 'new');
    assert.equal(records[1].content, 'new');
    assert.equal(records[2].content, 'new');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeJSONL with empty array clears the store', async () => {
  const { dir, storePath } = await tempPath('clear')();

  try {
    // 先写入数据
    await writeJSONL([{ id: 'mem_1', content: 'data' }], storePath);
    let records = await readJSONL(storePath);
    assert.equal(records.length, 1);

    // 写入空数组清空存储
    await writeJSONL([], storePath);
    records = await readJSONL(storePath);
    assert.equal(records.length, 0);

    // 验证文件存在但内容为空
    const raw = await readFile(storePath, 'utf8');
    assert.equal(raw, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONLStream yields records in order', async () => {
  const { dir, storePath } = await tempPath('stream')();

  try {
    await appendJSONL({ id: 'mem_1', seq: 1 }, storePath);
    await appendJSONL({ id: 'mem_2', seq: 2 }, storePath);
    await appendJSONL({ id: 'mem_3', seq: 3 }, storePath);

    const records = [];
    for await (const record of readJSONLStream(storePath)) {
      records.push(record);
    }

    assert.equal(records.length, 3);
    assert.equal(records[0].seq, 1);
    assert.equal(records[1].seq, 2);
    assert.equal(records[2].seq, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONLStream handles non-existent file gracefully', async () => {
  const { dir, storePath } = await tempPath('stream-missing')();

  try {
    const records = [];
    for await (const record of readJSONLStream(storePath)) {
      records.push(record);
    }
    assert.deepEqual(records, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONLStream skips malformed lines', async () => {
  const { dir, storePath } = await tempPath('stream-malformed')();

  try {
    const content = [
      JSON.stringify({ id: 'mem_a', content: 'valid' }),
      'this is not json',
      JSON.stringify({ id: 'mem_b', content: 'also valid' })
    ].join('\n') + '\n';

    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(storePath, content, 'utf8');

    const records = [];
    for await (const record of readJSONLStream(storePath)) {
      records.push(record);
    }

    assert.equal(records.length, 2);
    assert.equal(records[0].id, 'mem_a');
    assert.equal(records[1].id, 'mem_b');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 向后兼容测试：当 JSONL 文件不存在时，
 * readMemories 应回退读取旧 JSON 格式的 { memories: [...] } 文件。
 *
 * 修复要点：readMemories 从 storePath 所在目录派生旧 JSON 路径，
 * 确保自定义目录（如测试临时目录）也能正确回退。
 */
test('readMemories falls back to legacy JSON format', async () => {
  const { dir } = await tempPath('legacy')();
  const legacyPath = resolveLegacyStorePath(dir);

  try {
    // 写入旧 JSON 格式（不写入 JSONL 文件）
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });

    const oldFormat = {
      memories: [
        { id: 'mem_old1', text: 'legacy record 1', scope: 'user', source: 'manual', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'mem_old2', text: 'legacy record 2', scope: 'global', source: 'codex', updatedAt: '2026-02-01T00:00:00.000Z' }
      ]
    };
    await writeFile(legacyPath, JSON.stringify(oldFormat, null, 2), 'utf8');

    // readMemories 应回退读取旧格式
    const records = await readMemories(resolveStorePath(dir));
    assert.equal(records.length, 2);
    assert.equal(records[0].id, 'mem_old1');
    assert.equal(records[0].text, 'legacy record 1');
    assert.equal(records[1].id, 'mem_old2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 向后兼容测试：当 JSONL 文件有数据时，
 * readMemories 优先返回 JSONL 数据，忽略旧的 JSON 文件。
 */
test('readMemories prefers JSONL over legacy JSON', async () => {
  const { dir } = await tempPath('prefer-jsonl')();
  const jsonlPath = resolveStorePath(dir);
  const legacyPath = resolveLegacyStorePath(dir);

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });

    // 同时写入 JSONL 和旧 JSON
    await appendJSONL({ id: 'mem_jsonl', content: 'from jsonl' }, jsonlPath);
    await writeFile(legacyPath, JSON.stringify({
      memories: [{ id: 'mem_legacy', text: 'from legacy' }]
    }, null, 2), 'utf8');

    // JSONL 有数据，应优先返回 JSONL 数据
    const records = await readMemories(jsonlPath);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'mem_jsonl');
    assert.equal(records[0].content, 'from jsonl');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveStorePath defaults to .mem-sync/memories.jsonl', () => {
  // 在未设置 MEM_SYNC_HOME 时检查默认路径
  // 注意：测试运行环境可能设置了 MEM_SYNC_HOME，这里测默认行为
  const path = resolveStorePath();
  assert.ok(path.endsWith('memories.jsonl'), `expected path to end with memories.jsonl, got ${path}`);
});

test('resolveLegacyStorePath points to .json extension', () => {
  const path = resolveLegacyStorePath();
  assert.ok(path.endsWith('memories.json'), `expected path to end with memories.json, got ${path}`);
});

/**
 * writeMemories 向后兼容测试：验证 writeMemories 输出 JSONL 格式。
 */
/**
 * REQ-014: Scope bank model — readJSONL normalizes legacy 'user' scope to 'personal'.
 * Records written with scope: 'user' should be read back as scope: 'personal'.
 */
test('readJSONL maps legacy user scope to personal', async () => {
  const { dir, storePath } = await tempPath('scope-migrate')();

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });

    // Write a record with legacy scope: 'user'
    const content = JSON.stringify({ id: 'mem_legacy_user', content: 'old user scope', scope: 'user' }) + '\n';
    await writeFile(storePath, content, 'utf8');

    const records = await readJSONL(storePath);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'mem_legacy_user');
    assert.equal(records[0].scope, 'personal');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONLStream maps legacy user scope to personal', async () => {
  const { dir, storePath } = await tempPath('scope-stream')();

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });

    const lines = [
      JSON.stringify({ id: 'mem_a', content: 'first', scope: 'user' }),
      JSON.stringify({ id: 'mem_b', content: 'second', scope: 'global' }),
      JSON.stringify({ id: 'mem_c', content: 'third', scope: 'user' })
    ].join('\n') + '\n';
    await writeFile(storePath, lines, 'utf8');

    const records = [];
    for await (const record of readJSONLStream(storePath)) {
      records.push(record);
    }

    assert.equal(records.length, 3);
    assert.equal(records[0].scope, 'personal');
    assert.equal(records[1].scope, 'global');
    assert.equal(records[2].scope, 'personal');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readJSONL leaves non-user scopes unchanged', async () => {
  const { dir, storePath } = await tempPath('scope-unchanged')();

  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });

    const lines = [
      JSON.stringify({ id: 'mem_1', content: 'a', scope: 'global' }),
      JSON.stringify({ id: 'mem_2', content: 'b', scope: 'project' }),
      JSON.stringify({ id: 'mem_3', content: 'c', scope: 'agent' }),
      JSON.stringify({ id: 'mem_4', content: 'd', scope: 'local-only' }),
      JSON.stringify({ id: 'mem_5', content: 'e', scope: 'personal' }),
      JSON.stringify({ id: 'mem_6', content: 'f', scope: 'team' })
    ].join('\n') + '\n';
    await writeFile(storePath, lines, 'utf8');

    const records = await readJSONL(storePath);
    assert.equal(records.length, 6);
    assert.equal(records[0].scope, 'global');
    assert.equal(records[1].scope, 'project');
    assert.equal(records[2].scope, 'agent');
    assert.equal(records[3].scope, 'local-only');
    assert.equal(records[4].scope, 'personal');
    assert.equal(records[5].scope, 'team');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeMemories outputs JSONL format', async () => {
  const { dir, storePath } = await tempPath('write-memories')();

  try {
    const { writeMemories } = await import('../src/repo-store.js');

    await writeMemories([
      { id: 'mem_1', content: 'first' },
      { id: 'mem_2', content: 'second' }
    ], storePath);

    // 验证文件内容为 JSONL 格式（每行一条 JSON）
    const raw = await readFile(storePath, 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { id: 'mem_1', content: 'first' });
    assert.deepEqual(JSON.parse(lines[1]), { id: 'mem_2', content: 'second' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
