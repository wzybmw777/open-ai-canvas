package hostupdate

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestSourceBuildPlanUsesActualChangedInputs(t *testing.T) {
	tests := []struct {
		name string
		file string
		want sourceBuildPlan
	}{
		{"documentation", "docs/guide.md", sourceBuildPlan{}},
		{"backend source", "backend/internal/app/example.go", sourceBuildPlan{}},
		{"frontend source", "web/src/view.tsx", sourceBuildPlan{WebCheck: true}},
		{"frontend lock", "web/bun.lock", sourceBuildPlan{WebCheck: true, WebDependencies: true}},
		{"frontend manifest", "web/package.json", sourceBuildPlan{WebCheck: true, WebDependencies: true}},
		{"backend toolchain", "backend/go.mod", sourceBuildPlan{BackendImage: true}},
		{"backend Dockerfile", "backend/Dockerfile.dev", sourceBuildPlan{BackendImage: true}},
		{"agent runtime", "backend/agent-runtime/pi/agent-runtime.mjs", sourceBuildPlan{AgentImage: true}},
		{"agent image", "yingce-agent/Dockerfile", sourceBuildPlan{AgentImage: true}},
		{"shared compose", "docker-compose.hot.yml", sourceBuildPlan{WebCheck: true, WebDependencies: true, BackendImage: true, AgentImage: true}},
		{"docker context", ".dockerignore", sourceBuildPlan{BackendImage: true, AgentImage: true}},
		{"version metadata", "VERSION", sourceBuildPlan{WebRestart: true}},
		{"changelog metadata", "CHANGELOG.md", sourceBuildPlan{WebRestart: true}},
		{"external frontend glob", "assets/user-new.png", sourceBuildPlan{WebRestart: true}},
		{"external frontend markdown", "README.md", sourceBuildPlan{WebRestart: true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			local, _ := sourceGitFixture(t)
			from := gitFixture(t, local, "rev-parse", "HEAD")
			if err := os.MkdirAll(filepath.Dir(filepath.Join(local, tt.file)), 0700); err != nil {
				t.Fatal(err)
			}
			writeSourceFixture(t, local, tt.file, "changed input\n")
			gitFixture(t, local, "add", ".")
			gitFixture(t, local, "commit", "-m", "changed input")
			plan, err := sourceManagerFixture(t, local).sourceBuildPlan(from, gitFixture(t, local, "rev-parse", "HEAD"))
			if err != nil || plan != tt.want {
				t.Fatalf("plan=%+v want=%+v err=%v", plan, tt.want, err)
			}
		})
	}
}

func TestSourceBuildPlanIncludesDeletedAndRenamedInputs(t *testing.T) {
	local, _ := sourceGitFixture(t)
	if err := os.MkdirAll(filepath.Join(local, "yingce-agent"), 0700); err != nil {
		t.Fatal(err)
	}
	writeSourceFixture(t, local, "yingce-agent/server.mjs", "agent code\n")
	gitFixture(t, local, "add", ".")
	gitFixture(t, local, "commit", "-m", "agent file")
	from := gitFixture(t, local, "rev-parse", "HEAD")
	gitFixture(t, local, "mv", "yingce-agent/server.mjs", "brand.txt.mjs")
	gitFixture(t, local, "commit", "-m", "move agent code out")
	plan, err := sourceManagerFixture(t, local).sourceBuildPlan(from, gitFixture(t, local, "rev-parse", "HEAD"))
	if err != nil || !plan.AgentImage {
		t.Fatalf("renamed/deleted agent input was skipped: %+v %v", plan, err)
	}
}

func TestSourceBuildSkipsUnchangedImagesAndUsesTypecheck(t *testing.T) {
	local, _ := sourceGitFixture(t)
	writeSourceFixture(t, local, ".env", "CANVAS_SOURCE_BACKEND_IMAGE=sha256:old-backend\nCANVAS_SOURCE_AGENT_IMAGE=sha256:old-agent\n")
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	tools := filepath.Join(local, "web", "node_modules", ".bin")
	if err := os.MkdirAll(tools, 0700); err != nil {
		t.Fatal(err)
	}
	for _, tool := range []string{"vite", "tsc"} {
		writeSourceFixture(t, tools, tool, "fixture")
	}
	if err := m.sourceBuild(sourceBuildPlan{WebCheck: true}); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 1 || !reflect.DeepEqual(runner.calls[0], []string{"run", "--cwd", filepath.Join(local, "web"), "typecheck"}) {
		t.Fatalf("unnecessary build/install: %v", runner.calls)
	}
	values, err := readEnvFile(m.envPath())
	if err != nil || values["CANVAS_SOURCE_BACKEND_IMAGE"] != "sha256:old-backend" || values["CANVAS_SOURCE_AGENT_IMAGE"] != "sha256:old-agent" {
		t.Fatalf("reused image pins changed: %v %v", values, err)
	}
}

