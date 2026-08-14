#!/usr/bin/env bash
set -euo pipefail

ROOT=/www/html
PUBLISH="$ROOT/up"
INCOMING="$ROOT/_incoming"
PROCESSED="$ROOT/_processed"
FAILED="$ROOT/_failed"
STAGING="$ROOT/.extracting"
LOG=/var/log/stonewar-update-unzip.log
LOCKDIR=/run/stonewar-update-unzip.lock

log() {
  printf '%s %s\n' "$(date '+%F %T%z')" "$*" >> "$LOG"
}

safe_name() {
  basename "$1" | sed 's/[^A-Za-z0-9._-]/_/g'
}

zip_age_seconds() {
  local file="$1"
  local now mtime
  now=$(date +%s)
  mtime=$(stat -c %Y "$file")
  echo $((now - mtime))
}

reject_entry() {
  local zip="$1"
  local entry="$2"
  local part

  if [[ "$entry" == /* || "$entry" == \\* || "$entry" == *\\* || "$entry" == *:* ]]; then
    log "reject unsafe zip path: zip=$zip entry=$entry"
    return 0
  fi

  IFS='/' read -r -a parts <<< "$entry"
  for part in "${parts[@]}"; do
    if [[ "$part" == ".." ]]; then
      log "reject parent traversal in zip: zip=$zip entry=$entry"
      return 0
    fi
  done

  case "$entry" in
    _incoming|_incoming/*|_processed|_processed/*|_failed|_failed/*|.extracting|.extracting/*|.git|.git/*|.env)
      log "reject control path in zip: zip=$zip entry=$entry"
      return 0
      ;;
  esac

  return 1
}

validate_zip_paths() {
  local zip="$1"
  local entry

  if ! unzip -tq "$zip" >/dev/null 2>&1; then
    return 2
  fi

  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    if reject_entry "$zip" "$entry"; then
      return 1
    fi
  done < <(unzip -Z -1 "$zip")

  return 0
}

select_publish_source() {
  local src="$1"
  local top_count top_name

  top_count=$(find "$src" -mindepth 1 -maxdepth 1 -printf '.' | wc -c)
  if [ "$top_count" -eq 1 ]; then
    top_name=$(find "$src" -mindepth 1 -maxdepth 1 -printf '%f\n' | head -n 1)
    if { [ "$top_name" = "up" ] || [ "$top_name" = "html" ]; } && [ -d "$src/$top_name" ]; then
      printf '%s\n' "$src/$top_name"
      return 0
    fi
  fi

  printf '%s\n' "$src"
}

prepare_new_publish_dir() {
  local src="$1"
  local new_dir="$2"
  local publish_src item

  publish_src=$(select_publish_source "$src")
  rm -rf "$new_dir"
  mkdir -p "$new_dir"

  shopt -s dotglob nullglob
  for item in "$publish_src"/*; do
    case "$(basename "$item")" in
      _incoming|_processed|_failed|.extracting)
        continue
        ;;
    esac
    cp -a "$item" "$new_dir/"
  done
  shopt -u dotglob nullglob
}

replace_publish_dir() {
  local new_dir="$1"
  local old_dir="$STAGING/up.old.$$.$(date +%Y%m%d%H%M%S)"

  mkdir -p "$ROOT"
  if [ -d "$PUBLISH" ]; then
    mv "$PUBLISH" "$old_dir"
  fi

  if mv "$new_dir" "$PUBLISH"; then
    rm -rf "$old_dir"
    return 0
  fi

  if [ -d "$old_dir" ] && [ ! -e "$PUBLISH" ]; then
    mv "$old_dir" "$PUBLISH"
  fi
  return 1
}

process_zip() {
  local zip="$1"
  local age base safe_base work new_publish dest rc

  [ -f "$zip" ] || return 0
  age=$(zip_age_seconds "$zip")

  set +e
  validate_zip_paths "$zip"
  rc=$?
  set -e

  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 2 ] && [ "$age" -lt 600 ]; then
      log "skip incomplete or still-uploading zip: $zip age=${age}s"
      return 0
    fi
    base=$(safe_name "$zip")
    dest="$FAILED/${base}.$(date +%Y%m%d%H%M%S).failed"
    mv -f "$zip" "$dest"
    chown root:updates "$dest"
    chmod 0664 "$dest"
    log "moved invalid zip to failed: $dest"
    return 0
  fi

  base=$(basename "$zip" .zip)
  safe_base=$(safe_name "$base")
  work="$STAGING/${safe_base}.$$.$(date +%Y%m%d%H%M%S)"
  new_publish="$STAGING/${safe_base}.newup.$$.$(date +%Y%m%d%H%M%S)"
  mkdir -p "$work"

  if unzip -q "$zip" -d "$work"; then
    if find "$work" -type l -print -quit | grep -q .; then
      dest="$FAILED/${safe_base}.$(date +%Y%m%d%H%M%S).failed"
      mv -f "$zip" "$dest"
      chown root:updates "$dest"
      chmod 0664 "$dest"
      log "reject symlink in zip content zip=$zip moved=$dest"
      rm -rf "$work" "$new_publish"
      return 0
    fi

    prepare_new_publish_dir "$work" "$new_publish"
    chown -R root:updates "$new_publish"
    find "$new_publish" -type d -exec chmod 2775 {} \;
    find "$new_publish" -type f -exec chmod 0664 {} \;

    replace_publish_dir "$new_publish"
    chown -R root:updates "$PUBLISH"
    find "$PUBLISH" -type d -exec chmod 2775 {} \;
    find "$PUBLISH" -type f -exec chmod 0664 {} \;

    dest="$PROCESSED/${safe_base}.$(date +%Y%m%d%H%M%S).zip"
    mv -f "$zip" "$dest"
    chown root:updates "$dest"
    chmod 0664 "$dest"
    log "replaced publish=$PUBLISH from zip=$zip archived=$dest"
  else
    dest="$FAILED/${safe_base}.$(date +%Y%m%d%H%M%S).failed"
    mv -f "$zip" "$dest"
    chown root:updates "$dest"
    chmod 0664 "$dest"
    log "unzip failed zip=$zip moved=$dest"
  fi

  rm -rf "$work" "$new_publish"
}

main() {
  umask 0002
  mkdir -p "$INCOMING" "$PROCESSED" "$FAILED" "$STAGING" "$PUBLISH"
  chown -R root:updates "$INCOMING" "$PROCESSED" "$FAILED" "$STAGING" "$PUBLISH"
  chmod 2775 "$INCOMING" "$PROCESSED" "$FAILED" "$STAGING" "$PUBLISH"
  touch "$LOG"
  chown root:root "$LOG"
  chmod 0644 "$LOG"

  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    exit 0
  fi
  trap 'rmdir "$LOCKDIR" 2>/dev/null || true' EXIT

  find "$INCOMING" -maxdepth 1 -type f -name '*.zip' -print0 | while IFS= read -r -d '' zip; do
    process_zip "$zip"
  done
}

main "$@"
