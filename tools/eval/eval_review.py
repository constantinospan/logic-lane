"""Runs the real AI code reviewer on the eval cases, the same way GitHub does (plan item E2b, decision D25).

  uv run python eval_review.py                     every case, 3 runs each
  uv run python eval_review.py --cases b01,c02     only these cases
  uv run python eval_review.py --runs 1            fewer runs (cheaper, for trying things out)

Add --system-certs to `uv run` on a work Mac. Needs the eval's own Claude login (see README, "The eval's login").

For each run it builds a throwaway folder that looks like the code-review job's (see build_run_folder), starts
`claude -p` there with the job's own prompt, result format and tool limits (read from review.yml), and saves what
comes back to out/<time>/<case>-<run>.json. score.py then turns those files into a report.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVAL_DIR.parent.parent
CASE_DIRS = {"cases": False, "cases-hidden": True}  # folder name -> hidden?
OUT_DIR = EVAL_DIR / "out"
REVIEW_YML = REPO_ROOT / ".github" / "workflows" / "review.yml"
SCHEMA = REPO_ROOT / "tools" / "review" / "schema.json"
OWNER = "constantinospan"
REPO = "constantinospan/logic-lane"
KEYCHAIN_SERVICE = "logic-lane-eval"  # where the eval's login token is kept (README)
RUN_TIMEOUT_S = 30 * 60  # the code-review job's timeout
RUNS_TMP = Path("/private/tmp/ll-eval-runs")  # throwaway run folders, outside the home folder (the sandbox blocks it)
# The files the eval is testing (and E2d's rule fixes change). The run folder's root is main's code as of BASE,
# like the PR's own base, with only these taken from the rules commit.
RULE_PATHS = ["CLAUDE.md", ".claude", "docs/REVIEW-CHECKLIST.md", "docs/DECISIONS.md", "tools/review"]
# git for building run folders: none of the owner's own git settings, which could change diffs or commits.
GIT_ENV = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "en_US.UTF-8",
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"}


# ---------- Cases ----------

def load_cases(only: list[str] | None = None) -> list[dict]:
    """Every case (hidden ones too), each with 'dir' and 'hidden' added. `only` picks cases by id."""
    cases = []
    for folder, hidden in CASE_DIRS.items():
        for case_json in sorted((EVAL_DIR / folder).glob("*/case.json")):
            case = json.loads(case_json.read_text(encoding="utf-8"))
            case["dir"] = case_json.parent
            case["hidden"] = hidden
            cases.append(case)
    if only:
        missing = set(only) - {c["id"] for c in cases}
        if missing:
            raise SystemExit(f"No such case: {', '.join(sorted(missing))}")
        cases = [c for c in cases if c["id"] in only]
    return sorted(cases, key=lambda c: c["id"])


def base_commit() -> str:
    return (EVAL_DIR / "cases" / "BASE").read_text(encoding="utf-8").strip()


# ---------- The review job's settings, read from review.yml (so the eval can't drift from it) ----------

def _job_block(yml: str, job: str) -> str:
    """The text of one job in a workflow file: from '  <job>:' to the next job at the same indent."""
    m = re.search(rf"^  {re.escape(job)}:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", yml, re.M | re.S)
    if not m:
        raise ValueError(f"review.yml has no '{job}' job")
    return m.group(1)


def _key_block(block: str, key: str) -> list[str]:
    """The indented lines under a YAML key written as `key: |` or `key: >-`."""
    m = re.search(rf"^( *){re.escape(key)}: [|>]-?\n", block, re.M)
    if not m:
        raise ValueError(f"no '{key}:' block")
    indent = len(m.group(1))
    lines = []
    for line in block[m.end():].splitlines():
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        lines.append(line.strip())
    return lines


def at_commit(commit: str, path: Path) -> str:
    """A file's text as it is in a commit (so --rules evaluates that commit's settings too, not the working tree's)."""
    return git("show", f"{commit}:{path.relative_to(REPO_ROOT).as_posix()}", cwd=REPO_ROOT)


