# Logic Lane — Planning Decisions

Simple educational puzzle games for a 5-year-old (coding-style puzzles: arrows to treasure, etc.).
Must work on mobile and desktop. Private-ish use; public URL is acceptable, not advertised.

## Planning parts

1. Hosting & environments — **decided**
2. Workflow (request → production) — **decided**
3. Tech approach — **decided** (D8, D9)
4. Saving progress — **decided** (D7)
5. Home screen & first games — **decided** (D10–D14)

## Decisions

### D1. Public GitHub repo, hosted on GitHub Pages
Free tier requires a public repo for Pages. Only code is visible; saved progress stays on the device.
Re-confirmed after review: a private code repo + public display repo was considered and rejected. The public repo's
write-access check + fork guards (D16) already ensure only the owner can trigger AI runs.

### D1a. Name and URL
Project/repo name: **logic-lane**, under the owner's personal GitHub account `constantinospan`.
Site URL: `https://constantinospan.github.io/logic-lane/`. Chosen to suggest thinking and logic,
not "games" and not literal coding.

### D2. One repo, one long-lived branch (`main`), no separate dev environment
- GitHub Pages serves one site per repo. A `/dev/` path or second display repo was possible but rejected for simplicity.
- Safety comes from: tests gating deploys, AI review on every PR, human merge, and `git revert` as fallback.
- Can add a `/dev/` preview later if testing on the real tablet before merge becomes necessary.

### D3. Every change arrives as a pull request
```
request → agent builds on a short-lived branch → PR
       → automated tests + AI review agent (screenshots + verdict posted on PR)
       → owner merges (possible from phone) → GitHub Actions deploys to Pages
```
- Deploy only happens from `main` and only when tests pass.

### D4. AI review agent covers what tests can't
Runs on GitHub Actions for each PR. Plays the game in a real browser at phone and desktop sizes,
takes screenshots, checks against a review checklist (to be written: big tap targets, minimal reading,
clear feedback, levels solvable, gentle difficulty curve, …). Final "is it fun" judgement stays with the parent.

### D5. Portable: the agent's "brain" lives in the repo
Agent instructions, review checklist and tests are in the repo, so any entry point behaves the same.
Requests can come from:
| Entry point | Runs on | Laptop needed |
|---|---|---|
| GitHub issue / comment mentioning `@claude` (Claude GitHub Action) | GitHub Actions | No |
| claude.ai/code (web or Claude mobile app) | Anthropic cloud | No |
| Local Claude Code session | Laptop | Yes |
| Remote Control of local session | Laptop | Yes (must stay on) |

One-time setup for claude.ai/code: connect GitHub, install Claude GitHub app on the repo.

### D6. GitHub Action authenticates with the owner's personal Claude Max subscription
One-time: run `claude setup-token`, store the token as repo secret `CLAUDE_CODE_OAUTH_TOKEN`.
Usage counts against Max plan limits; no per-use billing. Never use a work/org account.

### D7. No long-term progress; only crash protection via localStorage with a time limit, no external services
- Every visit is a new start. No profiles, no saved progress between visits.
- Current game state is kept in localStorage with a timestamp. If she comes back within the resume window,
  the game resumes where it was (survives refresh, app swiped away, tablet killing the app); after it, fresh start.
- Resume window: 3 hours (one setting, easy to change).
- sessionStorage was rejected: lost when an installed app is closed or killed in the background.
- GitHub Pages is static and cannot write files; writing to the repo from the page would expose a token. Rejected.
- External backends (Supabase/Firebase/Cloudflare) rejected for now to avoid external services.
- All save/load goes through one storage module, so cross-device sync or per-account login can be added later
  without touching the games.

### D8. Plain JavaScript (ES modules), no build step
- Shipped files = repo files. No framework.
- Type checking via JSDoc comments checked by TypeScript in CI (no compilation).
- Dev tooling only for checks: unit tests (Vitest), browser tests (Playwright, phone + desktop sizes). Runs in CI before deploy.
- Rejected: Vite+TypeScript, Svelte (build step not worth it at this size), game engines (too heavy for grid puzzles).

### D9. Installable app (PWA)
- Web app manifest + service worker: home-screen icon, full screen (no browser bar), works offline.
- New versions show on next open, with a "new version available" refresh prompt.
- Technical defaults: rendering with HTML/SVG + CSS animations; pointer events so touch and mouse share one input path.

### D10. Language and reading level
- English only. Child (5yo) reads simple, easy English words.
- Icons and pictures first; any text is short, simple words.
- Every instruction has a speaker button that reads it aloud (browser built-in speech, no audio files).
  The button is always there; using it is optional for her.

