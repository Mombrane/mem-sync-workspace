import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * 解析项目标识符，按优先级从多层后备策略中选择。
 *
 * 项目 ID 是跨设备稳定的字符串，用于将上下文数据与项目关联。
 * 解析按以下优先级进行：
 *   1. 显式 ID（--project-id 标志）— 绝对优先
 *   2. Git remote origin URL → SHA256，取前 12 个十六进制字符
 *   3. package.json 中的 name 字段
 *   4. 当前工作目录的 basename（始终成功的兜底方案）
 *
 * @param {string} cwd - 当前工作目录路径
 * @param {string|null} [explicitId=null] - 显式项目 ID（通常由 --project-id 提供）
 * @returns {string} 解析后的项目标识符
 */
export function resolveProjectId(cwd, explicitId = null) {
  // 1. 显式 ID 具有绝对优先权
  if (explicitId) return explicitId;

  // 2. Git remote origin URL → SHA256，取前 12 个十六进制字符
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
    if (remoteUrl) {
      return createHash('sha256').update(remoteUrl).digest('hex').slice(0, 12);
    }
  } catch { /* 没有 remote，继续 */ }

  // 3. package.json 中的 name 字段
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (pkg.name) return pkg.name;
  } catch { /* 没有 package.json，继续 */ }

  // 4. 目录 basename（始终成功）
  return basename(cwd);
}
