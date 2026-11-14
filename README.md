# Logic Lane

Small logic and puzzle games for young children, playable on phone, tablet and desktop.

**Play:** https://constantinospan.github.io/logic-lane/

> 🚧 Setup in progress: the site, tests and AI pipeline below are being built. See [docs/PLAN.md](docs/PLAN.md) for status.

## Install on a tablet or phone
- **iPad / iPhone (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).

It then opens full screen from its own icon and works offline.

## Asking for a new game, a change or a fix
Use whichever is handy. All three end in a pull request (PR) for you to merge.

| From | How |
|---|---|
| GitHub (web or phone app) | Open an issue describing what you want, and include `@claude` in it (or in a comment). |
| claude.ai/code or the Claude app | Start a session on the `logic-lane` repo and describe what you want. |
| A local Claude Code session | Open this folder and describe what you want. |

⚠️ **Issues and comments are public.** Never write her name or other personal details in them.
`@claude` only works on issues and PRs you opened yourself. On anyone else's issue it does nothing.

What happens next:
0. **Idea check** (when it's switched on): before anything is built, an AI reviewer checks the request as an idea
   against the rules and decisions (`docs/IDEA-CHECKLIST.md`). A script gives it a score out of 100.
   - **Pass** (75 or more, nothing against the rules): a short ✅ comment, then building starts as usual.
   - **Fail:** a ❌ comment with numbered questions and the `needs-you` label. Reply `@claude` with your answers
     (numbers are fine) and it checks again, or reply `@claude go anyway` to build it as you asked. Remove the
     label yourself when you're done.
   - ⚠️ means the check didn't finish: ask again, or `@claude go anyway`.
   - These skip the check, but only when they're the whole comment: `@claude revert PR #N`, `@claude go anyway`,
     `@claude fix the Blocking items`, `@claude fix CI`, `@claude CI is red`.
   - Sessions (claude.ai/code or local) run the same check and ask you the questions there.
   - The on/off switch (`enabled`), the pass mark and the points per finding are in `tools/idea/settings.json`. To
     change them, ask for it like any other change (for example, an issue saying `@claude set the idea pass mark to
     70`). The new value counts from when that PR is merged.
1. Claude builds it on a branch and runs the tests (about 2–5 minutes). On GitHub it posts a **Create PR** link:
   tap it, then **Create pull request**. To watch it work, open the repo's **Actions** tab.
   - On a phone, if the **Create pull request** button doesn't show: in Safari tap **aA** → **Request Desktop
     Website**, or open the repo in the GitHub app and use its **Compare & pull request** banner.
   - When you ask `@claude` for changes on an open PR, GitHub holds the test run until you approve it: on the PR
     (in a browser), tap **Approve and run workflows**.
2. Tests run on the PR (the **test** check). A red ✗ means something broke, and the PR can't be merged until it's
   fixed. Comment `@claude fix the failing tests`.
   When the tests pass, two AI reviewers run (about 5–15 minutes): one plays the game in a browser at phone, tablet
   and desktop size, the other reads the code. They post **one comment**: ✅ pass, ❌ with a numbered list of what
   to fix, or ⚠️ if a reviewer didn't finish. Screenshots are in the comment, and the PR's checks list shows an
   **ai-review** line with the same result.
   - On ❌, if `AI_FIX` is on, Claude tries to fix the list itself (up to 2 rounds). The tests and the review then run
     again by themselves. If GitHub asks for approval on the PR, tap **Approve and run workflows** (in a browser).
     With `AI_FIX` off (the default), comment `@claude fix the Blocking items` when you want a fix.
   - After 2 rounds, if a fix pushes nothing or leaves something for you to decide, or if the review didn't finish,
     the PR gets the `needs-you` label.
     Comment `@claude` with what to do, or re-run **AI review** from the Actions tab.
   - PRs that only change docs aren't reviewed, except changes to the agent rules (`CLAUDE.md`, the checklist,
     `docs/DECISIONS.md`, `.claude/`), which always are. Those, and changes to the pipeline itself, get a ⚠️ banner
     in the verdict: read them yourself before merging too.
3. You look at the verdict and screenshots, then **Merge**. Or comment `@claude` on the PR with what to change,
   and it updates the same PR.
4. Merging runs the tests once more, then publishes the change to the live site within a few minutes. Installed apps show a **⬆️ New!** button
   when they're next opened. Tapping it updates, and she carries on from the same puzzle.

Only the repo owner can trigger Claude. Other people's issues or comments can't start it.

## Something broke: rolling back
- **On github.com in a browser** (the button isn't in the GitHub phone app): open the merged PR that caused it, tap
  **Revert**, then **Create pull request**, then merge it.
- **Or from anywhere:** open a new issue saying `@claude revert PR #N` (with the PR's number).
  This can't revert a PR that changed the pipeline (`.github/workflows/`). For those, use the Revert button.

## If the app gets stuck
On the home screen, hold the **Logic Lane** title for 3 seconds, then hold **Reset** for 3 seconds. It needs
internet. It clears only Logic Lane's own data and reloads.

To report a puzzle that looks wrong: long-press the level number at the top. It shows something like `12 · k3x9q2`.
Put that in the issue so Claude can recreate the exact puzzle.

## Maintenance
- **Claude token:** the `CLAUDE_CODE_OAUTH_TOKEN` repo secret comes from the owner's personal Claude Max plan and expires
  about a year after it was created (created 2026-11, so renew around 2027-11). When Claude runs start failing with
  an authentication error, run `claude setup-token` in a normal terminal, then
  `gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo constantinospan/logic-lane`. Never paste the token into a chat.
- **Usage limits:** Claude runs use the Max plan's limits. If a run fails because a limit was reached, re-run it later.
- **AI review switches:** Settings → Secrets and variables → Actions → **Variables**. `AI_REVIEW` = `on` runs the
  reviewers, `AI_FIX` = `on` runs automatic fix rounds. Set either to `off` (or delete it) to stop it, e.g. when the
  plan's limits run low. Works from the phone in a browser.
- **Review screenshots** live in the `review-screenshots` branch (one folder per PR and commit). Never merge it.
- **If the tests themselves break** (not your change: e.g. a GitHub outage, or GitHub changes its test machines),
  nothing can be merged, not even a revert. Settings → Branches → `main` → untick **Do not allow bypassing the
  above settings**, merge the fix or revert, then tick it again. If only the visual snapshot pictures are off
  after a GitHub machine change, comment `@claude` on a PR asking it to update the visual snapshots.
- **Approvals:** you can't approve your own PRs, so never switch on "require approvals" for `main`. Merging is the
  approval.

## Running the tests
`npm ci`, `npx playwright install chromium webkit`, then `npm run check`. GitHub runs them on every PR too.
Details: [docs/TESTING.md](docs/TESTING.md).

## How it's built and why
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Build plan and progress: [docs/PLAN.md](docs/PLAN.md)
- Review checklist: [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md)
- Rules for AI agents: [CLAUDE.md](CLAUDE.md)
- Adding a game: [docs/GAME-API.md](docs/GAME-API.md)
- Testing: [docs/TESTING.md](docs/TESTING.md)
