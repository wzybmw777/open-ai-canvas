package hostupdate

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (m *Manager) sourceRun(name string, args []string, stdout io.Writer) error {
	ctx, cancel := context.WithTimeout(context.Background(), m.config.StepTimeout)
	defer cancel()
	if stdout == nil {
		stdout = io.Discard
	}
	if err := m.runner.Run(ctx, name, args, nil, stdout, io.Discard); err != nil {
		return fmt.Errorf("%s 执行失败，请在服务器检查依赖和服务状态", filepath.Base(name))
	}
	return nil
}

func (m *Manager) sourceDependencies() error {
	return m.sourceRun(m.config.BunBinary, []string{"install", "--cwd", filepath.Join(m.config.InstallDir, "web"), "--frozen-lockfile"}, nil)
}

func (m *Manager) sourceStartServices() error {
	return m.compose(m.composePath(), "", m.config.StepTimeout, nil, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "600", "yingce-agent", "backend", "web")
}

func (m *Manager) sourceSaveEnvironment() (string, error) {
	path := filepath.Join(m.config.StateDir, "source-before-"+randomID()+".env")
	if err := replaceFile(m.envPath(), path, 0600); err != nil {
		return "", err
	}
	for _, pair := range [][2]string{{"backend", "CANVAS_SOURCE_BACKEND_IMAGE"}, {"yingce-agent", "CANVAS_SOURCE_AGENT_IMAGE"}} {
		var output bytes.Buffer
		if err := m.compose(m.composePath(), "", time.Minute, &output, "images", "-q", pair[0]); err != nil {
			_ = os.Remove(path)
			return "", err
		}
		image := strings.TrimSpace(output.String())
		digest := strings.TrimPrefix(image, "sha256:")
		_, digestErr := hex.DecodeString(digest)
		if len(digest) != 64 || digestErr != nil {
			_ = os.Remove(path)
			return "", errors.New("无法固定当前应用镜像，拒绝更新")
		}
		image = "sha256:" + digest
		if err := setEnvValue(path, pair[1], image); err != nil {
			_ = os.Remove(path)
			return "", err
		}
	}
	return path, nil
}

func (m *Manager) runSourceUpdate(from, target string) {
	merged, worktree, cleanup, err := m.prepareSourceMerge(from, target)
	if err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	defer cleanup()
	plan, err := m.sourceBuildPlan(from, merged)
	if err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	if err := m.sourceRun("docker", append(m.sourceComposeAt(worktree), "config", "--quiet"), nil); err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	// Seed the current lockfile's dependency cache so rollback can restore it.
	if err := m.sourceDependencies(); err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	previousEnv, err := m.sourceSaveEnvironment()
	if err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	keepEnv := false
	defer func() {
		if !keepEnv {
			_ = os.Remove(previousEnv)
		}
	}()
	// Give open pages at least one public status polling interval before stopping.
	m.mu.Lock()
	started := *m.state.Operation.StartedAt
	m.mu.Unlock()
	if remaining := time.Until(started.Add(12 * time.Second)); remaining > 0 {
		time.Sleep(remaining)
	}
	if err := m.sourceCleanAt(from); err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	// Pin only runtime image keys; preserve any other host configuration changes.
	saved, err := readEnvFile(previousEnv)
	if err != nil {
		m.failWithoutRollback(PhaseFailed, err)
		return
	}
	for _, key := range []string{"CANVAS_SOURCE_BACKEND_IMAGE", "CANVAS_SOURCE_AGENT_IMAGE"} {
		if err := setEnvValue(m.envPath(), key, saved[key]); err != nil {
			m.failWithoutRollback(PhaseFailed, err)
			return
		}
	}
	m.setPhase(PhaseDraining, "等待活动任务结束并停止 Backend 与独立 Agent，保留网站更新提示")
	if err := m.compose(m.composePath(), "", m.config.StepTimeout, nil, "stop", "backend", "yingce-agent"); err != nil {
		m.sourceRestartAfterAbort(err)
		return
	}
	m.setPhase(PhaseBackingUp, "应用停止写入后备份 PostgreSQL 与数据目录")
	backup, err := m.createBackup(from)
	if err == nil {
		err = m.sourceBackupEntry(backup, "database.dump", "exec", "-T", "postgres", "pg_restore", "--list")
	}
	if err != nil {
		m.sourceRestartAfterAbort(err)
		return
	}
	if err := m.sourceCleanAt(from); err != nil {
		m.sourceRestartAfterAbort(err)
		return
	}
	m.mu.Lock()
	m.state.LastBackup = &backup
	m.state.RollbackVersion = from
	m.state.SourceMergedCommit = merged
	m.state.SourcePreviousEnv = previousEnv
	err = m.saveStateLocked()
	m.mu.Unlock()
	if err != nil {
		m.sourceRestartAfterAbort(err)
		return
	}
	keepEnv = true
	m.setPhase(PhaseSwitching, "快进到已完成预合并的源码，保留本站定制提交")
	if _, err := m.sourceGit("-c", "core.hooksPath=/dev/null", "merge", "--ff-only", merged); err != nil {
		m.sourceRestartAfterAbort(err)
		return
	}
	fail := func(err error) { m.sourceRollbackAfterFailure(err, from, backup) }
	m.setPhase(PhasePulling, "按变更检查前端并构建必要镜像，复用未变更的依赖与镜像")
	if err := m.sourceBuild(plan); err != nil {
		fail(err)
		return
	}
	m.setPhase(PhaseMigrating, "编译后端并执行源码数据库迁移")
	if err := m.compose(m.composePath(), "", m.config.StepTimeout, nil, "run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", "backend", "-c", "go build -o /tmp/source-update-server ./cmd/server && go run ./cmd/migrate-schema up"); err != nil {
		fail(err)
		return
	}
	if err := m.sourceStartUpdatedServices(plan); err != nil {
		fail(err)
		return
	}
	m.setPhase(PhaseVerifying, "验证源码部署、数据库就绪及稳定窗口")
	if err := m.verifyHealthy(merged); err != nil {
		fail(err)
		return
	}
	m.sourceFinish(PhaseSucceeded, "已合并上游源码并保留本站定制", "")
}

