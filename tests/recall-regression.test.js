import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const CLI_PATH = new URL('../src/cli.js', import.meta.url).pathname;
const FIXTURES_DIR = new URL('fixtures/', import.meta.url).pathname;

/**
 * 辅助函数：在临时目录中创建完整的黄金语料集并重建索引。
 * 返回 MEM_SYNC_HOME 路径。
 */
async function setupGoldenCorpus() {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'recall-regression-'));
  const goldenPath = join(FIXTURES_DIR, 'recall-golden.jsonl');
  const content = await readFile(goldenPath, 'utf8');

  // 确保 .cache 子目录存在（rebuild 需要）
  await mkdir(join(memSyncHome, '.cache'), { recursive: true });
  await writeFile(join(memSyncHome, 'memories.jsonl'), content, 'utf8');

  // 重建索引
  const result = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `index rebuild failed: ${result.stderr}`);

  return memSyncHome;
}

/**
 * 辅助函数：运行 recall 命令并以 JSON 格式返回解析后的输出。
 * extraArgs 直接追加到 CLI 参数列表。
 */
function recallJSON(memSyncHome, query, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    CLI_PATH, 'recall', query, '--format', 'json', ...extraArgs
  ], {
    env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `recall failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

// ══════════════════════════════════════════════════════════════════════════════
// 加载黄金语料清单
// ══════════════════════════════════════════════════════════════════════════════

const manifestPath = join(FIXTURES_DIR, 'recall-golden-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

// ══════════════════════════════════════════════════════════════════════════════
// 从清单生成数据驱动的回归测试
// ══════════════════════════════════════════════════════════════════════════════

for (const [query, spec] of Object.entries(manifest.queries)) {
  test(`golden: ${spec.scenario} — "${query}"`, async (t) => {
    const memSyncHome = await setupGoldenCorpus();
    try {
      const output = recallJSON(memSyncHome, query);
      const ids = output.results.map(r => r.memory?.id || r.id);

      if (spec.expectedTopK) {
        assert.deepEqual(
          ids.slice(0, spec.expectedTopK.length),
          spec.expectedTopK,
          `top entries mismatch for query "${query}"`
        );
      }
      if (spec.expectedOrder) {
        for (let i = 0; i < spec.expectedOrder.length - 1; i++) {
          const aIdx = ids.indexOf(spec.expectedOrder[i]);
          const bIdx = ids.indexOf(spec.expectedOrder[i + 1]);
          assert.ok(
            aIdx >= 0,
            `${spec.expectedOrder[i]} not found in results for "${query}"`
          );
          assert.ok(
            bIdx >= 0,
            `${spec.expectedOrder[i + 1]} not found in results for "${query}"`
          );
          assert.ok(
            aIdx < bIdx,
            `${spec.expectedOrder[i]} (idx ${aIdx}) should precede ${spec.expectedOrder[i + 1]} (idx ${bIdx})`
          );
        }
      }
      if (spec.expectedContains) {
        for (const id of spec.expectedContains) {
          assert.ok(ids.includes(id), `should contain ${id}, got: ${ids.join(', ')}`);
        }
      }
      if (spec.expectedNotContains) {
        for (const id of spec.expectedNotContains) {
          assert.ok(!ids.includes(id), `should NOT contain ${id}`);
        }
      }
      if (spec.expectedCount !== undefined) {
        assert.equal(ids.length, spec.expectedCount);
      }

      // 子查询
      if (spec.subQueries) {
        for (const [subQuery, subSpec] of Object.entries(spec.subQueries)) {
          // 子查询字符串格式："查询词 --flag1 value1 --flag2"
          // 按空白分割后：第一个词是实际查询，其余为 CLI 参数
          const parts = subQuery.split(/\s+/);
          const q = parts[0];
          const args = parts.slice(1);
          const subOutput = recallJSON(memSyncHome, q, args);
          const subIds = subOutput.results.map(r => r.memory?.id || r.id);

          if (subSpec.expectedTopK) {
            assert.deepEqual(
              subIds.slice(0, subSpec.expectedTopK.length),
              subSpec.expectedTopK,
              `sub-query "${subQuery}" topK mismatch`
            );
          }
          if (subSpec.expectedContains) {
            for (const id of subSpec.expectedContains) {
              assert.ok(
                subIds.includes(id),
                `sub-query "${subQuery}" should contain ${id}`
              );
            }
          }
          if (subSpec.expectedNotContains) {
            for (const id of subSpec.expectedNotContains) {
              assert.ok(
                !subIds.includes(id),
                `sub-query "${subQuery}" should NOT contain ${id}`
              );
            }
          }
          if (subSpec.expectedCount !== undefined) {
            assert.equal(subIds.length, subSpec.expectedCount);
          }
        }
      }
    } finally {
      await rm(memSyncHome, { recursive: true, force: true });
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 独立测试：validUntil 边界条件
// ══════════════════════════════════════════════════════════════════════════════

test('validUntil boundary — record expiring exactly now is excluded', async () => {
  const memSyncHome = await mkdtemp(join(tmpdir(), 'recall-boundary-'));
  try {
    const now = new Date().toISOString();
    const record = {
      schemaVersion: 1,
      id: 'mem_boundary',
      canonicalKey: 'episode:global:::boundary',
      kind: 'episode',
      scope: 'global',
      projectId: null,
      agentId: null,
      content: '边界测试记忆',
      summary: '边界测试记忆',
      source: { type: 'manual' },
      evidence: [],
      confidence: 0.8,
      importance: 0.5,
      veracity: 'stated',
      tags: [],
      createdAt: now,
      updatedAt: now,
      validUntil: '2020-01-01T00:00:00.000Z',
      deletedAt: null,
      supersedes: []
    };
    await mkdir(join(memSyncHome, '.cache'), { recursive: true });
    await writeFile(join(memSyncHome, 'memories.jsonl'), JSON.stringify(record) + '\n');

    const rebuild = spawnSync(process.execPath, [CLI_PATH, 'index', 'rebuild'], {
      env: { ...process.env, MEM_SYNC_HOME: memSyncHome },
      encoding: 'utf8'
    });
    assert.equal(rebuild.status, 0, `index rebuild failed: ${rebuild.stderr}`);

    const output = recallJSON(memSyncHome, '边界测试');
    const ids = output.results.map(r => r.memory?.id || r.id);
    assert.ok(!ids.includes('mem_boundary'), 'expired record should not appear');
  } finally {
    await rm(memSyncHome, { recursive: true, force: true });
  }
});
