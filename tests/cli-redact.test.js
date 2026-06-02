import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
