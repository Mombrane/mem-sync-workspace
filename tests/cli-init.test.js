import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initGitRepo, cleanupEnv, runCli } from './helpers.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('init creates directory structure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-init-'));

  try {
    const result = runCli(dir, ['init']);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    // Verify JSON output
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.initialized, true);
    assert.equal(output.path, dir);
    assert.equal(output.remote, null);

    // Verify directories
    const expectedDirs = ['memories', 'pending', 'projects', 'meta', 'skills', 'archive'];
    for (const d of expectedDirs) {
      assert.ok(existsSync(join(dir, d)), `directory should exist: ${d}`);
    }

    // Verify meta files
    const schemaPath = join(dir, 'meta', 'schema.json');
    assert.ok(existsSync(schemaPath), 'meta/schema.json should exist');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    assert.equal(schema.schemaVersion, 1);
    assert.equal(schema.tool, 'mem-sync');

    const devicesPath = join(dir, 'meta', 'devices.json');
    assert.ok(existsSync(devicesPath), 'meta/devices.json should exist');
    const devices = JSON.parse(readFileSync(devicesPath, 'utf8'));
    assert.deepEqual(devices.devices, {});

    // Verify README
    assert.ok(existsSync(join(dir, 'README.md')), 'README.md should exist');

    // Verify git repo
    assert.ok(existsSync(join(dir, '.git')), '.git directory should exist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-init-'));

  try {
    // First init
    let result = runCli(dir, ['init']);
    assert.equal(result.status, 0);

    // Second init should also succeed
    result = runCli(dir, ['init']);
    assert.equal(result.status, 0, `second init should succeed, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.initialized, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('init with --repo clones from remote', () => {
  // Create a bare repo to clone from
  const bareDir = mkdtempSync(join(tmpdir(), 'mem-sync-init-bare-'));
  const dir = mkdtempSync(join(tmpdir(), 'mem-sync-init-'));

  try {
    initGitRepo(bareDir, true);

    const result = runCli(dir, ['init', '--repo', bareDir]);

    assert.equal(result.status, 0, `exit code should be 0, got ${result.status}\nstderr: ${result.stderr}`);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.initialized, true);
    assert.equal(output.remote, bareDir);

    // Should be a clone (not just init)
    assert.ok(existsSync(join(dir, '.git')), '.git directory should exist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bareDir, { recursive: true, force: true });
  }
});
