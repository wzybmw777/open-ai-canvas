package hostupdate

import (
	"os"
	"path/filepath"
	"strings"
)

type sourceBuildPlan struct {
	WebCheck        bool
	WebDependencies bool
	BackendImage    bool
	AgentImage      bool
	WebRestart      bool
}

func (m *Manager) sourceBuildPlan(from, merged string) (sourceBuildPlan, error) {
	var plan sourceBuildPlan
	// Disabling rename detection includes both the removed and added input paths.
	files, err := m.sourceGit("diff", "--name-only", "--no-renames", "-z", from, merged, "--")
	if err != nil {
		return plan, err
	}
	for _, file := range strings.Split(files, "\x00") {
		if strings.HasPrefix(file, "web/") {
			plan.WebCheck = true
		}
		if strings.HasPrefix(file, "assets/") {
			plan.WebRestart = true
		}
		switch file {
		case "web/package.json", "web/bun.lock", "web/bun.lockb", "web/bunfig.toml", "web/.npmrc", ".npmrc", "bunfig.toml":
			plan.WebDependencies = true
			plan.WebCheck = true
		case "backend/Dockerfile.dev", "backend/go.mod", "backend/go.sum":
			plan.BackendImage = true
		case ".dockerignore":
			plan.BackendImage = true
			plan.AgentImage = true
		case "VERSION", "CHANGELOG.md", "README.md":
			plan.WebRestart = true
		}
		if strings.HasPrefix(file, "yingce-agent/") || strings.HasPrefix(file, "backend/agent-runtime/") {
			plan.AgentImage = true
		}
		for _, composeFile := range m.config.ComposeFiles {
			if !filepath.IsAbs(composeFile) {
				composeFile = filepath.Join(m.config.InstallDir, composeFile)
			}
			if file != "" && filepath.Clean(filepath.Join(m.config.InstallDir, file)) == filepath.Clean(composeFile) {
				plan = sourceBuildPlan{WebCheck: true, WebDependencies: true, BackendImage: true, AgentImage: true}
			}
		}
	}
	return plan, nil
}

func (m *Manager) sourceStartUpdatedServices(plan sourceBuildPlan) error {
	args := []string{"up", "-d", "--no-deps", "--no-build", "--wait", "--wait-timeout", "600"}
	// Restart Vite to discard modules/config read before the source switch.
	if plan.WebCheck || plan.WebRestart {
		if err := m.compose(m.composePath(), "", m.config.StepTimeout, nil, append(args, "--force-recreate", "web")...); err != nil {
			return err
		}
	}
	// Stopped backend/Agent containers start with the new source; Compose
	// recreates them automatically only when their image/config has changed.
	return m.compose(m.composePath(), "", m.config.StepTimeout, nil, append(args, "yingce-agent", "backend", "web")...)
}

func (m *Manager) sourceBuild(plan sourceBuildPlan) error {
	if plan.WebCheck {
		for _, tool := range []string{"vite", "tsc"} {
			if _, err := os.Stat(filepath.Join(m.config.InstallDir, "web", "node_modules", ".bin", tool)); err != nil {
				plan.WebDependencies = true
			}
		}
	}
	if plan.WebDependencies {
		if err := m.sourceDependencies(); err != nil {
			return err
		}
	}
	// Managed source deployments serve Vite source; dist is not a runtime input.
	if plan.WebCheck {
		if err := m.sourceRun(m.config.BunBinary, []string{"run", "--cwd", filepath.Join(m.config.InstallDir, "web"), "typecheck"}, nil); err != nil {
			return err
		}
	}
	var services []string
	for _, image := range []struct {
		build   bool
		service string
		key     string
	}{{plan.BackendImage, "backend", "CANVAS_SOURCE_BACKEND_IMAGE"}, {plan.AgentImage, "yingce-agent", "CANVAS_SOURCE_AGENT_IMAGE"}} {
		if !image.build {
			continue
		}
		tag := composeProjectName(m.config.InstallDir) + "-" + image.service + ":source-" + randomID()
		if err := setEnvValue(m.envPath(), image.key, tag); err != nil {
			return err
		}
		services = append(services, image.service)
	}
	if len(services) > 0 {
		return m.compose(m.composePath(), "", m.config.StepTimeout, nil, append([]string{"build"}, services...)...)
	}
	return nil
}
