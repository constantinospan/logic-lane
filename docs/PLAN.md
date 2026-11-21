# Logic Lane — Build Plan

Decisions behind this plan: [DECISIONS.md](DECISIONS.md).
Times are rough. "Me" = the parent/owner, "Claude" = the AI agent.

| # | Step | What happens | Owner | Your time | Claude's time |
|---|------|--------------|-------|-----------|---------------|
| 1 ✅ | Repo | Create public GitHub repo, push docs, enable Pages (Actions source), protect `main`, require approval for outside contributors' workflows | Both | 10 min | 15 min |
| 2 ✅ | AI access | Install Claude GitHub App on the repo, run `claude setup-token`, store it as a repo secret | Me (Claude guides) | 10 min | — |
| 3 ✅ | Rulebook | `CLAUDE.md` (agent rules), `REVIEW-CHECKLIST.md`, `README.md` (rollback, token renewal) | Claude, you approve | 10 min read | 30 min |
| 4 ✅ | Shared base | Home screen, difficulty picker, refresh protection (localStorage, 3 h resume window), seeded random, installable app, styles | Claude | — | 2–3 h |
| 5 ✅ | Tests | Unit tests, browser tests at phone, tablet + desktop sizes, type checking | Claude | — | 1 h |
| 6a ✅ | Core pipeline | Tests gate + deploy, builder (`@claude`), fork guards. A working request → PR → merge → live loop | Claude | — | 1–1.5 h |
| 7 ✅ | Dry run | You open a small test issue from your phone, watch it go to PR → merge → live | Both | 30 min | 30 min |
| 6b ✅ | AI reviewers | Play reviewer (browser, screenshots) and code reviewer (diff), one verdict, auto-fix loop (max 2) (D19). Added on top of the working loop; expect a few iterations | Claude | 10 min | 1.5–2 h |
| 6c ✅ | Idea gate (D21) | Every request is reviewed by an idea reviewer before any code is written, on GitHub and in sessions. Clear requests are built as usual (with a short brief); unclear ones get questions first. Fixed rules in a tested script, settings in a repo file | Claude | 10 min | 1.5–2 h |
| 8 ✅ | Arrow path v1 | Puzzle generator + solver, ~30-level ladder, Easy/Medium/Hard starts, loops later in the ladder | Claude | — | 3–5 h |
| 9 | Playtest | Install on the tablet, play with her, turn feedback into issues | Me | 20 min + play | — |
| 10 | Test scaling (D20) | **When `main`'s CI passes 2m30s or at the third game:** PRs run only what they could break, shards grow with the tests, a no-cross-game-imports test | Claude | — | 1–2 h |

**Optional, later: more ways to start work on GitHub.** Today a session can open the issue for you (`CLAUDE.md`,
"Opening issues for the owner"), so you don't type it and nothing is pushed from the Mac. These go further, if wanted:

| # | Option | What happens | Your time | Claude's time |
|---|--------|--------------|-----------|---------------|
| O1 | Run button | A manual trigger on the builder (`claude.yml`) with a box for the request, started from the Actions tab or `gh workflow run`. No issue thread, so less history and no clean place for questions. After 6c, so the idea gate covers it | 5 min | ~1 h |
| O2 | Cloud session | Start a claude.ai/code session from the Claude app: it works on a branch in the cloud and opens the PR. Nothing to build; on first use, run the "first time a claude.ai/code session is used" checks in the progress notes | 15 min | ~30 min |
| O3 | Scheduled agent | A routine that picks the next issue labelled `ready`, with rules for what it may pick and a cap on runs to protect the Max quota. After 6c and step 8 | 15 min | 1.5–2 h |

