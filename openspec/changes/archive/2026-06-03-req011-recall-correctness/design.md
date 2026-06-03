# REQ-011 技术方案

## 架构概述

在现有 recall pipeline 中注入两个新的处理阶段：

```
FTS search → [existing filters] → [NEW: supersedes exclusion] → hybrid score → [NEW: quality multiplier] → MMR (with quality) → final results
```

## 变更 1: Veracity 评分映射

**文件**: `src/schema.js`

添加 `VERACITY_SCORES` 常量：
```js
export const VERACITY_SCORES = {
  stated: 1.0,
  tool: 0.9,
  inferred: 0.5,
  imported: 0.5,
  unknown: 0.3
};
```

添加辅助函数：
```js
export function getQualityMultiplier(record) {
  const confidence = record.confidence ?? 0.5;
  const importance = record.importance ?? 0.5;
  const veracityScore = VERACITY_SCORES[record.veracity] ?? 0.3;
  // 三者平均作为质量乘数，范围 [0, 1]
  return (confidence + importance + veracityScore) / 3;
}
```

## 变更 2: Supersedes 后处理过滤

**文件**: `src/index-store.js`，在 `searchIndexHybrid()` 返回结果前

```js
// 在 results 截断到 limit 之前
function excludeSuperseded(results) {
  const resultIds = new Set(results.map(r => r.id));
  const supersededIds = new Set();
  for (const r of results) {
    if (Array.isArray(r.supersedes)) {
      for (const s of r.supersedes) {
        if (resultIds.has(s)) supersededIds.add(s);
      }
    }
  }
  if (supersededIds.size === 0) return results;
  return results.filter(r => !supersededIds.has(r.id));
}
```

调用位置：在 `searchIndexHybrid()` 中，hybrid score 排序之后、MMR 之前。

## 变更 3: 质量加权 Hybrid Score

**文件**: `src/embedding-cache.js`

修改 `computeHybridScore` 添加可选的 `qualityMultiplier` 参数：
```js
export function computeHybridScore(bm25Rank, cosineSim, weight = 0.4, qualityMultiplier = 1.0) {
  const bm25Component = 1 / (1 + Math.abs(bm25Rank));
  const cosineComponent = Math.max(0, cosineSim);
  return (weight * bm25Component + (1 - weight) * cosineComponent) * qualityMultiplier;
}
```

在 `searchIndexHybrid()` 调用处传入质量乘数：
```js
const quality = getQualityMultiplier(result);
result._hybridScore = computeHybridScore(result._rank ?? 0, sim, embeddingWeight, quality);
```

## 变更 4: MMR 质量感知

**文件**: `src/embedding-cache.js`

修改 `mmrRerank()` 中的 relevance 计算：
```js
const relevance = results.map(r => {
  const base = typeof r._hybridScore === 'number'
    ? r._hybridScore
    : Math.abs(r._rank ?? 0) / (1 + Math.abs(r._rank ?? 0));
  const quality = getQualityMultiplier(r);
  return base * quality;
});
```

## 变更 5: searchIndex 纯 FTS 路径

**文件**: `src/index-store.js`

在 `searchIndex()` 的结果处理中，也需要：
1. 应用 supersedes 排除
2. 应用质量加权排序（替代纯 BM25 rank）

```js
// 替代 ORDER BY rank 的后处理排序
results = excludeSuperseded(results);
results.sort((a, b) => {
  const scoreA = Math.abs(a._rank ?? 0) * getQualityMultiplier(a);
  const scoreB = Math.abs(b._rank ?? 0) * getQualityMultiplier(b);
  return scoreB - scoreA; // 降序
});
```

## 测试策略

| 测试场景 | 验证点 |
|---------|--------|
| supersedes 排除 | 创建 A.supersedes=[B.id]，recall 应只返回 A |
| supersedes 无影响 | 当 A 不在结果中时，B 保持 |
| confidence 排序 | 高 confidence 排在低 confidence 之前 |
| importance 排序 | 高 importance 排在低 importance 之前 |
| veracity 排序 | stated > tool > inferred > unknown |
| 质量乘数为零 | confidence=0 的记忆不应出现在结果中 |
| MMR 质量感知 | 高质量记忆在多样性选择中优先 |
