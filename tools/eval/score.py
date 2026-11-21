"""Scoring and the report for the eval (plan item E2b, decision D25).

Written by Claude (the owner chose automation over writing it, 2026-11-21). tests/test_score.py pins down
exactly what each function must do.

A "record" is one saved run (out/<time>/<case>-<run>.json), made by eval_review.py. The parts you need:
  record["case"]     the case id, e.g. "b01"
  record["run"]      1, 2 or 3
  record["hidden"]   True for hidden cases
  record["expect"]   what the case plants:
                       {"kind": "bug", "file": "js/core/storage.js", "match": ["localstorage", ...]}
                       {"kind": "claim", "match": [...]}      a false claim in the PR description
                       {"kind": "clean"}                      nothing wrong
  record["review"]   the reviewer's answer, or None if it didn't give one (always present, maybe None):
                       {"summary": "...", "blocking": [finding, ...], "suggestions": [finding, ...], ...}
                     where a finding is {"title": "...", "evidence": "...", "where": "file:line"} ("where" may
                     be missing)
  record["error"]    only there if the run crashed or timed out
  record["raw"]      the full answer from `claude -p` (has "total_cost_usd", "num_turns", "duration_ms",
                     "modelUsage"), or None
  record["denials"]  how many tool calls were blocked (like the job's "Blocked tool calls" step), maybe missing
"""
from __future__ import annotations

import json
from pathlib import Path


# ---------- Helpers (Claude's part) ----------

def load_runs(folder: Path) -> list[dict]:
    """Every run record in an output folder, in case/run order."""
    return [json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(Path(folder).glob("*-*.json"))]


def finding_text(finding: dict) -> str:
    """A finding's title, evidence and location as one lowercase string, for matching."""
    return " ".join(str(finding.get(k, "")) for k in ("title", "evidence", "where")).lower()


def matches(finding: dict, expect: dict) -> bool:
    """Is this finding about the planted problem? Any of the case's match words appears in it."""
    text = finding_text(finding)
    return any(word.lower() in text for word in expect.get("match", []))


def in_file(finding: dict, path: str) -> bool:
    """Does this finding point at the given file?"""
    return path.lower() in finding_text(finding)


def cost(record: dict) -> dict:
    """Cost, turns and time of a run, from the raw answer (zeros if it's missing)."""
    raw = record.get("raw") if isinstance(record.get("raw"), dict) else {}
    return {"cost_usd": float(raw.get("total_cost_usd") or 0), "turns": int(raw.get("num_turns") or 0),
            "seconds": float(record.get("seconds") or 0)}


def models(record: dict) -> list[str]:
    """The models a run used, from the raw answer."""
    raw = record.get("raw") if isinstance(record.get("raw"), dict) else {}
    return sorted(raw.get("modelUsage") or {})


# ---------- Scoring one run ----------

def score_run(record: dict) -> dict:
    """Score one run. Returns:

      "case", "run", "hidden"   copied from the record
      "kind"                    record["expect"]["kind"]
      "outcome"                 "error"        the run crashed, timed out, or gave no review
                                "caught"       bug/claim case: a Blocking finding matches the planted problem
                                "missed"       bug/claim case: no Blocking finding matches
                                "clean"        clean case: no Blocking findings
                                "false alarm"  clean case: at least one Blocking finding
      "weak"                    missed, but a Suggestion matches (noticed, yet the PR would still pass)
      "false_alarms"            clean cases: how many Blocking findings
      "extra"                   bug/claim cases: Blocking findings that aren't part of the catch. On a bug case,
                                a finding that matches OR points at the planted file is part of the catch (one
                                bug often gets several right findings).
      "cost_usd", "turns", "seconds"   from cost(record); error runs cost something too
      "denials"                 blocked tool calls (0 if unknown): a run that lost its tools may review less
      "models"                  from models(record)
    """
    expect = record["expect"]
    result = {"case": record["case"], "run": record["run"], "hidden": record["hidden"], "kind": expect["kind"],
              "weak": False, "false_alarms": 0, "extra": 0, **cost(record),
              "denials": int(record.get("denials") or 0), "models": models(record)}

    review = record.get("review")
    if record.get("error") or not isinstance(review, dict):
        return {**result, "outcome": "error"}

    blocking = review.get("blocking", [])
    if expect["kind"] == "clean":
        return {**result, "outcome": "false alarm" if blocking else "clean", "false_alarms": len(blocking)}

    def part_of_the_catch(finding: dict) -> bool:
        return matches(finding, expect) or (expect["kind"] == "bug" and in_file(finding, expect["file"]))

    caught = any(matches(f, expect) for f in blocking)
    weak = not caught and any(matches(f, expect) for f in review.get("suggestions", []))
    extra = sum(1 for f in blocking if not part_of_the_catch(f))
    return {**result, "outcome": "caught" if caught else "missed", "weak": weak, "extra": extra}