def read_review_settings(yml: str) -> dict:
    """The code-review job's prompt, turn limit and tool lists.

    Returns {"prompt": str, "max_turns": int, "allowed": str, "disallowed": str, "env": {name: value}}.
    """
    job = _job_block(yml, "code-review")
    prompt = "\n".join(_key_block(job, "prompt")).strip()
    args = shlex.split(" ".join(_key_block(job, "claude_args")))
    def value(flag: str) -> str:
        if flag not in args or args.index(flag) + 1 >= len(args):
            raise ValueError(f"claude_args has no {flag}")
        return args[args.index(flag) + 1]
    env = dict(re.findall(r"^      ([A-Z][A-Z0-9_]+): '?([^'\n]*)'?$", job.split("steps:")[0], re.M))
    return {"prompt": prompt, "max_turns": int(value("--max-turns")), "allowed": value("--allowedTools"),
            "disallowed": value("--disallowedTools"), "env": env}


def fill_prompt(prompt: str, number: int, sha: str) -> str:
    out = prompt.replace("${{ needs.gate.outputs.number }}", str(number))
    out = out.replace("${{ needs.gate.outputs.sha }}", sha)
    if "${{" in out:
        raise ValueError(f"unfilled placeholder in the review prompt: {out}")
    return out


# ---------- CI inputs: a real green run, with the case's own test counts ----------

def parse_local_check(text: str) -> dict:
    """Test counts from `npm run check` output: unit files and tests, browser tests (passed + skipped locally)."""
    def num(pattern: str) -> int:
        m = re.search(pattern, text)
        if not m:
            raise ValueError(f"no match for {pattern!r} in local-check.txt")
        return int(m.group(1))
    # Playwright's summary ends with a time, e.g. "183 passed (35.6s)" or "74 passed (1.1m)"; vitest's doesn't.
    browser = num(r"(?m)^\s*(\d+) passed \([\d.]+m?s?\)$")
    if m := re.search(r"(?m)^\s*(\d+) skipped$", text):
        browser += int(m.group(1))
    return {"files": num(r"Test Files +(\d+) passed"), "tests": num(r"Tests +(\d+) passed"), "browser": browser}


def ci_inputs(template_json: dict, template_lines: list[str], counts: dict, head_sha: str) -> tuple[dict, str]:
    """ci.json and ci-tests.txt for a case: the template's shape, the case's counts and commit."""
    ci = json.loads(json.dumps(template_json))
    ci["headSha"] = head_sha
    for j in ci.get("jobs", []):
        if "headSha" in j:
            j["headSha"] = head_sha
    # One "N passed (time)" line per browser test shard in the template.
    shards = sum(1 for line in template_lines if re.search(r"\d+ passed \(\d", line) and "Test" not in line) or 1
    per = [counts["browser"] // shards + (1 if i < counts["browser"] % shards else 0) for i in range(shards)]
    out, b = [], 0
    for line in template_lines:
        if "Test Files" in line:
            line = re.sub(r"Test Files +\d+ passed \(\d+\)", f"Test Files  {counts['files']} passed ({counts['files']})", line)
        elif re.search(r"Tests +\d+ passed", line):
            line = re.sub(r"Tests +\d+ passed \(\d+\)", f"Tests  {counts['tests']} passed ({counts['tests']})", line)
        elif re.search(r"\d+ passed \(", line):
            line = re.sub(r"\d+ passed \(", f"{per[b]} passed (", line, count=1)
            b += 1
        out.append(line)
    return ci, "\n".join(out) + "\n"


# ---------- The throwaway folder ----------

def git(*args: str, cwd: Path | None = None, input: bytes | None = None) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, input=input, capture_output=True, env=GIT_ENV)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.decode(errors='replace').strip()[:300]}")
    return r.stdout.decode(errors="replace")


