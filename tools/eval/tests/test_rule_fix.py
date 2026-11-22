"""Tests for rule_fix.py, the rule-fix loop's steps without AI. These never start Claude."""
import json
import os

import pytest

import ci_eval
import eval_review as ev
import rule_fix as rf


def scored(case, outcome, hidden=False, kind="bug", weak=False, alarms=0, run=1):
    return {"case": case, "run": run, "hidden": hidden, "kind": kind, "outcome": outcome, "weak": weak,
            "false_alarms": alarms, "models": ["claude-sonnet-5-5"]}


def res(cases, hidden=None):
    """results.json from {case: (kind, caught, missed, false_alarms)}."""
    out = {"meta": {}, "cases": {}, "hidden": {"runs": 9, "caught": 2, "missed": 4, "weak": 4, "false_alarms": 0,
                                               "errors": 0, **(hidden or {})}}
    for cid, (kind, caught, miss, alarms) in cases.items():
        out["cases"][cid] = {"kind": kind, "runs": 3, "caught": caught, "missed": miss, "weak": miss,
                             "false_alarms": alarms, "errors": 0}
    return out


def test_results_count_visible_cases_and_only_a_hidden_total():
    s = [scored("b04", "caught"), scored("b04", "missed", weak=True, run=2), scored("b03", "missed", hidden=True),
         scored("c01", "false alarm", kind="clean", alarms=2), scored("c03", "clean", hidden=True, kind="clean")]
    r = rf.results(s, {"mode": "main"})
    assert r["cases"]["b04"] == {"kind": "bug", "runs": 2, "caught": 1, "missed": 1, "weak": 1, "false_alarms": 0,
                                 "errors": 0}
    assert r["cases"]["c01"]["false_alarms"] == 2
    assert "b03" not in json.dumps(r["cases"]) and "c03" not in json.dumps(r)
    assert r["hidden"] == {"runs": 2, "caught": 0, "missed": 1, "weak": 0, "false_alarms": 0, "errors": 0}
    assert r["meta"] == {"mode": "main"}


def test_details_never_include_hidden_cases():
    records = [{"case": "b04", "run": 1, "hidden": False,
                "review": {"blocking": [], "suggestions": [{"title": "Caches 404s"}]}},
               {"case": "b03", "run": 1, "hidden": True, "review": {"blocking": [{"title": "secret"}]}},
               {"case": "b05", "run": 1, "hidden": False, "review": None}]
    s = [scored("b04", "missed", weak=True), scored("b03", "caught", hidden=True), scored("b05", "error")]
    d = rf.details(records, s)
    assert [x["case"] for x in d] == ["b04", "b05"]
    assert d[0]["suggestions"] == ["Caches 404s"] and d[0]["weak"] and d[1]["blocking"] == []


def test_pick_needs_the_same_miss_twice():
    a = res({"b04": ("bug", 2, 1, 0), "b06": ("bug", 1, 2, 0), "c01": ("clean", 0, 0, 0)})
    b = res({"b04": ("bug", 2, 1, 0), "b06": ("bug", 3, 0, 0)})
    assert rf.pick(a, b) == "b04"
    assert rf.pick(a, res({"b06": ("bug", 2, 1, 0), "b04": ("bug", 1, 2, 0)})) == "b04"  # tie (3 each): by name
    assert rf.pick(a, res({"b06": ("bug", 1, 2, 0), "b04": ("bug", 2, 1, 0)})) == "b06"  # most missed first
    assert rf.pick(a, res({"b04": ("bug", 3, 0, 0)})) is None


def test_judge():
    main = res({"b04": ("bug", 2, 1, 0), "b05": ("bug", 3, 0, 0), "c01": ("clean", 0, 0, 0)})
    good = res({"b04": ("bug", 3, 0, 0), "b05": ("bug", 3, 0, 0), "c01": ("clean", 0, 0, 0)})
    assert rf.judge(good, main, "b04") == (True, [])
    ok, why = rf.judge(res({"b04": ("bug", 2, 1, 0), "b05": ("bug", 3, 0, 0), "c01": ("clean", 0, 0, 0)}), main, "b04")
    assert not ok and "caught in 2 of 3" in why[0]
    ok, why = rf.judge(res({"b04": ("bug", 3, 0, 0), "b05": ("bug", 2, 1, 0), "c01": ("clean", 0, 0, 0)}), main, "b04")
    assert not ok and "other bug cases" in why[0]
    ok, why = rf.judge(res({"b04": ("bug", 3, 0, 0), "b05": ("bug", 3, 0, 0)}, {"caught": 1}), main, "b04")
    assert not ok and why == ["other bug cases were caught less often than on main"]
    ok, why = rf.judge(res({"b04": ("bug", 3, 0, 0), "b05": ("bug", 3, 0, 0), "c01": ("clean", 0, 0, 1)}), main, "b04")
    assert not ok and "false alarms" in why[0]
    # Reasons the agent may read never carry hidden numbers.
    assert not any(ch.isdigit() for r in why for ch in r)
    assert rf.judge(good, main, "b99")[0] is False


