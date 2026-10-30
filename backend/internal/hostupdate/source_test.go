package hostupdate

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func sourceGitFixture(t *testing.T) (string, string) {
	t.Helper()
	remote := filepath.Join(t.TempDir(), "upstream")
	local := filepath.Join(t.TempDir(), "site")
	if err := os.MkdirAll(remote, 0700); err != nil {
		t.Fatal(err)
	}
	gitFixture(t, remote, "init", "-b", "main")
	gitFixture(t, remote, "config", "user.email", "test@example.invalid")
	gitFixture(t, remote, "config", "user.name", "Fixture")
	writeSourceFixture(t, remote, "brand.txt", "default\n")
	gitFixture(t, remote, "add", ".")
	gitFixture(t, remote, "commit", "-m", "initial")
	gitFixture(t, "", "clone", remote, local)
	gitFixture(t, local, "config", "user.email", "test@example.invalid")
	gitFixture(t, local, "config", "user.name", "Fixture")
	return local, remote
}

func gitFixture(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func writeSourceFixture(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func sourceManagerFixture(t *testing.T, local string) *Manager {
	t.Helper()
	m, err := NewManager(Config{Mode: "source", InstallDir: local, StateDir: t.TempDir(), BackupDir: t.TempDir(), SourceRemote: "origin", SourceBranch: "main"})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSourceUpdatePreservesCustomCommitsAndDoesNotRepeatMergedUpdates(t *testing.T) {
	local, remote := sourceGitFixture(t)
	writeSourceFixture(t, local, "brand.txt", "卓越AI剪辑\n")
	gitFixture(t, local, "commit", "-am", "site branding")
	writeSourceFixture(t, remote, "feature.txt", "new upstream feature\n")
	gitFixture(t, remote, "add", ".")
	gitFixture(t, remote, "commit", "-m", "upstream feature")
	m := sourceManagerFixture(t, local)
	status, err := m.Check(context.Background())
	if err != nil || !status.UpdateAvailable || status.Deployment != "docker-compose-source-updater" {
		t.Fatalf("check: %+v %v", status, err)
	}
	before := gitFixture(t, local, "rev-parse", "HEAD")
	merged, _, cleanup, err := m.prepareSourceMerge(before, status.LatestRelease.Version)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if got := gitFixture(t, local, "rev-parse", "HEAD"); got != before {
		t.Fatal("preflight changed live HEAD")
	}
	gitFixture(t, local, "merge", "--ff-only", merged)
	brand, _ := os.ReadFile(filepath.Join(local, "brand.txt"))
	if string(brand) != "卓越AI剪辑\n" {
		t.Fatalf("lost branding: %s", brand)
	}
	if _, err := os.Stat(filepath.Join(local, "feature.txt")); err != nil {
		t.Fatal(err)
	}
	status, err = m.Check(context.Background())
	if err != nil || status.UpdateAvailable {
		t.Fatalf("merged upstream offered again: %+v %v", status, err)
	}
}

func TestSourceMergeConflictNeverChangesLiveCheckout(t *testing.T) {
	local, remote := sourceGitFixture(t)
	writeSourceFixture(t, local, "brand.txt", "site customization\n")
	gitFixture(t, local, "commit", "-am", "custom")
	writeSourceFixture(t, remote, "brand.txt", "conflicting upstream change\n")
	gitFixture(t, remote, "commit", "-am", "conflict")
	m := sourceManagerFixture(t, local)
	status, err := m.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	before := gitFixture(t, local, "rev-parse", "HEAD")
	_, _, cleanup, err := m.prepareSourceMerge(before, status.LatestRelease.Version)
	if cleanup != nil {
		defer cleanup()
	}
	if err == nil {
		t.Fatal("conflicting update accepted")
	}
	if got := gitFixture(t, local, "rev-parse", "HEAD"); got != before {
		t.Fatal("conflict changed live HEAD")
	}
	if got := gitFixture(t, local, "status", "--porcelain"); got != "" {
		t.Fatalf("conflict leaked into live checkout: %s", got)
	}
}

func TestSourcePreflightRejectsUncommittedAndUntrackedFiles(t *testing.T) {
	for _, name := range []string{"brand.txt", "new-custom-file.txt"} {
		t.Run(name, func(t *testing.T) {
			local, _ := sourceGitFixture(t)
			m := sourceManagerFixture(t, local)
			before := gitFixture(t, local, "rev-parse", "HEAD")
			writeSourceFixture(t, local, name, "unsaved customization\n")
			if err := m.sourceCleanAt(before); err == nil {
				t.Fatal("uncommitted changes accepted")
			}
			body, _ := os.ReadFile(filepath.Join(local, name))
			if string(body) != "unsaved customization\n" {
				t.Fatal("customization was modified")
			}
		})
	}
}

func TestSourcePreflightRejectsChangedHeadAndUnconfirmedTarget(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	before := gitFixture(t, local, "rev-parse", "HEAD")
	gitFixture(t, local, "commit", "--allow-empty", "-m", "concurrent local commit")
	if err := m.sourceCleanAt(before); err == nil {
		t.Fatal("changed HEAD accepted")
	}
	if _, err := m.StartUpdate("--upload-pack=bad"); err == nil {
		t.Fatal("unconfirmed target accepted")
	}
}

type sourceImageRunner struct {
	image string
	calls [][]string
}

func (r *sourceImageRunner) Run(_ context.Context, _ string, args, _ []string, stdout, _ io.Writer) error {
	r.calls = append(r.calls, append([]string(nil), args...))
	_, err := io.WriteString(stdout, r.image+"\n")
	return err
}

func TestSourceRuntimeImagePinsAcceptDockerComposeBareIDs(t *testing.T) {
	for _, image := range []string{strings.Repeat("a", 64), "sha256:" + strings.Repeat("a", 64)} {
		t.Run(image[:8], func(t *testing.T) {
			local, _ := sourceGitFixture(t)
			writeSourceFixture(t, local, ".env", "POSTGRES_DB=canvas\nKEEP_SETTING=keep\n")
			m := sourceManagerFixture(t, local)
			m.runner = &sourceImageRunner{image: image}
			path, err := m.sourceSaveEnvironment()
			if err != nil {
				t.Fatal(err)
			}
			values, err := readEnvFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if values["CANVAS_SOURCE_BACKEND_IMAGE"] != "sha256:"+strings.Repeat("a", 64) || values["CANVAS_SOURCE_AGENT_IMAGE"] != "sha256:"+strings.Repeat("a", 64) || values["KEEP_SETTING"] != "keep" {
				t.Fatalf("incorrect saved runtime: %+v", values)
			}
		})
	}
}

func TestSourceBackupUsesAllComposeFilesAndStoppedBackend(t *testing.T) {
	local, _ := sourceGitFixture(t)
	writeSourceFixture(t, local, ".env", "POSTGRES_DB=canvas\n")
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	if _, err := m.createBackup(strings.Repeat("a", 40)); err != nil {
		t.Fatal(err)
	}
	for _, args := range runner.calls {
		command := strings.Join(args, " ")
		for _, file := range []string{"docker-compose.deploy.yml", "docker-compose.hot.yml", "docker-compose.source-update.yml"} {
			if !strings.Contains(command, filepath.Join(local, file)) {
				t.Fatalf("missing compose overlay %s: %s", file, command)
			}
		}
		if !strings.Contains(command, "--project-name site") {
			t.Fatalf("incorrect project: %s", command)
		}
	}
	if last := strings.Join(runner.calls[len(runner.calls)-1], " "); !strings.Contains(last, "run --rm --no-deps -T --user root --entrypoint tar backend") {
		t.Fatalf("backup requires a running backend: %s", last)
	}
}

func TestSourceRollbackRejectsNewLocalChangesBeforeStoppingServices(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	m.state.SourceMergedCommit = gitFixture(t, local, "rev-parse", "HEAD")
	m.state.LastBackup = &Backup{Version: m.state.SourceMergedCommit}
	m.state.RollbackVersion = m.state.SourceMergedCommit
	m.state.SourcePreviousEnv = "placeholder"
	runner := &recordingRunner{}
	m.runner = runner
	writeSourceFixture(t, local, "uncommitted-customization", "keep me")
	if _, err := m.StartRollback("test"); err == nil {
		t.Fatal("rollback accepted new customization")
	}
	if len(runner.calls) != 0 {
		t.Fatal("rollback touched Docker despite local changes")
	}
}

func TestSourceRollbackFailureStopsWritersAndKeepsFailedCommit(t *testing.T) {
	local, _ := sourceGitFixture(t)
	from := gitFixture(t, local, "rev-parse", "HEAD")
	gitFixture(t, local, "commit", "--allow-empty", "-m", "updated source")
	merged := gitFixture(t, local, "rev-parse", "HEAD")
	writeSourceFixture(t, filepath.Join(local, ".git", "info"), "exclude", ".env\n")
	writeSourceFixture(t, local, ".env", "POSTGRES_DB=canvas\n")
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	backup, err := m.createBackup(from)
	if err != nil {
		t.Fatal(err)
	}
	previousEnv := filepath.Join(m.config.StateDir, "previous.env")
	if err := replaceFile(m.envPath(), previousEnv, 0600); err != nil {
		t.Fatal(err)
	}
	m.state.SourceMergedCommit = merged
	m.state.SourcePreviousEnv = previousEnv
	runner.calls = nil
	// The recording runner rejects stdin restore after drop/create succeeds.
	// Every failure after disruption must stop writers again before returning.
	m.runSourceRollback(from, backup)
	stops := 0
	for _, args := range runner.calls {
		if strings.HasSuffix(strings.Join(args, " "), "stop backend yingce-agent") {
			stops++
		}
	}
	if stops != 2 || m.state.Operation.Phase != PhaseManualIntervention || m.state.Operation.RollbackError == "" {
		t.Fatalf("unsafe restore failure: stops=%d phase=%s error=%q", stops, m.state.Operation.Phase, m.state.Operation.RollbackError)
	}
	if got := gitFixture(t, local, "rev-parse", "main"); got != merged {
		t.Fatal("failed source commit was discarded")
	}
	if got := gitFixture(t, local, "rev-parse", "HEAD"); got != from {
		t.Fatal("rollback branch did not restore the original source")
	}
}

func TestSourceRollbackInvalidBackupDoesNotStopHealthyServices(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	m.runSourceRollback(gitFixture(t, local, "rev-parse", "HEAD"), Backup{Path: filepath.Join(t.TempDir(), "missing.zip")})
	if len(runner.calls) != 0 || m.state.Operation.Phase != PhaseFailed {
		t.Fatalf("preflight disrupted services: calls=%v phase=%s", runner.calls, m.state.Operation.Phase)
	}
}

type sourceBlockedRunner struct{}

func (sourceBlockedRunner) Run(context.Context, string, []string, []string, io.Writer, io.Writer) error {
	return errors.New("blocked by test")
}

func TestSourceStartRejectsLocalCommitMadeAfterCheck(t *testing.T) {
	local, remote := sourceGitFixture(t)
	writeSourceFixture(t, remote, "feature.txt", "new upstream feature")
	gitFixture(t, remote, "add", ".")
	gitFixture(t, remote, "commit", "-m", "new feature")
	m := sourceManagerFixture(t, local)
	status, err := m.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	gitFixture(t, local, "commit", "--allow-empty", "-m", "new local commit after check")
	m.runner = sourceBlockedRunner{}
	if _, err := m.StartUpdate(status.LatestRelease.Version); err == nil {
		// The blocked runner prevents disruption if this regression launches a job.
		deadline := time.Now().Add(3 * time.Second)
		for m.Snapshot().Operation.Phase.Active() && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("update accepted a local HEAD different from the checked HEAD")
	}
}

func TestSourceInterruptedCheckCanBeRetriedAfterRestart(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	m.state.Operation.Phase = PhaseChecking
	if err := m.saveStateLocked(); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewManager(m.config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.Check(context.Background()); err != nil {
		t.Fatalf("interrupted check stuck after restart: %v", err)
	}
}

func TestSourceReadinessChecksExactRunningCommit(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	target := strings.Repeat("a", 40)
	for _, commit := range []string{target, strings.Repeat("b", 40), "unknown"} {
		t.Run(commit[:7], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.WriteString(w, `{"code":0,"data":{"build":{"version":"dev","commit":"`+commit+`"}}}`)
			}))
			defer server.Close()
			err := m.checkHealthOnce(server.URL, target)
			if (err == nil) != (commit == target) {
				t.Fatalf("running commit %s accepted=%v", commit, err == nil)
			}
		})
	}
}