def build_run_folder(root: Path, rules_commit: str, base: str, case: dict) -> str:
    """Make `root` look like the code-review job's folder. Returns the case commit's SHA.

    ./            main as the reviewer sees it: a plain copy (git archive) of BASE, which is also pr/'s
                  origin/main, with RULE_PATHS replaced by rules_commit's (the rules being evaluated). Without
                  tools/eval/, so the reviewer can never read the cases or their answers. Not a worktree: a
                  worktree points back to this repo.
    pr/           BASE's history only, origin/main = BASE, plus one commit with the case's change.
    review-input/ what tools/review/collect-inputs.sh writes.
    """
    def extract(commit: str, *paths: str) -> None:
        archive = subprocess.run(["git", "archive", commit, "--", *paths], cwd=REPO_ROOT, capture_output=True,
                                 check=True, env=GIT_ENV).stdout
        subprocess.run(["tar", "-x", "-C", str(root)], input=archive, check=True)

    extract(base)
    for p in RULE_PATHS:
        target = root / p
        shutil.rmtree(target, ignore_errors=True) if target.is_dir() else target.unlink(missing_ok=True)
    present = [p for p in RULE_PATHS if git("ls-tree", "--name-only", rules_commit, "--", p, cwd=REPO_ROOT).strip()]
    extract(rules_commit, *present)
    shutil.rmtree(root / "tools" / "eval", ignore_errors=True)

    pr = root / "pr"
    pr.mkdir()
    git("init", "-q", "-b", "main", cwd=pr)
    git("fetch", "-q", "--no-tags", str(REPO_ROOT), base, cwd=pr)
    (pr / ".git" / "FETCH_HEAD").unlink(missing_ok=True)  # it names the real repo's folder
    git("update-ref", "refs/remotes/origin/main", base, cwd=pr)
    git("checkout", "-q", "-b", case["branch"], base, cwd=pr)
    git("apply", "--index", str(case["dir"] / "change.patch"), cwd=pr)
    git("-c", "user.name=claude[bot]", "-c", "user.email=noreply@anthropic.com",
        "commit", "-q", "-m", case["title"], cwd=pr)
    sha = git("rev-parse", "HEAD", cwd=pr).strip()

    ri = root / "review-input"
    ri.mkdir()
    pr_json = {"number": case["number"], "title": case["title"], "body": case["body"],
               "author": {"is_bot": False, "login": OWNER}, "labels": [], "headRefName": case["branch"],
               "baseRefName": "main", "url": f"https://github.com/{REPO}/pull/{case['number']}"}
    (ri / "pr.json").write_text(json.dumps(pr_json), encoding="utf-8")
    (ri / "files.txt").write_text(git("diff", "--name-only", "--no-renames", "origin/main...HEAD", cwd=pr))
    (ri / "diff-stat.txt").write_text(git("diff", "--no-renames", "--stat", "origin/main...HEAD", cwd=pr))
    (ri / "diff.patch").write_text(git("diff", "--no-renames", "origin/main...HEAD", cwd=pr))
    template = json.loads((EVAL_DIR / "templates" / "ci.json").read_text(encoding="utf-8"))
    lines = (EVAL_DIR / "templates" / "ci-tests.txt").read_text(encoding="utf-8").splitlines()
    counts = parse_local_check((case["dir"] / "local-check.txt").read_text(encoding="utf-8"))
    ci, tests = ci_inputs(template, lines, counts, sha)
    (ri / "ci.json").write_text(json.dumps(ci), encoding="utf-8")
    (ri / "ci-tests.txt").write_text(tests, encoding="utf-8")
    if (case["dir"] / "idea-brief.md").exists():
        shutil.copy(case["dir"] / "idea-brief.md", ri / "idea-brief.md")
    return sha


# ---------- Running the reviewer ----------

def eval_token() -> str:
    """The eval's own Claude login token: env EVAL_CLAUDE_TOKEN, else macOS Keychain (README)."""
    if os.environ.get("EVAL_CLAUDE_TOKEN"):
        return os.environ["EVAL_CLAUDE_TOKEN"]
    r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit("No eval login token. See README, 'The eval's login'.")
    return r.stdout.strip()


