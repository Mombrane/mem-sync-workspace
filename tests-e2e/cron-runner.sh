#!/usr/bin/env bash
# mem-sync 自动测试 cron 包装脚本
#
# 用法：
#   ./cron-runner.sh              # 定时执行
#   ./cron-runner.sh --follow-up  # 复查模式（仅在有失败标记时运行）
#
# cron 配置：
#   0 */2 * * *  /path/to/cron-runner.sh >> cron.log 2>&1
#   30 */2 * * * /path/to/cron-runner.sh --follow-up >> cron.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$SCRIPT_DIR/reports/cron.log"
STATE_FILE="$SCRIPT_DIR/.last-check.json"

mkdir -p "$SCRIPT_DIR/reports"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# ─── 锁机制 ─────────────────────────────────────────────────────────

LOCK_FILE="$SCRIPT_DIR/.auto-test.lock"
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0) ))
  if [ "$LOCK_AGE" -lt 300 ]; then
    log "⏭️ 跳过：另一个测试正在运行（锁文件存在 ${LOCK_AGE}s）"
    exit 0
  fi
  log "⚠️ 清理过期锁文件（${LOCK_AGE}s）"
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ─── 复查模式检查 ────────────────────────────────────────────────────

IS_FOLLOWUP=false
if [[ "${1:-}" == "--follow-up" ]]; then
  IS_FOLLOWUP=true
fi

if $IS_FOLLOWUP; then
  if [ -f "$STATE_FILE" ]; then
    NEED_FOLLOWUP=$(node -e "
      const s = JSON.parse(require('fs').readFileSync('$STATE_FILE','utf8'));
      console.log(s.followUpPending ? 'yes' : 'no');
    " 2>/dev/null || echo "no")

    if [ "$NEED_FOLLOWUP" != "yes" ]; then
      log "⏭️ 跳过复查：没有待复查的失败"
      exit 0
    fi
    log "🔄 确认需要复查，继续执行"
  else
    log "⏭️ 跳过复查：无状态文件"
    exit 0
  fi
fi

# ─── 执行测试 ────────────────────────────────────────────────────────

log "🚀 开始执行自动测试${IS_FOLLOWUP && echo '（复查）' || echo ''}"

cd "$PROJECT_ROOT"

if $IS_FOLLOWUP; then
  node tests-e2e/auto-test.mjs --follow-up 2>&1 | tee -a "$LOG_FILE"
else
  node tests-e2e/auto-test.mjs 2>&1 | tee -a "$LOG_FILE"
fi
EXIT_CODE=${PIPESTATUS[0]}

# ─── 结果处理 ────────────────────────────────────────────────────────

if [ $EXIT_CODE -eq 0 ]; then
  log "✅ 测试全部通过"
  # 清除复查标记
  if [ -f "$STATE_FILE" ]; then
    node -e "
      const fs = require('fs');
      const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
      s.followUpPending = false;
      fs.writeFileSync('$STATE_FILE', JSON.stringify(s, null, 2));
    " 2>/dev/null
  fi
else
  log "❌ 测试存在失败（退出码: $EXIT_CODE）"
  if ! $IS_FOLLOWUP; then
    # 定时执行有失败 → 标记需要复查
    log "⏰ 标记需要 30 分钟后复查"
    if [ -f "$STATE_FILE" ]; then
      node -e "
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
        s.followUpPending = true;
        fs.writeFileSync('$STATE_FILE', JSON.stringify(s, null, 2));
      " 2>/dev/null
    fi
  else
    # 复查仍有失败 → 清除标记，记录最终状态
    log "⚠️ 复查仍有失败，请人工排查"
    if [ -f "$STATE_FILE" ]; then
      node -e "
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf8'));
        s.followUpPending = false;
        fs.writeFileSync('$STATE_FILE', JSON.stringify(s, null, 2));
      " 2>/dev/null
    fi
  fi
fi

log "🏁 自动测试完成（退出码: $EXIT_CODE）"
exit $EXIT_CODE
