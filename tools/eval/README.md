# Eval of the AI code reviewer (E2)

Python tools that measure how well the AI code reviewer catches planted bugs, and how often it raises false alarms.
They run on a computer, never on the site (decisions D23, D25). Built in steps: E2a (this setup), E2b (the eval you
run by hand), then E2c and E2d (automatic runs and rule fixes), see `docs/PLAN.md`.

## One-time setup on the Mac (about 1 to 1.5 hours with reading)

You run these in Terminal. Each step says what it does, so you learn the tools as you go.

1. **Install uv.** uv is the tool that installs Python itself and the packages this folder needs, each project in
   its own box. Nothing changes outside uv's own folders (it keeps its Pythons and downloads under your home folder):
   not your system Python, `pip`, your `PATH` or your shell profile.
   ```
   HOMEBREW_NO_AUTO_UPDATE=1 brew install uv
   uv --version
   ```
   `HOMEBREW_NO_AUTO_UPDATE=1` stops Homebrew refreshing its package list first, so this install changes nothing
   else. You should see a version number.

   To undo everything later: `brew uninstall uv`, then delete `~/.local/share/uv`, `~/.cache/uv` and this folder's
   `.venv/`.

   **On a work Mac** whose network checks secure traffic with the company's own certificate, uv stops with
   "invalid peer certificate: UnknownIssuer". Add `--system-certs` to each uv command below (e.g.
   `uv lock --system-certs`, `uv run --system-certs pytest -v`): it makes uv trust the certificates the Mac already
   trusts, and changes nothing on the Mac.

2. **Go to this folder.**
   ```
   cd <your repo folder>/tools/eval
   ```
   (The first time, while this is still a PR, Claude tells you which folder has it.)

3. **Look at the two small files that describe the setup.**
   - `.python-version` says which Python to use: 3.12. Your Mac has an older one (3.9); uv downloads 3.12 just for
     this folder.
   - `pyproject.toml` says what the project needs: only `pytest`, the test runner. Read its comments.

4. **Make the lock file.**
   ```
   uv lock
   ```
   uv works out the exact versions of pytest and the few small packages pytest itself needs, and writes them to
   `uv.lock`. `uv.lock` is committed, so every run (yours, Claude's, later GitHub's) uses exactly the same versions.
   The first time, uv may also download Python 3.12 here. Open `uv.lock` and look for `name = "pytest"` and its
   `version`.

5. **Install them.**
   ```
   uv sync
   ```
   This creates `.venv/`, a private folder with Python 3.12 and pytest for this project (downloading them if
   needed). It's ignored by git.

6. **Run the tests.**
   ```
   uv run pytest -v
   ```
   `uv run` runs a command inside that private folder. You should see 2 tests pass. Open `tests/test_smoke.py`:
   each test is a function whose name starts with `test_`, and `assert` checks something is true. A failing
   `assert` is a failing test.

7. **Try breaking one.** In `tests/test_smoke.py`, change `(3, 12)` to `(3, 13)`, run `uv run pytest -v` again, and
   read how pytest shows the failure. Then change it back.

8. **Tell Claude it's done**, and paste the output of `uv run pytest -v`. Claude commits `uv.lock`.

## What comes in E2b
- `cases/`: small changes to the code, some with a planted bug, some clean. `cases-hidden/`: more of the same,
  never shown to the rule-fix agent (E2d).
- A script that runs the real code reviewer on each case, 3 times, exactly as GitHub does.
- Scoring and a report, which you write from Claude's outline and tests.
- One more setup step then: `claude setup-token`, so the eval logs in on its own, without your personal Claude
  settings.