**Optional, later: measuring the AI pipeline (owner's learning, never blocks games).** Python, in learning mode:
Claude writes most of it, the owner writes a few small pieces with Claude's outline, tests and review. Python is
for offline tools only and is never shipped (D23). Packages: pytest only, pinned with uv (owner approved, 2026-11-15).

| # | Item | What happens | Your time | Claude's time |
|---|------|--------------|-----------|---------------|
| E1 ✅ | Save the logs | A private repo, `logic-lane-archive`, keeps a raw copy of every Actions run with its full log, and every issue and PR with comments, events, labels, commits, files and reviews (D24). A scheduled workflow there collects what's new: daily, weekly after 2026-12-20 (it opens a reminder issue). It goes red if a log GitHub still has is missing, or something failed to download. GitHub deletes logs after 90 days, so this keeps them. No packages needed | 15 min (token) | ~5 h |
| E2a | Eval setup | Decisions (D25), Python with pytest pinned by uv in `tools/eval/`, your local setup from its README | ~1.5 h | ~2 h |
| E2b ✅ | Eval by hand | 12 test changes (8 planted bugs, 4 clean; 3 hidden) on a fixed base commit. One command runs the real code reviewer on each, 3 times, exactly as on GitHub, and scores bugs caught, false alarms and cost. Claude writes it all (you chose automation, 2026-11-21) | ~1 h | ~20–25 h |
| E2c | Eval on its own | Runs when the agent rules, prompts or model changed (daily check), and on PRs that change agent rules | — | ~3 h |
| E2d | Rule fixes | When a miss repeats, an agent proposes a rule change; a script opens the PR (D25); the eval re-runs it on all cases, hidden ones included; you merge. Max 2 tries, then `needs-you` | ~1 h | 6–10 h |

E2a and E2b are settled in D25. Still to decide: in E2c, whether Python may run in this repo's workflows (it would
amend D23), GitHub switching off scheduled workflows after 60 days without activity in a public repo, a slower
schedule from about 2026-12-20, an off switch like `AI_FIX` (D17) to protect the Max quota, and which model the GitHub review uses (GitHub's logs don't show it; the eval ran claude-sonnet-5-5). In E2d: how the rule-fix agent's checkout leaves
out `tools/eval/cases-hidden/` and its history (e.g. a copy without `tools/eval/`, or the hidden cases in E1's
private archive). After the first
baseline: the one change to compare (e.g. the model). Later, if wanted: rebuild the pipeline's numbers from E1's
archive with one command.

