#!/usr/bin/env bash
set -u

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_dir="${deploy_dir}/run"
log_dir="${deploy_dir}/logs"
mkdir -p "${run_dir}" "${log_dir}"

exec 9>"${run_dir}/supervisor.lock"
if ! flock -n 9; then
  exit 0
fi

printf '%s\n' "$$" > "${run_dir}/supervisor.pid"
child_pid=""

stop_child() {
  if [[ -n "${child_pid}" ]] && kill -0 "${child_pid}" 2>/dev/null; then
    kill "${child_pid}" 2>/dev/null || true
    wait "${child_pid}" 2>/dev/null || true
  fi
}

cleanup() {
  stop_child
  rm -f "${run_dir}/supervisor.pid"
}

trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

while true; do
  "${deploy_dir}/run.sh" >> "${log_dir}/server.log" 2>&1 &
  child_pid=$!
  wait "${child_pid}"
  status=$?
  child_pid=""
  printf '%s service exited status=%s; restarting in 3 seconds\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${status}" \
    >> "${log_dir}/supervisor.log"
  sleep 3
done
