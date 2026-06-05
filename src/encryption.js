import { execFile, execFileSync } from 'node:child_process';
import { access, readFile, chmod } from 'node:fs/promises';
import { constants, accessSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** age 加密文件的头部特征字符串，用于识别加密内容 */
const AGE_HEADER_PREFIX = 'age-encryption.org/v1';
const AGE_PEM_HEADER = '-----BEGIN AGE ENCRYPTED FILE-----';

/** 支持的 age 二进制文件路径候选列表（按优先级排序） */
const AGE_BINARY_CANDIDATES = [
  join(homedir(), 'bin/age'),
  'age'
];

const AGE_KEYGEN_CANDIDATES = [
  join(homedir(), 'bin/age-keygen'),
  'age-keygen'
];

/** 默认配置文件名 */
const ENCRYPTION_CONFIG_FILE = 'encryption.json';

/**
 * 从一组候选路径中查找可用的二进制文件路径（同步版本）。
 * 用于同步上下文如 rebuildIndex。
 *
 * @param {string[]} candidates - 候选路径列表
 * @returns {string|null} 可用的二进制路径，或 null
 */
function resolveBinarySync(candidates) {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 从一组候选路径中查找可用的二进制文件路径。
 * 候选路径按优先级排序，返回第一个可执行文件的路径。
 *
 * @param {string[]} candidates - 候选路径列表
 * @returns {Promise<{ path: string, version: string } | null>}
 */
async function resolveBinary(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      const version = await execFileWithOutput(candidate, ['--version']);
      return { path: candidate, version: version.trim() };
    } catch {
      // 当前候选不可用，继续尝试下一个
      continue;
    }
  }
  return null;
}

/**
 * 使用 execFile 执行命令并返回 stdout。
 * 基于 Promise 封装，方便异步流程中使用。
 *
 * @param {string} file - 可执行文件路径
 * @param {string[]} args - 命令行参数
 * @param {object} [opts] - 额外选项
 * @param {string} [opts.input] - 通过 stdin 传入的数据
 * @returns {Promise<string>} stdout 输出
 */
