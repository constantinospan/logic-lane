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
FROM_MAIN = ("CLAUDE.md", *ev.TRUSTED_PATHS)  # settings and hooks run next to the token: always main's


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


# ---------- The AI's folder ----------

def hidden_ids() -> list[str]:
    return sorted(c["id"] for c in ev.load_cases() if c["hidden"])


def _extract(ref: str, dest: Path, paths: list[str] | None = None) -> None:
    r = subprocess.run(["git", "archive", "--format=tar", ref, *(paths or [])], cwd=ev.REPO_ROOT,
                       capture_output=True, env=ev.GIT_ENV, check=True)
    data = r.stdout
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        # The "data" filter (no links out, no odd files) where Python has it (3.12 on GitHub).
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
         failed: list[str] | None = None) -> None:
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
    }, indent=2), encoding="utf-8")
    bad = leaks(out, hidden_ids())
    if bad:
        raise SystemExit(f"the AI's folder would show hidden cases: {bad}")


# ---------- What the AI changed ----------

def changes(before: Path, after: Path, out: Path) -> list[str]:
    """Copy the allowed changed files (plus why.md) to out/. Refuses anything else the AI touched."""
    problems, changed = [], []

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
    if not changed:
        problems.append("nothing changed")
    if lines > MAX_CHANGED_LINES:
        problems.append(f"{lines} changed lines (at most {MAX_CHANGED_LINES})")
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
    g = sub.add_parser("changes")
    g.add_argument("--before", type=Path, required=True)
    g.add_argument("--after", type=Path, required=True)
    g.add_argument("--out", type=Path, required=True)
    sub.add_parser("sanitise")
    a = p.parse_args(argv)
    load = lambda f: json.loads(f.read_text(encoding="utf-8"))  # noqa: E731

    if a.cmd == "pick":
        print(pick(load(a.latest), load(a.previous)) or "")
    elif a.cmd == "judge":
        ok, reasons = judge(load(a.pr), load(a.main), a.case)
        print(json.dumps({"pass": ok, "reasons": reasons}))
    elif a.cmd == "copy":
        copy(a.ref, a.main, a.case, load(a.details), load(a.main_results), a.out,
             [r for r in a.failed.splitlines() if r.strip()])
    elif a.cmd == "changes":
        a.out.mkdir(parents=True, exist_ok=True)
        print("\n".join(changes(a.before, a.after, a.out)))
    elif a.cmd == "sanitise":
        print(sanitise(sys.stdin.read()))


if __name__ == "__main__":
    main()
