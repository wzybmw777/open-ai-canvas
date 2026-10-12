"""Exercise build selection through the real shell entrypoint and a fake Docker CLI."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


DOCKER = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["FAKE_DOCKER_STATE"])
args = sys.argv[1:]
images_path = root / "images.json"
images = json.loads(images_path.read_text()) if images_path.exists() else {}
if args[:2] == ["image", "inspect"]:
    name = args[2]
    if name not in images:
        sys.exit(1)
    print(images[name]["id"] if "{{.Id}}" in args else images[name]["label"])
elif args[:2] == ["buildx", "build"]:
    tag = args[args.index("--tag") + 1]
    with (root / "calls.jsonl").open("a") as log:
        log.write(json.dumps({"tag": tag, "args": args}) + "\n")
    if os.environ.get("FAKE_DOCKER_FAIL_TAG") == tag:
        sys.exit(1)
    mutate = os.environ.get("FAKE_DOCKER_MUTATE")
    if mutate and "backend" in tag:
        Path(mutate).write_text("changed during build\n")
    label = args[args.index("--label") + 1].split("=", 1)[1]
    images[tag] = {"id": "sha256:" + label, "label": label}
    images_path.write_text(json.dumps(images))
elif args[:2] != ["buildx", "inspect"]:
    sys.exit("unexpected docker call: " + repr(args))
'''


class BuildImagesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = {
            ".gitignore": ".local/\n",
            "VERSION": "v1.0.0\n",
            "Dockerfile": "frontend recipe\n",
            "backend/Dockerfile": "backend recipe\n",
            "backend/go.mod": "module example\n",
            "backend/main.go": "package main\n",
            "backend/agent-runtime/pi/package.json": "{}\n",
            "backend/agent-runtime/pi/package-lock.json": "{}\n",
            "backend/agent-runtime/pi/Dockerfile.deps": "dependencies recipe\n",
            "web/src/main.ts": "export const value = 1;\n",
            "web/public/icon.svg": "<svg/>\n",
            "docs/note.md": "documentation\n",
        }
        for name, contents in files.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(contents)
        (self.root / "scripts").mkdir()
        shutil.copyfile(Path(__file__).with_name("build-images.sh"), self.root / "scripts/build-images.sh")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial")
        self.state = self.root / ".local"
        self.state.mkdir()
        docker = self.state / "docker"
        docker.write_text(DOCKER)
        docker.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": str(self.state) + ":" + os.environ["PATH"],
            "FAKE_DOCKER_STATE": str(self.state),
            "CANVAS_BUILD_BACKEND_IMAGE": "test-backend:local",
            "CANVAS_BUILD_WEB_IMAGE": "test-web:local",
            "CANVAS_BUILD_PI_RUNTIME_DEPS_IMAGE": "test-deps:local",
        }
        for key in ("BUILD_VERSION", "BUILD_COMMIT", "BUILD_TIME", "GO_BUILD_PARALLELISM"):
            self.env.pop(key, None)

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def run_build(self, *args, success=True, **env):
        result = subprocess.run(["bash", "scripts/build-images.sh", *args], cwd=self.root,
                                env={**self.env, **env}, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def tags(self):
        log = self.state / "calls.jsonl"
        return [json.loads(line)["tag"] for line in log.read_text().splitlines()] if log.exists() else []

    def clear_calls(self):
        (self.state / "calls.jsonl").write_text("")

    def bootstrap(self):
        self.run_build()
        self.assertEqual(self.tags(), ["test-deps:local", "test-backend:local", "test-web:local"])
        self.clear_calls()

    def test_unchanged_and_documentation_commit_skip_builds(self):
        self.bootstrap()
        self.run_build()
        (self.root / "docs/note.md").write_text("new documentation\n")
        self.git("add", "docs")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "docs")
        self.run_build()
        self.assertEqual(self.tags(), [])

    def test_frontend_working_tree_change_only_builds_web(self):
        self.bootstrap()
        (self.root / "web/src/main.ts").write_text("export const value = 2;\n")
        self.run_build()
        self.assertEqual(self.tags(), ["test-web:local"])

    def test_backend_change_keeps_agent_dependencies(self):
        self.bootstrap()
        (self.root / "backend/main.go").write_text("package changed\n")
        self.git("add", "backend/main.go")
        self.run_build()
        self.assertEqual(self.tags(), ["test-backend:local"])

    def test_new_and_deleted_source_files_are_detected(self):
        self.bootstrap()
        new = self.root / "web/src/new.ts"
        new.write_text("new source\n")
        self.run_build()
        new.unlink()
        (self.root / "web/src/main.ts").unlink()
        self.run_build()
        self.assertEqual(self.tags(), ["test-web:local", "test-web:local"])

    def test_dependency_change_rebuilds_deps_and_backend(self):
        self.bootstrap()
        (self.root / "backend/agent-runtime/pi/package-lock.json").write_text('{"changed":true}\n')
        self.run_build()
        self.assertEqual(self.tags(), ["test-deps:local", "test-backend:local"])

    def test_missing_image_rebuilds_only_that_component(self):
        self.bootstrap()
        path = self.state / "images.json"
        images = json.loads(path.read_text())
        del images["test-web:local"]
        path.write_text(json.dumps(images))
        self.run_build()
        self.assertEqual(self.tags(), ["test-web:local"])

    def test_explicit_all_builds_both_but_reuses_dependencies(self):
        self.bootstrap()
        self.run_build("all")
        self.assertEqual(self.tags(), ["test-backend:local", "test-web:local"])

    def test_failed_build_is_retried(self):
        self.bootstrap()
        (self.root / "web/src/main.ts").write_text("changed\n")
        self.run_build(success=False, FAKE_DOCKER_FAIL_TAG="test-web:local")
        self.run_build()
        self.assertEqual(self.tags(), ["test-web:local", "test-web:local"])

    def test_source_change_during_build_fails_then_retries(self):
        self.bootstrap()
        source = self.root / "backend/main.go"
        source.write_text("changed before build\n")
        self.run_build(success=False, FAKE_DOCKER_MUTATE=str(source))
        self.run_build()
        self.assertEqual(self.tags(), ["test-backend:local", "test-backend:local"])

    def test_explicit_metadata_change_invalidates_images(self):
        self.bootstrap()
        self.run_build(BUILD_COMMIT="release-custom")
        self.assertEqual(self.tags(), ["test-backend:local", "test-web:local"])


if __name__ == "__main__":
    unittest.main()