function execFileWithOutput(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      ...opts
    }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr ? stderr.trim() : error.message;
        reject(new Error(`${file}: ${msg}`));
        return;
      }
      resolve(stdout);
    });
    // 如果有 input 数据，写入 stdin 并关闭
    if (opts.input != null && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

/**
 * 获取 age 二进制文件路径。
 * 优先使用 ~/bin/age，其次使用 PATH 中的 age。
 *
 * @returns {Promise<string|null>}
 */
async function getAgeBinary() {
  const resolved = await resolveBinary(AGE_BINARY_CANDIDATES);
  return resolved ? resolved.path : null;
}

/**
 * 获取 age-keygen 二进制文件路径。
 *
 * @returns {Promise<string|null>}
 */
async function getAgeKeygenBinary() {
  const resolved = await resolveBinary(AGE_KEYGEN_CANDIDATES);
  return resolved ? resolved.path : null;
}

/**
 * 加载加密配置文件。
 *
 * 读取仓库的 `<repoPath>/meta/encryption.json` 配置文件。
 * 如果文件不存在（ENOENT），返回 null 表示明文模式。
 * 如果 JSON 格式无效，抛出错误。
 * 如果 version 不是 1 或缺少 mode 字段，抛出错误。
 *
 * @param {string} repoPath - 仓库根目录路径
 * @returns {Promise<object|null>} 加密配置对象，或 null（无加密）
 * @throws {Error} 配置文件格式无效时抛出
 */
export async function loadEncryptionConfig(repoPath) {
  const configPath = join(repoPath, 'meta', ENCRYPTION_CONFIG_FILE);
  let content;
  try {
    content = await readFile(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  let config;
  try {
    config = JSON.parse(content);
  } catch {
    throw new Error(`encryption config is not valid JSON: ${configPath}`);
  }

  if (config.version !== 1) {
    throw new Error(`unsupported encryption config version: ${config.version}`);
  }
  if (!config.mode) {
    throw new Error('encryption config missing "mode" field');
  }

  return config;
}

/**
 * 同步加载加密配置文件（用于同步函数如 rebuildIndex）。
 *
 * @param {string} repoPath - 仓库根目录路径
 * @returns {object|null} 加密配置对象，或 null（无加密）
 */
export function loadEncryptionConfigSync(repoPath) {
  const configPath = join(repoPath, 'meta', ENCRYPTION_CONFIG_FILE);
  let content;
  try {
    content = readFileSync(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }

  let config;
  try {
    config = JSON.parse(content);
  } catch {
    throw new Error(`encryption config is not valid JSON: ${configPath}`);
  }

  if (config.version !== 1) {
    throw new Error(`unsupported encryption config version: ${config.version}`);
  }
  if (!config.mode) {
    throw new Error('encryption config missing "mode" field');
  }

  return config;
}

/**
 * 检查一行文本是否为 age 加密内容。
 *
 * age 加密文本有两种格式：
 * 1. 以 "age-encryption.org/v1" 开头的短格式
 * 2. 以 "-----BEGIN AGE ENCRYPTED FILE-----" 开头的 PEM 格式
 *
 * @param {string} line - 待检查的文本行
 * @returns {boolean} 是否为 age 加密内容
 */
export function isEncrypted(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();
  return trimmed.startsWith(AGE_HEADER_PREFIX) || trimmed.startsWith(AGE_PEM_HEADER);
}

/**
 * 检查 age 二进制文件是否可用。
 *
 * 依次尝试候选路径，找到第一个可用的 age 二进制文件并获取其版本。
 *
 * @returns {Promise<{ available: boolean, path: string | null, version: string | null }>}
 */
export async function checkAgeBinary() {
  const resolved = await resolveBinary(AGE_BINARY_CANDIDATES);
  if (resolved) {
    return { available: true, path: resolved.path, version: resolved.version };
  }
  return { available: false, path: null, version: null };
}

/**
 * 生成新的 X25519 密钥对。
 *
 * 使用 age-keygen 生成密钥对，私钥写入指定路径，公钥从 stdout/stderr 解析。
 * （age-keygen 将公钥信息输出到 stderr 流）
 * 私钥文件权限设置为 0600。
 *
 * @param {string} keyPath - 私钥文件输出路径
 * @returns {Promise<{ publicKey: string, privateKeyPath: string }>}
 * @throws {Error} age-keygen 不可用或执行失败时抛出
 */
export async function generateKeypair(keyPath) {
  const keygenPath = await getAgeKeygenBinary();
  if (!keygenPath) {
    throw new Error('age-keygen not found — install age (age-encryption.org)');
  }

  // age-keygen 将公钥输出到 stderr，需同时捕获 stdout 和 stderr
  const output = await new Promise((resolve, reject) => {
    execFile(keygenPath, ['-o', keyPath], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`age-keygen: ${stderr ? stderr.trim() : error.message}`));
        return;
      }
      // 合并 stdout 和 stderr — 公钥可能在 stderr 中
      resolve((stdout + '\n' + stderr).trim());
    });
  });

  // 将私钥文件权限设置为 0600
  await chmod(keyPath, 0o600);

  // age-keygen 输出格式: "Public key: age1..."（可能在 stderr 中）
  const lines = output.split('\n');
  const publicKeyLine = lines.find(l => l.trim().startsWith('Public key:'));
  if (!publicKeyLine) {
    // 兼容其他可能的格式：直接以 age1 开头的行
    const altLine = lines.find(l => /^age1[a-zA-Z0-9]+$/.test(l.trim()));
    if (!altLine) {
      throw new Error('failed to parse public key from age-keygen output');
    }
    const publicKey = altLine.trim();
    return { publicKey, privateKeyPath: keyPath };
  }
  const publicKey = publicKeyLine.trim().replace(/^Public key:\s*/, '');

  return { publicKey, privateKeyPath: keyPath };
}

