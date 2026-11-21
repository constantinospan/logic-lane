"""Scoring and the report for the eval (plan item E2b, decision D25).

Learning mode: the owner writes `score_run` and `report` (marked YOUR PART below), from the outlines in their
docstrings, until `uv run pytest tests/test_score.py -v` passes. Claude wrote the rest and reviews your part.

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
  record["raw"]      the full answer from `claude -p` (has "total_cost_usd", "num_turns", "duration_ms"), or None
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


# ---------- YOUR PART 1 ----------

def score_run(record: dict) -> dict:
    """Score one run. Return a dict with these keys:

      "case", "run", "hidden"   copied from the record
      "kind"                    record["expect"]["kind"]
      "outcome"                 one of:
         "error"        the record has an "error", or "review" is None or not a dict
         "caught"       (bug or claim cases) a Blocking finding matches the planted problem: matches(...)
         "missed"       (bug or claim cases) no Blocking finding matches
         "clean"        (clean cases) no Blocking findings at all
         "false alarm"  (clean cases) at least one Blocking finding
      "weak"                    True only when the outcome is "missed" but a Suggestion matches (the reviewer
                                noticed, but the PR would still pass). False otherwise.
      "false_alarms"            clean cases: how many Blocking findings. Other cases: 0.
      "extra"                   bug and claim cases: Blocking findings that are NOT part of the catch. For a bug
                                case, a Blocking finding is part of the catch if it matches OR is in the planted
                                file (in_file(finding, expect["file"])): one bug often gets several right
                                findings. For a claim case, only matching counts. Clean and error runs: 0.
      plus everything cost(record) returns ("cost_usd", "turns", "seconds")

    Every result has all the keys above, error runs too: an error run still cost time and money.

    Hints: start with the "error" check and return early (still with the cost keys). `review.get("blocking", [])` gives the list.
    Python's `any(... for f in findings)` is True if any item passes, `sum(1 for f in findings if ...)` counts.
    `{**a, **b}` merges two dicts.
    """
    raise NotImplementedError("Your part: see the docstring, and tests/test_score.py")


# ---------- YOUR PART 2 ----------

def report(scored: list[dict], meta: dict) -> str:
    """A short markdown report of a whole eval, from the score_run results. It must have:

    1. A heading line: "## Eval report"
    2. A line with the Claude versions: "Claude Code: <meta['local_cli']> (GitHub: <meta['action_cli']>)"
    3. A table with one row per case that is NOT hidden, in case order:
         | Case | Kind | Runs | Caught | Missed | Weak | False alarms | Errors |
       - Runs: how many runs that case had.
       - Caught / Missed / Errors: how many runs had that outcome.
       - Weak: how many runs had weak = True.
       - False alarms: the sum of "false_alarms" over its runs.
    4. A "Hidden cases" line, counts only, never their ids: e.g.
         "Hidden cases: 3 cases, 9 runs: 5 caught, 2 missed, 0 false alarms, 2 errors"
       where "false alarms" is the sum of "false_alarms" (like the table), and the other counts are runs.
       (one total for all hidden cases together, so nothing about a single hidden case leaks).
    5. A "Totals" section with these lines, over ALL runs (hidden included):
         "Bugs caught: X of Y runs (Z%)"           Y = bug and claim runs that aren't errors; Z rounded to a
                                                   whole number, 0 if Y is 0
         "False alarms on clean cases: N in M runs"   N = sum of false_alarms, M = clean runs that aren't errors
         "Extra findings on bug cases: E"            sum of "extra"
         "Errors: K of T runs"
         "Cost: $C.CC, turns: U, time: V min"       sums; C with 2 decimals, V rounded to a whole number

    Hints: build a list of lines and finish with "\\n".join(lines) + "\\n". A dict of lists, filled in a loop
    (`by_case.setdefault(s["case"], []).append(s)`), groups runs by case. f"{x:.2f}" gives 2 decimals.
    """
    raise NotImplementedError("Your part: see the docstring, and tests/test_score.py")
