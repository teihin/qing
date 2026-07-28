#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="${deploy_dir}/run/supervisor.pid"

if [[ -r "${pid_file}" ]]; then
  running_pid="$(tr -d '[:space:]' < "${pid_file}")"
  if [[ -n "${running_pid}" ]] && kill -0 "${running_pid}" 2>/dev/null; then
    if [[ -x "${deploy_dir}/install-caddy-route.sh" ]]; then
      "${deploy_dir}/install-caddy-route.sh"
    fi
    echo "audio supervisor is already running"
    exit 0
  fi
fi

mkdir -p "${deploy_dir}/run" "${deploy_dir}/logs"
nohup "${deploy_dir}/supervise.sh" </dev/null >/dev/null 2>&1 &

for _ in {1..20}; do
  if curl --fail --silent --max-time 1 \
    "http://127.0.0.1:18080/healthz" >/dev/null; then
    if [[ -x "${deploy_dir}/install-caddy-route.sh" ]]; then
      "${deploy_dir}/install-caddy-route.sh"
    fi
    echo "audio server started"
    exit 0
  fi
  sleep 0.25
done

echo "audio server did not become healthy" >&2
exit 1
