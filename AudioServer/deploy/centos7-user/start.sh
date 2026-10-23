#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="${deploy_dir}/run/supervisor.pid"
health_url="http://127.0.0.1:18080/healthz"

healthy() {
  curl --fail --silent --max-time 1 "${health_url}" >/dev/null
}

install_route() {
  if [[ -x "${deploy_dir}/install-caddy-route.sh" ]]; then
    "${deploy_dir}/install-caddy-route.sh"
  fi
}

# pid 文件可能是重启前遗留的：机器重启后该 pid 常被系统启动期的其它进程复用，
# 此时 kill -0 会返回成功，导致把「没在运行」误判成「已在运行」而永远不再拉起。
# 必须核对 /proc/<pid>/cmdline 确实是我们的 supervise.sh。
supervisor_alive() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  local cmdline
  cmdline="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
  [[ "${cmdline}" == *"supervise.sh"* ]]
}

if [[ -r "${pid_file}" ]]; then
  running_pid="$(tr -d '[:space:]' < "${pid_file}")"
  if supervisor_alive "${running_pid}" && healthy; then
    install_route
    echo "audio supervisor is already running"
    exit 0
  fi
  # 守护进程还在但服务未就绪：先给它自我恢复的机会（supervise.sh 会重试子进程）
  if supervisor_alive "${running_pid}"; then
    for _ in {1..20}; do
      if healthy; then
        install_route
        echo "audio server recovered"
        exit 0
      fi
      sleep 0.5
    done
    echo "audio supervisor alive but service unhealthy; restarting" >&2
    kill "${running_pid}" 2>/dev/null || true
    sleep 1
  fi
  rm -f "${pid_file}"
fi

mkdir -p "${deploy_dir}/run" "${deploy_dir}/logs"
nohup "${deploy_dir}/supervise.sh" </dev/null >/dev/null 2>&1 &

for _ in {1..20}; do
  if healthy; then
    install_route
    echo "audio server started"
    exit 0
  fi
  sleep 0.25
done

echo "audio server did not become healthy" >&2
exit 1
