#!/usr/bin/env python3
"""Exercise scheduled Git uploads against disposable local repositories."""

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SYNC_SCRIPT = Path(__file__).with_name("sync-github.py")


class GithubSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="github-sync-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "work"
        self.repo.mkdir()
        self.env = os.environ.copy()
        for name in tuple(self.env):
            if name.startswith("GIT_") or name.startswith("GITHUB_SYNC_"):
                del self.env[name]
        self.env.update({
            "HOME": str(self.root),
            "XDG_CONFIG_HOME": str(self.root / "config"),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ALLOW_PROTOCOL": "file",
        })
        self.git("init", "--bare", "--initial-branch=main", str(self.remote))
        self.git("init", "--initial-branch=main")
        self.configure_author(self.repo)
        self.write("existing.txt", "original\n")
        self.write("removed.txt", "remove this file\n")
        self.git("add", ".")
        self.git("commit", "-m", "test: initial files")
        self.git("remote", "add", "user", str(self.remote))
        self.git("push", "user", "HEAD:refs/heads/main")

    def git(self, *args, cwd=None, check=True):
        return subprocess.run(
            ["git", *args], cwd=cwd or self.repo, env=self.env,
            capture_output=True, text=True, timeout=30, check=check,
        )

    def configure_author(self, repo):
        self.git("config", "user.name", "Git Sync Test", cwd=repo)
        self.git("config", "user.email", "git-sync-test@example.invalid", cwd=repo)
        self.git("config", "commit.gpgsign", "false", cwd=repo)

    def write(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def sync(self, *args):
        return subprocess.run(
            [sys.executable, str(SYNC_SCRIPT), "--repo", str(self.repo),
             "--remote", "user", "--branch", "main", "--expected-url",
             str(self.remote), *args],
            cwd=self.root, env=self.env, capture_output=True, text=True,
            timeout=60,
        )

    def head(self):
        return self.git("rev-parse", "HEAD").stdout.strip()

    def remote_head(self):
        return self.git("--git-dir", str(self.remote), "rev-parse", "main").stdout.strip()

    def index(self):
        return (self.repo / ".git" / "index").read_bytes()

    def remote_files(self):
        return self.git(
            "--git-dir", str(self.remote), "ls-tree", "-r", "--name-only", "main",
        ).stdout.splitlines()

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assert_failure_preserves_state(self, result, before):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.head(), self.remote_head(), self.index()), before)

    def state(self):
        return self.head(), self.remote_head(), self.index()

    def test_uploads_added_modified_deleted_files_and_is_idempotent(self):
        self.write("existing.txt", "modified\n")
        self.write("src/new file.txt", "new source\n")
        (self.repo / "removed.txt").unlink()
        self.assert_success(self.sync())
        self.assertEqual(self.head(), self.remote_head())
        self.assertEqual(self.remote_files(), ["existing.txt", "src/new file.txt"])
        self.assertEqual(self.git(
            "--git-dir", str(self.remote), "show", "main:existing.txt",
        ).stdout, "modified\n")
        self.assertEqual(self.git("diff", "--name-only").stdout, "")
        self.assertEqual(self.git("diff", "--cached", "--name-only").stdout, "")
        first_head = self.head()
        self.assert_success(self.sync())
        self.assertEqual(self.head(), first_head)
        self.assertEqual(self.remote_head(), first_head)

    def test_dry_run_preserves_head_index_and_working_changes(self):
        self.write("existing.txt", "unfinished change\n")
        self.write("new.txt", "new\n")
        before = self.state()
        self.assert_success(self.sync("--dry-run"))
        self.assertEqual(self.state(), before)
        self.assertEqual((self.repo / "existing.txt").read_text(), "unfinished change\n")
        self.assertEqual((self.repo / "new.txt").read_text(), "new\n")

    def test_failed_index_replacement_restores_head_and_preserves_work(self):
        self.write("existing.txt", "unfinished change\n")
        self.write("new.txt", "new source\n")
        (self.repo / "removed.txt").unlink()

        def working_files():
            return {
                path.relative_to(self.repo): path.read_bytes()
                for path in self.repo.rglob("*")
                if path.is_file() and ".git" not in path.relative_to(self.repo).parts
            }

        before = self.state()
        before_files = working_files()
        spec = importlib.util.spec_from_file_location("github_sync_under_test", SYNC_SCRIPT)
        module = importlib.util.module_from_spec(spec)
        with patch.object(sys, "dont_write_bytecode", True):
            spec.loader.exec_module(module)
        args = SimpleNamespace(
            repo=str(self.repo), remote="user", branch="main",
            expected_url=str(self.remote), dry_run=False,
        )
        with patch.dict(os.environ, self.env, clear=True):
            with patch.object(module.os, "replace", side_effect=OSError("simulated index failure")) as replace:
                with self.assertRaisesRegex(OSError, "simulated index failure"):
                    module.run(args)
                replace.assert_called_once()
        self.assertEqual(self.state(), before)
        self.assertEqual(working_files(), before_files)
        self.assertFalse((self.repo / ".git" / "index.lock").exists())

    def test_excludes_local_data_even_without_gitignore_and_keeps_env_example(self):
        blocked = [
            "backups/database.dump", ".env", "web/.env.production", "data/users.json",
            "backend/data/uploads/file.txt", ".settings-key", ".local/state.txt",
            "node_modules/library/index.js",
        ]
        for name in blocked:
            self.write(name, "local-only content\n")
        self.write(".env.example", "EXAMPLE_SETTING=\n")
        self.write("source.py", "print('source')\n")
        self.assert_success(self.sync())
        uploaded = self.remote_files()
        self.assertIn("source.py", uploaded)
        self.assertIn(".env.example", uploaded)
        for name in blocked:
            self.assertNotIn(name, uploaded)
            self.assertTrue((self.repo / name).exists())

    def test_uploads_tracked_file_inside_later_ignored_parent_directory(self):
        self.write("docs/progress/todo.md", "original documentation\n")
        self.git("add", "docs/progress/todo.md")
        self.git("commit", "-m", "test: track documentation")
        self.write(".gitignore", "docs/progress/\n")
        self.git("add", ".gitignore")
        self.git("commit", "-m", "test: ignore local documentation artifacts")
        self.git("push", "user", "HEAD:refs/heads/main")
        self.write("docs/progress/todo.md", "updated tracked documentation\n")
        self.write("docs/progress/local-notes.md", "ignored local notes\n")
        self.assert_success(self.sync())
        self.assertEqual(self.head(), self.remote_head())
        self.assertEqual(self.git(
            "--git-dir", str(self.remote), "show", "main:docs/progress/todo.md",
        ).stdout, "updated tracked documentation\n")
        self.assertNotIn("docs/progress/local-notes.md", self.remote_files())
        self.assertEqual(self.git("diff", "--name-only").stdout, "")
        self.assertEqual(self.git("diff", "--cached", "--name-only").stdout, "")

    def test_refuses_staged_changes_without_touching_index(self):
        self.write("existing.txt", "staged\n")
        self.git("add", "existing.txt")
        self.write("existing.txt", "newer unstaged\n")
        before = self.state()
        self.assert_failure_preserves_state(self.sync(), before)
        self.assertEqual(self.git("show", ":existing.txt").stdout, "staged\n")
        self.assertEqual((self.repo / "existing.txt").read_text(), "newer unstaged\n")

    def test_refuses_remote_divergence_and_keeps_local_work(self):
        self.write("local-commit.txt", "local commit\n")
        self.git("add", "local-commit.txt")
        self.git("commit", "-m", "test: local change")
        other = self.root / "other"
        self.git("clone", str(self.remote), str(other))
        self.configure_author(other)
        (other / "remote-commit.txt").write_text("remote commit\n")
        self.git("add", ".", cwd=other)
        self.git("commit", "-m", "test: concurrent remote change", cwd=other)
        self.git("push", "origin", "main", cwd=other)
        self.write("existing.txt", "still being edited\n")
        before = self.state()
        self.assert_failure_preserves_state(self.sync(), before)
        self.assertEqual((self.repo / "existing.txt").read_text(), "still being edited\n")

    def test_pushes_existing_local_commit_without_creating_another(self):
        self.write("existing.txt", "already committed\n")
        self.git("add", "existing.txt")
        self.git("commit", "-m", "test: ready for upload")
        local_head = self.head()
        self.assertNotEqual(local_head, self.remote_head())
        self.assert_success(self.sync())
        self.assertEqual(self.head(), local_head)
        self.assertEqual(self.remote_head(), local_head)

    def test_rejects_private_key_content_without_disclosing_it(self):
        secret = "-----BEGIN " + "PRIVATE KEY-----\nSYNTHETIC_TEST_SECRET\n"
        self.write("source.txt", secret)
        before = self.state()
        result = self.sync()
        self.assert_failure_preserves_state(result, before)
        self.assertNotIn("SYNTHETIC_TEST_SECRET", result.stdout + result.stderr)
        self.assertEqual((self.repo / "source.txt").read_text(), secret)

    def test_rejects_token_content_without_disclosing_it(self):
        token = "ghp_" + "a1B2" * 9
        self.write("source.txt", "token=" + token + "\n")
        before = self.state()
        result = self.sync()
        self.assert_failure_preserves_state(result, before)
        self.assertNotIn(token, result.stdout + result.stderr)

    def test_rejects_tracked_sensitive_paths_even_when_gitignored(self):
        self.write(".env", "LOCAL_SECRET=synthetic-test-value\n")
        self.git("add", ".env")
        self.git("commit", "-m", "test: accidental local environment")
        self.write(".gitignore", ".env\n")
        before = self.state()
        result = self.sync()
        self.assert_failure_preserves_state(result, before)
        self.assertNotIn("synthetic-test-value", result.stdout + result.stderr)

    def test_rejects_secret_in_outgoing_history_after_file_deleted(self):
        secret = "-----BEGIN " + "RSA PRIVATE KEY-----\nHISTORY_TEST_SECRET\n"
        self.write("source.txt", secret)
        self.git("add", "source.txt")
        self.git("commit", "-m", "test: accidental secret")
        self.git("rm", "source.txt")
        self.git("commit", "-m", "test: remove accidental secret")
        before = self.state()
        result = self.sync()
        self.assert_failure_preserves_state(result, before)
        self.assertNotIn("HISTORY_TEST_SECRET", result.stdout + result.stderr)

    def test_refuses_existing_index_lock(self):
        self.write("existing.txt", "pending change\n")
        lock = self.repo / ".git" / "index.lock"
        lock.write_text("another git command\n")
        before = self.state()
        self.assert_failure_preserves_state(self.sync(), before)
        self.assertEqual(lock.read_text(), "another git command\n")

    def test_refuses_another_checked_out_branch(self):
        self.git("switch", "-c", "feature-in-progress")
        self.write("existing.txt", "pending feature\n")
        before = self.state()
        self.assert_failure_preserves_state(self.sync(), before)
        self.assertEqual(self.git("branch", "--show-current").stdout.strip(), "feature-in-progress")

    def test_refuses_unexpected_remote_url(self):
        self.git("remote", "set-url", "user", str(self.root / "unexpected.git"))
        before = self.state()
        self.assert_failure_preserves_state(self.sync(), before)


if __name__ == "__main__":
    unittest.main()
