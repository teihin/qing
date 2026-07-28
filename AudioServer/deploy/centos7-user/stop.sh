#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="${deploy_dir}/run/supervisor.pid"

if [[ ! -r "${pid_file}" ]]; then
  echo "audio supervisor is not running"
  exit 0
fi

running_pid="$(tr -d '[:space:]' < "${pid_file}")"
if [[ -z "${running_pid}" ]] || ! kill -0 "${running_pid}" 2>/dev/null; then
  rm -f "${pid_file}"
  echo "audio supervisor is not running"
  exit 0
fi

kill "${running_pid}"
for _ in {1..40}; do
  if ! kill -0 "${running_pid}" 2>/dev/null; then
    echo "audio server stopped"
    exit 0
  fi
  sleep 0.25
done

echo "audio supervisor did not stop in time" >&2
exit 1
