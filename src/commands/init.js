import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureClone } from '../git.js';

/**
 * mem-sync init — scaffold a new memory repository.
 *
 * Creates the directory structure, meta files, and initial commit.
 * If --repo <url> is provided, clones from that remote first.
 *
 * Output: JSON result to stdout.
 *
 * @param {string[]} args - CLI arguments (supports --repo <url>)
 */
export async function initCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const remoteUrl =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // 1. Ensure the repository exists (clone or init)
  ensureClone(remoteUrl, memSyncHome);

  // 2. Create directory structure
  const dirs = ['memories', 'pending', 'projects', 'meta', 'skills', 'archive'];
  for (const d of dirs) {
    mkdirSync(join(memSyncHome, d), { recursive: true });
  }

  // 3. Write meta/schema.json
  const schemaJson = {
    schemaVersion: 1,
    created: new Date().toISOString(),
    tool: "mem-sync",
    toolVersion: "0.1.0"
  };
  writeFileSync(
    join(memSyncHome, 'meta', 'schema.json'),
    JSON.stringify(schemaJson, null, 2) + '\n',
    'utf8'
  );

  // 4. Write meta/devices.json
  const devicesJson = { devices: {} };
  writeFileSync(
    join(memSyncHome, 'meta', 'devices.json'),
    JSON.stringify(devicesJson, null, 2) + '\n',
    'utf8'
  );

  // 5. Write README.md if not exists
  const readmePath = join(memSyncHome, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# mem-sync\n\nMemory sync repository — managed by mem-sync.\n`,
      'utf8'
    );
  }

  // 6. Stage and commit
  try {
    execSync('git add -A', { cwd: memSyncHome, encoding: 'utf8' });
    execSync('git commit -m "init: scaffold memory repo"', {
      cwd: memSyncHome,
      encoding: 'utf8'
    });
  } catch (err) {
    // Commit may fail if nothing to commit (e.g. already initialized)
    // Non-fatal: the directory structure still exists
    console.error(`[mem-sync:init] commit skipped: ${err.message}`);
  }

  // 7. Output result
  console.log(JSON.stringify({
    initialized: true,
    path: memSyncHome,
    remote: remoteUrl || null
  }));
}