**E2b baseline (2026-11-21, main's rules, claude-sonnet-5-5):** 20 of 24 bug runs caught (83%), no false alarms in
12 clean runs, no errors, 10 minutes, about $4.30 if it were billed (it runs on the Max plan). Hidden cases: 3 of 6
bug runs caught; the misses were raised only as Suggestions. Visible misses: 1 of 3 runs on the cache case (b04),
also only a Suggestion. 16 of 36 runs had one blocked tool call: chained commands (`cd …; cat …`) that the review's
allowed tools don't permit, the same on GitHub. Both are candidates for E2d.

**Totals (rough):** you ~1.5 h spread across steps 1, 2, 3, 7, 9; Claude ~1.5–2 days of work sessions.

Notes:
- Steps 1–6 are done from a local or claude.ai/code session (the GitHub builder can't edit workflow files).
- Step 8 is still delivered as a PR, so the reviewer runs on it.
- After step 9, everything is requests via issues / claude.ai/code / local, as in D3/D5.

## Progress notes
- E1 done (2026-11-21): private repo `constantinospan/logic-lane-archive`, seeded with the 2026-11-19 snapshot.
  Secret `LOGIC_LANE_READ_TOKEN` there: fine-grained token, logic-lane only, read-only, created 2026-11-21, expires
  after 1 year (around 2027-11-21). Renew it the same way (its README says how). Switch the cron to weekly after
  2026-12-20 (the archive opens a reminder issue).
- Step 1 done (2026-11-13): repo `constantinospan/logic-lane` (public), Pages source = GitHub Actions,
  default workflow token read-only, fork PR workflows need approval for all outside contributors,
  `main` requires a PR (force-push and deletion blocked), branches auto-deleted after merge.
  Commits use the GitHub noreply address (repo-local git config).
- Step 2 done (2026-11-13): Claude GitHub App installed on logic-lane only; secret `CLAUDE_CODE_OAUTH_TOKEN` set.
  Token created 2026-11-13, expected to expire around 2027-11 — renew with `claude setup-token` + `gh secret set`.
- Step 3 done (2026-11-13): `CLAUDE.md`, `docs/REVIEW-CHECKLIST.md`, README. Reviewed by a fresh agent; fixes applied.
- Step 4 done: shared base, hidden demo game (`#/play/demo`), `docs/GAME-API.md`. Decided: one 🔊 in the top bar
  (D10), seed on long-press (D12), content-hash cache version stamped by deploy (D8, D16), parent-only reset (D16).
- Step 5 done: `npm run check` = `tsc` (strict `checkJs`, separate WebWorker config for `sw.js`) + Vitest + Playwright
  (phone Chromium, tablet WebKit, desktop Chromium). See `docs/TESTING.md`. Each test was proven able to fail by
  breaking the app on purpose.
- Step 5b done: more tests. Coverage (core at 100% lines, 95% branches, gated), accessibility checks (axe) on every
  screen, and browser edge cases (races, expiry, broken storage, no speech, endless top, rotation, reduced motion).
  It found and fixed a low-contrast "Soon" badge, and (via review) a real bug: with storage blocked or full the game
  couldn't be played. It now falls back to memory (D7). New tests were mutation-checked; ones that couldn't fail
  were strengthened.
- Step 6a done: `.github/workflows/ci.yml` (the `test` check on every PR and on `main`, then deploy to Pages with the
  content-hash `VERSION` from `tools/build-site.mjs` and a live check) and `.github/workflows/claude.yml` (the
  builder, owner-only on the owner's own issues and PRs). Visual snapshots of every screen, Linux pictures, run in CI
  and the builder only. After merge: `test` is a required check on `main`, enforced for admins.
- Step 7 done (2026-11-14). Issue #8 (from the phone) → builder (4 min) → PR #9 → `@claude` change on the PR → merge
  → live. Then issue #10 `@claude revert PR #9` → PR #11 → merge → live again with the earlier version. Confirmed:
  - The builder runs the checks, including visual snapshots; its new pictures matched CI's exactly.
  - The PR author is the owner (they tap Create PR), so CI runs on PR creation straight away.
  - `@claude` on an open PR pushes to the same branch. Its push **does** start CI, but GitHub holds that run for
    approval ("require approval for all outside contributors" treats the bot as an outsider). Decided (owner): keep
    the setting and tap **Approve and run workflows** each time, for now. Revisit in 6b, because the auto-fix loop
    depends on it (options: keep approving, loosen to first-time contributors, or push with an owner token).
  - Revert used `git revert` on the squash commit; the result matched the pre-#9 code exactly.
  - Allow-listed commands with `:*` (e.g. `git revert`, `npm test`) worked.
  - The builder once misreported its own checks (said visual tests skipped while all 150 ran). 6b's code reviewer
    should check claims in the PR text against CI.
  - On the phone, GitHub's mobile compare page hid the **Create pull request** button (owner will retry; workaround
    in README).
  - Not tested: `@claude` on someone else's issue (needs a second account; the workflow's `if:` blocks it and was
    reviewed). Failure notifications for builder runs (none failed).
- Step 6b done (2026-11-14): `.github/workflows/review.yml` (D15, D17, D19) with `tools/review/` (scope, standard
  screenshots, verdict, prompts) and unit tests. Merged switched off, then proven on GitHub with throwaway PRs
  #16–#19, #25, #26: docs-only (no review), a harmless change (✅, 3 green runs), planted bugs (❌, both caught,
  the play reviewer really played), a checklist change (rules banner), a fix round (#18: ❌ → fix pushed → ✅), the
  2-round limit (#25: no fix, `needs-you`), and a fix run that skipped what the owner asked for (#26).
  - The proof found 6 real problems, fixed in #20–#24 and the clean-up PR: Claude Code needs bubblewrap for secret
    scrubbing; `Bash(folder/:*)` rules never match a file (now `folder/*`, with a test); blocked tool calls are now
    listed in the log; reviewer screenshots named with their folder; the fix run never saw the owner's request; a
    skipped item made round 2 repeat itself (now: `needs-you` and no more rounds).
  - #21's guess (full paths) was wrong. Lesson: test a permission rule locally before changing it.
  - Fix pushes from the Claude app were **not** held for approval in the proof (they were in step 7).
  - Switches: `AI_REVIEW=on`, `AI_FIX=off` (owner's default; switch on for automatic fixes).
- Step 6c built (2026-11-14), not yet proven: the idea gate (D21). `claude.yml` now runs `route` (no AI) →
  `idea-review` (AI, read-only, no shell) → `idea-verdict` (script) → builder. Files: `.claude/agents/idea-reviewer.md`,
  `docs/IDEA-CHECKLIST.md`, `tools/idea/` (settings, rules, route, collect, schema), a step 0 for sessions in
  `CLAUDE.md`. Merged with `enabled: false`. To prove on GitHub after merge (switch on with a small PR): a pass, a
  fail, an answer that leads to a pass, `go anyway`, `revert PR #N`, `@claude` on an open PR, a crashed reviewer
  (⚠️ + `needs-you`), and a PR that sets `passMark: 0` still judged at 75. Also check the builder still gets the
  action's own instructions when the idea report is added with `--append-system-prompt` (PR #30 review). Tick 6c only after.
- Step 6c proof, first round (2026-11-14, issues #35–#38): a pass (#35, built), a revert that skipped the check
  (#37), the builder kept its own instructions with the report added (#38), and the builder's own comments started
  nothing. It also found a design flaw: "Add a new game" (#38) passed at 85 with "Which game?" open. The owner chose
  rules plus assumptions instead of a score (D21, option a+). The proof resumes after that change merges: ask →
  `@claude 1a` → build, too many assumptions → ask, `go anyway`, `@claude` on an open PR, a PR that sets
  `maxAssumptions: 10` still judged by `main`'s 3, and the brief check on the first real PR.
- Step 6c proof, second round (2026-11-15, after PR #39): ask → `@claude 1a` → build (#40); `go anyway` skipped the
  check (#41); a PR setting `enabled: false` and `maxAssumptions: 10` was still checked with `main`'s settings, and
  `@claude` on an open PR was checked (#42); the AI review blocked PR #43 for not matching #40's brief. Fixed after:
  the builder guessed a whole game after `go anyway` (#41), #40's change showed nothing (the only game is hidden),
  and linked issues from other repos (PR #39 review). Still to prove on GitHub: too many assumptions → ask. Tick 6c
  after that.
- Step 6c proven (2026-11-15, issues #45–#47): four guesses were all asked as questions and the builder didn't start
  (#47). #45 and #46 didn't hit the cap: the reviewer bundled guesses (e.g. "picture and message") to land on exactly
  3, so a rule now says one assumption per separate choice. #46 also showed the new nothing-to-see rule working.
- Step 8 done (2026-11-15, PR #49): Arrow Path (D22). Idea check: build, after answer 1c. Owner chose one-arrow
  loops, tap-to-turn board arrows, robot and gem, no stuck help. Plan reviewed by a fresh agent first (fixed: loop
  input, one meaning per tap, fast loop/debug checks, move-list screens fitting the phone). Follow-ups from the AI
  review, in the same PR: the hint shows on screen above the board, move levels light the robot's trail and draw it
  bigger, and tapped squares stay 64 px on 360–375 px phones (tested at those sizes). Then a polish PR: no lit
  square on an empty Go, and a same-seed test in the game's own tests. CI on `main` after the merge: 2m28s, so
  step 10 is due.
- Fixed (2026-11-14): the WebKit "New!" update test failed twice in CI. Reproduced in Linux WebKit (Playwright's
  Docker image): 3 of 150 taps on "New!" did nothing, because WebKit lost the "take over" message. The app now
  sends it again every second until the new version takes over (`js/pwa/update.js`). Proven: 300 of 300 passed after
  the fix, and a new test drops the first message on purpose in every browser.
- Check in step 9 on the real iPad: tapping "⬆️ New!" updates the app every time (the bug above was in Safari's
  engine).
- To do in step 6b: the play reviewer runs only when a shipped file changed (`isShipped` in
  `tests/shipped-files.js`); the code reviewer runs on every non-docs PR (D19).
- Note for step 9: the iPad/iPhone silent switch can mute 🔊. Check it's off when testing speech.
- Check in step 9 on the real iPad: a first visit shows no "⬆️ New!" banner. In 6a, WebKit on Linux once showed
  the banner in an unrelated visual test (cause unknown; visual tests now run without the service worker).
- Check in step 9 on the real iPad: the 3 s holds (home title, Reset) and the seed long-press aren't cancelled by
  iOS. They're tested in Chromium and WebKit with a mouse, but not yet with real touch on iOS.
- To do in step 6b: the reviewer and fix runs load `CLAUDE.md` and `docs/REVIEW-CHECKLIST.md` from `main`
  (the base branch), not the PR branch, so a PR can't change the rules it's judged by. The action already does
  this for `CLAUDE.md` and `.claude/`. The checklist (in `docs/`) must be read from `main` explicitly. The verdict flags any PR that
  changes them.
- To do in step 6b: the reviewer job checks out with `fetch-depth: 0`, so `git diff origin/main...HEAD` in checklist
  section 6 has the shared history it needs.
- To do in step 6b: the fix run must push with the Claude App token, not the default workflow token, or its push
  won't re-trigger tests and review.
- To check the first time a claude.ai/code session is used (not covered by step 7): can it push a change under `.github/workflows/`? Until then,
  pipeline changes are local-only.
- To check the first time a claude.ai/code session is used: when it opens a PR, is the PR author the owner or the Claude app?
  The reviewer's "owner-only" guard (D16) must allow whichever it is. If the author is the Claude app (a bot),
  the action treats the PR as coming from a non-write author and blocks npm and test runners on it, so `@claude`
  and fix runs couldn't run checks there. In that case, sessions should push the branch and let the owner open the PR.
- To decide in step 6b: how fix runs start. If not tied to the PR (e.g. `workflow_dispatch`), there's no
  `.claude-pr/` restore; check `CLAUDE.md`'s "Staging changes, and rule files on PR runs" section still fits.
