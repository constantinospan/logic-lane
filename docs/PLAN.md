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
| 8 | Arrow path v1 | Puzzle generator + solver, ~30-level ladder, Easy/Medium/Hard starts, loops later in the ladder | Claude | — | 3–5 h |
| 9 | Playtest | Install on the tablet, play with her, turn feedback into issues | Me | 20 min + play | — |
| 10 | Test scaling (D20) | **When `main`'s CI passes 2m30s or at the third game:** PRs run only what they could break, shards grow with the tests, a no-cross-game-imports test | Claude | — | 1–2 h |

**Totals (rough):** you ~1.5 h spread across steps 1, 2, 3, 7, 9; Claude ~1.5–2 days of work sessions.

Notes:
- Steps 1–6 are done from a local or claude.ai/code session (the GitHub builder can't edit workflow files).
- Step 8 is still delivered as a PR, so the reviewer runs on it.
- After step 9, everything is requests via issues / claude.ai/code / local, as in D3/D5.

## Progress notes
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
