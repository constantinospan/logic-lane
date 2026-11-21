"""Tests for ci_eval.py, the eval's GitHub steps. These never start Claude."""
import json
import shlex

import pytest

import ci_eval
import eval_review as ev

HEAD = "HEAD"


def test_matrix_lists_every_case_and_run():
    m = ci_eval.matrix("all", 3)
    ids = {c["id"] for c in ev.load_cases()}
    assert len(m) == 3 * len(ids) and {x["case"] for x in m} == ids
    assert ci_eval.matrix("b05, c04", 1) == [{"case": "b05", "run": 1}, {"case": "c04", "run": 1}]
    with pytest.raises(SystemExit):
        ci_eval.matrix("nope", 1)


def test_trigger_paths():
    assert ci_eval.triggers(["CLAUDE.md"])
    assert ci_eval.triggers(["games/demo/game.js", "tools/review/prompts/code.md"])
    assert ci_eval.triggers([".claude/agents/idea-reviewer.md"])
    assert ci_eval.triggers([".github/workflows/review.yml"])
    assert not ci_eval.triggers(["docs/DECISIONS.md", "docs/PLAN.md", "games/demo/game.js"])
    assert not ci_eval.triggers(["tools/reviewer-notes.md"])  # a prefix of a path isn't that path


def test_fingerprint_depends_on_content_and_model():
    a = ci_eval.fingerprint(HEAD, HEAD, "claude-sonnet-5-5")
    assert a == ci_eval.fingerprint(HEAD, HEAD, "claude-sonnet-5-5") and len(a) == 20
    assert a != ci_eval.fingerprint(HEAD, HEAD, "another-model")
    assert a != ci_eval.fingerprint(HEAD, HEAD, "claude-sonnet-5-5", "b05,c04/1")
    assert a != ci_eval.fingerprint(ev.base_commit(), HEAD, "claude-sonnet-5-5")  # BASE has older rules
    # Same content under another commit id: the same fingerprint (a squash merge matches main).
    tree = ev.git("rev-parse", "HEAD^{tree}", cwd=ev.REPO_ROOT).strip()
    assert ci_eval._object(HEAD, "CLAUDE.md") == ev.git("rev-parse", f"{tree}:CLAUDE.md", cwd=ev.REPO_ROOT).strip()
    assert ci_eval._object(HEAD, "no/such/file") == "-"


def test_claude_args_read_back_like_the_job():
    s = ev.read_review_settings(ev.REVIEW_YML.read_text(encoding="utf-8"))
    args = shlex.split(ci_eval.claude_args(s, '{"type":"object","x":"it\'s"}'))
    assert args[args.index("--max-turns") + 1] == str(s["max_turns"])
    assert args[args.index("--allowedTools") + 1] == s["allowed"]
    assert args[args.index("--disallowedTools") + 1] == s["disallowed"]
    assert json.loads(args[args.index("--json-schema") + 1])["x"] == "it's"


def test_prepare_builds_folders_without_answers(tmp_path):
    ci_eval.prepare(HEAD, HEAD, "b05,c04", tmp_path)
    for cid in ("b05", "c04"):
        folder = tmp_path / cid
        assert ci_eval.leaks(folder) == []
        run = json.loads((folder / "run.json").read_text())
        assert run["case"] == cid and "${{" not in run["prompt"] and "--json-schema" in run["claude_args"]
        assert "expect" not in json.dumps(run) and "match" not in run
        assert (folder / "work" / "review-input" / "diff.patch").is_file()
        assert (folder / "work" / "pr" / ".git").is_dir()


def test_leaks_finds_answers(tmp_path):
    (tmp_path / "tools" / "eval").mkdir(parents=True)
    (tmp_path / "x").mkdir()
    (tmp_path / "x" / "case.json").write_text("{}")
    assert sorted(ci_eval.leaks(tmp_path)) == ["tools/eval", "x/case.json"]


def saved(tmp_path, case, run, result, model="claude-sonnet-5-5"):
    d = tmp_path / f"run-{case}-{run}"
    d.mkdir()
    (d / "saved.json").write_text(json.dumps({"result": result, "model": model, "version": "2.1.400"}))


def result(blocking=(), **extra):
    return {"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 0.1, "num_turns": 5,
            "duration_ms": 20000, "modelUsage": {"claude-sonnet-5-5": {}}, "permission_denials": [{"tool_name": "Bash"}],
            "structured_output": {"summary": "s", "blocking": list(blocking), "suggestions": []}, **extra}


def test_report_scores_runs_and_counts_missing_ones_as_errors(tmp_path):
    runs = tmp_path / "runs"
    runs.mkdir()
    saved(runs, "b05", 1, result([{"title": "Uses an absolute path /sw.js", "evidence": ""}]))
    saved(runs, "c04", 1, result())
    wanted = [{"case": "b05", "run": 1}, {"case": "c04", "run": 1}, {"case": "c04", "run": 2}]
    text, errors = ci_eval.report(runs, wanted, tmp_path / "out", {"action_cli": "claude-code-action@abc"})
    assert errors == 1
    assert "| b05 | bug | 1 | 1 | 0 | 0 | 0 | 0 |" in text
    assert "| c04 | clean | 2 | 0 | 0 | 0 | 0 | 1 |" in text
    assert "Claude Code: 2.1.400 (GitHub: claude-code-action@abc)" in text
    assert "Model: claude-sonnet-5-5" in text
    assert "Blocked tool calls: 2 in 2 runs" in text
    assert (tmp_path / "out" / "report.md").read_text() == text


def test_record_handles_string_output_and_errors():
    case = {"id": "c04", "hidden": False, "expect": {"kind": "clean"}}
    r = ci_eval.record({"run": 1, "result": result(structured_output='{"summary": "s", "blocking": []}')}, case)
    assert r["review"] == {"summary": "s", "blocking": []} and "error" not in r
    r = ci_eval.record({"run": 1, "result": result(is_error=True, subtype="error_max_turns")}, case)
    assert r["error"] == "error: error_max_turns"
    assert ci_eval.record({"run": 2}, case)["error"] == "no result"
