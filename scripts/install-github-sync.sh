#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GITHUB_SYNC_REMOTE="${GITHUB_SYNC_REMOTE:-user}"
GITHUB_SYNC_BRANCH="${GITHUB_SYNC_BRANCH:-main}"
[[ "$EUID" -eq 0 ]] || { printf 'Please run as root\n' >&2; exit 1; }
[[ "$INSTALL_DIR" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { printf 'Unsupported install directory\n' >&2; exit 1; }
[[ "$GITHUB_SYNC_REMOTE" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 1
[[ "$GITHUB_SYNC_BRANCH" =~ ^[a-zA-Z0-9_./-]+$ ]] || exit 1
for command in python3 git ssh systemctl systemd-analyze; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
PYTHON_BIN="$(command -v python3)"
GITHUB_SYNC_EXPECTED_URL="$(git -C "$INSTALL_DIR" remote get-url --push "$GITHUB_SYNC_REMOTE")"
[[ "$GITHUB_SYNC_EXPECTED_URL" =~ ^(git@github\.com:|https://github\.com/)[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || {
  printf 'An SSH or credential-free HTTPS GitHub repository URL is required\n' >&2; exit 1;
}
export GITHUB_SYNC_REMOTE GITHUB_SYNC_BRANCH GITHUB_SYNC_EXPECTED_URL
"$PYTHON_BIN" "$INSTALL_DIR/scripts/sync-github.py" --repo "$INSTALL_DIR" --dry-run

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
for unit in service timer; do
  sed -e "s|@INSTALL_DIR@|${INSTALL_DIR}|g" -e "s|@PYTHON_BIN@|${PYTHON_BIN}|g" \
    -e "s|@REMOTE@|${GITHUB_SYNC_REMOTE}|g" -e "s|@BRANCH@|${GITHUB_SYNC_BRANCH}|g" \
    -e "s|@EXPECTED_URL@|${GITHUB_SYNC_EXPECTED_URL}|g" \
    "$INSTALL_DIR/scripts/systemd/open-ai-canvas-github-sync.${unit}" \
    > "$temporary/open-ai-canvas-github-sync.${unit}"
done
systemd-analyze verify "$temporary/open-ai-canvas-github-sync.service" "$temporary/open-ai-canvas-github-sync.timer"
install -m 0644 "$temporary/open-ai-canvas-github-sync.service" /etc/systemd/system/
install -m 0644 "$temporary/open-ai-canvas-github-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now open-ai-canvas-github-sync.timer
systemctl list-timers --no-pager open-ai-canvas-github-sync.timer