func TestSourceBuildRestoresMissingDependenciesBeforeChecking(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	if err := m.sourceBuild(sourceBuildPlan{WebCheck: true}); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 2 || runner.calls[0][0] != "install" || runner.calls[0][len(runner.calls[0])-1] != "--frozen-lockfile" || runner.calls[1][len(runner.calls[1])-1] != "typecheck" {
		t.Fatalf("dependencies were not restored before checking: %v", runner.calls)
	}
}

func TestSourceBuildPropagatesFailureInsteadOfBuildingImages(t *testing.T) {
	local, _ := sourceGitFixture(t)
	writeSourceFixture(t, local, ".env", "CANVAS_SOURCE_BACKEND_IMAGE=sha256:original\n")
	m := sourceManagerFixture(t, local)
	m.runner = sourceBlockedRunner{}
	if err := m.sourceBuild(sourceBuildPlan{WebDependencies: true, BackendImage: true}); err == nil {
		t.Fatal("dependency failure was swallowed")
	}
	values, err := readEnvFile(m.envPath())
	if err != nil || values["CANVAS_SOURCE_BACKEND_IMAGE"] != "sha256:original" {
		t.Fatal("changed runtime after failed dependency preparation")
	}
}

func TestSourceBuildReportsImageBuildFailure(t *testing.T) {
	local, _ := sourceGitFixture(t)
	writeSourceFixture(t, local, ".env", "CANVAS_SOURCE_AGENT_IMAGE=sha256:original\n")
	m := sourceManagerFixture(t, local)
	m.runner = sourceBlockedRunner{}
	if err := m.sourceBuild(sourceBuildPlan{AgentImage: true}); err == nil {
		t.Fatal("image build failure was swallowed instead of triggering rollback")
	}
}

func TestSourceBuildOnlyTagsAndBuildsChangedImage(t *testing.T) {
	local, _ := sourceGitFixture(t)
	writeSourceFixture(t, local, ".env", "CANVAS_SOURCE_BACKEND_IMAGE=sha256:old-backend\nCANVAS_SOURCE_AGENT_IMAGE=sha256:old-agent\n")
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	if err := m.sourceBuild(sourceBuildPlan{AgentImage: true}); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 1 || !strings.HasSuffix(strings.Join(runner.calls[0], " "), "build yingce-agent") {
		t.Fatalf("wrong images built: %v", runner.calls)
	}
	values, err := readEnvFile(m.envPath())
	if err != nil || values["CANVAS_SOURCE_BACKEND_IMAGE"] != "sha256:old-backend" || !strings.HasPrefix(values["CANVAS_SOURCE_AGENT_IMAGE"], "site-yingce-agent:source-") {
		t.Fatalf("wrong image tags: %v %v", values, err)
	}
}

func TestSourceStartUpdateReusesUnchangedContainers(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	if err := m.sourceStartUpdatedServices(sourceBuildPlan{}); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 1 || strings.Contains(strings.Join(runner.calls[0], " "), "--force-recreate") || !strings.HasSuffix(strings.Join(runner.calls[0], " "), "yingce-agent backend web") {
		t.Fatalf("unchanged services unnecessarily recreated: %v", runner.calls)
	}
}

func TestSourceStartUpdateRestartsWebOnlyWhenItsRuntimeChanges(t *testing.T) {
	local, _ := sourceGitFixture(t)
	m := sourceManagerFixture(t, local)
	runner := &recordingRunner{}
	m.runner = runner
	if err := m.sourceStartUpdatedServices(sourceBuildPlan{WebCheck: true}); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) != 2 || !strings.HasSuffix(strings.Join(runner.calls[0], " "), "--force-recreate web") || strings.Contains(strings.Join(runner.calls[1], " "), "--force-recreate") {
		t.Fatalf("web change recreated other services: %v", runner.calls)
	}
}
