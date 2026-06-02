#!/usr/bin/env node
/**
 * mem-sync 自动测试守护脚本
 *
 * 功能：
 *   1. 检查代码仓库是否有新提交
 *   2. 有变更 → 全量回归 + 影响评估 + 增量测试
 *   3. 无变更 → 快速冒烟测试
 *   4. 生成测试报告（Markdown）
 *   5. 有变更时标记需要 30 分钟后复查
 *
 * 用法：
 *   node tests-e2e/auto-test.mjs              # 正常执行
 *   node tests-e2e/auto-test.mjs --follow-up  # 30 分钟后复查
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const STATE_FILE = join(__dirname, '.last-check.json');
const REPORTS_DIR = join(__dirname, 'reports');

// ─── 工具函数 ────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return {
      ok: true,
      stdout: execSync(cmd, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
        ...opts
      }).trim()
    };
  } catch (e) {
    return {
      ok: false,
      stdout: (e.stdout || '').trim(),
      stderr: (e.stderr || '').trim(),
      status: e.status
    };
  }
}

function now() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function nowISO() {
  return new Date().toISOString();
}

// ─── 状态管理 ────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastCommit: null, lastCheckTime: null, followUpPending: false };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ─── Git 检查 ────────────────────────────────────────────────────────

function getCurrentCommit() {
  return run('git rev-parse HEAD').stdout;
}

function getRecentCommits(count = 5) {
  return run(`git log --oneline -${count}`).stdout;
}

function getChangedFiles(sinceCommit) {
  if (!sinceCommit) return [];
  const result = run(`git diff --name-only ${sinceCommit}..HEAD`);
  if (!result.ok) return [];
  return result.stdout.split('\n').filter(Boolean);
}

function getCommitCount(sinceCommit) {
  if (!sinceCommit) return 0;
  const result = run(`git rev-list --count ${sinceCommit}..HEAD`);
  return parseInt(result.stdout, 10) || 0;
}

// ─── 影响评估 ────────────────────────────────────────────────────────

const IMPACT_MAP = {
  // 高危：核心存储/模型层 → 全量回归
  'src/schema.js':         { level: 'high', tests: 'all' },
  'src/memory-store.js':   { level: 'high', tests: 'all' },
  'src/index-store.js':    { level: 'high', tests: 'all' },
  'src/repo-store.js':     { level: 'high', tests: 'all' },
  'src/merge.js':          { level: 'high', tests: 'all' },
  'src/cli.js':            { level: 'high', tests: 'all' },

  // 中危：命令层 → 回归 + 相关专项
  'src/commands/remember.js': { level: 'mid', tests: ['roundtrip', 'lifecycle'] },
  'src/commands/recall.js':   { level: 'mid', tests: ['roundtrip', 'context-assembly'] },
  'src/commands/retain.js':   { level: 'mid', tests: ['transcripts', 'retain-pipeline'] },
  'src/commands/flush.js':    { level: 'mid', tests: ['multi-device', 'retain-pipeline'] },
  'src/commands/sync.js':     { level: 'mid', tests: ['multi-device'] },
  'src/commands/context.js':  { level: 'mid', tests: ['context-assembly'] },
  'src/commands/review.js':   { level: 'mid', tests: ['review-forget'] },
  'src/commands/forget.js':   { level: 'mid', tests: ['review-forget'] },
  'src/commands/compact.js':  { level: 'mid', tests: ['edge-cases'] },
  'src/commands/show.js':     { level: 'mid', tests: ['review-forget'] },
  'src/commands/status.js':   { level: 'mid', tests: ['review-forget'] },
  'src/commands/index.js':    { level: 'mid', tests: ['roundtrip', 'edge-cases'] },
  'src/commands/log.js':      { level: 'mid', tests: ['review-forget'] },
  'src/commands/redact.js':   { level: 'mid', tests: ['redaction-security'] },
  'src/commands/init.js':     { level: 'mid', tests: ['edge-cases'] },
  'src/commands/doctor.js':   { level: 'mid', tests: ['edge-cases'] },
  'src/commands/prepare.js':  { level: 'mid', tests: ['multi-device'] },
  'src/commands/summarize.js':{ level: 'mid', tests: ['context-assembly'] },

  // 中危：引擎层 → 相关专项
  'src/retain-engine.js':      { level: 'mid', tests: ['transcripts'] },
  'src/summarize-engine.js':   { level: 'mid', tests: ['context-assembly'] },
  'src/redaction-engine.js':   { level: 'mid', tests: ['redaction-security'] },
  'src/embedding-cache.js':    { level: 'mid', tests: ['roundtrip'] },
  'src/embedding-provider.js': { level: 'mid', tests: ['roundtrip'] },
  'src/lock.js':               { level: 'mid', tests: ['edge-cases'] },

  // 低危：文档/配置 → 跳过
  'README.md':     { level: 'low', tests: [] },
  'CHANGELOG.md':  { level: 'low', tests: [] },
  '.gitignore':    { level: 'low', tests: [] },
  'LICENSE':       { level: 'low', tests: [] },
};

function assessImpact(changedFiles) {
  const result = {
    level: 'none',
    testSuites: new Set(),
    hasNewCommands: false,
    hasSchemaChange: false,
    hasDependencyChange: false,
    changedModules: []
  };

  for (const file of changedFiles) {
    // 跳过测试文件本身
    if (file.startsWith('tests/') || file.startsWith('tests-e2e/')) continue;

    // 依赖变更
    if (file === 'package.json' || file === 'package-lock.json') {
      result.hasDependencyChange = true;
      result.level = 'high';
      result.testSuites.add('all');
      continue;
    }

    // 新增命令检测
    if (file.startsWith('src/commands/') && file.endsWith('.js')) {
      const commandName = file.replace('src/commands/', '').replace('.js', '');
      result.changedModules.push(commandName);
    }

    // Schema 变更
    if (file === 'src/schema.js') {
      result.hasSchemaChange = true;
    }

    const impact = IMPACT_MAP[file];
    if (!impact) continue;

    // 未知文件默认中危
    if (impact.level === 'high') {
      result.level = 'high';
      result.testSuites.add('all');
    } else if (impact.level === 'mid' && result.level !== 'high') {
      result.level = 'mid';
      for (const t of impact.tests) {
        result.testSuites.add(t);
      }
    }
  }

  return result;
}

// ─── 测试执行 ────────────────────────────────────────────────────────

const ALL_SUITES = [
  'lifecycle',
  'roundtrip',
  'multi-device',
  'retain-pipeline',
  'context-assembly',
  'edge-cases',
  'transcripts',
  'redaction-security',
  'review-forget'
];

function runTestSuite(suiteName, timeout = 60_000) {
  const file = join(__dirname, `${suiteName}.test.js`);
  if (!existsSync(file)) {
    return { suite: suiteName, passed: 0, failed: 0, skipped: true, duration: 0, errors: [] };
  }

  const start = Date.now();
  const result = run(`node --test "${file}"`, { timeout });
  const duration = Date.now() - start;

  if (!result.ok) {
    // 解析失败信息
    const errors = [];
    const lines = (result.stderr + '\n' + result.stdout).split('\n');
    for (const line of lines) {
      if (line.includes('✖') || line.includes('AssertionError') || line.includes('Error:')) {
        errors.push(line.trim());
      }
    }
    const failMatch = result.stdout.match(/ℹ fail (\d+)/);
    const passMatch = result.stdout.match(/ℹ pass (\d+)/);
    return {
      suite: suiteName,
      passed: parseInt(passMatch?.[1] || '0', 10),
      failed: parseInt(failMatch?.[1] || '1', 10),
      skipped: false,
      duration,
      errors: errors.slice(0, 5)
    };
  }

  const passMatch = result.stdout.match(/ℹ pass (\d+)/);
  const failMatch = result.stdout.match(/ℹ fail (\d+)/);
  return {
    suite: suiteName,
    passed: parseInt(passMatch?.[1] || '0', 10),
    failed: parseInt(failMatch?.[1] || '0', 10),
    skipped: false,
    duration,
    errors: []
  };
}

function runSmoketest() {
  // 快速冒烟：只跑 roundtrip 和 lifecycle
  const suites = ['roundtrip', 'lifecycle'];
  return suites.map(s => runTestSuite(s, 30_000));
}

function runFullRegression() {
  return ALL_SUITES.map(s => runTestSuite(s, 90_000));
}

function runIncrementalTests(suites) {
  const toRun = [...new Set(suites)].filter(s => ALL_SUITES.includes(s));
  return toRun.map(s => runTestSuite(s, 60_000));
}

// ─── 报告生成 ────────────────────────────────────────────────────────

function generateReport({ mode, commit, commitCount, changedFiles, impact, results, startTime, endTime }) {
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const allPassed = totalFailed === 0;

  let md = `# 自动测试报告

**执行时间**：${startTime}
**完成时间**：${endTime}
**执行模式**：${mode === 'smoke' ? '🟢 快速冒烟（无变更）' : '🔴 全量回归（检测到变更）'}
**仓库最新提交**：${commit}

`;

  if (mode !== 'smoke') {
    md += `## 📝 变更概览

- **新增提交数**：${commitCount}
- **变更文件数**：${changedFiles.length}
- **影响等级**：${impact.level === 'high' ? '🔴 高危' : impact.level === 'mid' ? '🟡 中危' : '🟢 低危'}
- **Schema 变更**：${impact.hasSchemaChange ? '⚠️ 是' : '否'}
- **依赖变更**：${impact.hasDependencyChange ? '⚠️ 是' : '否'}

**变更文件列表**：
\`\`\`
${changedFiles.join('\n')}
\`\`\`

`;
  }

  md += `## 🧪 测试结果

| 测试套件 | 通过 | 失败 | 耗时 | 状态 |
|---------|------|------|------|------|
`;

  for (const r of results) {
    const status = r.skipped ? '⏭️ 跳过' : r.failed > 0 ? '❌ 失败' : '✅ 通过';
    const duration = r.skipped ? '-' : `${(r.duration / 1000).toFixed(1)}s`;
    md += `| ${r.suite} | ${r.passed} | ${r.failed} | ${duration} | ${status} |\n`;
  }

  md += `
**总计**：${totalPassed} 通过 / ${totalFailed} 失败 / 耗时 ${(totalDuration / 1000).toFixed(1)}s
**结论**：${allPassed ? '✅ 全部通过' : '❌ 存在失败，需要关注'}

`;

  // 失败详情
  const failedSuites = results.filter(r => r.failed > 0);
  if (failedSuites.length > 0) {
    md += `## ❌ 失败详情

`;
    for (const r of failedSuites) {
      md += `### ${r.suite}
`;
      for (const err of r.errors) {
        md += `- ${err}
`;
      }
      md += `
`;
    }
  }

  // 建议
  md += `## 💡 建议

`;
  if (allPassed && mode === 'smoke') {
    md += `- 仓库无变更，冒烟测试通过，一切正常
`;
  } else if (allPassed && mode !== 'smoke') {
    md += `- 变更后的回归测试全部通过，代码质量良好
`;
    if (impact.hasSchemaChange) {
      md += `- ⚠️ Schema 有变更，建议检查数据迁移兼容性
`;
    }
    if (impact.hasDependencyChange) {
      md += `- ⚠️ 依赖有变更，建议检查 CI/CD 环境是否一致
`;
    }
  } else {
    md += `- ❌ 存在失败测试，建议立即排查
`;
    md += `- 检查最近的代码变更是否引入了回归
`;
  }

  return { markdown: md, allPassed, totalPassed, totalFailed };
}

// ─── 主流程 ──────────────────────────────────────────────────────────

async function main() {
  const isFollowUp = process.argv.includes('--follow-up');
  const startTime = now();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  mem-sync 自动测试 ${isFollowUp ? '(复查)' : '(定时)'} - ${startTime}`);
  console.log(`${'═'.repeat(60)}\n`);

  // 1. 加载上次状态
  const state = loadState();
  const currentCommit = getCurrentCommit();
  const commitCount = getCommitCount(state.lastCommit);
  const changedFiles = getChangedFiles(state.lastCommit);

  // 过滤掉测试文件
  const codeChanges = changedFiles.filter(
    f => !f.startsWith('tests/') && !f.startsWith('tests-e2e/')
  );

  console.log(`📦 当前提交: ${currentCommit.slice(0, 8)}`);
  console.log(`📦 上次提交: ${state.lastCommit ? state.lastCommit.slice(0, 8) : '首次运行'}`);
  console.log(`📦 新增提交: ${commitCount}`);
  console.log(`📦 变更文件: ${codeChanges.length} 个\n`);

  // 2. 判断模式
  let mode, results, impact;

  if (codeChanges.length === 0) {
    // 无变更 → 快速冒烟
    mode = 'smoke';
    console.log('🟢 无代码变更，执行快速冒烟测试...\n');
    results = runSmoketest();
  } else {
    // 有变更 → 全量回归 + 增量
    mode = 'full';
    impact = assessImpact(changedFiles);

    console.log(`🔴 检测到 ${codeChanges.length} 个文件变更`);
    console.log(`   影响等级: ${impact.level}`);
    console.log(`   变更模块: ${impact.changedModules.join(', ') || '(存储/引擎层)'}\n`);

    if (impact.level === 'high') {
      console.log('🔴 高危变更，执行全量回归测试...\n');
      results = runFullRegression();
    } else {
      // 中危：回归 + 受影响的专项
      const regressionSuites = ['roundtrip', 'lifecycle'];
      const incrementalSuites = [...impact.testSuites];

      console.log('🟡 执行回归测试 + 增量测试...\n');
      console.log(`   回归套件: ${regressionSuites.join(', ')}`);
      console.log(`   增量套件: ${incrementalSuites.join(', ')}\n`);

      const regressionResults = regressionSuites.map(s => runTestSuite(s));
      const incrementalResults = incrementalSuites
        .filter(s => !regressionSuites.includes(s))
        .map(s => runTestSuite(s));

      results = [...regressionResults, ...incrementalResults];
    }
  }

  const endTime = now();

  // 3. 生成报告
  const report = generateReport({
    mode,
    commit: currentCommit,
    commitCount,
    changedFiles: codeChanges,
    impact: impact || { level: 'none', hasSchemaChange: false, hasDependencyChange: false, changedModules: [] },
    results,
    startTime,
    endTime
  });

  // 保存报告
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = join(REPORTS_DIR, `${new Date().toISOString().slice(0, 10)}-${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}.md`);
  writeFileSync(reportFile, report.markdown, 'utf8');
  console.log(`📄 报告已保存: ${reportFile}`);

  // 4. 更新状态
  const needsFollowUp = codeChanges.length > 0 && !report.allPassed;
  saveState({
    lastCommit: currentCommit,
    lastCheckTime: nowISO(),
    totalTests: report.totalPassed + report.totalFailed,
    passed: report.totalPassed,
    failed: report.totalFailed,
    // 复查模式下：通过则清除标记，失败则保留标记给人工处理
    followUpPending: isFollowUp ? false : needsFollowUp,
    mode
  });

  // 5. 输出摘要
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  结果: ${report.totalPassed} 通过 / ${report.totalFailed} 失败`);
  console.log(`  结论: ${report.allPassed ? '✅ 全部通过' : '❌ 存在失败'}`);
  if (needsFollowUp) {
    console.log(`  ⏰ 测试有失败，30 分钟后将自动复查`);
  }
  console.log(`${'─'.repeat(60)}\n`);

  // 退出码
  process.exit(report.allPassed ? 0 : 1);
}

main().catch(e => {
  console.error('自动测试脚本异常:', e);
  process.exit(2);
});
