# syntax=docker/dockerfile:1.7

ARG PI_RUNTIME_DEPS_IMAGE=pi-runtime-deps-build

FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS payment-package-build

ARG GOPROXY=https://goproxy.cn|https://proxy.golang.org|direct
ENV GOPROXY=$GOPROXY

RUN apk add --no-cache nodejs unzip zip

WORKDIR /src
# 支付包只依赖 SDK、支付实现与五个入口，业务代码变更不失效此层。
COPY plugin-packages ./plugin-packages
ARG TARGETOS
ARG TARGETARCH
ARG GO_BUILD_PARALLELISM=2
ENV GOFLAGS="-mod=readonly -p=${GO_BUILD_PARALLELISM}"
RUN --mount=type=bind,source=backend/go.mod,target=/src/backend/go.mod \
    --mount=type=bind,source=backend/go.sum,target=/src/backend/go.sum \
    --mount=type=bind,source=backend/third_party/go-sms-sender/go.mod,target=/src/backend/third_party/go-sms-sender/go.mod \
    --mount=type=bind,source=backend/payment-sdk,target=/src/backend/payment-sdk \
    --mount=type=bind,source=backend/payment-plugins,target=/src/backend/payment-plugins \
    --mount=type=bind,source=backend/cmd/payment-wechat,target=/src/backend/cmd/payment-wechat \
    --mount=type=bind,source=backend/cmd/payment-alipay,target=/src/backend/cmd/payment-alipay \
    --mount=type=bind,source=backend/cmd/payment-xunhupay,target=/src/backend/cmd/payment-xunhupay \
    --mount=type=bind,source=backend/cmd/payment-zhifufm,target=/src/backend/cmd/payment-zhifufm \
    --mount=type=bind,source=backend/cmd/payment-epay,target=/src/backend/cmd/payment-epay \
    --mount=type=cache,id=open-ai-canvas-go-build,target=/root/.cache/go-build,sharing=shared \
    --mount=type=cache,id=open-ai-canvas-go-mod,target=/go/pkg/mod,sharing=shared \
    --mount=type=tmpfs,target=/tmp,size=2147483648 set -eu; \
    test -n "$TARGETOS"; \
    test -n "$TARGETARCH"; \
    PAYMENT_PLUGIN_GOOS="$TARGETOS" \
    PAYMENT_PLUGIN_GOARCH="$TARGETARCH" \
    PAYMENT_PLUGIN_CGO_ENABLED=0 \
      ./plugin-packages/build-packages.sh --payments-only; \
    sh ./plugin-packages/verify-payment-packages.sh "$TARGETOS" "$TARGETARCH"

FROM alpine:3.22 AS payment-package-smoke

ARG TARGETOS
ARG TARGETARCH
RUN apk add --no-cache unzip
RUN --mount=type=bind,from=payment-package-build,source=/src/plugin-packages,target=/app/plugin-packages \
    --mount=type=tmpfs,target=/tmp PAYMENT_PLUGIN_SMOKE_TEST=1 \
    sh /app/plugin-packages/verify-payment-packages.sh "$TARGETOS" "$TARGETARCH" \
    && touch /payment-smoke-verified

FROM golang:1.25-alpine AS backend-build

ARG GOPROXY=https://goproxy.cn|https://proxy.golang.org|direct
ENV GOPROXY=$GOPROXY

RUN apk add --no-cache build-base

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
# go.mod 含本地 replace（github.com/casdoor/go-sms-sender => ./third_party/go-sms-sender）。
# go mod download 解析依赖时就需要读到该目录的 go.mod，而这行执行时完整源码尚未复制，
# 缺了它会报 "reading third_party/go-sms-sender/go.mod: no such file or directory"。
# 编译时会只读挂载完整源码，这里只为让依赖解析通过。
COPY backend/third_party ./third_party
# 模块通过持久化 cache mount 复用，避免把下载结果固化进业务源码层。
RUN --mount=type=cache,id=open-ai-canvas-go-mod,target=/go/pkg/mod,sharing=shared \
    go mod download
COPY VERSION /src/VERSION
ARG BUILD_VERSION
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG GO_BUILD_PARALLELISM=2
# 源码只在编译期间挂载，缓存层只保存产物，临时对象写入内存。
RUN --mount=type=bind,source=backend,target=/src/backend \
    --mount=type=cache,id=open-ai-canvas-go-build,target=/root/.cache/go-build,sharing=shared \
    --mount=type=cache,id=open-ai-canvas-go-mod,target=/go/pkg/mod,sharing=shared \
    --mount=type=tmpfs,target=/tmp,size=2147483648 set -eu; \
    version="${BUILD_VERSION:-$(tr -d '\r\n' </src/VERSION)}"; \
    ldflags="-s -w -X yingce/backend/internal/buildinfo.Version=${version} -X yingce/backend/internal/buildinfo.Commit=${BUILD_COMMIT} -X yingce/backend/internal/buildinfo.BuildTime=${BUILD_TIME}"; \
    export CGO_ENABLED=1 GOOS=linux; \
    mkdir -p /out; \
    go build -mod=readonly -p "$GO_BUILD_PARALLELISM" -trimpath -ldflags="$ldflags" -o /out/ \
      ./cmd/server ./cmd/migrate-schema ./cmd/migrate-sqlite-postgres; \
    mv /out/server /out/yingce-backend

FROM node:22.19-alpine AS pi-runtime-deps-build

WORKDIR /app/backend/agent-runtime/pi
COPY backend/agent-runtime/pi/package.json backend/agent-runtime/pi/package-lock.json ./
RUN --mount=type=cache,id=open-ai-canvas-pi-npm,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts

# Local source builds use the in-file stage. The persistent build script can
# point this stage at a separately built dependency image so application code
# changes do not rebuild the dependency layer.
FROM ${PI_RUNTIME_DEPS_IMAGE} AS pi-runtime-deps

# Inherit the selected dependency image so node_modules remains an independent
# reusable layer instead of being copied into every backend image build.
FROM pi-runtime-deps

RUN apk add --no-cache ca-certificates tzdata wget ffmpeg \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app
ENV GIN_MODE=release
ENV CANVAS_BACKEND_ADDR=:8080
ENV CANVAS_BACKEND_DATA_DIR=/data

RUN mkdir -p /data && chown -R app:app /data
COPY backend/agent-runtime/pi/package.json backend/agent-runtime/pi/package-lock.json /app/backend/agent-runtime/pi/
COPY backend/agent-runtime/pi/agent-runtime.mjs /app/backend/agent-runtime/pi/agent-runtime.mjs
COPY --from=payment-package-build /src/plugin-packages /app/plugin-packages
# 保留运行冒烟阶段为最终镜像依赖，避免 BuildKit 跳过验证。
COPY --from=payment-package-smoke /payment-smoke-verified /tmp/payment-smoke-verified
# 变化最频繁的业务二进制放最后，避免重新复制插件与 Agent 文件。
COPY --from=backend-build /out/ /usr/local/bin/

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health/ready >/dev/null || exit 1
CMD ["yingce-backend"]
