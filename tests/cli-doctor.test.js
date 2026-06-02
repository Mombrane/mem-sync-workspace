import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

// ─── Test helpers ──────────────────────────────────────────────────

function makeRecord(overrides = {}) {
  const scope = overrides.scope ?? 'global';
  const kind = overrides.kind ?? 'episode';
  const content = overrides.content ?? '测试记忆内容。';
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'mem_test001',
    canonicalKey: overrides.canonicalKey ?? `${scope}:${kind}:${hash}`,
    kind,
    scope,
    projectId: overrides.projectId ?? null,
    agentId: overrides.agentId ?? null,
    content,
    summary: overrides.summary ?? content,
    source: overrides.source ?? { type: 'manual' },
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 1,
    importance: overrides.importance ?? 0.5,
    veracity: overrides.veracity ?? 'stated',
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-06-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T10:00:00.000Z',
    validUntil: overrides.validUntil ?? null,
    deletedAt: overrides.deletedAt ?? null,
    supersedes: overrides.supersedes ?? []
  };
}

function initGitRepo(dir) {
  execSync(`git init -b main "${dir}"`, { encoding: 'utf8' });
  execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
  execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
}

function commitFile(repoDir, filename, content, message) {
  writeFileSync(join(repoDir, filename), content, 'utf8');
  execSync(`git add "${filename}"`, { cwd: repoDir, encoding: 'utf8' });
  execSync(`git commit -m "${message || 'add ' + filename}"`, { cwd: repoDir, encoding: 'utf8' });
}

function setupMemSyncEnv(options = {}) {
  const {
    withJSONL = false,
    jsonlRecords = [],
    withPending = false,
    pendingRecords = [],
    withIndex = false
  } = options;

  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-doctor-'));

  initGitRepo(dir);
  commitFile(dir, 'README.md', '# mem-sync', 'init');

  if (withJSONL && jsonlRecords.length > 0) {
    const lines = jsonlRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(dir, 'memories.jsonl'), lines, 'utf8');
    commitFile(dir, 'memories.jsonl', lines, 'add memories');
  }

  if (withPending && pendingRecords.length > 0) {
    const pendingDir = join(dir, 'pending');
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(
      join(pendingDir, 'device-test.json'),
      JSON.stringify(pendingRecords),
      'utf8'
    );
  }

  if (withIndex && jsonlRecords.length > 0) {
    const cacheDir = join(dir, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: dir },
      encoding: 'utf8'
    });
  }

  return { dir };
}

function cleanupEnv(env) {
  rmSync(env.dir, { recursive: true, force: true });
}

function runDoctor(env, args = []) {
  return spawnSync(process.execPath, [CLI_PATH, 'doctor', ...args], {
    env: { ...process.env, MEM_SYNC_HOME: env.dir },
    encoding: 'utf8'
  });
}

function parseStdoutJSON(stdout) {
  return JSON.parse(stdout.trim());
}

// ─── Test cases ────────────────────────────────────────────────────

