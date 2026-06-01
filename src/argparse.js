/**
 * 共享的命令行参数解析辅助函数。
 *
 * 这些纯函数提取自 cli.js 的内联解析逻辑，
 * 供 remember、recall 及其他命令模块复用。
 * 所有函数均为纯函数，方便隔离测试。
 */

/**
 * 从参数数组中获取标志的下一个值。
 * 如果下一个值不存在或看起来像另一个标志（以 -- 开头），
 * 则抛出错误，提供一致且可操作的错误消息。
 *
 * @param {string[]} args - 命令行参数数组
 * @param {number} index - 当前标志在 args 中的索引
 * @param {string} flag - 标志名称（如 '--scope'），用于错误消息
 * @returns {string} 标志对应的值
 * @throws {Error} 如果值缺失或值本身看起来像标志
 */
export function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

/**
 * 验证值是否属于允许的枚举值集合。
 * 如果不在集合中，抛出信息丰富的错误，列出允许值。
 *
 * @param {string} value - 要验证的值
 * @param {string[]} allowed - 允许的枚举值数组
 * @param {string} flag - 标志名称，用于错误消息
 * @returns {string} 验证过的值（直通返回，便于链式调用）
 * @throws {Error} 如果值不在 allowed 数组中
 */
export function validateEnum(value, allowed, flag) {
  if (!allowed.includes(value)) {
    throw new Error(`${flag} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

/**
 * 验证数字值是否在闭区间 [min, max] 范围内。
 * 检查是否为有限数以及范围约束。
 *
 * @param {number} value - 要验证的数值
 * @param {number} min - 最小值（含）
 * @param {number} max - 最大值（含）
 * @param {string} flag - 标志名称，用于错误消息
 * @returns {number} 验证过的值（直通返回，便于链式调用）
 * @throws {Error} 如果值不是有限数或超出范围
 */
export function validateRange(value, min, max, flag) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${flag} must be between ${min} and ${max}.`);
  }
  return value;
}

/**
 * 验证值是否为大于 0 的正整数。
 * 对 --limit 等必须为正整数且不能为 0/负数/小数的标志使用。
 *
 * @param {number|string} value - 要验证的值（将使用 parseInt）
 * @param {string} flag - 标志名称，用于错误消息
 * @returns {number} 解析并验证后的正整数
 * @throws {Error} 如果值不是正整数
 */
export function validatePositiveInt(value, flag) {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0 || String(num) !== String(value).trim()) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return num;
}
