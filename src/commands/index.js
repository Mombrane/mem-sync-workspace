import { join } from 'node:path';
import {
  rebuildIndex,
  getIndexStatus,
  updateIndex
} from '../index-store.js';
import { getEmbeddingStatus } from '../embedding-cache.js';

/**
 * 解析仓库目录和缓存目录的默认路径。
 * repoDir 是 JSONL 源数据所在的基础目录，
 * cacheDir 是 SQLite 索引数据库的存放目录。
 */
function resolveDirs() {
  const repoDir = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const cacheDir = join(repoDir, '.cache');
  return { repoDir, cacheDir };
}

/**
 * index rebuild 命令：全量重建 FTS5 全文索引。
 *
 * 扫描 repoDir 下所有 .jsonl 文件，验证每条记录，
 * 将有效记录插入 SQLite 并重建 FTS5 索引。
 *
 * 输出 JSON { indexed: N }，N 为成功索引的记录数。
 * 诊断日志通过 logger 回调输出到 stderr。
 */
export function rebuildCommand() {
  const { repoDir, cacheDir } = resolveDirs();
  const result = rebuildIndex(repoDir, cacheDir, {
    logger: (message) => console.error(message)
  });
  console.log(JSON.stringify({ indexed: result.recordCount }));
}

/**
 * index status 命令：查询索引状态。
 *
 * 支持 --format json 输出结构化状态：
 * { recordCount, repoHead, dbPath, exists }
 *
 * 不带 --format 参数时输出人类可读的摘要。
 */
export function statusCommand(args) {
  const { cacheDir } = resolveDirs();
  const status = getIndexStatus(cacheDir);

  const useJson = args.includes('--format') && args[args.indexOf('--format') + 1] === 'json';

  const embStatus = getEmbeddingStatus(cacheDir);

  if (useJson) {
    console.log(JSON.stringify({ ...status, embeddingCache: embStatus }));
  } else {
    // 人类可读输出
    console.log(`Index: ${status.exists ? 'exists' : 'not found'}`);
    if (status.exists) {
      console.log(`  Record count: ${status.recordCount}`);
      console.log(`  Repo HEAD:    ${status.repoHead ?? 'unknown'}`);
      console.log(`  DB path:      ${status.dbPath}`);
    }

    if (embStatus.exists && embStatus.count > 0) {
      process.stdout.write(`\nEmbedding Cache:\n`);
      process.stdout.write(`  Embeddings: ${embStatus.count}\n`);
      process.stdout.write(`  Model: ${embStatus.model ?? 'unknown'}\n`);
      process.stdout.write(`  Dimensions: ${embStatus.dimensions ?? 'unknown'}\n`);
    } else if (embStatus.exists) {
      process.stdout.write(`\nEmbedding Cache: empty (no embeddings computed)\n`);
    } else {
      process.stdout.write(`\nEmbedding Cache: not created\n`);
    }
  }
}

/**
 * index update 命令：增量更新索引。
 *
 * 检查 repo_head 是否变化：
 * - 无变化：跳过，输出 { skipped: true }
 * - 有变化或索引不存在：执行全量重建，输出 { rebuilt: true, recordCount: N }
 */
export function updateCommand() {
  const { repoDir, cacheDir } = resolveDirs();
  const result = updateIndex(repoDir, cacheDir, {
    logger: (message) => console.error(message)
  });
  console.log(JSON.stringify(result));
}
