"""Tests for ci_eval.py, the eval's GitHub steps. These never start Claude."""
import json
import shlex

import pytest

import ci_eval
import eval_review as ev

HEAD = "HEAD"


def test_slots_cover_every_case_and_run_under_anonymous_names():
    plan = ci_eval.slots("all", 3, salt="x")
    ids = {c["id"] for c in ev.load_cases()}
    assert len(plan["matrix"]) == len(plan["slots"]) == 3 * len(ids)
    assert {s["case"] for s in plan["slots"].values()} == ids
    assert [m["slot"] for m in plan["matrix"]] == sorted(plan["slots"])
    public = json.dumps(plan["matrix"]) + " ".join(s["folder"] for s in plan["slots"].values())
    assert not any(cid in public for cid in ids)  # nothing public names a case
    folders = {s["case"]: s["folder"] for s in plan["slots"].values()}
    assert len(set(folders.values())) == len(ids)  # one folder per case, shared by its runs
    assert ci_eval.slots("all", 3)["slots"]["01"]["folder"] != ci_eval.slots("all", 3)["slots"]["01"]["folder"]
    small = ci_eval.slots("c04, b05", 1, salt="x")["slots"]
    assert [(s["case"], s["run"]) for s in small.values()] == [("b05", 1), ("c04", 1)]
    with pytest.raises(SystemExit):
        ci_eval.slots("nope", 1)


def test_spec_text_ignores_order_and_spaces():
    assert ci_eval.spec_text("c04, b05", 1) == ci_eval.spec_text("b05,c04", 1) == "b05,c04/1"
    assert ci_eval.spec_text("all", 3) == ci_eval.spec_text("", 3) == "all/3"


def test_trigger_paths():
    assert ci_eval.triggers(["CLAUDE.md"])
    assert ci_eval.triggers(["games/demo/game.js", "tools/review/prompts/code.md"])
    assert ci_eval.triggers([".claude/agents/idea-reviewer.md"])
    assert ci_eval.triggers([".github/workflows/review.yml"])
    assert ".github/workflows/eval.yml" in ci_eval.EVAL_FILES  # how the review job runs is part of the fingerprint
    assert not ci_eval.triggers(["docs/DECISIONS.md", "docs/PLAN.md", "games/demo/game.js"])
    assert not ci_eval.triggers(["tools/reviewer-notes.md"])  # a prefix of a path isn't that path


