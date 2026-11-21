"""Tests for eval_review.py's setup: these never start Claude. Run: uv run pytest -v"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

import eval_review as ev

REVIEW_YML = ev.REVIEW_YML.read_text(encoding="utf-8")
LOCAL_CHECK = """
 Test Files  18 passed (18)
      Tests  380 passed (380)
  39 skipped
  184 passed (35.1s)
"""


def test_reads_the_real_code_review_settings():
    s = ev.read_review_settings(REVIEW_YML)
    assert "tools/review/prompts/code.md" in s["prompt"]
    assert s["max_turns"] > 0
    assert "Read" in s["allowed"] and "Bash(git -C pr diff:*)" in s["allowed"]
    assert "Write" in s["disallowed"] and "WebFetch" in s["disallowed"]
    assert s["env"].get("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB") == "1"


def test_settings_come_from_the_code_review_job_not_the_play_review():
    s = ev.read_review_settings(REVIEW_YML)
    assert "play.md" not in s["prompt"]
    assert "shots.mjs" not in s["allowed"]


def test_missing_job_fails_loudly():
    with pytest.raises(ValueError):
        ev.read_review_settings("jobs:\n  other:\n    runs-on: x\n")


def test_fill_prompt():
    s = ev.read_review_settings(REVIEW_YML)
    text = ev.fill_prompt(s["prompt"], 905, "abc123")
    assert "PR #905" in text and "abc123" in text and "${{" not in text


def test_parse_local_check():
    assert ev.parse_local_check(LOCAL_CHECK) == {"files": 18, "tests": 380, "browser": 223}


def test_ci_inputs_use_the_case_counts_and_commit():
    template = json.loads((ev.EVAL_DIR / "templates" / "ci.json").read_text())
    lines = (ev.EVAL_DIR / "templates" / "ci-tests.txt").read_text().splitlines()
    ci, tests = ev.ci_inputs(template, lines, {"files": 18, "tests": 380, "browser": 223}, "f00d")
    assert ci["headSha"] == "f00d" and ci["conclusion"] == "success"
    assert template["headSha"] != "f00d"  # the template itself is untouched
    assert "Tests  380 passed (380)" in tests
    shards = [int(line.split(" passed (")[0].split()[-1]) for line in tests.splitlines()
              if " passed (" in line and "Test" not in line]
    assert sum(shards) == 223 and len(shards) == 3


PATCH = """diff --git a/notes.txt b/notes.txt
new file mode 100644
--- /dev/null
+++ b/notes.txt
@@ -0,0 +1 @@
+hello
"""


@pytest.fixture
def case(tmp_path):
    d = tmp_path / "case"
    d.mkdir()
    (d / "change.patch").write_text(PATCH)
    (d / "local-check.txt").write_text(LOCAL_CHECK)
    return {"id": "t01", "number": 999, "title": "Add notes", "body": "Adds notes.", "branch": "claude/notes",
            "expect": {"kind": "clean"}, "dir": d, "hidden": False}


@pytest.fixture
def folder(tmp_path, case):
    root = tmp_path / "work"
    root.mkdir()
    sha = ev.build_run_folder(root, "HEAD", ev.base_commit(), case)
    return root, sha


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True).stdout


def test_folder_has_the_rules_but_never_the_eval(folder):
    root, _ = folder
    assert (root / "CLAUDE.md").is_file()
    assert (root / "tools" / "review" / "prompts" / "code.md").is_file()
    assert not (root / "tools" / "eval").exists()
    assert not (root / ".git").exists()  # a plain copy, not linked to this repo


def test_folder_code_is_base_but_rules_are_the_rules_commit(folder):
    # GitHub's root is main, which is also the PR's origin/main: so code comes from BASE, rules from the commit.
    root, _ = folder
    base, head = ev.base_commit(), "HEAD"
    assert (root / "docs" / "PLAN.md").read_text() == ev.git("show", f"{base}:docs/PLAN.md", cwd=ev.REPO_ROOT)
    assert (root / "docs" / "DECISIONS.md").read_text() == ev.git("show", f"{head}:docs/DECISIONS.md", cwd=ev.REPO_ROOT)
    assert (root / "js" / "core" / "storage.js").read_text() == ev.git("show", f"{base}:js/core/storage.js", cwd=ev.REPO_ROOT)


def test_git_ignores_the_owners_git_settings():
    assert ev.GIT_ENV["GIT_CONFIG_GLOBAL"] == "/dev/null" and ev.GIT_ENV["GIT_CONFIG_NOSYSTEM"] == "1"
    assert "HOME" not in ev.GIT_ENV


def test_pr_history_is_base_then_main_rules_then_the_case(folder):
    root, sha = folder
    pr = root / "pr"
    main = git(pr, "rev-parse", "origin/main").strip()
    assert git(pr, "rev-parse", f"{main}~1").strip() == ev.base_commit()  # HEAD's rules differ from BASE's
    changed = git(pr, "diff", "--name-only", ev.base_commit(), main).split()
    assert changed and all(any(c == p or c.startswith(p + "/") for p in ev.RULE_PATHS + ev.TRUSTED_PATHS)
                           for c in changed)
    assert (pr / "docs" / "DECISIONS.md").read_text() == (root / "docs" / "DECISIONS.md").read_text()
    assert git(pr, "rev-parse", "HEAD").strip() == sha
    assert git(pr, "log", "--format=%s", "-1").strip() == "Add notes"
    assert git(pr, "diff", "--name-only", "origin/main...HEAD").split() == ["notes.txt"]
    every_file_ever = git(pr, "log", "--all", "--name-only", "--format=")
    assert "tools/eval" not in every_file_ever
    assert len(git(pr, "branch", "-a").splitlines()) == 2  # the case branch and origin/main


def test_trusted_files_come_from_the_trusted_commit(tmp_path, case):
    # Settings and hooks are loaded at the root and run next to the token: never from the rules under test.
    root = tmp_path / "work"
    root.mkdir()
    ev.build_run_folder(root, "HEAD", ev.base_commit(), case, trusted=ev.base_commit())
    for p in ev.TRUSTED_PATHS:
        tracked = ev.git("ls-tree", "-r", "--name-only", ev.base_commit(), "--", p, cwd=ev.REPO_ROOT).split()
        for f in tracked:
            assert (root / f).read_text() == ev.git("show", f"{ev.base_commit()}:{f}", cwd=ev.REPO_ROOT)
    assert ".claude/settings.json" in ev.TRUSTED_PATHS and ".claude/hooks" in ev.TRUSTED_PATHS


def test_review_input_like_collect_inputs(folder):
    root, sha = folder
    ri = root / "review-input"
    pr = json.loads((ri / "pr.json").read_text())
    assert pr["number"] == 999 and pr["title"] == "Add notes" and pr["headRefName"] == "claude/notes"
    assert set(pr) == {"number", "title", "body", "author", "labels", "headRefName", "baseRefName", "url"}
    assert (ri / "files.txt").read_text().strip() == "notes.txt"
    assert "+hello" in (ri / "diff.patch").read_text()
    assert json.loads((ri / "ci.json").read_text())["headSha"] == sha
    assert "Tests  380 passed" in (ri / "ci-tests.txt").read_text()


def test_claude_command_matches_the_job_and_isolates(tmp_path):
    s = ev.read_review_settings(REVIEW_YML)
    cmd = ev.claude_command(s, "PROMPT", "{}")
    assert cmd[:3] == ["claude", "-p", "PROMPT"]
    assert cmd[cmd.index("--allowedTools") + 1] == s["allowed"]
    assert cmd[cmd.index("--disallowedTools") + 1] == s["disallowed"]
    assert cmd[cmd.index("--setting-sources") + 1] == "project"
    assert "--strict-mcp-config" in cmd and "--no-session-persistence" in cmd
    deny = json.loads(cmd[cmd.index("--settings") + 1])["permissions"]["deny"]
    assert f"Read(/{ev.REPO_ROOT.parent}/**)" in deny


def test_clean_env_keeps_only_what_the_run_needs(tmp_path, monkeypatch):
    monkeypatch.setenv("SOME_WORK_SECRET", "x")
    env = ev.clean_env("tok", tmp_path, {"CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"})
    assert set(env) == {"PATH", "HOME", "TMPDIR", "CLAUDE_CODE_TMPDIR", "LANG", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR",
                        "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"}
    assert env["CLAUDE_CONFIG_DIR"] == str(tmp_path)
    assert env["HOME"] == str(tmp_path / "home") != os.environ.get("HOME")


def test_sandbox_blocks_home_repo_and_other_runs_but_not_claude_or_its_own_run():
    own = ev.RUNS_TMP / "run-abc"
    profile = ev.sandbox_profile(ev.Path("/Users/someone"), own, ["/srv/repo", "/srv/repo/.git"])
    runs = os.path.realpath(ev.RUNS_TMP)
    assert (f'(deny file-read* file-write* (subpath "/Users/someone") (subpath "{runs}") (subpath "/srv/repo") '
            f'(subpath "/srv/repo/.git") (regex') in profile
    assert '(allow file-read* (subpath "/Users/someone/.local/bin") (subpath "/Users/someone/.local/share/claude"))' in profile
    assert profile.splitlines()[-1] == f'(allow file-read* file-write* (subpath "{os.path.realpath(own)}"))'
    assert ev.sandboxed(["claude"], own)[:2] == ["sandbox-exec", "-p"]


def test_repo_dirs_include_the_git_folder():
    dirs = ev.repo_dirs()
    assert os.path.realpath(ev.REPO_ROOT) in dirs
    assert any(os.path.isfile(os.path.join(d, "HEAD")) for d in dirs)  # the git folder itself


@pytest.mark.skipif(not shutil.which("sandbox-exec"), reason="macOS only")
def test_sandbox_really_blocks_the_repo_and_other_runs():
    # No Claude here: plain cat under the same profile, so it's quick and costs nothing.
    ev.RUNS_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ev.RUNS_TMP) as own, tempfile.TemporaryDirectory(dir=ev.RUNS_TMP) as other:
        (Path(own) / "mine.txt").write_text("mine")
        (Path(other) / "theirs.txt").write_text("theirs")

        def cat(path):
            return subprocess.run(ev.sandboxed(["/bin/cat", str(path)], Path(own)), capture_output=True, text=True)

        assert cat(Path(own) / "mine.txt").stdout == "mine"
        assert cat(Path(other) / "theirs.txt").returncode != 0
        assert cat(ev.EVAL_DIR / "cases" / "BASE").returncode != 0


def test_fetch_head_does_not_name_the_real_repo(folder):
    root, _ = folder
    assert not (root / "pr" / ".git" / "FETCH_HEAD").exists()
    assert str(ev.REPO_ROOT) not in (root / "pr" / ".git" / "config").read_text()
