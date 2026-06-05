import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;

function setupEnv(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-redact-'));
  mkdirSync(join(dir, '.mem-sync'), { recursive: true });

  if (options.jsonlContent) {
    writeFileSync(join(dir, '.mem-sync', 'memories.jsonl'), options.jsonlContent, 'utf8');
  }

  return { dir };
}

function cleanupEnv(env) {
  rmSync(env.dir, { recursive: true, force: true });
}

function runCli(dir, args, extraEnv = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: dir,
    env: { ...process.env, MEM_SYNC_HOME: join(dir, '.mem-sync'), ...extraEnv },
    encoding: 'utf8',
  });
}

// 1. Scan clean memories → ok=true, no findings
test('redact --check: clean memories → ok=true, no findings', () => {
  const env = setupEnv({
    jsonlContent: JSON.stringify({ id: 'mem_1', content: 'I like coffee', scope: 'global' }) + '\n',
  });
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.scanned, 1);
    assert.deepEqual(output.findings, []);
  } finally {
    cleanupEnv(env);
  }
});

// 2. Scan memories with AWS key → ok=false, finding with rule='aws-key'
test('redact --check: password pattern → ok=false, rule=password', () => {
  const env = setupEnv({
    jsonlContent: JSON.stringify({ id: 'mem_2', content: 'password: mysecretvalue12345', scope: 'global' }) + '\n',
  });
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.scanned, 1);
    assert.ok(output.findings.length > 0);
    assert.equal(output.findings[0].rule, 'password');
  } finally {
    cleanupEnv(env);
  }
});

// 3. Scan empty JSONL → ok=true, scanned=0
test('redact --check: empty JSONL → ok=true, scanned=0', () => {
  const env = setupEnv({ jsonlContent: '' });
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.scanned, 0);
    assert.deepEqual(output.findings, []);
  } finally {
    cleanupEnv(env);
  }
});

// 4. Scan missing JSONL → ok=true, scanned=0
test('redact --check: missing JSONL → ok=true, scanned=0', () => {
  const env = setupEnv();
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.scanned, 0);
    assert.deepEqual(output.findings, []);
  } finally {
    cleanupEnv(env);
  }
});

// 5. Scan memories with JWT → finding with rule='jwt-token'
test('redact --check: JWT token → finding with rule=jwt-token', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const env = setupEnv({
    jsonlContent: JSON.stringify({ id: 'mem_3', content: `token is ${jwt}`, scope: 'global' }) + '\n',
  });
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.ok(output.findings.some(f => f.rule === 'jwt-token'));
  } finally {
    cleanupEnv(env);
  }
});

// 6. Scan memories with private key → finding with rule='private-key'
test('redact --check: private key → finding with rule=private-key', () => {
  const env = setupEnv({
    jsonlContent: JSON.stringify({ id: 'mem_4', content: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowI...', scope: 'global' }) + '\n',
  });
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.ok(output.findings.some(f => f.rule === 'private-key'));
  } finally {
    cleanupEnv(env);
  }
});

// 7. JSON output structure verification
test('redact --check: output has ok, scanned, findings fields', () => {
  const env = setupEnv({
    jsonlContent: JSON.stringify({ id: 'mem_5', content: 'hello world', scope: 'global' }) + '\n',
  });
  try {
    const result = runCli(env.dir, ['redact', '--check']);
    assert.equal(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.ok('ok' in output, 'missing ok field');
    assert.ok('scanned' in output, 'missing scanned field');
    assert.ok('findings' in output, 'missing findings field');
    assert.ok(Array.isArray(output.findings), 'findings should be array');
    // Each finding should have line, id, rule, severity
    if (output.findings.length > 0) {
      const f = output.findings[0];
      assert.ok('line' in f, 'finding missing line');
      assert.ok('id' in f, 'finding missing id');
      assert.ok('rule' in f, 'finding missing rule');
      assert.ok('severity' in f, 'finding missing severity');
    }
  } finally {
    cleanupEnv(env);
  }
});

// 8. redact without --check flag → error
test('redact without --check → error', () => {
  const env = setupEnv();
  try {
    const result = runCli(env.dir, ['redact']);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('--check'));
  } finally {
    cleanupEnv(env);
  }
});

// 9. remember with secret → blocked (exit code 1)
test('remember: secret content → blocked', () => {
  const env = setupEnv();
  try {
    const result = runCli(env.dir, ['remember', 'password: my_secret_value_12345']);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.toLowerCase().includes('blocked'));
  } finally {
    cleanupEnv(env);
  }
});

