#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runtime_env="${deploy_dir}/runtime.env"

if [[ ! -x "${deploy_dir}/bin/xuanmanager" ]]; then
  echo "XuanManager binary is missing or not executable" >&2
  exit 1
fi
if [[ ! -r "${runtime_env}" ]]; then
  echo "XuanManager runtime.env is missing" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${runtime_env}"
set +a

exec "${deploy_dir}/bin/xuanmanager"