/**
 * 加密单行文本。
 *
 * 使用 age 工具对 plaintext 进行加密，返回加密后的密文。
 * 支持两种模式：
 * - "age": 使用公钥加密（当前仅支持单个公钥）
 * - "password": 密码模式（待实现）
 *
 * @param {string} plaintext - 待加密的明文
 * @param {object} config - 加密配置
 * @param {string} config.mode - 加密模式 ("age" | "password")
 * @param {string[]} [config.publicKeys] - 公钥列表（age 模式）
 * @returns {Promise<string>} age 加密后的密文
 * @throws {Error} 不支持的加密模式或加密失败时抛出
 */
export async function encryptLine(plaintext, config) {
  // Validate mode FIRST — before checking for age binary
  if (config.mode === 'password') {
    throw new Error('password mode not yet implemented in encryptLine');
  }
  if (config.mode !== 'age') {
    throw new Error(`unsupported encryption mode: ${config.mode}`);
  }

  const agePath = await getAgeBinary();
  if (!agePath) {
    throw new Error('age binary not found — install age (age-encryption.org)');
  }

  if (!config.publicKeys || config.publicKeys.length === 0) {
    throw new Error('no public key provided for age encryption');
  }
  // -a/--armor 输出 PEM 格式（纯 ASCII），确保加密内容可安全存储在 JSONL 文本文件中
  const stdout = await execFileWithOutput(agePath, ['-a', '-r', config.publicKeys[0]], {
    input: plaintext
  });
  return stdout;
}

/**
 * 解密单行文本。
 *
 * 使用 age 工具对 age 加密的密文进行解密，返回原始明文。
 * 支持两种模式：
 * - "age": 使用私钥文件解密（`-d -i <privateKeyPath>`）
 * - "password": 密码模式（待实现）
 *
 * @param {string} ciphertext - age 加密的密文
 * @param {object} config - 加密配置
 * @param {string} config.mode - 加密模式 ("age" | "password")
 * @param {string} [config.privateKeyPath] - 私钥文件路径（age 模式）
 * @returns {Promise<string>} 解密后的明文
 * @throws {Error} 解密失败或配置无效时抛出
 */
export async function decryptLine(ciphertext, config) {
  // Validate mode FIRST — before checking for age binary
  if (config.mode === 'password') {
    throw new Error('password mode not yet implemented in decryptLine');
  }
  if (config.mode !== 'age') {
    throw new Error(`unsupported encryption mode: ${config.mode}`);
  }

  const agePath = await getAgeBinary();
  if (!agePath) {
    throw new Error('age binary not found — install age (age-encryption.org)');
  }

  if (!config.privateKeyPath) {
    throw new Error('no private key path provided for age decryption');
  }
  const stdout = await execFileWithOutput(agePath, ['-d', '-i', config.privateKeyPath], {
    input: ciphertext
  });
  return stdout;
}

/**
 * 同步解密单行文本（用于同步函数如 rebuildIndex）。
 *
 * 使用 execFileSync 阻塞调用 age 解密。
 * 仅在无法使用异步解密的同步上下文中使用。
 *
 * @param {string} ciphertext - age 加密的密文
 * @param {object} config - 加密配置
 * @returns {string} 解密后的明文
 */
export function decryptLineSync(ciphertext, config) {
  // Validate mode FIRST — before checking for age binary
  if (config.mode === 'password') {
    throw new Error('password mode not yet implemented in decryptLineSync');
  }
  if (config.mode !== 'age') {
    throw new Error(`unsupported encryption mode: ${config.mode}`);
  }

  const agePath = resolveBinarySync(AGE_BINARY_CANDIDATES);
  if (!agePath) {
    throw new Error('age binary not found — install age (age-encryption.org)');
  }

  if (!config.privateKeyPath) {
    throw new Error('no private key path provided for age decryption');
  }
  return execFileSync(agePath, ['-d', '-i', config.privateKeyPath], {
    input: ciphertext,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
}
