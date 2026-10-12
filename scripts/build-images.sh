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
go_parallelism="${GO_BUILD_PARALLELISM:-2}"
build_scope="${1:-auto}"
case "$build_scope" in
    auto|all|web|backend) ;;
    *) printf '用法: bash scripts/build-images.sh [auto|all|web|backend]\n' >&2; exit 2 ;;
esac
if [[ ! "$go_parallelism" =~ ^[1-9][0-9]*$ ]]; then
    printf 'GO_BUILD_PARALLELISM 必须是正整数。\n' >&2
    exit 2
fi

# 标签记录真实构建输入，包括未提交修改和新增文件；不依赖提交号判断源码。
# Git 默认提交时间只作版本信息，文档提交不应使所有业务镜像重新构建。
input_fingerprint() {
    local scope="$1" file
    local -a paths
    case "$scope" in
        deps) paths=(backend/agent-runtime/pi/package.json backend/agent-runtime/pi/package-lock.json backend/agent-runtime/pi/Dockerfile.deps backend/agent-runtime/pi/.dockerignore) ;;
        backend) paths=(backend plugin-packages VERSION .dockerignore backend/Dockerfile.dockerignore scripts/build-images.sh) ;;
        web) paths=(web/src web/public web/package.json web/bun.lock web/index.html web/vite.config.ts web/tsconfig.json web/postcss.config.mjs VERSION CHANGELOG.md README.md assets Dockerfile Dockerfile.dockerignore .dockerignore nginx.conf docker/canvas-web-entrypoint.sh scripts/build-images.sh) ;;
    esac
    {
        printf 'canvas-build-inputs-v1\n%s\n' "$scope"
        if [[ "$scope" != deps ]]; then
            printf '%s\n' "$build_version" "${BUILD_COMMIT-}" "${BUILD_TIME-}"
        fi
        if [[ "$scope" == backend ]]; then
            printf '%s\n' "$goproxy" "$go_parallelism" "$deps_image"
            docker image inspect "$deps_image" --format '{{.Id}}' 2>/dev/null || printf 'missing-deps\n'
        fi
        git ls-tree -r HEAD -- "${paths[@]}"
        git diff --binary HEAD -- "${paths[@]}"
        while IFS= read -r -d '' file; do
            if [[ -f "$file" || -L "$file" ]]; then
                printf '%s\0' "$file"
                git hash-object -- "$file"
                if [[ -x "$file" ]]; then printf 'executable\n'; fi
            fi
        done < <(git ls-files --others --exclude-standard -z -- "${paths[@]}")
    } | sha256sum | cut -d ' ' -f 1
}

image_matches() {
    local actual
    actual="$(docker image inspect "$1" --format '{{ index .Config.Labels "org.yingce.build.inputs" }}' 2>/dev/null)" || return 1
    [[ "$actual" == "$2" ]]
}

ensure_builder() {
    if [[ "$builder_driver" != "docker" ]]; then
        printf '当前构建脚本使用 --load 加载独立依赖镜像，只支持 Docker 驱动；请使用 CANVAS_BUILDX_BUILDER=default。\n' >&2
        exit 1
    fi
    if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
        printf '未找到持久化 Builder %q；请先配置 Docker default Builder，不会自动创建临时 Builder。\n' "$builder" >&2
        exit 1
    fi
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
        --label "org.yingce.build.inputs=$deps_fingerprint" \
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
        --build-arg "GO_BUILD_PARALLELISM=$go_parallelism" \
        --build-arg "PI_RUNTIME_DEPS_IMAGE=$deps_image" \
        --build-arg "BUILD_VERSION=$build_version" \
        --build-arg "BUILD_COMMIT=$build_commit" \
        --build-arg "BUILD_TIME=$build_time" \
        --label "org.yingce.build.inputs=$backend_fingerprint" \
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
        --label "org.yingce.build.inputs=$web_fingerprint" \
        --tag "$web_image" \
        .
}

started=$SECONDS
builder_ready=false
for component in backend web; do
    if [[ "$build_scope" != auto && "$build_scope" != all && "$build_scope" != "$component" ]]; then
        continue
    fi
    fingerprint="$(input_fingerprint "$component")"
    if [[ "$component" == backend ]]; then image="$backend_image"; else image="$web_image"; fi
    if [[ "$build_scope" == auto ]] && image_matches "$image" "$fingerprint"; then
        printf '\n==> %s 输入未变，复用镜像: %s\n' "$component" "$image"
        continue
    fi
    if [[ "$builder_ready" == false ]]; then ensure_builder; builder_ready=true; fi
    component_started=$SECONDS
    if [[ "$component" == backend ]]; then
        deps_fingerprint="$(input_fingerprint deps)"
        if image_matches "$deps_image" "$deps_fingerprint"; then
            printf '\n==> Agent 依赖未变，复用镜像: %s\n' "$deps_image"
        else
            build_deps_image
            if [[ "$(input_fingerprint deps)" != "$deps_fingerprint" ]]; then
                printf '构建期间 Agent 依赖发生变化，请重新构建。\n' >&2; exit 1
            fi
        fi
        backend_fingerprint="$(input_fingerprint backend)"
        build_backend_image
        fingerprint="$backend_fingerprint"
    else
        web_fingerprint="$fingerprint"
        build_web_image
    fi
    if [[ "$(input_fingerprint "$component")" != "$fingerprint" ]]; then
        printf '构建期间 %s 输入发生变化，请重新构建。\n' "$component" >&2; exit 1
    fi
    printf '\n==> %s 完成，用时 %s 秒\n' "$component" "$((SECONDS - component_started))"
done
printf '\n构建完成，总用时 %s 秒；持久化 Builder: %s\n' "$((SECONDS - started))" "$builder"
