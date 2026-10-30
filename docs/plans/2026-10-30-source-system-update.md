# 源码系统更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当前源码热更新部署可在管理后台合并 origin/main，保留本站已提交的定制。

**Architecture:** 扩展现有宿主机 Host Updater 的 source 模式，沿用认证、状态持久化和备份格式；通过隔离 Git worktree 预合并后快进运行目录，不使用强制覆盖。原镜像更新路径保持独立。

**Tech Stack:** Go、Git、Docker Compose、Bun、systemd、React。

**Spec:** 用户选择“合并上游源码，保留本站定制”；更新、断线和恢复沿用全站提示。

## Global Constraints

- 更新远端和分支由宿主机配置，网页只提交检查结果中的完整 commit SHA。
- 未提交文件、合并冲突、目标改变或本地 HEAD 改变时停止；不 stash、不强制 reset、不自动解决冲突。
- 保留 PostgreSQL、Redis、独立 yingce-agent、现有环境和数据挂载，不转换为官方镜像部署。
- 停止应用写入后新建数据库及数据目录备份，校验归档和 PostgreSQL 目录；迁移或健康验证失败时恢复旧代码、数据库和数据文件。
- 回退创建 codex/source-rollback-* 分支保存旧代码，保留失败提交供追溯；有后续本地修改时拒绝自动覆盖。
- 更新器不挂载 Docker Socket 到网站后端，后端仅连接带随机凭据的宿主机 Unix Socket。

## Review Focus

- Git 冲突、脏工作区和未跟踪文件不能改变运行代码或停止服务。
- 检查后上游或本地提交改变，不能更新到未确认目标。
- 多份 Compose 及项目名必须在备份、迁移、启动和恢复时完全一致。
- 失败恢复必须保留本站定制，不能恢复数据库后继续运行新代码。
- Token、环境文件、备份正文和上游敏感输出不能进入浏览器日志。

### Task 1: 源码更新控制与 Git 合并

**Files:** `backend/internal/hostupdate/source.go`、`source_test.go`、`manager.go`、`manager_ops.go`。

**Interfaces:** `Config.Mode/SourceRemote/SourceBranch/ComposeFiles/BunBinary`；复用 `Check/StartUpdate/StartRollback/Snapshot` HTTP 合同。

- [x] 写真实临时 Git 仓库测试：已合并不重复提示、保留本地提交、冲突不影响运行目录、脏工作区阻断、目标校验。
- [x] 观察失败后实现 source 模式、原子任务占用和持久化状态。
- [x] 为组合 Compose 参数、离线备份、迁移和安全回退补专项测试，并验证既有镜像更新测试。

### Task 2: 安装和管理页面

**Files:** `scripts/install-host-updater.sh`、`docker-compose.source-update.yml`、`backend/cmd/host-updater/main.go`、`.env.example`、`web/src/pages/admin/settings/system-update-page.tsx`。

- [x] 安装器 source 模式从本机源码编译，接入 Bun 和多份 Compose；原 release 模式保持镜像及校验清单要求。
- [x] 页面按部署模式展示提交、源码合并和回退说明，不把 SHA 当作镜像版本。
- [x] 运行后端专项测试、前端类型检查、Shell 语法和 Compose 配置验证。

### Task 3: 当前部署接入与交付

**Files:** 后端 HTTP 合同、代码地图、待测试文档。

- [x] 安装并启动 source 更新器，复用既有凭据，重建 backend 连接 Unix Socket。
- [x] 验证认证、公开状态、后台源码检查和服务健康，不自动执行上游更新。
- [x] 本次提交保存本站定制与功能，排除真实密钥、数据及构建产物。
- [x] 独立代码审查并修复重要问题，记录未完成的真实更新/回退浏览器验收。

## 验证记录

- `go test ./internal/hostupdate ./cmd/host-updater -count=1` 和公开状态 handler 专项通过。
- 前端更新状态、真实 React 提示、请求语义和受管 Vite 配置共 15 项测试通过，`bun run typecheck` 通过。
- Shell 语法、Compose 配置与空白检查通过。
- 更新器 source 检查、认证拒绝、网站公开桥接及就绪、运行中 Vite HMR 关闭已实测；未执行真实上游更新/回退或浏览器验收。
