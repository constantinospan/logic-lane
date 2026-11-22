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


def ev_result(fp, main_fp, cases, mode="daily", number="", rules="m1", when="2026-11-23T06:40:00Z", aid=1,
              hidden=None, spec=("all", "3")):
    r = res(cases, hidden)
    r["meta"] = {"mode": mode, "number": number, "rules": rules, "fingerprint": fp, "main_fingerprint": main_fp,
                 "cases": spec[0], "runs": spec[1]}
    r["artifact"] = {"id": aid, "created_at": when}
    return r


MISS = {"b04": ("bug", 2, 1, 0), "b05": ("bug", 3, 0, 0), "c01": ("clean", 0, 0, 0)}
GOOD = {"b04": ("bug", 3, 0, 0), "b05": ("bug", 3, 0, 0), "c01": ("clean", 0, 0, 0)}
NOW = "2026-11-24T08:00:00Z"


def pr(**k):
    return {"number": 70, "sha": "s1", "ref": "rule-fix/b04-123", "labels": ["rule-fix", "rule-fix-try-1"],
            "head_date": "2026-11-24T07:00:00Z", "judged": [], "stale": False, **k}


def test_state_starts_a_try_only_on_a_repeat_for_main_as_it_is_now():
    latest = ev_result("F2", "F2", MISS, aid=2, when="2026-11-24T06:40:00Z")
    older = ev_result("F1", "F1", MISS, aid=1)
    assert rf.state([latest, older], [], set(), "F2", NOW) == {"action": "try", "case": "b04", "result": 2}
    assert rf.state([latest, older], [], {"b04:F2"}, "F2", NOW)["action"] == "none"  # already tried
    assert rf.state([latest, older], [], set(), "F3", NOW)["action"] == "none"  # main moved on: wait for its eval
    assert rf.state([latest], [], set(), "F2", NOW)["action"] == "none"  # only one eval
    small = ev_result("F2", "F2", MISS, aid=3, spec=("b04", "1"))
    assert rf.state([small, older], [], set(), "F2", NOW)["action"] == "none"  # small runs don't count
    pr_eval = ev_result("P1", "F1", MISS, mode="pr", number="9", aid=4)  # a PR's eval isn't main's
    assert rf.state([pr_eval, older], [], set(), "F1", NOW)["action"] == "none"
    assert rf.state([latest, ev_result("F1", "F1", GOOD)], [], set(), "F2", NOW)["action"] == "none"


def test_state_by_hand_skips_the_repeat_check_but_not_the_rest():
    latest = ev_result("F2", "F2", GOOD, aid=2)
    assert rf.state([latest], [], set(), "F2", NOW, case="b04") == {"action": "try", "case": "b04", "result": 2}
    assert rf.state([latest], [], set(), "F2", NOW, case="c01")["action"] == "none"  # clean case
    assert rf.state([latest], [], set(), "F2", NOW, case="b03")["action"] == "none"  # hidden: not in the results
    assert rf.state([latest], [], {"b04:F2"}, "F2", NOW, case="b04")["action"] == "none"
    assert rf.state([latest], [pr()], set(), "F2", NOW, case="b04")["action"] == "none"  # one PR at a time


def test_state_judges_an_open_rule_fix_pr():
    main = ev_result("F1", "F1", MISS, aid=1)
    good = ev_result("P1", "F1", GOOD, mode="pr", number="70", rules="s1", aid=5, when="2026-11-24T07:30:00Z")
    bad = ev_result("P1", "F1", MISS, mode="pr", number="70", rules="s1", aid=5, when="2026-11-24T07:30:00Z")
    assert rf.state([good, main], [pr()], set(), "F1", NOW)["action"] == "judge-pass"
    r = rf.state([bad, main], [pr()], set(), "F1", NOW)
    assert r["action"] == "retry" and r["case"] == "b04" and r["result"] == 1 and "caught in 2 of 3" in r["reasons"][0]
    assert rf.state([bad, main], [pr(labels=["rule-fix", "rule-fix-try-1", "rule-fix-try-2"])], set(), "F1",
                    NOW)["action"] == "needs-you"
    assert rf.state([good, main], [pr(judged=["s1"])], set(), "F1", NOW)["action"] == "none"  # never twice
    assert rf.state([good, main], [pr(stale=True)], set(), "F1", NOW)["action"] == "needs-you"
    assert rf.state([good, main], [pr(ref="feature/x")], set(), "F1", NOW)["action"] == "needs-you"
    assert rf.state([good], [pr()], set(), "F1", NOW)["action"] == "needs-you"  # nothing to compare with


def test_state_waits_for_the_prs_eval_then_gives_up():
    main = ev_result("F1", "F1", MISS, aid=1)
    old_eval = ev_result("P0", "F1", GOOD, mode="pr", number="70", rules="s0", aid=5)  # an earlier commit's
    assert rf.state([old_eval, main], [pr()], set(), "F1", NOW)["action"] == "none"  # 1 h: wait
    late = rf.state([old_eval, main], [pr(head_date="2026-11-24T03:00:00Z")], set(), "F1", NOW)
    assert late["action"] == "needs-you" and "no clean eval" in late["reasons"][0]
