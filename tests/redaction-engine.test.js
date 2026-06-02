import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_PATTERNS, loadRedactionRules, redactContent } from '../src/redaction-engine.js';

// ─── Default patterns ───────────────────────────────────────────────

test('DEFAULT_PATTERNS is a non-empty array of rules', () => {
  assert.ok(Array.isArray(DEFAULT_PATTERNS));
  assert.ok(DEFAULT_PATTERNS.length > 0);
  for (const p of DEFAULT_PATTERNS) {
    assert.ok(p.name, 'pattern should have name');
    assert.ok(p.regex instanceof RegExp, 'pattern should have RegExp');
    assert.equal(p.severity, 'block');
  }
});

// ─── Each default pattern matches a known secret ────────────────────

test('api-key pattern matches', () => {
  const r = redactContent("api_key: 'abcdefghijklmnop'", DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'api-key');
});

test('github-token pattern matches ghp_ prefix', () => {
  const token = 'ghp_' + 'A'.repeat(36);
  const r = redactContent(`token = ${token}`, DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'github-token');
});

test('aws-key pattern matches AKIA prefix', () => {
  const r = redactContent('key = AKIA1234567890ABCDEF', DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'aws-key');
});

test('private-key pattern matches', () => {
  const r = redactContent('-----BEGIN RSA PRIVATE KEY-----\nMIIEowI...', DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'private-key');
});

test('password pattern matches', () => {
  const r = redactContent('password: hunter2', DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'password');
});

test('jwt-token pattern matches', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefg';
  const r = redactContent(`Bearer ${jwt}`, DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'jwt-token');
});

test('mongodb-connection pattern matches', () => {
  const r = redactContent('mongodb://admin:s3cret@db.example.com:27017/mydb', DEFAULT_PATTERNS);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].rule, 'mongodb-connection');
});

// ─── Clean content returns blocked=false ─────────────────────────────

test('clean content returns blocked=false', () => {
  const r = redactContent('This is safe content with no secrets.');
  assert.equal(r.blocked, false);
  assert.equal(r.severity, null);
  assert.equal(r.matches.length, 0);
});

// ─── Empty string and null handled gracefully ───────────────────────

test('empty string returns unblocked', () => {
  const r = redactContent('');
  assert.equal(r.blocked, false);
  assert.equal(r.severity, null);
  assert.deepEqual(r.matches, []);
});

test('null returns unblocked', () => {
  const r = redactContent(null);
  assert.equal(r.blocked, false);
  assert.equal(r.severity, null);
  assert.deepEqual(r.matches, []);
});

test('undefined returns unblocked', () => {
  const r = redactContent(undefined);
  assert.equal(r.blocked, false);
  assert.equal(r.severity, null);
  assert.deepEqual(r.matches, []);
});

// ─── Multiple secrets in one text ───────────────────────────────────

test('multiple secrets in one text produce multiple matches', () => {
  const text = `password: secret123\napi_key: 'abcdefghijklmnop'`;
  const r = redactContent(text);
  assert.ok(r.blocked);
  assert.equal(r.matches.length, 2);
  const names = r.matches.map(m => m.rule).sort();
  assert.deepEqual(names, ['api-key', 'password']);
});

// ─── Invalid content type throws TypeError ──────────────────────────

test('non-string content throws TypeError', () => {
  assert.throws(() => redactContent(123), TypeError);
  assert.throws(() => redactContent({}), TypeError);
  assert.throws(() => redactContent(true), TypeError);
});

// ─── Custom rules loading ───────────────────────────────────────────

test('loadRedactionRules loads custom rules and merges with defaults', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'redact-test-'));
  try {
    const metaDir = join(tmpDir, 'meta');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(
      join(metaDir, 'redaction-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          { name: 'custom-secret', pattern: 'SECRET_[A-Z]+', flags: 'g', severity: 'block' },
        ],
      }),
      'utf8',
    );

    const rules = loadRedactionRules(tmpDir);
    assert.ok(rules.length > DEFAULT_PATTERNS.length);
    const custom = rules.find(r => r.name === 'custom-secret');
    assert.ok(custom, 'should include custom rule');
    assert.ok(custom.regex instanceof RegExp);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Missing rules file falls back to defaults ─────────────────────

test('loadRedactionRules falls back to defaults when file missing', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'redact-test-'));
  try {
    const rules = loadRedactionRules(tmpDir);
    assert.equal(rules.length, DEFAULT_PATTERNS.length);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── Malformed rules JSON throws ────────────────────────────────────

test('loadRedactionRules throws on malformed JSON', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'redact-test-'));
  try {
    const metaDir = join(tmpDir, 'meta');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(join(metaDir, 'redaction-rules.json'), '{ invalid json', 'utf8');

    assert.throws(() => loadRedactionRules(tmpDir), /Malformed/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadRedactionRules throws on missing version field', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'redact-test-'));
  try {
    const metaDir = join(tmpDir, 'meta');
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(
      join(metaDir, 'redaction-rules.json'),
      JSON.stringify({ rules: [] }),
      'utf8',
    );

    assert.throws(() => loadRedactionRules(tmpDir), /Malformed/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── match index is correct ─────────────────────────────────────────

test('match index is correctly reported', () => {
  const prefix = 'abc '.repeat(10); // 40 chars
  const r = redactContent(`${prefix}password: test123`);
  assert.ok(r.blocked);
  assert.equal(r.matches[0].index, 40);
});
