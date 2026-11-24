"""Rule fixes (plan item E2d, decision D27): the steps .github/workflows/rule-fix.yml runs that need no AI.
Python's built-in library only.

    python3 rule_fix.py pick --latest A/results.json --previous B/results.json     which case to fix, or nothing
    python3 rule_fix.py judge --pr P/results.json --main M/results.json --case b04  did the try look better?
    python3 rule_fix.py copy --ref SHA --main SHA --case b04 --details D.json --out DIR [--failed REASONS]
    python3 rule_fix.py changes --before DIR --after DIR --out DIR                  what the AI changed, checked
    python3 rule_fix.py sanitise < why.md                                           safe text for the PR

The AI only ever gets the folder `copy` makes: no tools/eval/ (so no hidden cases and no answers), no .github/,
no git history. Everything that writes to GitHub happens in jobs without AI, and only after `changes` has checked
that just the allowed rule files changed.
"""
from __future__ import annotations

import argparse
import filecmp
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import eval_review as ev

# The only files a rule fix may change: the text the code reviewer reads (D27). Never workflows, settings, allowed
# tools, the cases or the eval (D26: those always come from main and aren't evaluated).
ALLOWED = ("docs/REVIEW-CHECKLIST.md", "tools/review/prompts/code.md")
WHY = "fix-input/why.md"
MAX_CHANGED_LINES = 200
SECRETS = re.compile(r"sk-ant-|gh[pousr]_[A-Za-z0-9]{10,}|ghs_|github_pat_|-----BEGIN")
LEFT_OUT = ("tools/eval", ".github")  # never in the copy
# Settings and hooks run next to the token, and the agent's own instructions must be main's: always from main.
FROM_MAIN = ("CLAUDE.md", "tools/review/prompts/rule-fix.md", *ev.TRUSTED_PATHS)


# ---------- What an eval keeps (written by ci_eval.py report) ----------

def results(scored: list[dict], meta: dict) -> dict:
    """Per visible case: counts. Hidden cases: one total only (D25)."""
    def counts(runs: list[dict]) -> dict:
        return {"runs": len(runs), "caught": sum(s["outcome"] == "caught" for s in runs),
                "missed": sum(s["outcome"] == "missed" for s in runs), "weak": sum(bool(s["weak"]) for s in runs),
                "false_alarms": sum(s["false_alarms"] for s in runs),
                "errors": sum(s["outcome"] == "error" for s in runs)}
    cases: dict[str, dict] = {}
    for s in scored:
        if not s["hidden"]:
            cases.setdefault(s["case"], {"kind": s["kind"], "_runs": []})["_runs"].append(s)
    visible = {cid: {"kind": c["kind"], **counts(c["_runs"])} for cid, c in sorted(cases.items())}
    hidden = [s for s in scored if s["hidden"]]
    return {"meta": meta, "cases": visible, "hidden": counts(hidden)}


def details(records: list[dict], scored: list[dict]) -> list[dict]:
    """What the reviewer said on each visible run: the fix agent learns from the misses. Never hidden cases."""
    out = []
    for r, s in zip(records, scored):
        if r["hidden"]:
            continue
        review = r.get("review") if isinstance(r.get("review"), dict) else {}
        titles = lambda key: [str(f.get("title", ""))[:200] for f in review.get(key, []) if isinstance(f, dict)]  # noqa: E731
        out.append({"case": r["case"], "run": r["run"], "outcome": s["outcome"], "weak": s["weak"],
                    "blocking": titles("blocking"), "suggestions": titles("suggestions")})
    return out


# ---------- When to try, and whether a try worked ----------

def missed(res: dict) -> dict[str, int]:
    return {cid: c["missed"] for cid, c in res["cases"].items() if c["kind"] != "clean" and c["missed"] > 0}


def pick(latest: dict, previous: dict) -> str | None:
    """The visible bug case missed in both evals (most missed first), or None."""
    a, b = missed(latest), missed(previous)
    both = sorted(set(a) & set(b), key=lambda c: (-(a[c] + b[c]), c))
    return both[0] if both else None


