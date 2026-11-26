"""Tests for score.py: what each scoring rule and the report must do. Run:

    uv run pytest tests/test_score.py -v
"""
import score

BUG = {"kind": "bug", "file": "games/demo/game.js", "match": ["localstorage", "storage module"]}
CLAIM = {"kind": "claim", "match": ["no test", "claims"]}
CLEAN = {"kind": "clean"}
RAW = {"total_cost_usd": 0.5, "num_turns": 12, "duration_ms": 90000, "modelUsage": {"claude-sonnet-5-5": {}}}


def f(title, evidence="", where=None):
    out = {"title": title, "evidence": evidence}
    if where:
        out["where"] = where
    return out


def rec(expect, blocking=(), suggestions=(), case="b01", run=1, hidden=False, **extra):
    r = {"case": case, "run": run, "hidden": hidden, "expect": expect, "raw": RAW, "seconds": 120,
         "review": {"summary": "s", "blocking": list(blocking), "suggestions": list(suggestions)}}
    r.update(extra)
    return r


# ---------- score_run ----------

def test_bug_caught():
    s = score.score_run(rec(BUG, [f("Uses localStorage directly", "games/demo/game.js:40")]))
    assert s["outcome"] == "caught"
    assert s["weak"] is False
    assert s["extra"] == 0
    assert s["false_alarms"] == 0


def test_copies_case_run_hidden_kind_and_cost():
    s = score.score_run(rec(BUG, case="b03", run=2, hidden=True))
    assert (s["case"], s["run"], s["hidden"], s["kind"]) == ("b03", 2, True, "bug")
    assert (s["cost_usd"], s["turns"], s["seconds"]) == (0.5, 12, 120)


def test_matching_ignores_case_and_reads_evidence_and_where():
    s = score.score_run(rec(BUG, [f("Saving bypasses the STORAGE MODULE")]))
    assert s["outcome"] == "caught"
    s = score.score_run(rec(BUG, [f("Problem", "it calls localStorage.setItem")]))
    assert s["outcome"] == "caught"


def test_bug_missed():
    s = score.score_run(rec(BUG, [], [f("Nice code")]))
    assert s["outcome"] == "missed"
    assert s["weak"] is False


def test_bug_only_a_suggestion_is_weak_miss():
    s = score.score_run(rec(BUG, [], [f("Maybe avoid localStorage here")]))
    assert s["outcome"] == "missed"
    assert s["weak"] is True


def test_other_findings_in_the_planted_file_are_part_of_the_catch():
    s = score.score_run(rec(BUG, [f("Uses localStorage"), f("Key has no prefix", "", "games/demo/game.js:41")]))
    assert s["outcome"] == "caught"
    assert s["extra"] == 0


def test_findings_elsewhere_on_a_bug_case_are_extra():
    s = score.score_run(rec(BUG, [f("Uses localStorage"), f("Typo in sw.js", "", "sw.js:3")]))
    assert s["outcome"] == "caught"
    assert s["extra"] == 1
    assert s["false_alarms"] == 0


def test_a_miss_can_still_have_extra_findings():
    s = score.score_run(rec(BUG, [f("Typo in sw.js", "", "sw.js:3")]))
    assert s["outcome"] == "missed"
    assert s["extra"] == 1


def test_claim_caught_and_missed():
    assert score.score_run(rec(CLAIM, [f("Description claims tests that aren't there")]))["outcome"] == "caught"
    assert score.score_run(rec(CLAIM, [f("Unrelated")]))["outcome"] == "missed"


def test_claim_case_has_no_planted_file():
    s = score.score_run(rec(CLAIM, [f("Description claims a test"), f("Other", "", "js/app.js:1")]))
    assert s["outcome"] == "caught"
    assert s["extra"] == 1


def test_clean_case_passes():
    s = score.score_run(rec(CLEAN, [], [f("Could add a comment")]))
    assert s["outcome"] == "clean"
    assert s["false_alarms"] == 0
    assert s["extra"] == 0
    assert s["weak"] is False


def test_clean_case_false_alarms_are_counted():
    s = score.score_run(rec(CLEAN, [f("A"), f("B")]))
    assert s["outcome"] == "false alarm"
    assert s["false_alarms"] == 2


def test_error_run():
    s = score.score_run(rec(BUG, error="timeout"))
    assert s["outcome"] == "error"
    assert (s["extra"], s["false_alarms"], s["weak"]) == (0, 0, False)
    assert (s["case"], s["kind"], s["cost_usd"], s["turns"]) == ("b01", "bug", 0.5, 12)


