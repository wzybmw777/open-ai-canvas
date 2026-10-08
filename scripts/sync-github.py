#!/usr/bin/env python3
"""Commit a source snapshot and push it to one explicitly configured remote."""

import argparse
import datetime
import fcntl
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo


EXCLUDED_DIRS = {
    ".local", ".ssh", ".cache", ".idea", ".vscode", ".next", ".git",
    "backups", "data", "uploads", "node_modules", "dist", "out", "coverage",
    "output", "__pycache__",
}
EXCLUDED_SUFFIXES = (
    ".pem", ".key", ".p12", ".pfx", ".dump", ".sql", ".sqlite", ".sqlite3",
    ".db", ".db-wal", ".db-shm", ".bak", ".log", ".tmp", ".zip", ".tar", ".gz",
)
SECRET = re.compile(
    rb"(?m)^-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|"
    rb"\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"
)
MAX_BLOB_BYTES = 50 * 1024 * 1024


def excluded(path):
    parts = PurePosixPath(path).parts
    name = parts[-1].lower()
    return (
        bool(set(parts) & EXCLUDED_DIRS)
        or (name.startswith(".env") and name != ".env.example")
        or name in {".settings-key", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"}
        or name.endswith(EXCLUDED_SUFFIXES)
    )


def log(message):
    now = datetime.datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    print(f"[{now}] {message}", flush=True)


def run(args):
    repo = Path(args.repo).resolve()
    env = os.environ.copy()
    # An inherited alternate index or worktree must never redirect the snapshot.
    for key in ("GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"):
        env.pop(key, None)
    env.update(GIT_TERMINAL_PROMPT="0", GIT_LITERAL_PATHSPECS="1")
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15")

    def git(*command, index=None, check=True, data=None):
        command_env = dict(env)
        if index is not None:
            command_env["GIT_INDEX_FILE"] = str(index)
        result = subprocess.run(
            ["git", "-C", str(repo), *command], input=data, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=command_env, timeout=180,
        )
        if check and result.returncode:
            # Git/filter output can contain file contents or credential-bearing URLs.
            raise RuntimeError(f"git {command[0]} failed (exit {result.returncode})")
        return result

    def value(*command, **kwargs):
        return git(*command, **kwargs).stdout.decode().strip()

    def paths(*command, **kwargs):
        return [os.fsdecode(p) for p in git(*command, **kwargs).stdout.split(b"\0") if p]

    if Path(value("rev-parse", "--show-toplevel")).resolve() != repo:
        raise RuntimeError("--repo must name the repository root")
    git("check-ref-format", f"refs/heads/{args.branch}")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", args.remote):
        raise RuntimeError("Invalid remote name")
    for options in (("--all",), ("--push", "--all")):
        if value("remote", "get-url", *options, args.remote).splitlines() != [args.expected_url]:
            raise RuntimeError("Remote URL differs from the pinned destination")

    git_dir = Path(value("rev-parse", "--absolute-git-dir"))
    with (git_dir / "daily-github-sync.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another GitHub sync is running") from None

        def ready():
            if value("symbolic-ref", "--quiet", "--short", "HEAD") != args.branch:
                raise RuntimeError("Current branch differs from the configured branch")
            for state in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"):
                state_path = Path(value("rev-parse", "--git-path", state))
                if (repo / state_path).exists():
                    raise RuntimeError("A Git merge/rebase/cherry-pick/revert is in progress")
            if git("diff", "--cached", "--quiet", "--exit-code", check=False).returncode:
                raise RuntimeError("Staged changes exist; finish the manual Git operation first")

        ready()
        if (git_dir / "index.lock").exists():
            raise RuntimeError("The Git index is locked by another operation")
        base = value("rev-parse", "HEAD")
        remote_ref = f"refs/remotes/{args.remote}/{args.branch}"
        git("fetch", "--no-tags", "--no-write-fetch-head", args.expected_url,
            f"+refs/heads/{args.branch}:{remote_ref}")
        remote_head = value("rev-parse", remote_ref)
        if git("merge-base", "--is-ancestor", remote_head, base, check=False).returncode:
            raise RuntimeError("Remote is ahead or diverged; reconcile it manually before syncing")

        checked_blobs = set()

        def validate(tree, names, index=None):
            for name in set(names):
                if excluded(name):
                    raise RuntimeError(f"Refusing a tracked sensitive/generated path: {name!r}")
                blob = value("rev-parse", f"{tree}:{name}", index=index)
                if blob in checked_blobs:
                    continue
                if value("cat-file", "-t", blob) != "blob":
                    raise RuntimeError("Submodule changes require a manual commit and push")
                if int(value("cat-file", "-s", blob)) > MAX_BLOB_BYTES:
                    raise RuntimeError(f"File exceeds the 50 MiB automatic upload limit: {name!r}")
                if SECRET.search(git("cat-file", "blob", blob).stdout):
                    raise RuntimeError(f"Possible private key or GitHub token in: {name!r}")
                checked_blobs.add(blob)

        # Inspect every outgoing commit, including secrets removed by a later commit.
        for commit in value("rev-list", f"{remote_head}..{base}").splitlines():
            validate(commit, paths("diff-tree", "--root", "-m", "--no-commit-id", "--name-only",
                                   "-r", "-z", "--diff-filter=ACMRT", commit))

        index_lock = git_dir / "index.lock"
        fd = os.open(index_lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        try:
            ready()
            if value("rev-parse", "HEAD") != base:
                raise RuntimeError("HEAD changed while preparing the sync")
            with tempfile.TemporaryDirectory(prefix="github-sync-", dir=git_dir) as temp:
                index = Path(temp) / "index"
                if (git_dir / "index").exists():
                    shutil.copyfile(git_dir / "index", index)
                else:
                    git("read-tree", base, index=index)
                tracked = set(paths("ls-files", "-z"))
                candidates = set(paths("ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z"))
                selected = []
                for name in sorted(candidates):
                    if excluded(name):
                        if name in tracked:
                            raise RuntimeError(f"Sensitive/generated tracked path changed: {name!r}")
                        continue
                    selected.append(name)
                # Tracked documentation may live under an ignored parent directory.
                git("add", "--update", index=index)
                new_paths = [name for name in selected if name not in tracked]
                if new_paths:
                    git("add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul", index=index,
                        data=b"\0".join(os.fsencode(n) for n in new_paths) + b"\0")
                validate("", paths("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT", base, index=index), index=index)
                tree = value("write-tree", index=index)
                changed = tree != value("rev-parse", f"{base}^{{tree}}")
                log(f"Snapshot: {len(selected)} candidate paths; new commit needed: {changed}")
                if args.dry_run:
                    log("Dry run passed; no commit, index update or push")
                    return
                target = base
                if changed:
                    stamp = datetime.datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S %Z")
                    message = f"chore(sync): 代码备份 - 每日自动同步 {stamp}\n"
                    target = value("commit-tree", tree, "-p", base, data=message.encode())
                    try:
                        git("update-ref", "-m", "daily GitHub source sync", f"refs/heads/{args.branch}", target, base)
                        # The real index lock prevents concurrent staging throughout this update.
                        os.replace(index, git_dir / "index")
                    except BaseException:
                        # Undo only our own ref update if writing the corresponding index failed.
                        if index.exists() and value("rev-parse", f"refs/heads/{args.branch}") == target:
                            git("update-ref", f"refs/heads/{args.branch}", base, target)
                        raise
                    log(f"Created commit {target[:12]}")
        finally:
            index_lock.unlink()

        if value("rev-parse", f"refs/heads/{args.branch}") != target:
            raise RuntimeError("Branch changed before push; retry after the manual Git operation")
        if target == remote_head:
            log("Already synchronized; no push needed")
            return
        git("push", "--porcelain", args.expected_url, f"{target}:refs/heads/{args.branch}")
        log(f"Pushed {target[:12]} to {args.remote}/{args.branch}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=os.environ.get("GITHUB_SYNC_REPO", str(Path(__file__).resolve().parent.parent)))
    parser.add_argument("--remote", default=os.environ.get("GITHUB_SYNC_REMOTE", "user"))
    parser.add_argument("--branch", default=os.environ.get("GITHUB_SYNC_BRANCH", "main"))
    parser.add_argument("--expected-url", default=os.environ.get("GITHUB_SYNC_EXPECTED_URL"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.expected_url:
        parser.error("--expected-url or GITHUB_SYNC_EXPECTED_URL is required")
    os.umask(0o077)

    def terminate(signum, frame):
        raise RuntimeError("Sync was stopped by the service manager")

    signal.signal(signal.SIGTERM, terminate)
    try:
        run(args)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        log(f"FAILED: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
