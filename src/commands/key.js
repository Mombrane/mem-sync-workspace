import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { checkAgeBinary, loadEncryptionConfig } from '../encryption.js';

/**
 * 获取 mem-sync 仓库路径。
 *
 * 从环境变量或默认位置获取仓库根目录。
 *
 * @param {string[]} args - 命令行参数（支持 --repo <path>）
 * @returns {string} 仓库路径
 */
function resolveRepoPath(args) {
  const repoIdx = args.indexOf('--repo');
  if (repoIdx !== -1 && repoIdx + 1 < args.length) {
    return args[repoIdx + 1];
  }
  return process.env.MEM_SYNC_HOME ?? '.mem-sync';
}

/**
 * key status — 显示加密配置状态。
 *
 * 读取仓库的 meta/encryption.json 配置文件并显示：
 * - 加密模式（age/password/disabled）
 * - 公钥指纹
 * - 私钥文件是否存在
 * - age 二进制是否可用
 *
 * @param {string[]} args - 命令行参数
 */
export async function keyStatusCommand(args) {
  const repoPath = resolveRepoPath(args);

  // 检查仓库是否存在
  if (!existsSync(repoPath)) {
    throw new Error(`Repository not found at: ${repoPath}\nRun 'mem-sync init' first.`);
  }

  // 加载加密配置
  const config = await loadEncryptionConfig(repoPath);

  // 检查 age 二进制可用性
  const ageCheck = await checkAgeBinary();

  // 检查私钥文件
  const defaultKeyPath = join(homedir(), '.mem-sync', 'age-key');
  const privateKeyExists = existsSync(defaultKeyPath);

  if (!config) {
    // 未配置加密
    console.log(JSON.stringify({
      encryption: 'disabled',
      ageAvailable: ageCheck.available,
      agePath: ageCheck.path,
      ageVersion: ageCheck.version
    }, null, 2));
    return;
  }

  // 构建状态结果
  const status = {
    encryption: config.mode,
    publicKeys: config.publicKeys || [],
    privateKeyExists,
    privateKeyPath: defaultKeyPath,
    ageAvailable: ageCheck.available,
    agePath: ageCheck.path,
    ageVersion: ageCheck.version
  };

  // 如果是 age 模式，添加公钥指纹信息
  if (config.mode === 'age' && config.publicKeys && config.publicKeys.length > 0) {
    status.publicKeyFingerprints = config.publicKeys.map(key => ({
      key,
      // 显示前 12 个字符作为指纹预览
      fingerprint: key.substring(0, 12) + '...'
    }));
  }

  console.log(JSON.stringify(status, null, 2));
}

/**
 * key export — 导出私钥路径用于备份。
 *
 * 显示私钥文件路径，但不输出实际密钥内容（安全考虑）。
 * 如果私钥文件不存在，显示错误提示。
 *
 * @param {string[]} args - 命令行参数
 */
export async function keyExportCommand(args) {
  const repoPath = resolveRepoPath(args);

  // 检查仓库是否存在
  if (!existsSync(repoPath)) {
    throw new Error(`Repository not found at: ${repoPath}\nRun 'mem-sync init' first.`);
  }

  // 加载加密配置以验证加密已启用
  const config = await loadEncryptionConfig(repoPath);
  if (!config) {
    throw new Error('Encryption is not configured. Run \'mem-sync init --encrypt\' first.');
  }

  // 检查私钥文件路径
  const defaultKeyPath = join(homedir(), '.mem-sync', 'age-key');
  const privateKeyExists = existsSync(defaultKeyPath);

  if (!privateKeyExists) {
    throw new Error(
      `Private key not found at: ${defaultKeyPath}\n` +
      'The private key may have been moved or deleted.\n' +
      'If you have a backup, restore it to the path above.\n' +
      'Otherwise, you may need to re-initialize encryption with \'mem-sync init --encrypt\'.'
    );
  }

  // 输出私钥路径（不输出实际内容）
  console.log(JSON.stringify({
    privateKeyPath: defaultKeyPath,
    publicKey: config.publicKeys?.[0] || null,
    instructions: [
      'Back up this file to a secure location:',
      `  cp "${defaultKeyPath}" /path/to/secure/backup/`,
      '',
      'To restore from backup:',
      `  cp /path/to/backup/age-key "${defaultKeyPath}"`,
      '  chmod 600 "${defaultKeyPath}"',
      '',
      'IMPORTANT: Keep this file secure. Anyone with access to it can decrypt your memories.'
    ].join('\n')
  }, null, 2));
}
