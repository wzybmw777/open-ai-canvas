#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Keep one named BuildKit builder across releases. Its cache
# contains the Go build/module caches and the npm cache declared in the
# Dockerfiles, so a later build only recompiles changed inputs.
builder="${CANVAS_BUILDX_BUILDER:-default}"
builder_driver="${CANVAS_BUILDX_DRIVER:-docker}"
goproxy="${GOPROXY:-https://goproxy.cn|https://proxy.golang.org|direct}"
backend_image="${CANVAS_BUILD_BACKEND_IMAGE:-open-ai-canvas-backend:server}"
web_image="${CANVAS_BUILD_WEB_IMAGE:-open-ai-canvas-web:server}"
deps_image="${CANVAS_BUILD_PI_RUNTIME_DEPS_IMAGE:-open-ai-canvas-pi-runtime-deps:local}"
build_version="${BUILD_VERSION:-$(tr -d '\r\n' < VERSION)}"
build_commit="${BUILD_COMMIT:-$(git rev-parse HEAD)}"
build_time="${BUILD_TIME:-$(git show -s --format=%cI HEAD)}"
progress="${BUILDKIT_PROGRESS:-plain}"
build_scope="${1:-all}"
case "$build_scope" in
    all|web|backend) ;;
    *) printf '用法: bash scripts/build-images.sh [all|web|backend]\n' >&2; exit 2 ;;
esac

ensure_builder() {
    if [[ "$builder_driver" != "docker" ]]; then
        printf '当前构建脚本使用 --load 加载独立依赖镜像，只支持 Docker 驱动；请使用 CANVAS_BUILDX_BUILDER=default。\n' >&2
        exit 1
    fi
    if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
        printf '未找到持久化 Builder %q；请先配置 Docker default Builder，不会自动创建临时 Builder。\n' "$builder" >&2
        exit 1
    fi
    docker buildx use "$builder"
    docker buildx inspect --bootstrap "$builder" >/dev/null
}

build_deps_image() {
    printf '\n==> 构建独立 Agent 运行时依赖镜像: %s\n' "$deps_image"
    docker buildx build \
        --builder "$builder" \
        --pull=false \
        --progress "$progress" \
        --load \
        --file backend/agent-runtime/pi/Dockerfile.deps \
        --tag "$deps_image" \
        backend/agent-runtime/pi
}

build_backend_image() {
    printf '\n==> 构建后端镜像: %s\n' "$backend_image"
    docker buildx build \
        --builder "$builder" \
        --pull=false \
        --progress "$progress" \
        --load \
        --file backend/Dockerfile \
        --build-arg "GOPROXY=$goproxy" \
        --build-arg "PI_RUNTIME_DEPS_IMAGE=$deps_image" \
        --build-arg "BUILD_VERSION=$build_version" \
        --build-arg "BUILD_COMMIT=$build_commit" \
        --build-arg "BUILD_TIME=$build_time" \
        --tag "$backend_image" \
        .
}

build_web_image() {
    printf '\n==> 构建网页镜像: %s\n' "$web_image"
    docker buildx build \
        --builder "$builder" \
        --pull=false \
        --progress "$progress" \
        --load \
        --file Dockerfile \
        --build-arg "BUILD_VERSION=$build_version" \
        --build-arg "BUILD_COMMIT=$build_commit" \
        --build-arg "BUILD_TIME=$build_time" \
        --tag "$web_image" \
        .
}

ensure_builder
if [[ "$build_scope" != "web" ]]; then
    build_deps_image
    build_backend_image
fi
if [[ "$build_scope" != "backend" ]]; then
    build_web_image
fi

printf '\n构建完成，持久化 Builder: %s\n' "$builder"
docker buildx inspect "$builder" | sed -n '1,12p'
case "$build_scope" in
    web) images=("$web_image") ;;
    backend) images=("$backend_image") ;;
    all) images=("$backend_image" "$web_image") ;;
esac
docker image inspect "${images[@]}" --format '{{index .RepoTags 0}} {{.Id}}'
