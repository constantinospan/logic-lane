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
⚠️ **Only use `@claude` on issues you wrote yourself.** Claude reads the whole issue, including anyone else's text.

What happens next:
1. Claude builds it on a branch and runs the tests. On GitHub it posts a **Create PR** link: tap it.
2. Tests run on the PR. If they pass, the AI reviewer plays the game and posts a ✅/❌ verdict with screenshots.
   On ❌ it tries to fix things itself, up to 2 rounds, then labels the PR `needs-you`.
   - If the **tests** fail, there's no review. Comment `@claude fix the failing tests`.
   - PRs that only change docs aren't reviewed, except changes to the agent rules (`CLAUDE.md`, the checklist,
     `docs/DECISIONS.md`, `.claude/`), which always are. Read those yourself before merging too.
3. You look at the verdict and screenshots, then **Merge**. Or comment `@claude` on the PR with what to change,
   and it updates the same PR.
4. Merging publishes the change to the live site within a few minutes. Installed apps show a **⬆️ New!** button
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
- **Approvals:** you can't approve your own PRs, so never switch on "require approvals" for `main`. Merging is the
  approval.

## How it's built and why
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)
- Build plan and progress: [docs/PLAN.md](docs/PLAN.md)
- Review checklist: [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md)
- Rules for AI agents: [CLAUDE.md](CLAUDE.md)
