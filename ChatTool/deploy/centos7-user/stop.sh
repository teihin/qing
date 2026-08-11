#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="${deploy_dir}/run/supervisor.pid"

if [[ ! -r "${pid_file}" ]]; then
  echo "ChatTool 未运行"
  exit 0
fi

running_pid="$(tr -d '[:space:]' < "${pid_file}")"
if [[ -n "${running_pid}" ]] && kill -0 "${running_pid}" 2>/dev/null; then
  kill "${running_pid}"
  # 兼容尚未主动关闭SSE的旧版本，最多等待20秒；新版本通常会立即退出。
  for _ in {1..80}; do
    # supervise.sh 的退出清理会先删除 pid 文件；在部分系统中，父进程
    # 已退出后仍可能短暂保留为僵尸进程，此时 kill -0 仍会返回成功。
    if [[ ! -e "${pid_file}" ]] || ! kill -0 "${running_pid}" 2>/dev/null; then
      echo "ChatTool 已停止"
      exit 0
    fi
    sleep 0.25
  done
fi

echo "ChatTool 停止超时" >&2
exit 1