def judge(pr: dict, main: dict, case: str) -> tuple[bool, list[str]]:
    """Reasons it failed (empty = it looks better). Reasons never give hidden numbers: the agent may read them."""
    reasons = []
    c = pr["cases"].get(case)
    if not c:
        return False, [f"{case} wasn't in the eval"]
    if c["missed"] or c["errors"] or c["caught"] < c["runs"]:
        reasons.append(f"{case} was caught in {c['caught']} of {c['runs']} runs (needs all)")

    def caught(res: dict, hidden: bool) -> int:
        if hidden:
            return res["hidden"]["caught"]
        return sum(x["caught"] for cid, x in res["cases"].items() if cid != case and x["kind"] != "clean")

    def alarms(res: dict) -> int:
        return res["hidden"]["false_alarms"] + sum(x["false_alarms"] for x in res["cases"].values())

    if caught(pr, False) < caught(main, False) or caught(pr, True) < caught(main, True):
        reasons.append("other bug cases were caught less often than on main")
    if alarms(pr) > alarms(main):
        reasons.append("there were more false alarms than on main")
    if pr["hidden"]["errors"] or any(x["errors"] for x in pr["cases"].values()):
        reasons.append("some review runs errored")
    return not reasons, reasons


# ---------- What to do now (rule-fix.yml's decide job) ----------

WAIT_HOURS = 4  # a rule-fix PR's eval should have come by then
BRANCH = re.compile(r"^rule-fix/([a-z][0-9]{2})-[0-9]+$")


def _full(r: dict) -> bool:
    m = r.get("meta") or {}
    return m.get("cases") == "all" and str(m.get("runs")) == "3"


def _hours(since: str, now: str) -> float:
    from datetime import datetime
    parse = lambda t: datetime.fromisoformat(t.replace("Z", "+00:00"))  # noqa: E731
    return (parse(now) - parse(since)).total_seconds() / 3600


def state(results: list[dict], prs: list[dict], attempts: set[str], main_fp: str, now: str,
          case: str | None = None) -> dict:
    """One action from the repo's state, never from a single event (D27), so a lost or repeated event can't skip
    or double a step. results: eval-result contents (+ "artifact" {id, created_at}), newest first. prs: open
    rule-fix PRs {number, sha, ref, labels, head_date, judged (shas), stale}. attempts: "case:main_fp" markers.

    Actions: none, try (case, result), judge-pass / retry / needs-you (pr, reasons)."""
    if not main_fp or main_fp == "-":
        return {"action": "none", "why": "main's fingerprint is unknown (no eval result with a model yet)"}
    full = [r for r in results if _full(r)]
    # Results stand for content, not for how they ran: after a rules PR is squash-merged, main has the PR's
    # fingerprint and its daily eval is skipped, so the PR's own eval is main's. A fingerprint main had (now or as
    # some eval's main) is a main state; keep the newest result of each, newest first.
    fps = {main_fp} | {r["meta"].get("main_fingerprint") for r in full}
    newest: dict[str, dict] = {}
    for r in full:
        newest.setdefault(r["meta"].get("fingerprint"), r)
    mains = [r for fp, r in newest.items() if fp in fps]
    if prs:
        pr = sorted(prs, key=lambda x: x["number"])[0]
        m = BRANCH.match(pr["ref"])
        base = {"pr": pr["number"], "ref": pr["ref"], "sha": pr["sha"], "case": m.group(1) if m else ""}
        if case:
            return {"action": "none", "why": f"rule-fix PR #{pr['number']} is still open"}
        if pr["sha"] in pr.get("judged", []):
            labels = pr.get("labels", [])
            if "rule-fix-try-2" in labels and "needs-you" not in labels:  # try 2 started but pushed nothing
                return {**base, "action": "needs-you", "reasons": ["try 2 didn't push a change"]}
            return {"action": "none", "why": "already judged"}
        if not m:
            return {**base, "action": "needs-you", "reasons": ["the branch name isn't a rule-fix branch"]}
        if pr.get("stale"):
            return {**base, "action": "needs-you", "reasons": ["main's rules changed since this PR was made"]}
        mine = [r for r in full if r["meta"].get("mode") == "pr" and str(r["meta"].get("number")) == str(pr["number"])
                and r["meta"].get("rules") == pr["sha"]]
        if not mine:
            if _hours(pr["head_date"], now) >= WAIT_HOURS:
                return {**base, "action": "needs-you", "reasons": ["no clean eval came for this commit"]}
            return {"action": "none", "why": "waiting for the PR's eval"}
        ref = [r for r in full if r["meta"].get("fingerprint") == mine[0]["meta"].get("main_fingerprint")]
        if not ref:
            return {**base, "action": "needs-you", "reasons": ["there's no eval of main to compare with"]}
        ok, reasons = judge(mine[0], ref[0], base["case"])
        if ok:
            return {**base, "action": "judge-pass", "reasons": []}
        if {"rule-fix-try-2", "rule-fix-practice"} & set(pr.get("labels", [])):  # a practice run has one try
            return {**base, "action": "needs-you", "reasons": reasons}
        # Main's numbers to compare with; what the reviewer said comes from the PR's own eval (try 1's rules).
        return {**base, "action": "retry", "reasons": reasons, "result": ref[0]["artifact"]["id"],
                "said": mine[0]["artifact"]["id"]}
    if not mains:
        return {"action": "none", "why": "no full eval of main yet"}
    if case:
        if case not in mains[0]["cases"] or mains[0]["cases"][case]["kind"] == "clean":
            return {"action": "none", "why": f"{case} isn't a visible bug case"}
    else:
        if len(mains) < 2 or mains[0]["meta"]["fingerprint"] != main_fp:
            return {"action": "none", "why": "no two full evals of main as it is now"}
        case = pick(mains[0], mains[1])
        if not case:
            return {"action": "none", "why": "no miss repeats"}
    if f"{case}:{main_fp}" in attempts:
        return {"action": "none", "why": f"{case} was already tried for main as it is now"}
    return {"action": "try", "case": case, "result": mains[0]["artifact"]["id"]}