// 10. remember with secret + --skip-redaction → succeeds
test('remember: secret content + --skip-redaction → succeeds', () => {
  const env = setupEnv();
  try {
    const result = runCli(env.dir, ['remember', 'password: my_secret_value_12345', '--skip-redaction']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.trim().startsWith('mem_'));
  } finally {
    cleanupEnv(env);
  }
});

// 11. retain with secret candidate → candidate skipped
test('retain: secret candidate → skipped', () => {
  const env = setupEnv();
  mkdirSync(join(env.dir, '.mem-sync', 'pending'), { recursive: true });

  const transcript = [
    { role: 'user', content: 'password: my_super_secret_value_123456' },
    { role: 'assistant', content: 'I will remember that for you' },
  ];
  const transcriptPath = join(env.dir, 'transcript.json');
  writeFileSync(transcriptPath, JSON.stringify(transcript), 'utf8');

  try {
    const result = runCli(env.dir, [
      'retain',
      '--transcript-file', transcriptPath,
      '--pending',
      '--device', 'test-device',
    ]);
    // The retain command should succeed; blocked candidates are skipped
    assert.equal(result.status, 0);
    const count = parseInt(result.stdout.trim(), 10);
    assert.ok(count >= 0, 'should output a count');
    // stderr should mention blocked
    assert.ok(result.stderr.includes('blocked'), `stderr should mention blocked: ${result.stderr}`);
  } finally {
    cleanupEnv(env);
  }
});

// ─── Flush redaction gate tests ────────────────────────────────────

/**
 * Helper: create a standard v1 memory record for flush tests.
 */
function makeRecord(overrides = {}) {
  const scope = overrides.scope ?? 'global';
  const kind = overrides.kind ?? 'episode';
  const content = overrides.content ?? 'test memory content';
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

/**
 * Helper: initialize a Git repo for flush tests.
 */
function initGitRepo(dir, bare = false) {
  const flag = bare ? '--bare' : '';
  execSync(`git init -b main ${flag} "${dir}"`, { encoding: 'utf8' });
  if (!bare) {
    execSync('git config user.email "test@test"', { cwd: dir, encoding: 'utf8' });
    execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf8' });
  }
}

/**
 * Helper: commit a file to a repo.
 */
function commitFile(repoDir, filename, content, message) {
  writeFileSync(join(repoDir, filename), content, 'utf8');
  execSync(`git add "${filename}"`, { cwd: repoDir, encoding: 'utf8' });
  execSync(`git commit -m "${message || 'add ' + filename}"`, { cwd: repoDir, encoding: 'utf8' });
}

/**
 * Helper: create a full mem-sync test environment for flush tests.
 */
function setupMemSyncEnv(options = {}) {
  const {
    withJSONL = false,
    jsonlRecords = [],
    withPending = false,
    pendingRecords = [],
  } = options;

  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-redact-flush-'));

  // Initialize git repo
  initGitRepo(dir);
  commitFile(dir, 'README.md', '# mem-sync', 'init');

  // Write initial JSONL if requested
  if (withJSONL && jsonlRecords.length > 0) {
    const lines = jsonlRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(join(dir, 'memories.jsonl'), lines, 'utf8');
    commitFile(dir, 'memories.jsonl', lines, 'add memories');
  }

  // Write pending records if requested
  if (withPending && pendingRecords.length > 0) {
    const pendingDir = join(dir, 'pending');
    mkdirSync(pendingDir, { recursive: true });
    writeFileSync(
      join(pendingDir, 'device-test.json'),
      JSON.stringify(pendingRecords),
      'utf8'
    );
  }

  return { dir };
}

/**
 * Helper: clean up flush test environment.
 */
function cleanupFlushEnv(env) {
  rmSync(env.dir, { recursive: true, force: true });
}

// 12. Flush blocks commit when pending has secret
test('flush: blocks commit when pending record contains AWS key', () => {
  const secretRecord = makeRecord({
    id: 'mem_secret',
    content: 'the access key is AKIAIOSFODNN7EXAMPLE for AWS',
  });
  const env = setupMemSyncEnv({
    withPending: true,
    pendingRecords: [secretRecord],
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8',
    });

    // Should exit with code 1
    assert.equal(result.status, 1, `exit code should be 1, got ${result.status}\nstderr: ${result.stderr}`);

    // Stderr should contain "redaction:blocked"
    assert.ok(result.stderr.includes('redaction:blocked'), `stderr should contain redaction:blocked: ${result.stderr}`);

    // Commit should NOT have been made — verify by checking git log
    const log = execSync('git log --oneline', { cwd: env.dir, encoding: 'utf8' }).trim();
    assert.ok(!log.includes('mem-sync:'), `should not have mem-sync commit: ${log}`);
  } finally {
    cleanupFlushEnv(env);
  }
});

