#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="${deploy_dir}/run/supervisor.pid"

if [[ ! -r "${pid_file}" ]]; then
  echo "XuanManager is not running"
  exit 0
fi

running_pid="$(tr -d '[:space:]' < "${pid_file}")"
if [[ -n "${running_pid}" ]] && kill -0 "${running_pid}" 2>/dev/null; then
  kill "${running_pid}"
  for _ in {1..30}; do
    if ! kill -0 "${running_pid}" 2>/dev/null; then
      echo "XuanManager stopped"
      exit 0
    fi
    sleep 0.2
  done
fi

echo "XuanManager stop timed out" >&2
exit 1
