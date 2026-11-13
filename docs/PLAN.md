# Logic Lane — Build Plan

Decisions behind this plan: [DECISIONS.md](DECISIONS.md).
Times are rough. "Me" = the parent/owner, "Claude" = the AI agent.

| # | Step | What happens | Owner | Your time | Claude's time |
|---|------|--------------|-------|-----------|---------------|
| 1 ✅ | Repo | Create public GitHub repo, push docs, enable Pages (Actions source), protect `main`, require approval for outside contributors' workflows | Both | 10 min | 15 min |
| 2 ✅ | AI access | Install Claude GitHub App on the repo, run `claude setup-token`, store it as a repo secret | Me (Claude guides) | 10 min | — |
| 3 ✅ | Rulebook | `CLAUDE.md` (agent rules), `REVIEW-CHECKLIST.md`, `README.md` (rollback, token renewal) | Claude, you approve | 10 min read | 30 min |
| 4 ✅ | Shared base | Home screen, difficulty picker, refresh protection (localStorage, 3 h resume window), seeded random, installable app, styles | Claude | — | 2–3 h |
| 5 | Tests | Unit tests, browser tests at phone, tablet + desktop sizes, type checking | Claude | — | 1 h |
| 6a | Core pipeline | Tests gate + deploy, builder (`@claude`), fork guards. A working request → PR → merge → live loop | Claude | — | 1–1.5 h |
| 7 | Dry run | You open a small test issue from your phone, watch it go to PR → merge → live | Both | 30 min | 30 min |
| 6b | AI reviewer | Reviewer with screenshots, auto-fix loop (max 2). Added on top of the working loop; expect a few iterations | Claude | 10 min | 1.5–2 h |
| 8 | Arrow path v1 | Puzzle generator + solver, ~30-level ladder, Easy/Medium/Hard starts, loops later in the ladder | Claude | — | 3–5 h |
| 9 | Playtest | Install on the tablet, play with her, turn feedback into issues | Me | 20 min + play | — |

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
- To do in step 6a: allow the builder to run the test, type-check and browser-test commands (`claude_args: --allowedTools ...`)
  and install Playwright browsers in the job, so it can run checks before pushing.
- To do in step 6a: allow `Bash(git revert:*)` for the builder (via `claude_args: --allowedTools`) and check out with `fetch-depth: 0`, so
  "`@claude` revert PR #N" works. Test it in the step 7 dry run.
- Step 4 done: shared base, hidden demo game (`#/play/demo`), `docs/GAME-API.md`. Decided: one 🔊 in the top bar
  (D10), seed on long-press (D12), content-hash cache version stamped by deploy (D8, D16), parent-only reset (D16).
- To do in step 5: Vitest for `js/core/*` and the demo generator. Playwright at phone, tablet and desktop for the
  flows (home → picker → play, resume after reopening, celebration, Home then Continue, offline reset guard).
  A test that `PRECACHE` lists exactly the shipped files. A test of the update banner (serve a changed `sw.js`
  via `page.route`). `tsc` `checkJs`, with a separate config for `sw.js` (webworker lib).
- To do in step 6a: the deploy job writes a hash of the shipped files into `VERSION` in `sw.js` (only that line).
- Note for step 9: the iPad/iPhone silent switch can mute 🔊. Check it's off when testing speech.
- Check in step 9 on the real iPad: the 3 s holds (home title, Reset) and the seed long-press aren't cancelled by
  iOS (only tested in Chrome so far).
- To do in step 6a: set `include_comments_by_actor: constantinospan`, so Claude only reads the owner's comments
  (D15). Until then, the README's "anyone else's comments are ignored" only covers triggering.
- To do in step 6b: the reviewer and fix runs load `CLAUDE.md` and `docs/REVIEW-CHECKLIST.md` from `main`
  (the base branch), not the PR branch, so a PR can't change the rules it's judged by. The action already does
  this for `CLAUDE.md` and `.claude/`. The checklist (in `docs/`) must be read from `main` explicitly. The verdict flags any PR that
  changes them.
- To do in step 6b: the reviewer job checks out with `fetch-depth: 0`, so `git diff origin/main...HEAD` in checklist
  section 6 has the shared history it needs.
- To do in step 6b: the fix run must push with the Claude App token, not the default workflow token, or its push
  won't re-trigger tests and review.
- To check in step 7: can a claude.ai/code session push a change under `.github/workflows/`? Until then,
  pipeline changes are local-only.
- To check in step 7: when a claude.ai/code session opens a PR, is the PR author the owner or the Claude app?
  The reviewer's "owner-only" guard (D16) must allow whichever it is. If the author is the Claude app (a bot),
  the action treats the PR as coming from a non-write author and blocks npm and test runners on it, so `@claude`
  and fix runs couldn't run checks there. In that case, sessions should push the branch and let the owner open the PR.
- To decide in step 6b: how fix runs start. If not tied to the PR (e.g. `workflow_dispatch`), there's no
  `.claude-pr/` restore; check `CLAUDE.md`'s "Staging changes, and rule files on PR runs" section still fits.
- To do in step 6a: make the test job a required status check on `main`, then enforce the rules for admins too
  (left off for now so setup can bootstrap).
