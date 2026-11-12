#!/bin/bash
# Finder 启动时工作目录不固定，始终使用启动器所在目录的恢复脚本。
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

echo 'Antigravity 一键更新与恢复汉化（macOS）'
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 14 ? 0 : 1)'; then
  echo '需要 Node.js 14 或更新版本。请安装后重试，或按 README 手动替换同版本预制包。'
  read -r -p '按回车关闭…' _
  exit 1
fi

echo '请先保存工作：恢复流程会关闭 Antigravity 及相关后台进程。'
echo '仅使用本地同版本预制包，不联网下载或重新打包。'
read -r -p '输入 y 继续，其他输入取消：' answer
case "$answer" in
  y|Y) ;;
  *) echo '已取消，未修改应用。'; exit 0 ;;
esac

node "$SCRIPT_DIR/localize.js" --auto-restore
RESTORE_CODE=$?
case "$RESTORE_CODE" in
  0)
    echo '汉化包已就绪，正在打开 Antigravity…'
    open -a '/Applications/Antigravity.app' || RESTORE_CODE=1
    ;;
  2) echo '版本不匹配，未覆盖客户端。请获取对应客户端版本的汉化包后重试。' ;;
  *) echo '恢复失败。请检查上方错误、客户端路径和本地预制包是否完整。' ;;
esac
read -r -p '按回车关闭…' _
exit "$RESTORE_CODE"