test('doctor: healthy state returns ok=true', () => {
  const records = [makeRecord({ id: 'mem_001', content: '健康状态测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records, withIndex: true });

  try {
    const result = runDoctor(env);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = parseStdoutJSON(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.checks.jsonl.ok, true);
    assert.equal(output.checks.index.ok, true);
    assert.equal(output.checks.lock.ok, true);
    assert.equal(output.checks.repo.ok, true);
    assert.equal(output.checks.pending.ok, true);
    assert.equal(output.checks.remote.ok, true);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: missing .mem-sync dir still runs (not_initialized)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-doctor-missing-'));
  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'doctor'], {
      env: { ...process.env, MEM_SYNC_HOME: join(dir, 'nonexistent') },
      encoding: 'utf8'
    });

    const output = parseStdoutJSON(result.stdout);
    assert.ok('checks' in output, 'should have checks field');
    assert.ok('jsonl' in output.checks, 'should have jsonl check');
    assert.ok('records' in output.checks, 'should have records check');
    assert.ok('repo' in output.checks, 'should have repo check');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor: empty JSONL returns ok=true with 0 records', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    assert.equal(output.checks.jsonl.ok, true);
    assert.equal(output.checks.jsonl.validRecords, 0);
    assert.equal(output.checks.records.total, 0);
    assert.equal(output.checks.records.active, 0);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: malformed JSONL lines produce parseErrors > 0 and ok=false', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const lines = [
      JSON.stringify(makeRecord({ id: 'mem_good', content: '正常记录。' })),
      'this is not valid json',
      '{"incomplete": true'
    ].join('\n') + '\n';
    writeFileSync(join(env.dir, 'memories.jsonl'), lines, 'utf8');

    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    assert.equal(output.ok, false);
    assert.ok(output.checks.jsonl.parseErrors > 0, `should have parse errors, got ${output.checks.jsonl.parseErrors}`);
    assert.equal(output.checks.jsonl.ok, false);
    assert.ok(output.checks.jsonl.details.length > 0, 'should have error details');
    assert.ok(output.checks.jsonl.details[0].line, 'detail should have line number');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: schema validation errors produce validationErrors > 0', () => {
  const env = setupMemSyncEnv({ withJSONL: false });

  try {
    const lines = [
      JSON.stringify(makeRecord({ id: 'mem_valid', content: '有效记录。' })),
      JSON.stringify({ id: 'mem_invalid', content: '无效记录，缺少必要字段。' })
    ].join('\n') + '\n';
    writeFileSync(join(env.dir, 'memories.jsonl'), lines, 'utf8');

    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    assert.ok(output.checks.jsonl.validationErrors > 0, `should have validation errors, got ${output.checks.jsonl.validationErrors}`);
    assert.equal(output.checks.jsonl.validRecords, 1);
    assert.ok(output.checks.jsonl.details.some(d => d.id === 'mem_invalid'), 'should have detail for invalid record');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: stale lock file is detected', () => {
  const records = [makeRecord({ id: 'mem_001', content: '锁文件测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records });

  try {
    writeFileSync(join(env.dir, 'repo.lock'), '99999', 'utf8');

    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    assert.equal(output.checks.lock.exists, true);
    assert.equal(output.checks.lock.stale, true);
    assert.equal(output.checks.lock.pid, 99999);
    assert.equal(output.checks.lock.ok, false);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: stale index is detected when HEAD changes', () => {
  const records = [makeRecord({ id: 'mem_001', content: '索引过期测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records, withIndex: true });

  try {
    commitFile(env.dir, 'newfile.txt', 'new content', 'change HEAD');

    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    assert.equal(output.checks.index.exists, true);
    assert.equal(output.checks.index.stale, true);
    assert.equal(output.checks.index.ok, false);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: JSON output has all expected fields', () => {
  const records = [makeRecord({ id: 'mem_001', content: '字段验证测试。' })];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records });

  try {
    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    // Top level
    assert.ok('ok' in output, 'should have ok field');
    assert.ok('checks' in output, 'should have checks field');

    // JSONL check
    assert.ok('jsonl' in output.checks);
    assert.ok('ok' in output.checks.jsonl);
    assert.ok('totalLines' in output.checks.jsonl);
    assert.ok('validRecords' in output.checks.jsonl);
    assert.ok('parseErrors' in output.checks.jsonl);
    assert.ok('validationErrors' in output.checks.jsonl);
    assert.ok('details' in output.checks.jsonl);

    // Records check
    assert.ok('records' in output.checks);
    assert.ok('total' in output.checks.records);
    assert.ok('active' in output.checks.records);
    assert.ok('deleted' in output.checks.records);
    assert.ok('expired' in output.checks.records);

    // Index check
    assert.ok('index' in output.checks);
    assert.ok('ok' in output.checks.index);
    assert.ok('exists' in output.checks.index);
    assert.ok('stale' in output.checks.index);
    assert.ok('records' in output.checks.index);

    // Lock check
    assert.ok('lock' in output.checks);
    assert.ok('ok' in output.checks.lock);
    assert.ok('exists' in output.checks.lock);

    // Repo check
    assert.ok('repo' in output.checks);
    assert.ok('ok' in output.checks.repo);
    assert.ok('initialized' in output.checks.repo);
    assert.ok('head' in output.checks.repo);
    assert.ok('rebaseInProgress' in output.checks.repo);

    // Pending check
    assert.ok('pending' in output.checks);
    assert.ok('ok' in output.checks.pending);
    assert.ok('files' in output.checks.pending);
    assert.ok('records' in output.checks.pending);

    // Remote check
    assert.ok('remote' in output.checks);
    assert.ok('ok' in output.checks.remote);
    assert.ok('configured' in output.checks.remote);
    assert.ok('reachable' in output.checks.remote);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: deleted and expired records are counted correctly', () => {
  const records = [
    makeRecord({ id: 'mem_active', content: '活跃记录。' }),
    makeRecord({ id: 'mem_deleted', content: '已删除记录。', deletedAt: '2026-06-01T12:00:00.000Z' }),
    makeRecord({ id: 'mem_expired', content: '已过期记录。', validUntil: '2026-01-01T00:00:00.000Z' })
  ];
  const env = setupMemSyncEnv({ withJSONL: true, jsonlRecords: records });

  try {
    const result = runDoctor(env);
    const output = parseStdoutJSON(result.stdout);

    assert.equal(output.checks.records.total, 3);
    assert.equal(output.checks.records.active, 1);
    assert.equal(output.checks.records.deleted, 1);
    assert.equal(output.checks.records.expired, 1);
  } finally {
    cleanupEnv(env);
  }
});
