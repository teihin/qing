#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON_BIN=""

for candidate in /opt/homebrew/bin/python3.13 /usr/local/bin/python3.13 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON_BIN=$candidate
    break
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "未找到 Python 3，无法管理美术版本。" >&2
  exit 1
fi

exec "$PYTHON_BIN" "$PROJECT_ROOT/tools/manage_skin_versions.py" "$@"