// 13. Flush with --skip-redaction allows commit even with secret
test('flush: --skip-redaction allows commit with secret record', () => {
  const secretRecord = makeRecord({
    id: 'mem_secret_skip',
    content: 'the access key is AKIAIOSFODNN7EXAMPLE for AWS',
  });
  const env = setupMemSyncEnv({
    withPending: true,
    pendingRecords: [secretRecord],
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush', '--skip-redaction'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8',
    });

    // Should exit with code 0
    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // Commit should have been made
    const log = execSync('git log --oneline -1', { cwd: env.dir, encoding: 'utf8' }).trim();
    assert.match(log, /mem-sync:/, `commit message should contain 'mem-sync:': ${log}`);
  } finally {
    cleanupFlushEnv(env);
  }
});

// 14. Retain blocks LLM-extracted secret (test redactContent directly)
test('retain: redactContent blocks LLM record with secret', async () => {
  const { redactContent } = await import('../src/redaction-engine.js');

  // Simulate what happens when an LLM record contains a secret
  const llmContent = 'The AWS access key is AKIAIOSFODNN7EXAMPLE';
  const result = redactContent(llmContent);

  assert.equal(result.blocked, true, 'should be blocked');
  assert.ok(result.matches.some(m => m.rule === 'aws-key'), 'should match aws-key rule');
});

// 15. Flush with clean records succeeds
test('flush: clean records succeed without redaction blocking', () => {
  const cleanRecord = makeRecord({
    id: 'mem_clean',
    content: 'I prefer dark mode in my editor',
  });
  const env = setupMemSyncEnv({
    withPending: true,
    pendingRecords: [cleanRecord],
  });

  try {
    const result = spawnSync(process.execPath, [CLI_PATH, 'flush'], {
      env: { ...process.env, MEM_SYNC_HOME: env.dir },
      encoding: 'utf8',
    });

    // Should exit with code 0
    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // Stderr should mention redaction:clean
    assert.ok(result.stderr.includes('redaction:clean'), `stderr should contain redaction:clean: ${result.stderr}`);

    // Commit should have been made
    const log = execSync('git log --oneline -1', { cwd: env.dir, encoding: 'utf8' }).trim();
    assert.match(log, /mem-sync:/, `commit message should contain 'mem-sync:': ${log}`);
  } finally {
    cleanupFlushEnv(env);
  }
});
