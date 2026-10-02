#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
[[ "$EUID" -eq 0 ]] || { printf 'Please run as root\n' >&2; exit 1; }
[[ "$INSTALL_DIR" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { printf 'Unsupported install directory\n' >&2; exit 1; }
for command in node docker curl flock systemctl; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
NODE_BIN="$(command -v node)"
"$NODE_BIN" -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || {
  printf 'Node.js 20 or later is required\n' >&2; exit 1;
}
[[ -f "${INSTALL_DIR}/.env" && -f "${INSTALL_DIR}/docker-compose.deploy.yml" ]] || {
  printf 'Production Compose and .env are required\n' >&2; exit 1;
}
[[ -f "${INSTALL_DIR}/scripts/sync-qt-channel.mjs" ]] || exit 1
mkdir -p "${INSTALL_DIR}/.local"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
for unit in service timer; do
  sed -e "s|@INSTALL_DIR@|${INSTALL_DIR}|g" -e "s|@NODE_BIN@|${NODE_BIN}|g" \
    "${INSTALL_DIR}/scripts/systemd/open-ai-canvas-qt-sync.${unit}" \
    > "${temporary}/open-ai-canvas-qt-sync.${unit}"
done
systemd-analyze verify "${temporary}/open-ai-canvas-qt-sync.service" "${temporary}/open-ai-canvas-qt-sync.timer"
install -m 0644 "${temporary}/open-ai-canvas-qt-sync.service" /etc/systemd/system/
install -m 0644 "${temporary}/open-ai-canvas-qt-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now open-ai-canvas-qt-sync.timer
systemctl list-timers --no-pager open-ai-canvas-qt-sync.timer
