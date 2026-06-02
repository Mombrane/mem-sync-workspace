import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { ensureClone } from '../git.js';
import { checkAgeBinary, generateKeypair } from '../encryption.js';

/**
 * mem-sync init — scaffold a new memory repository.
 *
 * Creates the directory structure, meta files, and initial commit.
 * If --repo <url> is provided, clones from that remote first.
 * If --encrypt is provided, generates an age keypair and writes encryption config.
 * If --encrypt --password is provided, writes password-mode encryption config.
 *
 * Output: JSON result to stdout.
 *
 * @param {string[]} args - CLI arguments (supports --repo <url>, --encrypt, --password)
 */
export async function initCommand(args) {
  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';

  // Parse --repo
  const repoIdx = args.indexOf('--repo');
  const remoteUrl =
    repoIdx !== -1 && repoIdx + 1 < args.length
      ? args[repoIdx + 1]
      : null;

  // 解析加密相关标志
  const encryptFlag = args.includes('--encrypt');
  const passwordFlag = args.includes('--password');

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

  // 6. Handle encryption setup if --encrypt flag is present
  let encryptionResult = null;
  if (encryptFlag) {
    encryptionResult = await setupEncryption(memSyncHome, passwordFlag);
  }

  // 7. Stage and commit
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

  // 8. Output result
  const result = {
    initialized: true,
    path: memSyncHome,
    remote: remoteUrl || null
  };

  if (encryptionResult) {
    result.encryption = encryptionResult;
  }

  console.log(JSON.stringify(result));
}

/**
 * 设置加密配置。
 *
 * 根据是否为密码模式生成相应的配置文件。
 * age 模式会生成密钥对并写入配置；
 * password 模式仅写入配置（密钥由用户提供）。
 *
 * @param {string} memSyncHome - mem-sync 主目录路径
 * @param {boolean} passwordMode - 是否使用密码模式
 * @returns {Promise<object>} 加密结果信息
 */
async function setupEncryption(memSyncHome, passwordMode) {
  // 检查 age 二进制是否可用
  const ageCheck = await checkAgeBinary();
  if (!ageCheck.available) {
    throw new Error(
      'age binary not found. Install age from https://age-encryption.org\n' +
      '  On Ubuntu/Debian: sudo apt install age\n' +
      '  On macOS: brew install age\n' +
      '  Or download from: https://github.com/FiloSottile/age/releases'
    );
  }

  const metaDir = join(memSyncHome, 'meta');
  mkdirSync(metaDir, { recursive: true });
  const configPath = join(metaDir, 'encryption.json');

  if (passwordMode) {
    // 密码模式：仅写入配置，不生成密钥对
    const config = {
      version: 1,
      mode: 'password',
      publicKeys: []
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

    console.error('[mem-sync:init] Password mode encryption configured.');
    console.error('[mem-sync:init] You will be prompted for a password when encrypting/decrypting.');

    return { mode: 'password', configPath };
  }

  // age 公钥模式：生成密钥对
  const keyPath = join(homedir(), '.mem-sync', 'age-key');
  const keyDir = join(homedir(), '.mem-sync');
  mkdirSync(keyDir, { recursive: true });
  // 如果私钥文件已存在，尝试复用；否则生成新密钥对
  let publicKey;
  let privateKeyPath = keyPath;
  if (existsSync(keyPath)) {
    // 从已有私钥文件中提取公钥（age 私钥文件包含注释行 "# public key: age1..."）
    const content = await readFile(keyPath, 'utf8');
    const match = content.match(/# public key:\s*(age1[a-zA-Z0-9]+)/);
    if (match) {
      publicKey = match[1];
    } else {
      // 私钥文件存在但无法解析公钥，删除后重新生成
      await unlink(keyPath);
      const kp = await generateKeypair(keyPath);
      publicKey = kp.publicKey;
      privateKeyPath = kp.privateKeyPath;
    }
  } else {
    const kp = await generateKeypair(keyPath);
    publicKey = kp.publicKey;
    privateKeyPath = kp.privateKeyPath;
  }

  const config = {
    version: 1,
    mode: 'age',
    publicKeys: [publicKey]
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  console.error(`[mem-sync:init] Encryption enabled with age.`);
  console.error(`[mem-sync:init] Public key: ${publicKey}`);
  console.error(`[mem-sync:init] Private key saved to: ${privateKeyPath}`);
  console.error(`[mem-sync:init] IMPORTANT: Back up your private key file!`);

  return {
    mode: 'age',
    publicKey,
    privateKeyPath,
    configPath
  };
}
