#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RUNTIME_ENV="$BASE_DIR/deploy/centos7-user/runtime.env"

if [[ ! -f "$RUNTIME_ENV" ]]; then
  echo "缺少运行配置：$RUNTIME_ENV" >&2
  exit 1
fi

set -a
source "$RUNTIME_ENV"
set +a

exec "$BASE_DIR/bin/chattool"
