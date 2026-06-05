# REQ-020 技术方案

## 架构

修改 `src/index-store.js` 中的 `updateIndex` 函数，将 HEAD 变化时的全量重建替换为增量更新。

## 实现细节

### 1. 新增辅助函数 `gitDiffFiles(oldHead, newHead, repoDir)`

在 `index-store.js` 中添加：
```javascript
import { spawnSync } from 'node:child_process';

function gitDiffFiles(oldHead, newHead, repoDir) {
  const result = spawnSync('git', ['diff', '--name-only', oldHead, newHead], {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git diff failed');
  }
  return result.stdout.trim().split('\n').filter(Boolean);
}
```

### 2. 新增辅助函数 `indexFile(db, filePath, repoCommit, logger)`

从 `rebuildIndex` 提取单文件索引逻辑：
- 读取 JSONL 文件
- 处理加密行（复用现有逻辑）
- DELETE WHERE file_path = filePath
- INSERT 新记录

### 3. 修改 `updateIndex`

```javascript
export function updateIndex(repoDir, cacheDir, options = {}) {
  const { logger, repoHead: explicitHead } = options;
  const head = explicitHead ?? getGitHead(repoDir);
  const status = getIndexStatus(cacheDir);

  // 索引尚未创建或 repo_head 缺失 → 全量重建
  if (!status.exists || !status.repoHead) {
    return fullRebuild(repoDir, cacheDir, options);
  }

  // HEAD 未变化 → 跳过
  if (status.repoHead === head) {
    return { skipped: true };
  }

  // HEAD 变化 → 尝试增量更新
  try {
    const changedFiles = gitDiffFiles(status.repoHead, head, repoDir);
    const jsonlFiles = changedFiles.filter(f => f.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      // 无 JSONL 文件变更，仅更新 HEAD
      updateRepoHead(cacheDir, head);
      return { updated: true, recordCount: 0 };
    }

    // 增量更新变更的文件
    const recordCount = incrementalUpdate(repoDir, cacheDir, jsonlFiles, head, logger);
    return { updated: true, recordCount };
  } catch (err) {
    // git diff 失败 → 回退到全量重建
    logger?.(`[mem-sync:index] update:fallback git diff failed: ${err.message}`);
    return fullRebuild(repoDir, cacheDir, options);
  }
}
```

### 4. 增量更新函数 `incrementalUpdate`

```javascript
function incrementalUpdate(repoDir, cacheDir, changedFiles, newHead, logger) {
  const dbPath = resolveDbPath(cacheDir);
  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  const deleteStmt = db.prepare('DELETE FROM memories WHERE file_path = ?');
  // ... 复用 rebuildIndex 的 insertStmt 和批处理逻辑 ...

  let recordCount = 0;
  const updateBatch = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(row);
      recordCount += 1;
    }
  });

  // 处理每个变更文件
  for (const relPath of changedFiles) {
    const absPath = path.join(repoDir, relPath);
    
    // 删除该文件的旧记录
    deleteStmt.run(absPath);
    
    // 检查文件是否还存在（可能被删除）
    if (!existsSync(absPath)) {
      logger?.(`[mem-sync:index] update:deleted ${relPath}`);
      continue;
    }
    
    // 重新索引该文件
    const rows = indexFileToRows(absPath, head);
    if (rows.length > 0) {
      updateBatch(rows);
    }
  }

  // 重建 FTS
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild');");
  
  // 更新 repo_head
  db.prepare('INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)')
    .run('repo_head', newHead);
  
  db.close();
  return recordCount;
}
```

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/index-store.js` | 修改 `updateIndex`，新增 `gitDiffFiles`、`incrementalUpdate`、`indexFileToRows`、`updateRepoHead` |
| `test/index-store.test.js` | 新增 5 个增量更新测试 |

## 风险

1. **git diff 在非 git 仓库失败** → 已处理，catch 回退到全量重建
2. **文件重命名** → git diff 显示为 delete + add，正确处理
3. **加密文件** → 复用现有解密逻辑
4. **FTS 全量重建** → 无法避免，FTS5 外部内容表必须全量 rebuild
