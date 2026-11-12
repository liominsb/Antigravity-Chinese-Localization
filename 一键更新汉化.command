#!/bin/bash
# Finder 启动时工作目录不固定，始终使用启动器所在目录的恢复脚本。
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

node_is_usable() {
  [ -n "$1" ] && [ -x "$1" ] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 14 ? 0 : 1)' >/dev/null 2>&1
}

NODE_BIN="$(command -v node 2>/dev/null)"
if ! node_is_usable "$NODE_BIN"; then
  # 由用户自己的 shell 加载配置，避免 Bash 解释 Zsh 语法；标记行隔离启动输出。
  NODE_BIN="$("${SHELL:-/bin/zsh}" -lic 'printf "\n__ANTIGRAVITY_NODE__=%s\n" "$(command -v node)"' </dev/null 2>/dev/null | sed -n 's/^__ANTIGRAVITY_NODE__=//p' | tail -n 1)"
fi
if ! node_is_usable "$NODE_BIN"; then
  # NVM 可能尚未写入 shell 配置，加载后必须显式选择默认版本。
  NODE_BIN="$(NVM_DIR="${NVM_DIR:-$HOME/.nvm}" /bin/bash -c '
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1 &&
    nvm use --silent default >/dev/null 2>&1 && command -v node
  ' </dev/null 2>/dev/null)"
fi

echo 'Antigravity 一键更新与恢复汉化（macOS）'
if ! node_is_usable "$NODE_BIN"; then
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

"$NODE_BIN" "$SCRIPT_DIR/localize.js" --auto-restore
RESTORE_CODE=$?
case "$RESTORE_CODE" in
  0)
    echo '汉化包已就绪，正在打开 Antigravity…'
    open -a '/Applications/Antigravity.app' 2>/dev/null || open -a Antigravity 2>/dev/null ||
      echo '提示：未能自动启动应用，请手动打开 Antigravity。'
    ;;
  2) echo '版本不匹配，未覆盖客户端。请获取对应客户端版本的汉化包后重试。' ;;
  *) echo '恢复失败。请检查上方错误、客户端路径和本地预制包是否完整。' ;;
esac
read -r -p '按回车关闭…' _
exit "$RESTORE_CODE"
