/**
 * file-store.js — 向后兼容导出层
 *
 * 存储层已迁移到 repo-store.js（JSONL 格式，每行一条 JSON 记录）。
 * 本文件保留旧的导出签名（resolveStorePath / readMemories / writeMemories），
 * 确保现有调用方无需改动即可继续运行，同时暴露新的 JSONL API。
 *
 * 迁移要点：
 * - readMemories: 优先读 .jsonl，回退读旧 .json（{ memories: [...] } 包装格式）
 * - writeMemories: 统一写 .jsonl 格式，不再产生旧 JSON 文件
 * - 新增导出: readJSONL, readJSONLStream, appendJSONL, writeJSONL
 */
export {
  // 向后兼容导出（旧调用方无需改动）
  resolveStorePath,
  readMemories,
  writeMemories,
  // 旧 JSON 路径（迁移/调试用）
  resolveLegacyStorePath,
  // 新 JSONL API
  readJSONL,
  readJSONLStream,
  appendJSONL,
  writeJSONL
} from './repo-store.js';
