#!/bin/zsh
# 双击启动一个 Worker（前台运行，日志就在窗口里）。
# 关掉这个窗口 / 按 Ctrl-C 就会停掉这一个 Worker；再双击一次就是再起一个（节点编号自动区分）。
set -u
SCRIPT_DIR="${0:A:h}"
BIN_DIR="$SCRIPT_DIR/XuanManager/server/bin"
CLIENT_DIR="$SCRIPT_DIR/XuanManager/agent-client"

if [[ ! -x "$BIN_DIR/xuanagent" ]]; then
    echo "找不到可执行文件：$BIN_DIR/xuanagent"
    read "REPLY?按回车键关闭窗口..."
    exit 1
fi

# 节点编号：每次启动自动加短编号，多个 Worker 同时跑不会互相顶掉同一个节点行。
CODE="${1:-mac-mini-$(printf '%03d' $((RANDOM % 1000)))}"
LOG_FILE="/tmp/xuanagent-$CODE.log"

cd "$BIN_DIR" || exit 1
echo "Worker 节点编号：$CODE"
echo "日志：$LOG_FILE"
echo "关掉这个窗口（或按 Ctrl-C）就停止；要停全部 Worker 请双击「5停止机器人Worker.command」。"
echo "-----------------------------------------------------------------------"

export XUAN_AGENT_CODE="$CODE"
# 前台跑：窗口在，Worker 就在。Ctrl-C 走正常退出（会通知后台下线）。
./xuanagent 2>&1 | tee "$LOG_FILE"

echo
echo "Worker $CODE 已退出。"
read "REPLY?按回车键关闭窗口..."