func (m *Manager) sourceRestartAfterAbort(cause error) {
	err := m.sourceStartServices()
	if err != nil {
		m.sourceFinish(PhaseManualIntervention, "源码更新已中止，旧服务启动失败，需要人工处理", safeOperationError(errors.Join(cause, err)))
		return
	}
	m.sourceFinish(PhaseFailed, "源码更新已中止，已重新启动旧服务", safeOperationError(cause))
}

func (m *Manager) sourceRollbackAfterFailure(cause error, from string, backup Backup) {
	m.mu.Lock()
	m.state.Operation.Error = safeOperationError(cause)
	m.state.Operation.AutomaticRollback = true
	m.mu.Unlock()
	m.setPhase(PhaseRollingBack, "源码更新失败，恢复更新前的代码、数据库和素材")
	m.runSourceRollback(from, backup)
}

func (m *Manager) startSourceRollback(reason string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.TrimSpace(reason) == "" {
		return m.snapshotLocked(), errors.New("请填写回退原因")
	}
	if m.state.Operation.Phase.Active() || m.state.Operation.Phase == PhaseChecking {
		return m.snapshotLocked(), errors.New("已有更新操作正在进行")
	}
	if m.state.LastBackup == nil || m.state.RollbackVersion == "" || m.state.SourceMergedCommit == "" || m.state.SourcePreviousEnv == "" {
		return m.snapshotLocked(), errors.New("没有可用的源码回退记录")
	}
	if err := m.sourceCleanAt(m.state.SourceMergedCommit); err != nil {
		return m.snapshotLocked(), errors.New("更新后源码有新提交或未提交修改，请人工处理，不能覆盖本站改动")
	}
	now := time.Now().UTC()
	target := m.state.RollbackVersion
	backup := *m.state.LastBackup
	m.state.Operation = Operation{ID: randomID(), Phase: PhaseRollingBack, FromVersion: m.state.SourceMergedCommit, TargetVersion: target, StartedAt: &now, Logs: []LogEntry{{At: now, Phase: PhaseRollingBack, Message: "管理员请求回退源码部署"}}}
	if err := m.saveStateLocked(); err != nil {
		m.state.Operation.Phase = PhaseFailed
		return m.snapshotLocked(), err
	}
	go m.runSourceRollback(target, backup)
	return m.snapshotLocked(), nil
}

