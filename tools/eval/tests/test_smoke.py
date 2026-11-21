"""Smoke tests: they prove Python, uv and pytest are set up (plan step E2a).

Run them from tools/eval with: uv run pytest
"""
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent.parent  # tools/eval
REPO_ROOT = EVAL_DIR.parent.parent  # the repo's top folder


def test_python_is_the_pinned_version():
    # .python-version says 3.12; uv installs it, so this never depends on the Mac's own Python.
    assert sys.version_info[:2] == (3, 12)


def test_the_code_reviewer_is_where_the_eval_expects_it():
    # The eval (E2b) runs this prompt with the settings in review.yml. If they move, the eval must move too.
    assert (REPO_ROOT / "tools" / "review" / "prompts" / "code.md").is_file()
    assert "code-review:" in (REPO_ROOT / ".github" / "workflows" / "review.yml").read_text(encoding="utf-8")
