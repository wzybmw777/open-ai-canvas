#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "${ROOT_DIR}/.local"
exec 9>"${ROOT_DIR}/.local/qt-channel-sync.lock"
flock -n 9 || { printf 'QT channel sync is already running\n' >&2; exit 1; }
cd "$ROOT_DIR"
exec "${QT_SYNC_NODE_BIN:-node}" "${ROOT_DIR}/scripts/sync-qt-channel.mjs" "$@"
