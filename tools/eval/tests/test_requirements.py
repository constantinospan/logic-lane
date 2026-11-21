"""CI installs pytest from requirements-dev.txt with pip (no uv on GitHub's machines). It must match uv.lock exactly."""
import re
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def test_requirements_match_the_lock():
    lock = tomllib.loads((HERE / "uv.lock").read_text(encoding="utf-8"))
    locked = {}  # name -> (version, every hash uv.lock allows)
    for p in lock["package"]:
        if p["name"] != "logic-lane-eval":
            files = p.get("wheels", []) + ([p["sdist"]] if "sdist" in p else [])
            locked[p["name"]] = (p["version"], {f["hash"] for f in files})
    text = (HERE / "requirements-dev.txt").read_text(encoding="utf-8")
    pinned = dict(re.findall(r"(?m)^([a-z0-9_.-]+)==([^\s;]+)", text))
    assert pinned == {name: version for name, (version, _) in locked.items()}
    for block in re.split(r"(?m)^(?=[a-z])", text):
        m = re.match(r"([a-z0-9_.-]+)==", block)
        if m:
            hashes = set(re.findall(r"--hash=(sha256:[0-9a-f]{64})", block))
            assert hashes and hashes <= locked[m.group(1)][1], m.group(1)