def test_crashed_run_as_saved_by_the_eval():
    # What eval_review.py saves when a run crashes before Claude answers.
    r = {"case": "c01", "run": 1, "hidden": False, "expect": CLEAN, "review": None, "raw": None,
         "error": "RuntimeError: git apply failed", "seconds": 2}
    s = score.score_run(r)
    assert s["outcome"] == "error" and s["cost_usd"] == 0 and s["turns"] == 0


def test_no_review_is_an_error():
    r = rec(CLEAN)
    r["review"] = None
    assert score.score_run(r)["outcome"] == "error"


def test_missing_cost_is_zero():
    r = rec(CLEAN)
    del r["raw"]
    s = score.score_run(r)
    assert (s["cost_usd"], s["turns"]) == (0, 0)


# ---------- report ----------

META = {"local_cli": "2.1.330 (Claude Code)", "action_cli": "2.1.300"}


def scored_set():
    runs = [
        rec(BUG, [f("Uses localStorage")], case="b01", run=1),
        rec(BUG, [], [f("localStorage maybe")], case="b01", run=2),
        rec(BUG, error="timeout", case="b01", run=3),
        rec(CLEAN, [f("Bogus")], case="c01", run=1),
        rec(CLEAN, [], case="c01", run=2, denials=1),
        rec(BUG, [f("Uses localStorage")], case="b03", run=1, hidden=True),
        rec(CLEAN, [f("X"), f("Y")], case="c03", run=1, hidden=True),
    ]
    return [score.score_run(r) for r in runs]


def test_report_heading_and_versions():
    text = score.report(scored_set(), META)
    assert text.splitlines()[0] == "## Eval report"
    assert "Claude Code: 2.1.330 (Claude Code) (GitHub: 2.1.300)" in text
    assert "Model: claude-sonnet-5-5" in text


def test_score_keeps_denials_and_models():
    s = score.score_run(rec(BUG, denials=2))
    assert s["denials"] == 2 and s["models"] == ["claude-sonnet-5-5"]
    r = rec(BUG)
    r["raw"] = None
    assert score.score_run(r)["denials"] == 0 and score.score_run(r)["models"] == []


def test_report_table_rows():
    lines = score.report(scored_set(), META).splitlines()
    header = [line for line in lines if line.startswith("| Case")]
    assert header == ["| Case | Kind | Runs | Caught | Missed | Weak | False alarms | Errors |"]
    rows = [[c.strip() for c in line.strip("|").split("|")] for line in lines
            if line.startswith("| b") or line.startswith("| c")]
    assert rows == [["b01", "bug", "3", "1", "1", "1", "0", "1"],
                    ["c01", "clean", "2", "0", "0", "0", "1", "0"]]


def test_report_hides_hidden_case_ids():
    text = score.report(scored_set(), META)
    assert "b03" not in text and "c03" not in text
    assert "Hidden cases: 2 cases, 2 runs: 1 caught, 0 missed (0 weak), 2 false alarms, 0 errors" in text


def test_report_totals():
    text = score.report(scored_set(), META)
    assert "Bugs caught: 2 of 3 runs (67%)" in text
    assert "False alarms on clean cases: 3 in 3 runs" in text
    assert "Extra findings on bug cases: 0" in text
    assert "Errors: 1 of 7 runs" in text
    assert "Blocked tool calls: 1 in 1 runs" in text
    assert "Cost: $3.50, turns: 84, time: 14.0 min" in text


def test_report_with_no_bug_runs_says_zero_percent():
    text = score.report([score.score_run(rec(CLEAN, case="c01"))], META)
    assert "Bugs caught: 0 of 0 runs (0%)" in text


def test_report_names_the_main_model_first_and_minutes_with_a_decimal():
    usage = {"claude-haiku-5-5": {"costUSD": 0.001}, "claude-sonnet-5-5": {"costUSD": 0.2}}
    r = {"case": "c04", "run": 1, "hidden": False, "expect": {"kind": "clean"}, "seconds": 42,
         "review": {"summary": "s", "blocking": [], "suggestions": []},
         "raw": {"modelUsage": usage, "total_cost_usd": 0.2, "num_turns": 3}}
    s = score.score_run(r)
    assert s["models"] == ["claude-sonnet-5-5", "claude-haiku-5-5"]
    text = score.report([s], {"local_cli": "x", "action_cli": "y"})
    assert "Model: claude-sonnet-5-5 (side steps: claude-haiku-5-5)" in text
    assert "time: 0.7 min" in text


def test_models_cope_with_a_missing_or_empty_cost():
    rec = {"raw": {"modelUsage": {"b": {"costUSD": None}, "a": {}, "c": {"costUSD": 0.5}, "d": "odd"}}}
    assert score.models(rec) == ["c", "a", "b", "d"]
