# 构建 Vite 前端产物。
FROM --platform=$BUILDPLATFORM oven/bun:1.3.9 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,id=open-ai-canvas-bun,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY README.md /app/README.md
COPY assets /app/assets
COPY web/index.html web/vite.config.ts web/tsconfig.json web/postcss.config.mjs ./
COPY web/src ./src
ARG VITE_TLDRAW_LICENSE_KEY
ARG BUILD_VERSION
ARG BUILD_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV VITE_TLDRAW_LICENSE_KEY=${VITE_TLDRAW_LICENSE_KEY}
ENV CANVAS_BUILD_VERSION=${BUILD_VERSION}
ENV CANVAS_BUILD_COMMIT=${BUILD_COMMIT}
ENV CANVAS_BUILD_TIME=${BUILD_TIME}
ENV CANVAS_BUILD_COPY_PUBLIC=false
# 生产镜像只构建云端工作台前端；Agent Runtime 在后端 Worker 中运行。
RUN bun --bun ./node_modules/vite/bin/vite.js build

# 运行镜像：nginx 托管静态前端，并在 Compose 中把 /api 转发到后端服务。
FROM nginx:1.27-alpine AS web-runtime

COPY --chmod=755 docker/canvas-web-entrypoint.sh /usr/local/bin/canvas-web-entrypoint
COPY nginx.conf /etc/nginx/conf.d/default.conf

ENTRYPOINT ["/usr/local/bin/canvas-web-entrypoint"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

# 静态图片单独缓存，代码变更只替换生成的 JS/CSS，不重新复制图片和 Nginx 配置。
FROM web-runtime AS web-static
COPY web/public /opt/canvas-release

FROM web-static AS web-release
COPY --from=web-build /app/web/dist /opt/canvas-release
