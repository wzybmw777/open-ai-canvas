#!/usr/bin/env bash

set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/open-ai-canvas}"
REPOSITORY="${REPOSITORY:-ddcat-ai/open-ai-canvas}"
SOCKET_DIR="${CANVAS_UPDATER_SOCKET_DIR:-/run/open-ai-canvas-updater}"
UPDATER_BIN="/usr/local/bin/open-ai-canvas-host-updater"
UPDATER_ENV="/etc/open-ai-canvas-updater.env"
UPDATER_SERVICE="/etc/systemd/system/open-ai-canvas-updater.service"
UPDATER_MODE="${CANVAS_UPDATER_MODE:-release}"
SOURCE_REMOTE="${CANVAS_UPDATER_SOURCE_REMOTE:-origin}"
SOURCE_BRANCH="${CANVAS_UPDATER_SOURCE_BRANCH:-main}"
SOURCE_COMPOSE_FILES="${CANVAS_UPDATER_COMPOSE_FILES:-docker-compose.deploy.yml,docker-compose.hot.yml,docker-compose.source-update.yml}"

fail() {
    printf 'Host Updater 安装失败：%s\n' "$1" >&2
    exit 1
}

require_root() {
    [[ "${EUID}" -eq 0 ]] || fail "请使用 sudo 运行"
    [[ "$(uname -s)" == "Linux" ]] || fail "仅支持 Linux 服务器"
    command -v systemctl >/dev/null 2>&1 || fail "服务器必须使用 systemd"
    command -v curl >/dev/null 2>&1 || fail "缺少 curl"
    command -v sha256sum >/dev/null 2>&1 || fail "缺少 sha256sum"
    command -v openssl >/dev/null 2>&1 || fail "缺少 openssl"
    [[ -f "${INSTALL_DIR}/.env" ]] || fail "未找到 ${INSTALL_DIR}/.env"
    [[ -f "${INSTALL_DIR}/docker-compose.deploy.yml" ]] || fail "未找到部署 Compose"
    if [[ "$UPDATER_MODE" == "source" ]]; then
        command -v git >/dev/null 2>&1 || fail "缺少 Git"
        command -v go >/dev/null 2>&1 || fail "源码模式需要 Go 1.25 或更新版本"
        command -v bun >/dev/null 2>&1 || [[ -x /usr/local/bin/open-ai-canvas-bun ]] || fail "源码模式需要 Bun"
        git -C "$INSTALL_DIR" rev-parse --is-inside-work-tree >/dev/null || fail "源码模式需要 Git 工作区"
        [[ -f "${INSTALL_DIR}/docker-compose.source-update.yml" ]] || fail "缺少源码更新 Compose"
        return
    fi
    [[ "$UPDATER_MODE" == "release" ]] || fail "CANVAS_UPDATER_MODE 必须是 release 或 source"
    local backend_image web_image
    backend_image="$(sed -n 's/^CANVAS_BACKEND_IMAGE=//p' "${INSTALL_DIR}/.env" | tail -n 1)"
    web_image="$(sed -n 's/^CANVAS_WEB_IMAGE=//p' "${INSTALL_DIR}/.env" | tail -n 1)"
    [[ "$backend_image" =~ ^ghcr\.io/[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] || fail "CANVAS_BACKEND_IMAGE 必须固定为 GHCR digest"
    [[ "$web_image" =~ ^ghcr\.io/[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] || fail "CANVAS_WEB_IMAGE 必须固定为 GHCR digest"
}

read_image_tag() {
    local configured
    configured="$(sed -n 's/^CANVAS_IMAGE_TAG=//p' "${INSTALL_DIR}/.env" | tail -n 1)"
    [[ -n "$configured" && "$configured" != "latest" ]] || fail "请先把 CANVAS_IMAGE_TAG 固定为已发布版本"
    if [[ "$configured" == v* ]]; then
        RELEASE_TAG="$configured"
    else
        RELEASE_TAG="v${configured}"
    fi
}

install_binary() {
    local arch asset temporary checksum_file expected
    case "$(uname -m)" in
        x86_64|amd64) arch="amd64" ;;
        aarch64|arm64) arch="arm64" ;;
        *) fail "不支持的 CPU 架构：$(uname -m)" ;;
    esac
    asset="open-ai-canvas-host-updater-linux-${arch}"
    temporary="$(mktemp)"
    checksum_file="$(mktemp)"
    curl -fsSL "https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/${asset}" -o "$temporary"
    curl -fsSL "https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}/SHA256SUMS" -o "$checksum_file"
    expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$checksum_file")"
    [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "Release 校验清单缺少 ${asset}"
    printf '%s  %s\n' "$expected" "$temporary" | sha256sum -c - >/dev/null || fail "Host Updater SHA-256 校验失败"
    install -m 0755 "$temporary" "$UPDATER_BIN"
    rm -f "$temporary" "$checksum_file"
}

install_source_binary() {
    local temporary bun_source
    temporary="$(mktemp)"
    (cd "${INSTALL_DIR}/backend" && go build -o "$temporary" ./cmd/host-updater)
    install -m 0755 "$temporary" "$UPDATER_BIN"
    rm -f "$temporary"
    if command -v bun >/dev/null 2>&1; then
        bun_source="$(command -v bun)"
        if [[ "$bun_source" != /usr/local/bin/open-ai-canvas-bun ]]; then
            install -m 0755 "$bun_source" /usr/local/bin/open-ai-canvas-bun
        fi
    fi
}

ensure_token() {
    local token temporary
    token="$(sed -n 's/^CANVAS_UPDATER_TOKEN=//p' "${INSTALL_DIR}/.env" | tail -n 1)"
    if [[ -z "$token" ]]; then
        token="$(openssl rand -hex 32)"
        temporary="$(mktemp "${INSTALL_DIR}/.env.XXXXXX")"
        awk -v token="$token" '
            BEGIN { updated=0 }
            /^CANVAS_UPDATER_TOKEN=/ { print "CANVAS_UPDATER_TOKEN=" token; updated=1; next }
            { print }
            END { if (!updated) print "CANVAS_UPDATER_TOKEN=" token }
        ' "${INSTALL_DIR}/.env" > "$temporary"
        chmod --reference="${INSTALL_DIR}/.env" "$temporary"
        mv "$temporary" "${INSTALL_DIR}/.env"
    fi
    [[ ${#token} -ge 32 ]] || fail "CANVAS_UPDATER_TOKEN 长度不足"
    umask 077
    printf 'CANVAS_UPDATER_TOKEN=%s\nCANVAS_UPDATER_INSTALL_DIR=%s\nCANVAS_UPDATER_SOCKET=%s/updater.sock\n' "$token" "$INSTALL_DIR" "$SOCKET_DIR" > "$UPDATER_ENV"
    if [[ "$UPDATER_MODE" == "source" ]]; then
        printf 'CANVAS_UPDATER_MODE=source\nCANVAS_UPDATER_SELF_UPDATE=false\nCANVAS_UPDATER_SOURCE_REMOTE=%s\nCANVAS_UPDATER_SOURCE_BRANCH=%s\nCANVAS_UPDATER_COMPOSE_FILES=%s\n' "$SOURCE_REMOTE" "$SOURCE_BRANCH" "$SOURCE_COMPOSE_FILES" >> "$UPDATER_ENV"
    fi
}

install_service() {
    local temporary_service
    install -d -m 0755 "$SOCKET_DIR"
    install -d -m 0700 /var/lib/open-ai-canvas-updater "${INSTALL_DIR}/backups"
    temporary_service="$(mktemp)"
    printf '%s\n' \
        '[Unit]' \
        'Description=Open AI Canvas Host Updater' \
        'After=docker.service network-online.target' \
        'Requires=docker.service' \
        'Wants=network-online.target' \
        '' \
        '[Service]' \
        'Type=simple' \
        "EnvironmentFile=${UPDATER_ENV}" \
        "ExecStart=${UPDATER_BIN}" \
        'Restart=on-failure' \
        'RestartSec=5s' \
        'NoNewPrivileges=true' \
        'PrivateTmp=true' \
        'Environment=PATH=/usr/local/bin:/usr/bin:/bin' \
        'ProtectHome=true' \
        'ProtectSystem=full' \
        "ReadWritePaths=${INSTALL_DIR} /var/lib/open-ai-canvas-updater ${SOCKET_DIR} /usr/local/bin" \
        '' \
        '[Install]' \
        'WantedBy=multi-user.target' > "$temporary_service"
    install -m 0644 "$temporary_service" "$UPDATER_SERVICE"
    rm -f "$temporary_service"
    systemctl daemon-reload
    systemctl enable --now open-ai-canvas-updater.service
    systemctl restart open-ai-canvas-updater.service
}

main() {
    require_root
    if [[ "$UPDATER_MODE" == "source" ]]; then
        install_source_binary
    else
        read_image_tag
        install_binary
    fi
    ensure_token
    install_service
    printf 'Host Updater 已安装，Socket：%s/updater.sock\n' "$SOCKET_DIR"
    printf '请重建 backend 容器，使 Token 与 Socket 挂载生效。\n'
    if [[ "$UPDATER_MODE" == "source" ]]; then
        printf '源码模式：合并 %s/%s，未提交文件或合并冲突会阻止更新。\n' "$SOURCE_REMOTE" "$SOURCE_BRANCH"
        printf 'Compose 文件：%s\n' "$SOURCE_COMPOSE_FILES"
    fi
}

main "$@"