# ---------- The AI's folder ----------

def hidden_ids() -> list[str]:
    return sorted(c["id"] for c in ev.load_cases() if c["hidden"])


def _extract(ref: str, dest: Path, paths: list[str] | None = None) -> None:
    r = subprocess.run(["git", "archive", "--format=tar", ref, *(paths or [])], cwd=ev.REPO_ROOT,
                       capture_output=True, env=ev.GIT_ENV, check=True)
    _untar(io.BytesIO(r.stdout), dest)


def _untar(fileobj, dest: Path) -> None:
    """Unpack only plain files and folders with safe names, so a tar file the AI wrote can't put a link or a file
    outside dest before `changes` looks at it. Anything else refuses the whole file."""
    with tarfile.open(fileobj=fileobj) as tar:
        for m in tar.getmembers():
            parts = Path(m.name).parts
            if not (m.isfile() or m.isdir()) or m.name.startswith("/") or ".." in parts:
                raise SystemExit(f"refused: {m.name!r} in the tar file isn't a plain file or folder")
        # The "data" filter as well where Python has it (3.12 on GitHub).
        tar.extractall(dest, **({"filter": "data"} if hasattr(tarfile, "data_filter") else {}))


def leaks(folder: Path, ids: list[str]) -> list[str]:
    """Anything in the AI's folder that could show a hidden case or an answer."""
    found = [str(p.relative_to(folder)) for p in folder.rglob("*")
             if p.name in ("case.json", ".git") or (p.name == "eval" and p.parent.name == "tools")
             or (p.name == ".github" and p.parent == folder)]
    # The docs name the hidden folder, which is fine; a hidden case's id appears nowhere outside tools/eval/.
    words = re.compile(r"\b(" + "|".join(map(re.escape, ids)) + r")\b") if ids else None
    for p in folder.rglob("*"):
        if words and p.is_file() and not p.is_symlink() and words.search(p.read_text(encoding="utf-8", errors="replace")):
            found.append(f"{p.relative_to(folder)} mentions a hidden case")
    return found