def test_fingerprint_depends_on_content_and_model():
    a = ci_eval.fingerprint(HEAD, HEAD, "claude-sonnet-5-5")
    assert a == ci_eval.fingerprint(HEAD, HEAD, "claude-sonnet-5-5") and len(a) == 20
    assert a != ci_eval.fingerprint(HEAD, HEAD, "another-model")
    assert a != ci_eval.fingerprint(HEAD, HEAD, "claude-sonnet-5-5", "b05,c04/1")
    assert a != ci_eval.fingerprint(ev.base_commit(), HEAD, "claude-sonnet-5-5")  # BASE has older rules
    # Same content under another commit id: the same fingerprint (a squash merge matches main, and a push that
    # changes no rule file matches the PR's last eval). commit-tree makes that commit without moving any branch.
    twin = ev.git("commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "twin", cwd=ev.REPO_ROOT).strip()
    assert ci_eval.fingerprint(twin, twin, "claude-sonnet-5-5") == a
    tree = ev.git("rev-parse", "HEAD^{tree}", cwd=ev.REPO_ROOT).strip()
    assert ci_eval._object(HEAD, "CLAUDE.md") == ev.git("rev-parse", f"{tree}:CLAUDE.md", cwd=ev.REPO_ROOT).strip()
    assert ci_eval._object(HEAD, "no/such/file") == "-"


def test_claude_args_read_back_like_the_job():
    s = ev.read_review_settings(ev.REVIEW_YML.read_text(encoding="utf-8"))
    args = shlex.split(ci_eval.claude_args(s, '{"type":"object","x":"it\'s"}'))
    assert args[args.index("--max-turns") + 1] == str(s["max_turns"])
    assert args[args.index("--allowedTools") + 1] == s["allowed"]
    denied = args[args.index("--disallowedTools") + 1].split(",")
    assert s["disallowed"].split(",") == denied[:len(s["disallowed"].split(","))] and "Task" in denied and "Skill" in denied
    assert json.loads(args[args.index("--json-schema") + 1])["x"] == "it's"


def test_job_env_keeps_only_claude_code_settings():
    assert ci_eval.job_env({"env": {"CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1", "GH_TOKEN": "x",
                                    "CLAUDE_CODE_X": "$(boom)", "CLAUDE_CODE_Y\nPATH": "1",
                                    "CLAUDE_CODE_Z=": "1"}}) == {"CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"}
    s = ev.read_review_settings(ev.REVIEW_YML.read_text(encoding="utf-8"))
    assert ci_eval.job_env(s) == {"CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"}


def test_prepare_builds_folders_without_answers(tmp_path):
    plan = ci_eval.slots("b05,c04", 2, salt="x")
    ci_eval.prepare(HEAD, HEAD, plan, tmp_path)
    folders = sorted({s["folder"] for s in plan["slots"].values()})
    assert sorted(p.name for p in tmp_path.iterdir()) == folders
    for name in folders:
        folder = tmp_path / name
        assert ci_eval.leaks(folder) == []
        run = json.loads((folder / "run.json").read_text())
        assert "${{" not in run["prompt"] and "--json-schema" in run["claude_args"]
        assert run["env"] == {"CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"}
        assert "expect" not in json.dumps(run) and "case" not in run
        assert (folder / "work" / "review-input" / "diff.patch").is_file()
        assert (folder / "work" / "pr" / ".git").is_dir()


def test_leaks_finds_answers(tmp_path):
    (tmp_path / "tools" / "eval").mkdir(parents=True)
    (tmp_path / "x").mkdir()
    (tmp_path / "x" / "case.json").write_text("{}")
    assert sorted(ci_eval.leaks(tmp_path)) == ["tools/eval", "x/case.json"]


def saved(tmp_path, slot, result, model="claude-sonnet-5-5"):
    d = tmp_path / f"run-{slot}"
    d.mkdir()
    (d / "saved.json").write_text(json.dumps({"result": result, "model": model, "version": "2.1.400"}))


def result(blocking=(), **extra):
    return {"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 0.1, "num_turns": 5,
            "duration_ms": 20000, "modelUsage": {"claude-sonnet-5-5": {}}, "permission_denials": [{"tool_name": "Bash"}],
            "structured_output": {"summary": "s", "blocking": list(blocking), "suggestions": []}, **extra}


def test_report_scores_runs_and_counts_missing_ones_as_errors(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    plan = ci_eval.slots("b05", 1, salt="x")
    plan["slots"].update({"02": {"case": "c04", "run": 1, "folder": "f"}, "03": {"case": "c04", "run": 2, "folder": "f"}})
    saved(runs, "01", result([{"title": "Uses an absolute path /sw.js", "evidence": ""}]))
    saved(runs, "02", result())
    text, errors = ci_eval.report(runs, plan, tmp_path / "out", {"action_cli": "claude-code-action@abc"})
    assert errors == 1
    assert "| b05 | bug | 1 | 1 | 0 | 0 | 0 | 0 |" in text
    assert "| c04 | clean | 2 | 0 | 0 | 0 | 0 | 1 |" in text
    assert "Claude Code: 2.1.400 (GitHub: claude-code-action@abc)" in text
    assert "Model: claude-sonnet-5-5" in text
    assert "Blocked tool calls: 2 in 2 runs" in text
    assert (tmp_path / "out" / "report.md").read_text() == text


def test_record_handles_string_output_and_errors():
    case = {"id": "c04", "hidden": False, "expect": {"kind": "clean"}}
    r = ci_eval.record({"result": result(structured_output='{"summary": "s", "blocking": []}')}, case, 1)
    assert r["review"] == {"summary": "s", "blocking": []} and "error" not in r and r["run"] == 1
    r = ci_eval.record({"result": result(is_error=True, subtype="error_max_turns")}, case, 1)
    assert r["error"] == "error: error_max_turns"
    assert ci_eval.record({}, case, 2)["error"] == "no result"


def test_tool_limits_always_come_from_main(tmp_path, monkeypatch):
    real = ev.read_review_settings
    def rules_widen_tools(yml):  # the rules under test ask for every tool
        s = real(yml)
        return {**s, "allowed": "Bash(*)", "max_turns": 999} if "WIDE" in yml else s
    monkeypatch.setattr(ev, "read_review_settings", rules_widen_tools)
    at = ev.at_commit
    rules = "HEAD^{commit}"  # the same commit under another name, standing in for a PR's rules
    monkeypatch.setattr(ev, "at_commit", lambda c, p: at(c, p) + ("\n# WIDE\n" if c == rules and p == ev.REVIEW_YML else ""))
    plan = ci_eval.slots("b05", 1, salt="x")
    ci_eval.prepare(rules, HEAD, plan, tmp_path)
    run = json.loads((tmp_path / plan["slots"]["01"]["folder"] / "run.json").read_text())
    args = shlex.split(run["claude_args"])
    main = real(ev.REVIEW_YML.read_text(encoding="utf-8"))
    assert args[args.index("--allowedTools") + 1] == main["allowed"] != "Bash(*)"
    assert args[args.index("--max-turns") + 1] == str(main["max_turns"])
