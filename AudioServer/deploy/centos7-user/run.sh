#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
secret_file="${deploy_dir}/token-secret"

if [[ ! -x "${deploy_dir}/bin/audioserver" ]]; then
  echo "audioserver binary is missing or not executable" >&2
  exit 1
fi
if [[ ! -x "${deploy_dir}/bin/ffmpeg" ]]; then
  echo "ffmpeg binary is missing or not executable" >&2
  exit 1
fi
if [[ ! -r "${secret_file}" ]]; then
  echo "token secret is missing" >&2
  exit 1
fi

token_secret="$(tr -d '\r\n' < "${secret_file}")"
if [[ ${#token_secret} -lt 32 ]]; then
  echo "token secret must contain at least 32 characters" >&2
  exit 1
fi

cd "${deploy_dir}"
ulimit -n 65536 2>/dev/null || true
exec env \
  AUDIO_SERVER_TOKEN_SECRET="${token_secret}" \
  AUDIO_SERVER_FFMPEG_PATH="${deploy_dir}/bin/ffmpeg" \
  "${deploy_dir}/bin/audioserver" \
  -config "${deploy_dir}/config.json"