### D11. Home screen
Big game tiles, tap to play. No profiles, no long-term progress shown.

### D12. Procedurally generated puzzles (all games)
- Difficulty per level is fixed and defined by rules (e.g. grid size, path length, turns, obstacles).
- Layout / positions / answers are random each time, so replaying never repeats the same puzzle.
- Every generated puzzle must be solvable: generate the solution first, then build around it; verify with a solver.
- Seeded randomness: the seed is saved with the game state (D7), so resuming restores the same puzzle, and can be used
  to reproduce a puzzle for bug fixes.
- Tests generate many puzzles per difficulty and assert solvable + within difficulty bounds.

### D13. Game backlog
1. **Arrow path** (first): place arrows to guide a character to the treasure; later levels add loops and debugging.
2. **Word guessing**: like Taboo but no forbidden words; easy enough for 5–7 year olds. Name TBD.
3. **What comes next?**: identify/continue the pattern. Name TBD.

### D14. Difficulty: one ladder per game, chosen before every game
- Every game starts with a difficulty picker (shared screen, built once): Easy / Medium / Hard.
- Each game has ONE ladder of levels; Easy/Medium/Hard are starting points on it.
- Long ladders so she can stay in one game a while. Default: ~30 levels, several random puzzles per level
  before moving up; e.g. Easy starts at 1, Medium ~11, Hard ~21 (tunable per game).
- Arrow path v1 ships with the full ~30-level ladder (no smaller pilot).
- Above the top level: endless fresh puzzles at max difficulty.

### D15. AI implementation details (from review against claude-code-action docs)
- Builder = Claude GitHub Action, triggered by `@claude` from users with write access only (bots blocked by default).
- Install via the Claude GitHub App (`/install-github-app`). Its pushes trigger other workflows; the default
  GITHUB_TOKEN would NOT, so never rely on GITHUB_TOKEN for pushes that must trigger review/deploy.
- The action pushes a branch and posts a "Create PR" link (one tap); it does not open PRs itself by default.
- The action cannot edit `.github/workflows/*`. Pipeline changes go through a local session, or by hand
  (claude.ai/code may share the same limit; untested).
- On PR runs the action restores `CLAUDE.md` and `.claude/` from the base branch; PR versions go to `.claude-pr/`.
- Screenshots: no native PR image upload. Reviewer commits screenshots to a dedicated `review-screenshots` branch
  and embeds the links in its PR comment.
- Public-repo hygiene: keep `show_full_output` off (logs are public); limit comments Claude reads to the owner
  (`include_comments_by_actor`); only `@claude` on the owner's own issues.
- Branch protection on `main`: tests must pass before merge.
- Squash merges only (merge commits and rebase merging are off): one commit per PR, so reverting is always one step.
- Reviewer is a separate run with a strict, critical prompt and checklist; the parent is the final judge.
- Quota: runs share the owner's Max limits. Reviewer runs only after tests pass; skip it for docs-only changes.
  `CLAUDE.md`, `docs/REVIEW-CHECKLIST.md`, `docs/DECISIONS.md` and `.claude/` never count as docs-only: they're always reviewed.

### D16. Second review round
- Only the owner can trigger the builder (write access required; no collaborators; bots blocked).
- Fork PRs: review workflow runs only when PR author is the owner; repo setting requires approval for all
  outside contributors' workflow runs. Never use `pull_request_target`. Forks don't get repo secrets.
- PWA cache is versioned per deploy; update prompt is tested; an emergency "clear cache" path exists.
- Site lives under `/logic-lane/`: relative paths only; tests run under the same base path.
- Max OAuth token expires (~1 year): renewal reminder in README; failures are loud.
- Quota exhausted → run fails; re-run later.
- One open request per game at a time to avoid conflicts.
- Rollback: "Revert" button on the merged PR, or `@claude revert` (documented in README).
- Checklist includes child safety: no external links, no ads, no data collection, age-appropriate content.
- When the owner rejects something the reviewer passed, the reason is added to the checklist.

### D17. Automatic fix loop on reviewer ❌
- Not via bot comments (builder ignores bots by default). The review workflow itself starts a fix run when it
  returns ❌, pushing to the same PR branch, which re-triggers tests + review.
- Max 2 automatic fix rounds per PR; then stop, add label `needs-you`, owner gets notified.

### D18. Child privacy in a public repo
- Never put the child's name, photos, school or other identifying details in the repo, issues, PRs or screenshots.
- Added to the agent rules and the review checklist.
