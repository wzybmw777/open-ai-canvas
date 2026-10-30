package hostupdate

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func validSourceCommit(value string) bool {
	if len(value) != 40 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func (m *Manager) sourceGit(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	return m.sourceGitContext(ctx, args...)
}

func (m *Manager) sourceGitContext(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = m.config.InstallDir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err != nil {
		// Git stderr may contain credential-bearing remote URLs.
		return "", fmt.Errorf("Git 操作失败（%s）：%w", args[0], err)
	}
	return strings.TrimSpace(string(output)), nil
}

func (m *Manager) sourceUpstream() (string, error) {
	if strings.HasPrefix(m.config.SourceRemote, "-") || strings.ContainsAny(m.config.SourceRemote, " /\\:\t\r\n") {
		return "", errors.New("源码更新远端名称无效")
	}
	if _, err := m.sourceGit("check-ref-format", "refs/heads/"+m.config.SourceBranch); err != nil {
		return "", errors.New("源码更新分支无效")
	}
	return "refs/remotes/" + m.config.SourceRemote + "/" + m.config.SourceBranch, nil
}

func (m *Manager) sourceCleanAt(expected string) error {
	head, err := m.currentVersion()
	if err != nil {
		return err
	}
	if head != expected {
		return errors.New("本地提交已改变，请重新检查更新")
	}
	status, err := m.sourceGit("status", "--porcelain=v1", "--untracked-files=normal")
	if err != nil {
		return err
	}
	if status != "" {
		return errors.New("存在未提交或未跟踪的文件，请先提交本站定制后再更新")
	}
	return nil
}

func (m *Manager) sourceNeedsUpdate(current, target string) (bool, error) {
	if !validSourceCommit(current) || !validSourceCommit(target) {
		return false, errors.New("源码提交标识无效")
	}
	_, err := m.sourceGit("merge-base", "--is-ancestor", target, current)
	if err == nil {
		return false, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return true, nil
	}
	return false, err
}

func (m *Manager) checkSource(ctx context.Context) (Status, error) {
	m.mu.Lock()
	if m.state.Operation.Phase.Active() || m.state.Operation.Phase == PhaseChecking {
		status := m.snapshotLocked()
		m.mu.Unlock()
		return status, errors.New("更新操作正在进行")
	}
	m.state.Operation.Phase = PhaseChecking
	m.state.Operation.Error = ""
	m.appendLogLocked(PhaseChecking, "正在检查上游源码分支")
	_ = m.saveStateLocked()
	m.mu.Unlock()
	failed := func(err error) (Status, error) {
		m.failWithoutRollback(PhaseFailed, err)
		return m.Snapshot(), err
	}
	ref, err := m.sourceUpstream()
	if err != nil {
		return failed(err)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if _, err := m.sourceGitContext(ctx, "fetch", "--no-tags", "--", m.config.SourceRemote, "+refs/heads/"+m.config.SourceBranch+":"+ref); err != nil {
		return failed(err)
	}
	target, err := m.sourceGit("rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return failed(err)
	}
	current, err := m.currentVersion()
	if err != nil {
		return failed(err)
	}
	available, err := m.sourceNeedsUpdate(current, target)
	if err != nil {
		return failed(err)
	}
	body, err := m.sourceGit("log", "--max-count=30", "--format=%h %s", current+".."+target)
	if err != nil {
		return failed(err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state.LatestRelease = &Release{Version: target, Name: "上游源码 " + target[:12], Body: body, URL: "https://github.com/" + m.config.Repository + "/commit/" + target, PublishedAt: time.Now().UTC()}
	m.state.SourceCheckedHead = current
	m.state.Operation.Phase = PhaseNoUpdate
	if available {
		m.state.Operation.Phase = PhaseReady
	}
	m.appendLogLocked(m.state.Operation.Phase, map[bool]string{true: "发现可合并的上游提交，本站定制将通过 Git 合并保留", false: "当前源码已包含上游最新提交"}[available])
	_ = m.saveStateLocked()
	return m.snapshotLocked(), nil
}

func (m *Manager) startSourceUpdate(target string) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.Operation.Phase.Active() || m.state.Operation.Phase == PhaseChecking {
		return m.snapshotLocked(), errors.New("已有更新操作正在进行")
	}
	if !validSourceCommit(target) || m.state.LatestRelease == nil || m.state.LatestRelease.Version != target {
		return m.snapshotLocked(), errors.New("目标提交与检查结果不一致，请重新检查")
	}
	ref, err := m.sourceUpstream()
	if err != nil {
		return m.snapshotLocked(), err
	}
	confirmed, err := m.sourceGit("rev-parse", "--verify", ref+"^{commit}")
	if err != nil || confirmed != target {
		return m.snapshotLocked(), errors.New("上游检查结果已改变，请重新检查")
	}
	current, err := m.currentVersion()
	if err == nil && current != m.state.SourceCheckedHead {
		err = errors.New("本地提交与检查时不同，请重新检查更新")
	}
	if err == nil {
		err = m.sourceCleanAt(current)
	}
	if err != nil {
		return m.snapshotLocked(), err
	}
	available, err := m.sourceNeedsUpdate(current, target)
	if err != nil || !available {
		return m.snapshotLocked(), errors.New("当前源码已包含目标提交")
	}
	now := time.Now().UTC()
	m.state.Operation = Operation{ID: randomID(), Phase: PhasePreflight, FromVersion: current, TargetVersion: target, StartedAt: &now, Logs: []LogEntry{}}
	m.appendLogLocked(PhasePreflight, "在隔离工作区检查源码合并，保留本站定制")
	if err := m.saveStateLocked(); err != nil {
		m.state.Operation.Phase = PhaseFailed
		return m.snapshotLocked(), err
	}
	go m.runSourceUpdate(current, target)
	return m.snapshotLocked(), nil
}

func (m *Manager) prepareSourceMerge(from, target string) (string, string, func(), error) {
	if !validSourceCommit(from) || !validSourceCommit(target) {
		return "", "", nil, errors.New("源码提交标识无效")
	}
	if err := m.sourceCleanAt(from); err != nil {
		return "", "", nil, err
	}
	dir, err := os.MkdirTemp(m.config.StateDir, "source-merge-*")
	if err != nil {
		return "", "", nil, err
	}
	_ = os.Remove(dir)
	cleanup := func() { _, _ = m.sourceGit("worktree", "remove", "--force", dir) }
	if _, err := m.sourceGit("worktree", "add", "--detach", dir, from); err != nil {
		_ = os.RemoveAll(dir)
		return "", "", nil, err
	}
	if _, err := m.sourceGit("-C", dir, "-c", "user.name=Site Source Updater", "-c", "user.email=source-updater@localhost", "-c", "core.hooksPath=/dev/null", "merge", "--no-ff", "--no-edit", "--no-gpg-sign", target); err != nil {
		cleanup()
		return "", "", nil, errors.New("源码合并失败或存在冲突，运行目录未修改，请人工合并后重试")
	}
	merged, err := m.sourceGit("-C", dir, "rev-parse", "HEAD")
	if err != nil {
		cleanup()
		return "", "", nil, err
	}
	return merged, dir, cleanup, nil
}

func (m *Manager) sourceSnapshotLocked() Status {
	current, err := m.currentVersion()
	checks := []Check{{Key: "updater", Label: "宿主机源码更新器", Status: "passed", Detail: m.config.SourceRemote + "/" + m.config.SourceBranch, Blocking: true}, {Key: "worktree", Label: "本站定制已提交", Status: "passed", Detail: "通过 Git 合并保留本地提交", Blocking: true}}
	if err == nil {
		err = m.sourceCleanAt(current)
	}
	if err != nil {
		checks[1].Status = "failed"
		checks[1].Detail = safeOperationError(err)
	}
	checks = append(checks, Check{Key: "backup", Label: "数据库及素材备份", Status: "pending", Detail: "停止应用写入后创建并校验", Blocking: true}, Check{Key: "merge", Label: "源码合并与构建", Status: "pending", Detail: "隔离合并，冲突时不修改运行目录", Blocking: true})
	status := Status{Supported: true, Connected: true, Repository: m.config.Repository, Deployment: "docker-compose-source-updater", CurrentVersion: current, LatestRelease: cloneRelease(m.state.LatestRelease), Checks: checks, LastBackup: cloneBackup(m.state.LastBackup), RollbackVersion: m.state.RollbackVersion, Operation: cloneOperation(m.state.Operation)}
	if status.LatestRelease != nil {
		status.UpdateAvailable, _ = m.sourceNeedsUpdate(current, status.LatestRelease.Version)
	}
	return status
}

func (m *Manager) sourceComposeAt(worktree string) []string {
	args := []string{"compose", "--project-name", composeProjectName(m.config.InstallDir), "--env-file", m.envPath(), "--project-directory", m.config.InstallDir}
	for _, file := range m.config.ComposeFiles {
		if filepath.IsAbs(file) {
			args = append(args, "-f", file)
		} else {
			args = append(args, "-f", filepath.Join(worktree, file))
		}
	}
	return args
}
