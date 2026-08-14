#!/usr/bin/env bash
set -euo pipefail

INCOMING=/www/html/_incoming
UNZIP_SCRIPT=/usr/local/sbin/stonewar-auto-unzip-updates.sh
LOG=/var/log/stonewar-update-unzip.log
SLEEP_SECONDS=3
MAX_SECONDS=1800
EMPTY_ROUNDS_TO_EXIT=2

log() {
  printf '%s %s\n' "$(date '+%F %T%z')" "$*" >> "$LOG"
}

pending_count() {
  find "$INCOMING" -maxdepth 1 -type f \( \
    -name '*.zip' -o \
    -name '*.uploading' -o \
    -name '.*.uploading' -o \
    -name '*.zip.uploading' -o \
    -name '.*.zip.uploading' \
  \) -print | wc -l
}

main() {
  local start now elapsed pending empty_rounds

  mkdir -p "$INCOMING"
  touch "$LOG"
  chmod 0644 "$LOG"

  start=$(date +%s)
  empty_rounds=0
  log "burst watcher started: incoming=$INCOMING interval=${SLEEP_SECONDS}s max=${MAX_SECONDS}s"

  while true; do
    "$UNZIP_SCRIPT"

    pending=$(pending_count)
    if [ "$pending" -eq 0 ]; then
      empty_rounds=$((empty_rounds + 1))
    else
      empty_rounds=0
    fi

    if [ "$empty_rounds" -ge "$EMPTY_ROUNDS_TO_EXIT" ]; then
      log "burst watcher finished: incoming stable and no pending files"
      exit 0
    fi

    now=$(date +%s)
    elapsed=$((now - start))
    if [ "$elapsed" -ge "$MAX_SECONDS" ]; then
      log "burst watcher reached max duration: pending=$pending elapsed=${elapsed}s"
      exit 0
    fi

    sleep "$SLEEP_SECONDS"
  done
}

main "$@"
