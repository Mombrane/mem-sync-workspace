import { readFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { validateMemory } from '../schema.js';
import { getIndexStatus } from '../index-store.js';
import { readPendingFiles } from '../merge.js';
import { hasRemote } from '../git.js';

// ─── Check functions ────────────────────────────────────────────────

/**
 * Check JSONL file integrity: scan memories.jsonl line by line.
 * Reports total lines, parse errors, validation errors with details.
 */
export function checkJsonlIntegrity(memSyncHome) {
  const jsonlPath = join(memSyncHome, 'memories.jsonl');

  if (!existsSync(jsonlPath)) {
    return { ok: true, totalLines: 0, validRecords: 0, parseErrors: 0, validationErrors: 0, details: [] };
  }

  const raw = readFileSync(jsonlPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const totalLines = lines.length;
  const details = [];
  let parseErrors = 0;
  let validationErrors = 0;
  let validRecords = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let record;
    try {
      record = JSON.parse(line);
    } catch (err) {
      parseErrors++;
      details.push({ line: i + 1, error: err.message });
      continue;
    }

    try {
      validateMemory(record);
      validRecords++;
    } catch (err) {
      validationErrors++;
      details.push({ line: i + 1, id: record.id ?? null, field: err.message, error: err.message });
    }
  }

  return {
    ok: parseErrors === 0 && validationErrors === 0,
    totalLines,
    validRecords,
    parseErrors,
    validationErrors,
    details
  };
}

/**
 * Check record statistics: total, active, deleted, expired.
 */
export function checkRecords(memSyncHome) {
  const jsonlPath = join(memSyncHome, 'memories.jsonl');
  let total = 0;
  let active = 0;
  let deleted = 0;
  let expired = 0;

  if (!existsSync(jsonlPath)) {
    return { total: 0, active: 0, deleted: 0, expired: 0 };
  }

  const raw = readFileSync(jsonlPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    try {
      validateMemory(record);
    } catch {
      continue;
    }

    total++;

    if (record.deletedAt) {
      deleted++;
    } else if (record.validUntil && new Date(record.validUntil) < new Date()) {
      expired++;
    } else {
      active++;
    }
  }

  return { total, active, deleted, expired };
}

/**
 * Check index state: exists, stale (repoHead != currentHead), recordCount.
 */
export function checkIndex(cacheDir, memSyncHome) {
  const status = getIndexStatus(cacheDir);

  let currentHead = null;
  try {
    currentHead = execSync('git rev-parse HEAD', {
      cwd: memSyncHome,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // not a git repo
  }

  const stale = status.exists && status.repoHead !== null && currentHead !== null && status.repoHead !== currentHead;

  return {
    ok: !stale && status.exists,
    exists: status.exists,
    stale,
    records: status.recordCount
  };
}

/**
 * Check lock file: exists, stale (process dead), pid.
 */
export function checkLock(lockPath) {
  if (!existsSync(lockPath)) {
    return { ok: true, exists: false };
  }

  const raw = readFileSync(lockPath, 'utf8');
  const pid = parseInt(raw.trim(), 10);

  if (isNaN(pid) || pid <= 0) {
    return { ok: false, exists: true, stale: true, pid: null };
  }

  let stale = false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if (err.code === 'ESRCH') {
      stale = true;
    }
  }

  return { ok: !stale, exists: true, stale, pid };
}

/**
 * Check git repository status: initialized, head, rebaseInProgress.
 */
export function checkRepo(memSyncHome) {
  const gitDir = join(memSyncHome, '.git');
  const initialized = existsSync(gitDir);

  if (!initialized) {
    return { ok: true, initialized: false, head: null, rebaseInProgress: false };
  }

  let head = null;
  try {
    head = execSync('git rev-parse HEAD', {
      cwd: memSyncHome,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    // no commits yet
  }

  const rebaseInProgress =
    existsSync(join(memSyncHome, '.git', 'rebase-merge')) ||
    existsSync(join(memSyncHome, '.git', 'rebase-apply'));

  return { ok: !rebaseInProgress, initialized, head, rebaseInProgress };
}

/**
 * Check pending records: count files and records.
 */
export function checkPending(pendingDir) {
  const records = readPendingFiles(pendingDir);

  let files = 0;
  try {
    files = readdirSync(pendingDir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl')).length;
  } catch {
    // pending dir doesn't exist
  }

  return { ok: true, files, records: records.length };
}

/**
 * Check remote connectivity: configured, reachable.
 */
export function checkRemote(memSyncHome) {
  const configured = hasRemote(memSyncHome);

  if (!configured) {
    return { ok: true, configured: false, reachable: false };
  }

  let reachable = false;
  try {
    execSync('git fetch origin', {
      cwd: memSyncHome,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000
    });
    reachable = true;
  } catch {
    // fetch failed or timed out
  }

  return { ok: true, configured, reachable };
}

// ─── Main entry point ───────────────────────────────────────────────

/**
 * Run health checks on the mem-sync environment.
 *
 * @param {string[]} args - CLI arguments (--format json)
 * @returns {number} exit code: 0 = all pass, 1 = issues found
 */
export async function doctorCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const cacheDir = join(memSyncHome, '.cache');
  const lockPath = join(memSyncHome, 'repo.lock');
  const pendingDir = join(memSyncHome, 'pending');

  // Run all checks (checkPending is async)
  const [jsonlCheck, recordsCheck, indexCheck, lockCheck, repoCheck, pendingCheck, remoteCheck] =
    await Promise.all([
      checkJsonlIntegrity(memSyncHome),
      checkRecords(memSyncHome),
      checkIndex(cacheDir, memSyncHome),
      checkLock(lockPath),
      checkRepo(memSyncHome),
      checkPending(pendingDir),
      checkRemote(memSyncHome)
    ]);

  const allOk = jsonlCheck.ok && indexCheck.ok && lockCheck.ok && repoCheck.ok && pendingCheck.ok && remoteCheck.ok;

  const result = {
    ok: allOk,
    checks: {
      jsonl: jsonlCheck,
      records: recordsCheck,
      index: indexCheck,
      lock: lockCheck,
      repo: repoCheck,
      pending: pendingCheck,
      remote: remoteCheck
    }
  };

  // JSON to stdout
  console.log(JSON.stringify(result, null, 2));

  // Human-readable diagnostics to stderr
  console.error('mem-sync doctor:');
  console.error(`  jsonl:     ${jsonlCheck.ok ? '✓' : '✗'} (${jsonlCheck.validRecords} valid, ${jsonlCheck.parseErrors} parse errors, ${jsonlCheck.validationErrors} validation errors)`);
  console.error(`  records:   ${recordsCheck.total} total (${recordsCheck.active} active, ${recordsCheck.deleted} deleted, ${recordsCheck.expired} expired)`);
  console.error(`  index:     ${indexCheck.ok ? '✓' : '✗'} (exists=${indexCheck.exists}, stale=${indexCheck.stale}, records=${indexCheck.records})`);
  console.error(`  lock:      ${lockCheck.ok ? '✓' : '✗'} (exists=${lockCheck.exists}${lockCheck.stale ? ', stale' : ''})`);
  console.error(`  repo:      ${repoCheck.ok ? '✓' : '✗'} (initialized=${repoCheck.initialized}${repoCheck.rebaseInProgress ? ', rebase in progress' : ''})`);
  console.error(`  pending:   ${pendingCheck.ok ? '✓' : '✗'} (${pendingCheck.files} files, ${pendingCheck.records} records)`);
  console.error(`  remote:    ${remoteCheck.ok ? '✓' : '✗'} (configured=${remoteCheck.configured}, reachable=${remoteCheck.reachable})`);

  return allOk ? 0 : 1;
}
