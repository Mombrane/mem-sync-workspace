import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

/**
 * Helper: create an isolated MEM_SYNC_HOME temporary directory.
 */
async function setupTestEnv() {
  return mkdtemp(join(tmpdir(), 'mem-sync-cli-retain-'));
}

/**
 * Helper: create a temporary transcript JSON file.
 */
async function createTranscriptFile(dir, content) {
  const path = join(dir, 'transcript.json');
  await writeFile(path, JSON.stringify(content), 'utf8');
  return path;
}

/**
 * Helper: read all records from a pending JSONL file.
 */
async function readPendingFile(memSyncHome, deviceId) {
  const pendingPath = join(memSyncHome, 'pending', `${deviceId}.jsonl`);
  const raw = await readFile(pendingPath, 'utf8');
  return raw.trim().split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ─── Basic extraction and write ───────────────────────────────────────────

test('retain --pending writes candidates to pending/<device>.jsonl', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'user', content: '记住我更喜欢暗色主题' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const records = await readPendingFile(memSyncHome, 'test-device');
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'preference');
    assert.equal(records[0].scope, 'user');
    assert.equal(records[0].content, '我更喜欢暗色主题');
    assert.equal(records[0].source.type, 'retain');
    assert.equal(records[0].source.device, 'test-device');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Print candidate count ────────────────────────────────────────────────

test('retain prints new candidate count to stdout', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'user', content: '记住第一条' },
      { role: 'user', content: '以后都用 pnpm' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '2');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Reject without --pending ─────────────────────────────────────────────

test('retain rejects without --pending flag', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', '/tmp/transcript.json',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1');
    assert.match(result.stderr, /retain requires --pending/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Reject without --transcript-file ─────────────────────────────────────

test('retain rejects without --transcript-file', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1');
    assert.match(result.stderr, /--transcript-file requires a value/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Reject without --device ──────────────────────────────────────────────

test('retain rejects without --device', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', '/tmp/transcript.json',
      '--pending'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1');
    assert.match(result.stderr, /--device requires a value/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Handle nonexistent transcript file ───────────────────────────────────

test('retain handles nonexistent transcript file', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', '/tmp/nonexistent-file.json',
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1');
    assert.match(result.stderr, /transcript file not found/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Handle invalid JSON transcript ───────────────────────────────────────

test('retain handles invalid JSON transcript', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const badPath = join(tmpDir, 'bad.json');
    await writeFile(badPath, 'not valid json{{{', 'utf8');

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', badPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1, 'exit code should be 1');
    assert.match(result.stderr, /invalid JSON/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Empty transcript writes nothing, prints 0 ────────────────────────────

test('retain on empty transcript writes nothing and prints 0', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcriptPath = await createTranscriptFile(tmpDir, []);

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), '0');

    // Pending file should not exist (nothing written)
    await assert.rejects(
      () => readPendingFile(memSyncHome, 'test-device'),
      /ENOENT/
    );
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Dedup: running twice on same transcript doesn't duplicate ────────────

test('retain dedup — running twice does not duplicate records', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'user', content: '记住我更喜欢暗色主题' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    // First run
    let result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '1');

    // Second run — same transcript, should produce 0 new records
    result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '0');

    // Pending file should still have only 1 record
    const records = await readPendingFile(memSyncHome, 'test-device');
    assert.equal(records.length, 1);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Unknown flag handling ────────────────────────────────────────────────

test('retain rejects unknown flags', async () => {
  const memSyncHome = await setupTestEnv();

  try {
    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', '/tmp/t.json',
      '--pending',
      '--device', 'test-device',
      '--unknown-flag', 'value'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown option/);
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});

// ─── Optional --project-id and --agent-id ─────────────────────────────────

test('retain passes --project-id and --agent-id to records', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'user', content: '记住项目使用 TypeScript' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device',
      '--project-id', 'myproject',
      '--agent-id', 'claude'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readPendingFile(memSyncHome, 'test-device');
    assert.equal(records.length, 1);
    assert.equal(records[0].projectId, 'myproject');
    assert.equal(records[0].agentId, 'claude');
    assert.equal(records[0].source.agent, 'claude');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Different device IDs write to different pending files ────────────────

test('retain writes to device-specific pending file', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'user', content: '记住设备特定记忆' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    // Write to device-a
    let result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'device-a'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);

    // Write to device-b
    result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'device-b'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);

    // Each device has its own file
    const recordsA = await readPendingFile(memSyncHome, 'device-a');
    const recordsB = await readPendingFile(memSyncHome, 'device-b');
    assert.equal(recordsA.length, 1);
    assert.equal(recordsB.length, 1);
    assert.equal(recordsA[0].source.device, 'device-a');
    assert.equal(recordsB[0].source.device, 'device-b');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Transcript with only assistant messages produces empty output ────────

test('retain on assistant-only transcript prints 0', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'assistant', content: 'I remember the user said something important' },
      { role: 'system', content: 'system configuration details' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '0');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ─── Schema v1 record structure ───────────────────────────────────────────

test('retain produces valid Schema v1 records', async () => {
  const memSyncHome = await setupTestEnv();
  const tmpDir = await mkdtemp(join(tmpdir(), 'retain-transcript-'));

  try {
    const transcript = [
      { role: 'user', content: '记住我偏好 pnpm' }
    ];
    const transcriptPath = await createTranscriptFile(tmpDir, transcript);

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device'
    ], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);

    const records = await readPendingFile(memSyncHome, 'test-device');
    assert.equal(records.length, 1);
    assert.equal(records[0].schemaVersion, 1);
    assert.ok(records[0].id, 'record should have an id');
    assert.ok(records[0].canonicalKey, 'record should have a canonicalKey');
    assert.equal(records[0].kind, 'preference');
    assert.equal(records[0].scope, 'user');
    assert.equal(records[0].source.type, 'retain');
    assert.equal(records[0].source.device, 'test-device');
    assert.ok(Array.isArray(records[0].evidence));
    assert.equal(records[0].evidence[0].type, 'user_message');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
    await rm(tmpDir, { recursive: true, force: true });
  }
});
