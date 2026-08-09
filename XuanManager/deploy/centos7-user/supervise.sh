#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="${deploy_dir}/run/supervisor.pid"
child_pid=""

cleanup() {
  if [[ -n "${child_pid}" ]] && kill -0 "${child_pid}" 2>/dev/null; then
    kill "${child_pid}" 2>/dev/null || true
    wait "${child_pid}" 2>/dev/null || true
  fi
  rm -f "${pid_file}"
}
stop_supervisor() {
  cleanup
  exit 0
}
trap cleanup EXIT
trap stop_supervisor INT TERM

mkdir -p "${deploy_dir}/run" "${deploy_dir}/logs"
printf '%s\n' "$$" > "${pid_file}"

while true; do
  "${deploy_dir}/run.sh" >>"${deploy_dir}/logs/xuanmanager.log" 2>&1 &
  child_pid="$!"
  if wait "${child_pid}"; then
    exit 0
  fi
  child_pid=""
  sleep 3
done