def copy(ref: str, main: str, case: str, details_rows: list[dict], main_res: dict, out: Path,
         failed: list[str] | None = None, practice: bool = False) -> None:
    """out/: the repo at `ref` without LEFT_OUT and without history, rule settings from main, plus fix-input/."""
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    _extract(ref, out)
    for p in LEFT_OUT:
        shutil.rmtree(out / p, ignore_errors=True)
    for p in FROM_MAIN:
        target = out / p
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        if ev.git("ls-tree", "--name-only", main, "--", p, cwd=ev.REPO_ROOT).strip():
            _extract(main, out, [p])
    the_case = next(c for c in ev.load_cases([case]) if not c["hidden"])
    fin = out / "fix-input"
    fin.mkdir()
    # The PR the reviewer saw, and what it should have blocked. Never the scoring words (expect.match): a fix
    # should teach the reviewer the problem, not the words that score.
    (fin / "case.diff").write_bytes((the_case["dir"] / "change.patch").read_bytes())
    expect = the_case["expect"]
    (fin / "task.json").write_text(json.dumps({
        "case": case, "pr_title": the_case.get("title", ""), "pr_body": the_case.get("body", ""),
        "what_was_planted": the_case.get("why", ""), "file": expect.get("file"), "kind": expect["kind"],
        "runs": [d for d in details_rows if d["case"] == case],
        "main": {cid: c for cid, c in main_res["cases"].items()},  # visible numbers only
        "last_try_failed_because": failed or [],
        "practice": practice,
    }, indent=2), encoding="utf-8")
    bad = leaks(out, hidden_ids())
    if bad:
        raise SystemExit(f"the AI's folder would show hidden cases: {bad}")


# ---------- What the AI changed ----------

def changes(before: Path, after: Path, out: Path) -> list[str]:
    """Copy the allowed changed files (plus why.md) to out/. Refuses anything else the AI touched, except new empty
    files (Claude Code's sandbox leaves empty placeholders such as .env and yarn.lock; they're never pushed).
    No change at all is an answer, not a refusal: the AI explains in why.md (e.g. the case isn't missed)."""
    problems, changed, ignored = [], [], []

    def walk(root: Path) -> dict[str, Path]:
        return {str(p.relative_to(root)): p for p in root.rglob("*") if not p.is_dir() or p.is_symlink()}
    a, b = walk(before), walk(after)
    for rel in sorted(set(a) | set(b)):
        if rel == WHY:
            continue
        pa, pb = a.get(rel), b.get(rel)
        if pa and pb and not pa.is_symlink() and not pb.is_symlink() and filecmp.cmp(pa, pb, shallow=False) \
                and pa.stat().st_mode == pb.stat().st_mode:
            continue
        if not pa and pb and not pb.is_symlink() and pb.is_file() and pb.stat().st_size == 0 and rel not in ALLOWED:
            ignored.append(rel)
            continue
        if rel not in ALLOWED:
            problems.append(f"{rel}: not a file a rule fix may change")
        elif not (pa and pb) or pa.is_symlink() or pb.is_symlink() or not pb.is_file():
            problems.append(f"{rel}: added, deleted or not a plain file")
        elif pa.stat().st_mode != pb.stat().st_mode:
            problems.append(f"{rel}: its mode changed")
        else:
            changed.append(rel)
    lines = 0
    for rel in changed:
        old = a[rel].read_text(encoding="utf-8").splitlines()
        new = b[rel].read_text(encoding="utf-8").splitlines()
        lines += abs(len(new) - len(old)) + sum(1 for x, y in zip(old, new) if x != y)
        if SECRETS.search(b[rel].read_text(encoding="utf-8")) and not SECRETS.search(a[rel].read_text(encoding="utf-8")):
            problems.append(f"{rel}: looks like it contains a secret")
    if lines > MAX_CHANGED_LINES:
        problems.append(f"{lines} changed lines (at most {MAX_CHANGED_LINES})")
    if ignored:  # on stderr, so the run log shows them but the list of changed files stays clean
        print("ignored new empty files: " + ", ".join(ignored), file=sys.stderr)
    if problems:
        raise SystemExit("refused: " + "; ".join(problems))
    for rel in changed:
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(b[rel], out / rel)
    why = b.get(WHY)
    text = why.read_text(encoding="utf-8", errors="replace") if why and why.is_file() and not why.is_symlink() else ""
    (out / "why.md").write_text(sanitise(text) or "_The rule-fix run gave no reason._", encoding="utf-8")
    return changed