def claude_command(settings: dict, prompt: str, schema: str) -> list[str]:
    # Extra, local only: deny Claude's file tools the real repo's folder. The sandbox below is the real guard.
    projects = str(REPO_ROOT.parent)
    deny = {"permissions": {"deny": [f"{tool}(/{projects}/**)" for tool in ("Read", "Glob", "Grep")]}}
    return ["claude", "-p", prompt,
            "--max-turns", str(settings["max_turns"]),
            "--json-schema", schema,
            "--allowedTools", settings["allowed"],
            "--disallowedTools", settings["disallowed"],
            "--output-format", "json",
            "--setting-sources", "project",
            "--settings", json.dumps(deny),
            "--strict-mcp-config",
            "--no-session-persistence"]


def repo_dirs() -> list[str]:
    """This repo's folder and its git folder (for a worktree, the main clone's .git), real paths."""
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=REPO_ROOT).strip()
    return [os.path.realpath(REPO_ROOT), os.path.realpath(common)]


def sandbox_profile(real_home: Path, own_run: Path, repo: list[str]) -> str:
    """A macOS sandbox rule set: the run may not read or write the owner's home folder (notes, Claude memory),
    this repo (the cases and their answers) wherever it is, or other runs' folders (other cases, hidden ones
    included), except Claude Code's own program files and its own run folder. Covers every command the reviewer
    starts, Bash included. Claude's scratch folders under /tmp/claude-* are blocked too. Later rules win."""
    home, runs, own = str(real_home), os.path.realpath(RUNS_TMP), os.path.realpath(own_run)
    allowed = [f"{home}/.local/bin", f"{home}/.local/share/claude"]
    denied = [home, runs, *repo]
    return "\n".join([
        "(version 1)",
        "(allow default)",
        "(deny file-read* file-write* " + " ".join(f'(subpath "{p}")' for p in denied)
        + ' (regex #"^/private/tmp/claude-"))',
        "(allow file-read* " + " ".join(f'(subpath "{p}")' for p in allowed) + ")",
        f'(allow file-read-metadata (literal "{home}") (literal "{runs}"))',
        f'(allow file-read* file-write* (subpath "{own}"))',
    ])


def sandboxed(cmd: list[str], own_run: Path) -> list[str]:
    return ["sandbox-exec", "-p", sandbox_profile(Path.home(), own_run, repo_dirs()), *cmd]


def clean_env(token: str, config_dir: Path, job_env: dict) -> dict:
    """Only what the run needs: none of the owner's own settings, keys or tokens. HOME is an empty folder of the
    run's own, so nothing (Claude, git) reads the owner's."""
    home, tmp = config_dir / "home", config_dir / "tmp"
    home.mkdir(exist_ok=True)
    tmp.mkdir(exist_ok=True)  # Claude's own scratch goes here, not in the shared /tmp/claude-<user> (blocked)
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "TMPDIR": str(tmp), "CLAUDE_CODE_TMPDIR": str(tmp),
           "LANG": "en_US.UTF-8",
           "CLAUDE_CODE_OAUTH_TOKEN": token, "CLAUDE_CONFIG_DIR": str(config_dir)}
    env.update(job_env)  # e.g. CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, as the job sets it
    return env


