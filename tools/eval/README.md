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

## The eval's login
The eval logs in with its own token, on your Claude subscription (no API key, so nothing is billed per use; it
uses your plan's quota). One time, in your own Terminal:
1. `claude setup-token`, and copy the token it prints.
2. `security add-generic-password -a "$USER" -s logic-lane-eval -w`, and paste the token both times it asks.

The token stays in your Keychain. Never paste it into a chat.

## Running it
In `tools/eval` (add `--system-certs` after `uv run` on a work Mac):
- `uv run python eval_review.py`: every case, 3 runs each, about 10 minutes. Results and `report.md` go in
  `out/<time>/` (never committed).
- `--cases b01,c01` for some cases, `--runs 1` for a quick try, `--rules <commit>` to test other rules.
- `uv run pytest`: the offline tests. `EVAL_LIVE=1 uv run pytest tests/test_live_canary.py -s` also checks, with a
  few short real runs, that the reviewer is cut off from everything it shouldn't see.

## On GitHub (D26)
`.github/workflows/eval.yml` runs the same eval by itself, through the same pinned action as the real code review:
- **Daily**, but only when something that decides the result changed (rules, the code-review job, the cases, or
  the model, which a tiny probe checks). The report is on the run's page (Actions → Eval).
- **After the AI review on your PRs** that change what the code reviewer reads: one comment with the PR's numbers
  and main's.
- **By hand:** Actions → Eval → Run workflow, with the cases, runs and rules to test.
- **Switch:** Settings → Secrets and variables → Actions → Variables, `AI_EVAL` = `on`. Anything else is off.
- **If GitHub pauses it** (after 60 days without activity in the repo): Actions → Eval → Enable workflow.

CI runs the tests here on every PR (`eval-tests`), installing pytest from `requirements-dev.txt`. After changing
`uv.lock`, remake it with the command at the top of that file (a test fails until you do).

## Rule fixes (D27)
`.github/workflows/rule-fix.yml` runs after every eval (and daily). When the same visible case is missed in two
full evals of main in a row, an AI drafts a change to the reviewer's checklist or prompt, in a copy of the repo
without this folder. A script opens the PR (`rule-fix` label, @mention), the eval runs on it, and the workflow
comments whether it looks better. You merge or close it. At most 2 tries per PR, then `needs-you`.
- **By hand:** Actions → Rule fix → Run workflow, with a visible bug case (e.g. `b04`).
- **Switch:** `AI_RULE_FIX` = `on`. Anything else is off.
- The steps without AI are in `rule_fix.py` (tested in `tests/test_rule_fix.py`); the AI's instructions are
  `tools/review/prompts/rule-fix.md`.

## What's in here
- `cases/`: small changes on one base commit (`cases/BASE`), some with a planted bug, some clean. Each has the
  PR text, the patch, local check counts and what the reviewer should find (`case.json`). `cases-hidden/`: more
  of the same, never shown to the rule-fix agent (E2d). The report only gives their combined numbers.
- `eval_review.py`: runs the real code reviewer on each case exactly as the GitHub job does (its prompt, tools,
  turn limit, schema and `review-input/` files). Each run gets a throwaway folder: main's code as of the base
  commit, the rules being tested, and the PR in `pr/`. A macOS sandbox stops it reading your home folder, this
  repo and other runs' folders.
- `score.py`: scores each run (caught, missed, weak, false alarm) and writes the report.
- `ci_eval.py`: the GitHub workflow's steps (which cases, the fingerprint, run folders, the report).
