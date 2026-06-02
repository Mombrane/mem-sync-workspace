#!/usr/bin/env bash
# 安装/更新 mem-sync 自动测试的 cron 定时任务
#
# 用法：
#   ./setup-cron.sh install   # 安装定时任务
#   ./setup-cron.sh remove    # 移除定时任务
#   ./setup-cron.sh status    # 查看当前状态

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CRON_RUNNER="$SCRIPT_DIR/cron-runner.sh"
LOG_FILE="$SCRIPT_DIR/reports/cron.log"
CRON_TAG="# mem-sync-auto-test"

install_cron() {
  # 移除旧的
  remove_cron_silent

  # 主任务：每 2 小时执行
  (crontab -l 2>/dev/null || true; echo "0 */2 * * * $CRON_RUNNER >> $LOG_FILE 2>&1 $CRON_TAG-main") | crontab -
  # 复查任务：每 2 小时的 30 分执行（仅在有失败标记时运行）
  (crontab -l 2>/dev/null || true; echo "30 */2 * * * $CRON_RUNNER --follow-up >> $LOG_FILE 2>&1 $CRON_TAG-followup") | crontab -

  echo "✅ 定时任务已安装"
  echo "   主检查：每 2 小时整点执行"
  echo "   复查：每 2 小时的 30 分执行（仅在有失败时）"
  echo ""
  echo "当前 cron 任务："
  crontab -l 2>/dev/null | grep "mem-sync" || echo "（无）"
}

remove_cron_silent() {
  crontab -l 2>/dev/null | grep -v "$CRON_TAG" | crontab - 2>/dev/null || true
}

remove_cron() {
  remove_cron_silent
  echo "✅ 定时任务已移除"
}

status() {
  echo "📊 mem-sync 自动测试状态"
  echo ""

  # cron 状态
  if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    echo "⏰ 定时任务：已启用"
    crontab -l 2>/dev/null | grep "$CRON_TAG"
  else
    echo "⏰ 定时任务：未启用"
  fi

  echo ""

  # 上次检查状态
  if [ -f "$SCRIPT_DIR/.last-check.json" ]; then
    echo "📦 上次检查："
    cat "$SCRIPT_DIR/.last-check.json" | sed 's/^/   /'
  else
    echo "📦 上次检查：首次运行"
  fi

  echo ""

  # 最近报告
  LATEST_REPORT=$(ls -t "$SCRIPT_DIR/reports/"*.md 2>/dev/null | head -1)
  if [ -n "$LATEST_REPORT" ]; then
    echo "📄 最新报告：$LATEST_REPORT"
  else
    echo "📄 最新报告：无"
  fi
}

case "${1:-status}" in
  install) install_cron ;;
  remove)  remove_cron ;;
  status)  status ;;
  *)
    echo "用法: $0 {install|remove|status}"
    exit 1
    ;;
esac