def run_one(case: dict, n: int, rules_commit: str, base: str, settings: dict, token: str, out: Path) -> dict:
    """One review of one case. Never raises: problems are saved as an error result."""
    started = time.time()
    record = {"case": case["id"], "run": n, "hidden": case["hidden"], "expect": case["expect"],
              "rules_commit": rules_commit, "base": base, "review": None, "raw": None}
    RUNS_TMP.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="run-", dir=RUNS_TMP) as tmp:
        root, config = Path(tmp) / "work", Path(tmp) / "config"
        root.mkdir()
        config.mkdir()
        try:
            sha = build_run_folder(root, rules_commit, base, case)
            prompt = fill_prompt(settings["prompt"], case["number"], sha)
            schema = json.dumps(json.loads(at_commit(rules_commit, SCHEMA)), separators=(",", ":"))
            r = subprocess.run(sandboxed(claude_command(settings, prompt, schema), Path(tmp)), cwd=root,
                               capture_output=True, text=True,
                               env=clean_env(token, config, settings["env"]), timeout=RUN_TIMEOUT_S)
            record["exit_code"] = r.returncode
            record["stderr"] = r.stderr[-2000:]
            try:
                raw = json.loads(r.stdout)
            except ValueError:
                raw = {"unparsed_stdout": r.stdout[-4000:]}
            record["raw"] = raw
            record["review"] = raw.get("structured_output") if isinstance(raw, dict) else None
            # Like the job's "Blocked tool calls" step: a run that lost its tools still "succeeds", so count them.
            record["denials"] = len(raw.get("permission_denials") or []) if isinstance(raw, dict) else None
        except subprocess.TimeoutExpired:
            record["error"] = "timeout"
        except Exception as e:  # saved, never fatal: the report counts it as an error run
            record["error"] = f"{type(e).__name__}: {e}"[:1000]
    record["seconds"] = round(time.time() - started, 1)
    (out / f"{case['id']}-{n}.json").write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
    return record


def versions() -> dict:
    """The local Claude Code version, and what the pinned action runs (best effort, via gh).

    The action doesn't install the Claude Code CLI itself; it uses the Claude Agent SDK, so its SDK version is
    recorded. GitHub's logs don't show the model the review used: confirming it is an E2c task.
    """
    local = subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.strip()
    action = "unknown"
    m = re.search(r"anthropics/claude-code-action@([0-9a-f]{40})", REVIEW_YML.read_text(encoding="utf-8"))
    if m:
        r = subprocess.run(["gh", "api", f"repos/anthropics/claude-code-action/contents/package.json?ref={m.group(1)}",
                            "-q", ".content"], capture_output=True, text=True)
        if r.returncode == 0:
            import base64
            deps = json.loads(base64.b64decode(r.stdout)).get("dependencies", {})
            if "@anthropic-ai/claude-agent-sdk" in deps:
                action = f"agent-sdk {deps['@anthropic-ai/claude-agent-sdk']}"
    return {"local_cli": local, "action_cli": action}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--cases", help="comma-separated case ids (default: all)")
    p.add_argument("--runs", type=int, default=3, help="runs per case (default 3)")
    p.add_argument("--rules", default="HEAD", help="commit whose rules to evaluate (default: HEAD)")
    p.add_argument("--jobs", type=int, default=2, help="runs at the same time (default 2)")
    a = p.parse_args(argv)

    cases = load_cases(a.cases.split(",") if a.cases else None)
    rules = git("rev-parse", a.rules, cwd=REPO_ROOT).strip()
    settings = read_review_settings(at_commit(rules, REVIEW_YML))
    token = eval_token()
    out = OUT_DIR / datetime.datetime.now().strftime("%Y-%m-%d-%H%M%S")
    out.mkdir(parents=True)
    meta = {"rules_commit": rules, "base": base_commit(), "runs": a.runs, "cases": [c["id"] for c in cases],
            "settings": {k: v for k, v in settings.items() if k != "prompt"}, **versions()}
    (out / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"{len(cases)} cases x {a.runs} runs -> {out}", file=sys.stderr)

    jobs = [(c, n) for c in cases for n in range(1, a.runs + 1)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
        futures = [pool.submit(run_one, c, n, rules, meta["base"], settings, token, out) for c, n in jobs]
        for i, f in enumerate(concurrent.futures.as_completed(futures), 1):
            r = f.result()
            status = r.get("error") or ("ok" if r.get("review") else "no result")
            print(f"[{i}/{len(jobs)}] {r['case']} run {r['run']}: {status} ({r['seconds']}s)", file=sys.stderr)

    import score  # turns the run files into a report
    report = score.report([score.score_run(r) for r in score.load_runs(out)], meta)
    (out / "report.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