def sanitise(text: str) -> str:
    """AI text for a PR body: no mentions, no issue-closing keywords, no secrets, short."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "[picture removed]", text)  # nothing loads from elsewhere
    text = re.sub(r"\[([^\]]*)\]\(([^)]*)\)", r"\1", text)  # links: just their text
    text = text.replace("<", "&lt;")  # no raw HTML: no pictures from elsewhere, no hidden text
    text = text.replace("@", "@​")
    text = re.sub(r"(?i)\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b(\s*:?\s*)#", r"\1\3#​", text)
    text = SECRETS.sub("[removed]", text)
    return text[:4000].strip()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("pick")
    k.add_argument("--latest", type=Path, required=True)
    k.add_argument("--previous", type=Path, required=True)
    j = sub.add_parser("judge")
    j.add_argument("--pr", type=Path, required=True)
    j.add_argument("--main", type=Path, required=True)
    j.add_argument("--case", required=True)
    c = sub.add_parser("copy")
    c.add_argument("--ref", required=True)
    c.add_argument("--main", required=True)
    c.add_argument("--case", required=True)
    c.add_argument("--details", type=Path, required=True)
    c.add_argument("--main-results", type=Path, required=True)
    c.add_argument("--failed", default="", help="why the last try failed, one reason per line")
    c.add_argument("--out", type=Path, required=True)
    c.add_argument("--practice", action="store_true", help="by hand: the case is caught; one small general improvement")
    g = sub.add_parser("changes")
    g.add_argument("--before", type=Path, required=True)
    g.add_argument("--after", type=Path, required=True)
    g.add_argument("--out", type=Path, required=True)
    sub.add_parser("sanitise")
    u = sub.add_parser("untar")
    u.add_argument("--file", type=Path, required=True)
    u.add_argument("--dest", type=Path, required=True)
    t = sub.add_parser("state")
    t.add_argument("--results", type=Path, required=True, help="folder of <artifact id>.json, each with 'artifact'")
    t.add_argument("--prs", type=Path, required=True)
    t.add_argument("--attempts", type=Path, required=True, help="one 'case:main_fp' per line")
    t.add_argument("--main-fp", required=True)
    t.add_argument("--now", required=True)
    t.add_argument("--case", default="")
    a = p.parse_args(argv)
    load = lambda f: json.loads(f.read_text(encoding="utf-8"))  # noqa: E731

    if a.cmd == "pick":
        print(pick(load(a.latest), load(a.previous)) or "")
    elif a.cmd == "judge":
        ok, reasons = judge(load(a.pr), load(a.main), a.case)
        print(json.dumps({"pass": ok, "reasons": reasons}))
    elif a.cmd == "copy":
        copy(a.ref, a.main, a.case, load(a.details), load(a.main_results), a.out,
             [r for r in a.failed.splitlines() if r.strip()], a.practice)
    elif a.cmd == "changes":
        a.out.mkdir(parents=True, exist_ok=True)
        print("\n".join(changes(a.before, a.after, a.out)))
    elif a.cmd == "state":
        rows = [load(f) for f in a.results.glob("*.json")]
        rows.sort(key=lambda r: r["artifact"]["created_at"], reverse=True)
        attempts = set(a.attempts.read_text(encoding="utf-8").split())
        print(json.dumps(state(rows, load(a.prs), attempts, a.main_fp, a.now, a.case or None)))
    elif a.cmd == "untar":
        a.dest.mkdir(parents=True, exist_ok=True)
        with a.file.open("rb") as f:
            _untar(f, a.dest)
    elif a.cmd == "sanitise":
        print(sanitise(sys.stdin.read()))


if __name__ == "__main__":
    main()
