"""The eval on GitHub (plan item E2c, decision D26): the steps .github/workflows/eval.yml runs. Python's built-in
library only, so GitHub's machines need nothing installed.

    python3 ci_eval.py matrix --cases all --runs 3              the {case, run} list for the review jobs
    python3 ci_eval.py trigger < changed-files.txt              does a PR change what the code reviewer reads?
    python3 ci_eval.py fingerprint --rules SHA --main SHA --model M [--cases all --runs 3]
    python3 ci_eval.py prepare --rules SHA --main SHA --out DIR one run folder per case, without any answers
    python3 ci_eval.py report --runs DIR --matrix JSON --out DIR  score the runs, write report.md

The reviewer jobs never check out this repo: they get a prepared run folder, so the cases' answers are never on
the machine where Claude runs. Scoring happens afterwards, in a job without Claude.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import shutil
import sys
from pathlib import Path

import eval_review as ev
import score

# What decides an eval's result, besides the model. A PR touching any of it (except DECISIONS.md, which most PRs
# change) starts an eval; the fingerprint skips it when an eval with the same content already ran.
EVAL_FILES = ["tools/eval/cases", "tools/eval/cases-hidden", "tools/eval/templates", "tools/eval/eval_review.py",
              "tools/eval/score.py", "tools/eval/ci_eval.py"]
TRIGGER_PATHS = [p for p in ev.RULE_PATHS if p != "docs/DECISIONS.md"] + [".github/workflows/review.yml"]


def case_ids(spec: str) -> list[str] | None:
    return None if spec in ("", "all") else [c.strip() for c in spec.split(",") if c.strip()]


def matrix(spec: str, runs: int) -> list[dict]:
    return [{"case": c["id"], "run": n} for c in ev.load_cases(case_ids(spec)) for n in range(1, runs + 1)]


def triggers(changed: list[str]) -> bool:
    return any(f == p or f.startswith(p.rstrip("/") + "/") for f in changed for p in TRIGGER_PATHS)


def _object(commit: str, path: str) -> str:
    """The content hash of a file or folder at a commit, or '-' if it isn't there."""
    try:
        return ev.git("rev-parse", f"{commit}:{path}", cwd=ev.REPO_ROOT).strip()
    except RuntimeError:
        return "-"


def fingerprint(rules: str, main: str, model: str, spec: str = "all/3") -> str:
    """Content, never commit SHAs, so a squash-merged PR gets main's fingerprint. `spec` (cases/runs) keeps a small
    run by hand from ever standing in for a full one."""
    yml = ev.at_commit(rules, ev.REVIEW_YML)
    parts = [f"rules {p} {_object(rules, p)}" for p in ev.RULE_PATHS]
    parts += [f"trusted {p} {_object(main, p)}" for p in ev.TRUSTED_PATHS]
    parts += [f"eval {p} {_object(main, p)}" for p in EVAL_FILES]
    parts += ["code-review " + hashlib.sha256(ev._job_block(yml, "code-review").encode()).hexdigest(), f"model {model}", f"spec {spec}"]
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:20]


def claude_args(settings: dict, schema: str) -> str:
    """The action's claude_args, as the code-review job writes them."""
    return shlex.join(["--max-turns", str(settings["max_turns"]), "--json-schema", schema,
                       "--allowedTools", settings["allowed"], "--disallowedTools", settings["disallowed"]])


def leaks(folder: Path) -> list[str]:
    """Anything in a run folder that could give an answer away."""
    found = [str(p.relative_to(folder)) for p in folder.rglob("case.json")]
    found += [str(p.relative_to(folder)) for p in folder.rglob("eval") if p.is_dir() and p.parent.name == "tools"]
    return found