func (m *Manager) runSourceRollback(from string, backup Backup) {
	m.mu.Lock()
	disrupted := m.state.Operation.AutomaticRollback
	merged, previousEnv := m.state.SourceMergedCommit, m.state.SourcePreviousEnv
	m.mu.Unlock()
	fail := func(err error) {
		if !disrupted {
			m.sourceFinish(PhaseFailed, "回退检查失败，当前运行服务未变更", safeOperationError(err))
			return
		}
		stopErr := m.compose(m.composePath(), "", m.config.StepTimeout, nil, "stop", "backend", "yingce-agent")
		m.mu.Lock()
		m.state.Operation.RollbackError = safeOperationError(errors.Join(err, stopErr))
		m.mu.Unlock()
		message := "源码回退未完成，应用服务已停止，等待人工处理"
		if stopErr != nil {
			message = "源码回退未完成，无法确认服务已停止，请立即人工处理"
		}
		m.sourceFinish(PhaseManualIntervention, message, "")
	}
	if err := verifyZipBackup(backup.Path, backup.Checksum); err != nil {
		fail(err)
		return
	}
	if err := m.sourceCleanAt(merged); err != nil {
		fail(err)
		return
	}
	if _, err := os.Stat(previousEnv); err != nil {
		fail(err)
		return
	}
	disrupted = true
	if err := m.compose(m.composePath(), "", m.config.StepTimeout, nil, "stop", "backend", "yingce-agent"); err != nil {
		fail(err)
		return
	}
	if err := m.sourceCleanAt(merged); err != nil {
		fail(err)
		return
	}
	if _, err := os.Stat(previousEnv); err != nil {
		fail(err)
		return
	}
	// A new branch retains the failed merge and lets the same upstream be retried.
	if _, err := m.sourceGit("-c", "core.hooksPath=/dev/null", "switch", "-c", "codex/source-rollback-"+randomID(), from); err != nil {
		fail(err)
		return
	}
	if err := replaceFile(previousEnv, m.envPath(), 0600); err != nil {
		fail(err)
		return
	}
	if err := m.restoreDatabase(backup); err != nil {
		fail(err)
		return
	}
	if err := m.sourceBackupEntry(backup, "backend-data.tar", "run", "--rm", "--no-deps", "-T", "--user", "root", "--entrypoint", "tar", "backend", "-C", "/data", "-xf", "-"); err != nil {
		fail(err)
		return
	}
	if err := m.sourceDependencies(); err != nil {
		fail(err)
		return
	}
	if err := m.sourceStartServices(); err != nil {
		fail(err)
		return
	}
	if err := m.verifyHealthy(from); err != nil {
		fail(err)
		return
	}
	m.mu.Lock()
	m.state.RollbackVersion = ""
	m.state.SourceMergedCommit = ""
	m.mu.Unlock()
	m.sourceFinish(PhaseRolledBack, "已在回退分支恢复更新前代码、数据库和素材，失败提交仍保留", "")
}

func (m *Manager) sourceFinish(phase Phase, message, errorMessage string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.state.Operation.Phase = phase
	m.state.Operation.FinishedAt = &now
	if errorMessage != "" {
		m.state.Operation.Error = errorMessage
	}
	m.appendLogLocked(phase, message)
	_ = m.saveStateLocked()
}

func (m *Manager) sourceBackupEntry(backup Backup, entryName string, args ...string) error {
	if err := verifyZipBackup(backup.Path, backup.Checksum); err != nil {
		return err
	}
	archive, err := zip.OpenReader(backup.Path)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, entry := range archive.File {
		if entry.Name != entryName {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			return err
		}
		defer reader.Close()
		ctx, cancel := context.WithTimeout(context.Background(), m.config.StepTimeout)
		defer cancel()
		command := execCommandWithInput{runner: m.runner, input: reader}
		if err := command.Run(ctx, "docker", append(m.composeArgs(m.composePath(), m.envPath()), args...), nil, io.Discard, io.Discard); err != nil {
			return errors.New("读取或恢复备份内容失败，需要在服务器检查")
		}
		return nil
	}
	return errors.New("备份中缺少所需条目")
}