# ---------- The report ----------

def _count(runs: list[dict], outcome: str) -> int:
    return sum(1 for s in runs if s["outcome"] == outcome)


def report(scored: list[dict], meta: dict) -> str:
    """A short markdown report of a whole eval: a table per visible case, one combined line for the hidden cases
    (counts only, never their ids, so nothing about a single hidden case leaks), and totals over every run."""
    used = sorted({m for s in scored for m in s.get("models", [])})
    lines = ["## Eval report", "",
             f"Claude Code: {meta['local_cli']} (GitHub: {meta['action_cli']})",
             f"Model: {', '.join(used) or 'unknown'}", "",
             "| Case | Kind | Runs | Caught | Missed | Weak | False alarms | Errors |",
             "|---|---|---|---|---|---|---|---|"]

    by_case: dict[str, list[dict]] = {}
    for s in scored:
        by_case.setdefault(s["case"], []).append(s)
    for case in sorted(by_case):
        runs = by_case[case]
        if runs[0]["hidden"]:
            continue
        lines.append(f"| {case} | {runs[0]['kind']} | {len(runs)} | {_count(runs, 'caught')} | "
                     f"{_count(runs, 'missed')} | {sum(1 for s in runs if s['weak'])} | "
                     f"{sum(s['false_alarms'] for s in runs)} | {_count(runs, 'error')} |")

    hidden = [s for s in scored if s["hidden"]]
    lines += ["", f"Hidden cases: {len({s['case'] for s in hidden})} cases, {len(hidden)} runs: "
                  f"{_count(hidden, 'caught')} caught, {_count(hidden, 'missed')} missed "
                  f"({sum(1 for s in hidden if s['weak'])} weak), "
                  f"{sum(s['false_alarms'] for s in hidden)} false alarms, {_count(hidden, 'error')} errors"]

    bugs = [s for s in scored if s["kind"] != "clean" and s["outcome"] != "error"]
    clean = [s for s in scored if s["kind"] == "clean" and s["outcome"] != "error"]
    percent = round(100 * _count(bugs, "caught") / len(bugs)) if bugs else 0
    lines += ["", "### Totals",
              f"Bugs caught: {_count(bugs, 'caught')} of {len(bugs)} runs ({percent}%)",
              f"False alarms on clean cases: {sum(s['false_alarms'] for s in clean)} in {len(clean)} runs",
              f"Extra findings on bug cases: {sum(s['extra'] for s in scored)}",
              f"Errors: {_count(scored, 'error')} of {len(scored)} runs",
              f"Blocked tool calls: {sum(s['denials'] for s in scored)} in "
              f"{sum(1 for s in scored if s['denials'])} runs",
              f"Cost: ${sum(s['cost_usd'] for s in scored):.2f}, turns: {sum(s['turns'] for s in scored)}, "
              f"time: {round(sum(s['seconds'] for s in scored) / 60)} min"]
    return "\n".join(lines) + "\n"