def prepare(rules: str, main: str, spec: str, out: Path) -> None:
    """out/<case>/work: the run folder. out/<case>/run.json: what the review job passes to the action."""
    settings = ev.read_review_settings(ev.at_commit(rules, ev.REVIEW_YML))
    schema = json.dumps(json.loads(ev.at_commit(rules, ev.SCHEMA)), separators=(",", ":"))
    base = ev.base_commit()
    for case in ev.load_cases(case_ids(spec)):
        folder = out / case["id"]
        work = folder / "work"
        shutil.rmtree(folder, ignore_errors=True)
        work.mkdir(parents=True)
        sha = ev.build_run_folder(work, rules, base, case, trusted=main)
        bad = leaks(work)
        if bad:
            raise SystemExit(f"{case['id']}: answers in the run folder: {bad}")
        run = {"case": case["id"], "prompt": ev.fill_prompt(settings["prompt"], case["number"], sha),
               "claude_args": claude_args(settings, schema), "env": settings["env"]}
        (folder / "run.json").write_text(json.dumps(run), encoding="utf-8")


def record(saved: dict, case: dict) -> dict:
    """A review job's saved result, as score.py reads it: the case's answer is only added here."""
    raw = saved.get("result") if isinstance(saved.get("result"), dict) else None
    review = raw.get("structured_output") if raw else None
    if isinstance(review, str):
        try:
            review = json.loads(review)
        except ValueError:
            review = None
    out = {"case": case["id"], "run": saved["run"], "hidden": case["hidden"], "expect": case["expect"],
           "review": review if isinstance(review, dict) else None, "raw": raw,
           "seconds": round((raw or {}).get("duration_ms", 0) / 1000, 1),
           "denials": len((raw or {}).get("permission_denials") or [])}
    if raw is None or raw.get("is_error"):
        out["error"] = "no result" if raw is None else f"error: {raw.get('subtype')}"
    return out


def report(runs: Path, wanted: list[dict], out: Path, meta: dict) -> tuple[str, int]:
    """Score every wanted run. A run with no saved result (the job crashed or timed out) is an error."""
    cases = {c["id"]: c for c in ev.load_cases()}
    records, models, versions = [], set(), set()
    for w in wanted:
        path = runs / f"run-{w['case']}-{w['run']}" / "saved.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        saved["run"] = w["run"]
        if saved.get("model"):
            models.add(saved["model"])
        if saved.get("version"):
            versions.add(saved["version"])
        records.append(record(saved, cases[w["case"]]))
    scored = [score.score_run(r) for r in records]
    meta = {**meta, "local_cli": ", ".join(sorted(versions)) or "unknown"}
    text = score.report(scored, meta)
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.md").write_text(text, encoding="utf-8")
    (out / "scored.json").write_text(json.dumps(scored, indent=1), encoding="utf-8")
    return text, sum(1 for s in scored if s["outcome"] == "error")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("matrix")
    m.add_argument("--cases", default="all")
    m.add_argument("--runs", type=int, default=3)
    sub.add_parser("trigger")
    f = sub.add_parser("fingerprint")
    f.add_argument("--rules", required=True)
    f.add_argument("--main", required=True)
    f.add_argument("--model", required=True)
    f.add_argument("--cases", default="all")
    f.add_argument("--runs", type=int, default=3)
    r = sub.add_parser("prepare")
    r.add_argument("--rules", required=True)
    r.add_argument("--main", required=True)
    r.add_argument("--cases", default="all")
    r.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("report")
    s.add_argument("--runs", type=Path, required=True)
    s.add_argument("--matrix", required=True, help="the matrix JSON")
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--action", default="claude-code-action", help="what ran the reviews, for the report")
    a = p.parse_args(argv)

    if a.cmd == "matrix":
        print(json.dumps(matrix(a.cases, a.runs), separators=(",", ":")))
    elif a.cmd == "trigger":
        print("true" if triggers(sys.stdin.read().split()) else "false")
    elif a.cmd == "fingerprint":
        print(fingerprint(a.rules, a.main, a.model, f"{a.cases}/{a.runs}"))
    elif a.cmd == "prepare":
        prepare(a.rules, a.main, a.cases, a.out)
    elif a.cmd == "report":
        text, errors = report(a.runs, json.loads(a.matrix), a.out, {"action_cli": a.action})
        print(text)
        if errors:
            print(f"{errors} run(s) errored", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