def test_copy_has_no_eval_no_workflows_no_history_and_mains_settings(tmp_path):
    out = tmp_path / "copy"
    main = res({"b04": ("bug", 2, 1, 0)})
    rf.copy("HEAD", "HEAD", "b04", [{"case": "b04", "run": 1, "outcome": "missed"},
                                    {"case": "b05", "run": 1, "outcome": "caught"}], main, out, ["it got worse"])
    assert not (out / "tools" / "eval").exists() and not (out / ".github").exists() and not (out / ".git").exists()
    assert (out / "CLAUDE.md").read_text() == ev.at_commit("HEAD", ev.REPO_ROOT / "CLAUDE.md")
    assert (out / "docs" / "REVIEW-CHECKLIST.md").is_file() and (out / "tools" / "review" / "prompts" / "code.md").is_file()
    task = json.loads((out / "fix-input" / "task.json").read_text())
    assert task["case"] == "b04" and task["what_was_planted"] and [r["case"] for r in task["runs"]] == ["b04"]
    assert task["last_try_failed_because"] == ["it got worse"]
    assert "match" not in json.dumps(task)  # never the scoring words
    assert (out / "fix-input" / "case.diff").read_text().startswith("diff --git")
    assert rf.leaks(out, rf.hidden_ids()) == []
    with pytest.raises(StopIteration):
        rf.copy("HEAD", "HEAD", rf.hidden_ids()[0], [], main, tmp_path / "x")  # never a hidden case


def test_leaks_finds_hidden_things(tmp_path):
    (tmp_path / "tools" / "eval").mkdir(parents=True)
    (tmp_path / ".github").mkdir()
    (tmp_path / "a.md").write_text("see case b03 for details")
    (tmp_path / "b.md").write_text("colour #b03a2e and the cases-hidden folder are fine")
    found = rf.leaks(tmp_path, ["b03"])
    assert "tools/eval" in found and ".github" in found and "a.md mentions a hidden case" in found
    assert not any(f.startswith("b.md") for f in found)


def tree(root, files):
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text)


def two(tmp_path, before, after):
    a, b = tmp_path / "a", tmp_path / "b"
    tree(a, before)
    tree(b, after)
    return a, b


BASE = {"docs/REVIEW-CHECKLIST.md": "one\ntwo\n", "tools/review/prompts/code.md": "prompt\n", "CLAUDE.md": "rules\n"}


def test_changes_keeps_allowed_files_and_why(tmp_path):
    a, b = two(tmp_path, BASE, {**BASE, "docs/REVIEW-CHECKLIST.md": "one\ntwo\nthree\n",
                                "fix-input/why.md": "Because @someone said; fixes #3"})
    out = tmp_path / "out"
    out.mkdir()
    assert rf.changes(a, b, out) == ["docs/REVIEW-CHECKLIST.md"]
    assert (out / "docs" / "REVIEW-CHECKLIST.md").read_text().endswith("three\n")
    why = (out / "why.md").read_text()
    assert "@someone" not in why and "#3" not in why.replace("#​3", "")


@pytest.mark.parametrize("after,problem", [
    ({**BASE, "CLAUDE.md": "new rules\n"}, "not a file a rule fix may change"),
    ({**BASE, ".claude/settings.json": "{}"}, "not a file a rule fix may change"),
    ({k: v for k, v in BASE.items() if k != "tools/review/prompts/code.md"}, "added, deleted"),
    (BASE, "nothing changed"),
    ({**BASE, "docs/REVIEW-CHECKLIST.md": "one\ntwo\nsk-ant-oat01-abcdef\n"}, "secret"),
    ({**BASE, "docs/REVIEW-CHECKLIST.md": "x\n" * 300}, "changed lines"),
    ({**BASE, "docs/REVIEW-CHECKLIST.md.bak": "x\n"}, "not a file a rule fix may change"),
])
def test_changes_refuses(tmp_path, after, problem):
    a, b = two(tmp_path, BASE, after)
    with pytest.raises(SystemExit, match=problem):
        rf.changes(a, b, tmp_path / "out")


def test_changes_refuses_symlinks_and_mode_changes(tmp_path):
    a, b = two(tmp_path, BASE, BASE)
    target = b / "docs" / "REVIEW-CHECKLIST.md"
    target.unlink()
    target.symlink_to(b / "CLAUDE.md")
    with pytest.raises(SystemExit, match="not a plain file"):
        rf.changes(a, b, tmp_path / "out")
    a2, b2 = two(tmp_path / "m", BASE, {**BASE, "tools/review/prompts/code.md": "prompt\nmore\n"})
    os.chmod(b2 / "tools/review/prompts/code.md", 0o755)
    with pytest.raises(SystemExit, match="mode changed"):
        rf.changes(a2, b2, tmp_path / "out2")


def test_sanitise():
    assert rf.sanitise("Closes #12, resolved: #4, @claude do it, token ghp_abcdefghijklmnop") == (
        "Closes #​12, resolved: #​4, @​claude do it, token [removed]")


def test_report_writes_results_and_details(tmp_path):
    runs = tmp_path / "runs"
    (runs / "run-01").mkdir(parents=True)
    plan = ci_eval.slots("b05", 1, salt="x")
    result = {"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 0.1, "num_turns": 5,
              "duration_ms": 20000, "modelUsage": {"claude-sonnet-5-5": {"costUSD": 0.1}},
              "structured_output": {"summary": "s", "blocking": [{"title": "Uses an absolute path /sw.js",
                                                                  "evidence": ""}], "suggestions": []}}
    (runs / "run-01" / "saved.json").write_text(json.dumps({"result": result}))
    ci_eval.report(runs, plan, tmp_path / "out", {"action_cli": "x"}, {"mode": "pr", "number": 7})
    r = json.loads((tmp_path / "out" / "results.json").read_text())
    assert r["cases"]["b05"]["caught"] == 1 and r["meta"] == {"mode": "pr", "number": 7, "model": "claude-sonnet-5-5"}
    d = json.loads((tmp_path / "out" / "details.json").read_text())
    assert d[0]["blocking"] == ["Uses an absolute path /sw.js"]
