"""Checks every eval case is well formed and applies cleanly to BASE. Run: uv run pytest -v"""
import subprocess

import pytest

import eval_review as ev

CASES = ev.load_cases()


def test_there_are_cases_and_some_are_hidden():
    assert len(CASES) >= 12
    assert any(c["hidden"] for c in CASES) and not all(c["hidden"] for c in CASES)


def test_ids_and_numbers_are_unique():
    assert len({c["id"] for c in CASES}) == len(CASES)
    assert len({c["number"] for c in CASES}) == len(CASES)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_case_is_well_formed(case):
    for key in ("id", "number", "title", "body", "branch", "expect", "why"):
        assert case.get(key), f"{case['id']}: missing {key}"
    expect = case["expect"]
    assert expect["kind"] in ("bug", "claim", "clean")
    if expect["kind"] == "bug":
        assert expect.get("file") and (ev.REPO_ROOT / expect["file"]).exists() or expect["file"] in (
            case["dir"] / "change.patch").read_text()
    if expect["kind"] != "clean":
        assert 4 <= len(expect["match"]) <= 10 and all(w == w.lower() for w in expect["match"])
    assert (case["dir"] / "change.patch").read_text().startswith("diff --git")
    ev.parse_local_check((case["dir"] / "local-check.txt").read_text())  # raises if counts are missing


@pytest.fixture(scope="module")
def base_repo(tmp_path_factory):
    repo = tmp_path_factory.mktemp("base")
    ev.git("init", "-q", cwd=repo)
    ev.git("fetch", "-q", "--no-tags", str(ev.REPO_ROOT), ev.base_commit(), cwd=repo)
    ev.git("checkout", "-q", ev.base_commit(), cwd=repo)
    return repo


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_patch_applies_to_base(case, base_repo):
    r = subprocess.run(["git", "apply", "--check", str(case["dir"] / "change.patch")], cwd=base_repo,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
