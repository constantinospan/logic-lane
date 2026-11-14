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
Runs on GitHub Actions for each PR. Plays the game in a real browser at phone, tablet and desktop sizes,
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
- Resume window: 3 hours from the last save (one setting, easy to change). Saves also happen when the app is
  hidden or closed.
- An installed app always opens at its start page, so on startup, a fresh save from the play screen goes straight
  back into that game. Pressing 🏠 keeps the save for a "Continue" button on that game's picker, but doesn't
  auto-resume on the next start.
- One resume slot: starting a different game replaces it.
- If the browser blocks storage or it's full (e.g. Safari "Block All Cookies"), saving falls back to memory. She
  can always play; only resume after a reload is lost.
- sessionStorage was rejected: lost when an installed app is closed or killed in the background.
- GitHub Pages is static and cannot write files; writing to the repo from the page would expose a token. Rejected.
- External backends (Supabase/Firebase/Cloudflare) rejected for now to avoid external services.
- All save/load goes through one storage module, so cross-device sync or per-account login can be added later
  without touching the games.

### D8. Plain JavaScript (ES modules), no build step
- Shipped files = repo files. No framework. One exception: the deploy job writes `VERSION` in `sw.js` (D16), and
  nothing else.
- Type checking via JSDoc comments checked by TypeScript in CI (no compilation).
- Dev tooling only for checks, pinned exactly: Vitest 4.1.12 (unit), Playwright 1.64.1 (browser), TypeScript 6.0.3
  (`checkJs`; 6.x is the last JS-based compiler), @vitest/coverage-v8 4.1.12 (coverage), @axe-core/playwright
  4.14.0 (accessibility). The owner wants as many tests as possible.
- Coverage minimum: **every file** in the shared core (`js/core/`) stays at 100% of lines, statements and functions,
  and 95% of branches. `npm test` fails below that. `npm run check` runs everything; CI runs the same checks before deploy on Node 24.
- Browser tests: phone (Chromium, 390×844, touch), tablet (**WebKit**, Safari's engine, 820×1180, touch), desktop
  (Chromium, 1280×800). See `docs/TESTING.md`.
- Visual snapshots (Playwright `toHaveScreenshot`) of every screen at all three sizes. Pictures depend on the
  machine's fonts, so they run only with `VISUAL=1`, on one pinned machine (`ubuntu-24.04`, same setup in CI and the
  builder). Missing pictures fail in CI (never written quietly), and a test that only passes on retry fails the run.
  Pictures change only for an intended visual change.
- CI (`.github/workflows/ci.yml`): Node 24, `npm ci`, Playwright browsers, the same checks as `npm run check`,
  split for speed: type check + unit tests on one machine, browser tests in 3 shards, all at once. A final `test`
  job is the required check on `main`, enforced for admins too. It passes only if every part passed, and is never
  skipped (GitHub counts a skipped required check as passed), so on a manual snapshot run it's red on purpose. If CI
  itself breaks, the owner can briefly allow bypassing (README).
- Rejected: Vite+TypeScript, Svelte (build step not worth it at this size), game engines (too heavy for grid puzzles).

### D9. Installable app (PWA)
- Web app manifest + service worker: home-screen icon, full screen (no browser bar), works offline.
- New versions show on next open, with a "new version available" refresh prompt.
- Technical defaults: rendering with HTML/SVG + CSS animations; pointer events so touch and mouse share one input path.

### D10. Language and reading level
- English only. Child (5yo) reads simple, easy English words.
- Icons and pictures first; any text is short, simple words.
- One 🔊 speaker button in the top bar reads the current instruction aloud (browser built-in speech, no audio
  files). It costs no extra space on small screens; using it is optional for her. Games can change what it reads,
  e.g. to a hint. (Owner chose this over one button per instruction, 2026-11-13.)

### D11. Home screen
Big game tiles, tap to play. No profiles, no long-term progress shown.

### D12. Procedurally generated puzzles (all games)
- Difficulty per level is fixed and defined by rules (e.g. grid size, path length, turns, obstacles).
- Layout / positions / answers are random each time, so replaying never repeats the same puzzle.
- Every generated puzzle must be solvable: generate the solution first, then build around it; verify with a solver.
- Seeded randomness: the seed is saved with the game state (D7), so resuming restores the same puzzle, and can be used
  to reproduce a puzzle for bug fixes. Seeds are 6 characters (e.g. `k3x9q2`). A long-press on the level
  indicator shows `level · seed` for 5 seconds, for bug reports.
- Each game has a `version`, which is bumped when its generator changes. Saves from an older version are dropped.
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
- Builder = Claude GitHub Action (`.github/workflows/claude.yml`), triggered by `@claude` from users with write
  access only (bots blocked by default). Our workflow adds a stricter guard: only `constantinospan`, and only on
  issues and PRs `constantinospan` opened, so Claude never reads a stranger's issue text. One run per issue or PR
  at a time. Pinned to an action release at least 2 weeks old (full commit SHA), like every other action.
- Builder settings: `include_comments_by_actor: constantinospan`; full history (for revert); same machine and
  browsers as CI (`VISUAL=1`); `actions: read` so it can read failed CI logs; an allow-list of shell commands (the
  checks, `npx playwright test`, `git revert`, read-only git). Anything not on the list is denied (the action runs
  without a way to ask), so widen the list if the builder gets stuck. Owner-only triggering is the main boundary.
- Install via the Claude GitHub App (`/install-github-app`). Its pushes trigger other workflows; the default
  GITHUB_TOKEN would NOT, so never rely on GITHUB_TOKEN for pushes that must trigger review/deploy.
- The action pushes a branch and posts a "Create PR" link (one tap); it does not open PRs itself by default.
- The action cannot edit `.github/workflows/*`. Pipeline changes go through a local session, or by hand
  (claude.ai/code may share the same limit; untested).
- On PR runs the action restores `CLAUDE.md` and `.claude/` from the base branch; PR versions go to `.claude-pr/`.
- Screenshots: no native PR image upload. The review workflow (not the AI) commits them to a dedicated
  `review-screenshots` branch, in `pr-<n>/<sha7>/`, kept for good (owner, 2026-11-14), and embeds them in the verdict
  comment, linked by commit so caches never show old pictures. That branch has no CI and is never merged.
- Public-repo hygiene: keep `show_full_output` off (logs are public); limit comments Claude reads to the owner
  (`include_comments_by_actor`); only `@claude` on the owner's own issues.
- Branch protection on `main`: tests must pass before merge.
- Squash merges only (merge commits and rebase merging are off): one commit per PR, so reverting is always one step.
- Reviewer is a separate run with a strict, critical prompt and checklist; the parent is the final judge.
- Reviewers run in `.github/workflows/review.yml`, started by `workflow_run` when CI passes (decided 2026-11-14, step
  6b). GitHub always runs `main`'s copy of a `workflow_run` workflow, so a PR can't change the review that judges it.
  For the same reason the workflow checks out `main` at the workspace root (rules, prompts, scripts in
  `tools/review/`) and the PR's code in `pr/`. The action doesn't restore the agent files from `main` on
  `workflow_run`, so the fix job does it itself, the same way.
  - Runs only for same-repo PRs opened by `constantinospan` and pushed by them or the Claude app (`allowed_bots:
    claude`, so re-reviews after a fix push work).
  - Reviewer jobs use the read-only job token and can't write to GitHub. Secrets are hidden from the commands Claude
    runs (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`). What they read is collected for them first (`review-input/`).
    The scrub needs bubblewrap (Ubuntu's own package), which the workflow installs before each Claude step; without
    it Claude Code refuses to start (found in the first proof run, 2026-11-14).
  - Only the verdict job writes (comment, labels, the `ai-review` commit status, the screenshots branch). It has no
    AI and never runs the PR's code.
  - Known leftover risk, accepted because only the owner's own PRs are reviewed: the play reviewer can run Node
    scripts it writes, with network access, in a job where the Claude token exists in the parent process. Text in a
    PR that steered it could in theory leak that token. If PRs from anyone else are ever reviewed, sandbox those
    scripts first.
  - Switches (repo variables): `AI_REVIEW=on` runs reviews, `AI_FIX=on` runs fix rounds. Anything else is off.
  - Proof exception (owner, 2026-11-14): a `workflow_run` workflow only runs once it's on `main`, so it can't be
    proven on GitHub before merge, as "Changing CI" in `CLAUDE.md` asks. It merges switched off, then is proven with
    throwaway PRs (at least 3 green runs, plus planted problems), and step 6b is ticked only after that. It can't
    block merges or deploys: the required `test` check doesn't depend on it.
- Quota: runs share the owner's Max limits. Reviewers run only after tests pass. What runs when is set by D19.
  `CLAUDE.md`, `docs/REVIEW-CHECKLIST.md`, `docs/DECISIONS.md` and `.claude/` never count as docs-only: they're always reviewed.

### D16. Second review round
- Only the owner can trigger the builder (write access required; no collaborators; bots blocked).
- Fork PRs: review workflow runs only when PR author is the owner; repo setting requires approval for all
  outside contributors' workflow runs. Never use `pull_request_target`. Forks don't get repo secrets.
- PWA cache version = a hash of the shipped files, written into `sw.js` `VERSION` by the deploy job
  (`tools/build-site.mjs`: copies only the shipped files to the Pages artifact, stamps the hash, nothing else; a
  live check after deploy confirms the new `sw.js` is served). It's
  `dev` in the repo. Never edit it by hand. A docs-only change keeps the same hash (no update prompt). A revert
  goes back to the earlier hash (the files are identical again). That still differs from what's installed, so
  devices that had the reverted version see the update banner.
- Every shipped file is listed in `PRECACHE` in `sw.js`, which a test checks.
- All this account's `*.github.io` sites share one origin, so every storage key and cache name is prefixed
  `logic-lane:`. Nothing clears storage or caches it didn't create.
- The "⬆️ New!" banner updates the app (resume brings her back to the same puzzle).
- Emergency reset is parent-only: hold the home title for 3 s, then hold "Reset" for 3 s. It works online only,
  clears only `logic-lane:` data and caches, and reloads.
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
- Rounds are counted by labels `ai-fix-1` and `ai-fix-2`, added by the workflow before the AI starts, so the limit
  never depends on what the AI writes. A fix run that pushes nothing adds `needs-you` (also done by the workflow).
- The fix run pushes with the Claude app token, so its push starts CI. "Require approval for all outside
  contributors" is kept (owner, 2026-11-14). In step 7 GitHub held the app's pushes for an Approve tap; in the 6b
  proof (2026-11-14) it didn't. The fix comment says to tap Approve only if GitHub asks.
- If a fix run skips an item on purpose (e.g. it would undo what the owner asked for), the workflow adds `needs-you`
  and uses up the remaining rounds, because another round would only skip it again (owner, 2026-11-14). The fix run
  reports the count in `review-input/skipped-count`.
- A review that didn't finish (a reviewer crashed or timed out) is never ✅ and never starts a fix: it's posted as
  ⚠️ with `needs-you`.
- The fix loop is optional (owner, 2026-11-14): `AI_FIX` is **off** by default after the 6b proof. A ❌ verdict then
  ends with "comment `@claude fix the Blocking items`", and the owner switches `AI_FIX` on when they want fixes to
  start by themselves. Reason: plan usage.
- The fix run gets the owner's own words (the PR description and the owner's comments), so it can skip an item that
  would undo something the owner asked for.

### D18. Child privacy in a public repo
- Never put the child's name, photos, school or other identifying details in the repo, issues, PRs or screenshots.
- Added to the agent rules and the review checklist.

### D19. Two AI reviewers on GitHub: play and code (decided 2026-11-13, built in plan step 6b)
- **Play reviewer:** opens the PR's site in a browser at phone, tablet and desktop sizes, plays the changed game and
  posts screenshots. Owns checklist §1, §2, the *(play)* items of §3, and §4. Runs only when shipped files changed
  (`tests/shipped-files.js`).
- **Code reviewer:** reads the PR's changes, no browser. Looks for bugs, edge cases, offline/update logic and rule
  breaks. Owns the *(code)* items of §3, §5 and §6. Runs on every PR except docs-only ones (rule files always count).
- Why both: PR #2's review found 4 code-level bugs (e.g. an update could cache old files) that neither tests nor
  playing would catch.
- Both write into one ✅/❌ verdict. The automatic fix loop works from the combined Blocking list (max 2 rounds, D17).
- Until 6b exists, a fresh agent reviews each PR by hand before it's handed to the owner.
- Fixed checks don't depend on the AI: `tools/review/shots.mjs` takes the standard screenshots (home, and each
  affected game's picker and first Easy puzzle, at all three sizes) and logs console errors and requests to other
  sites. Those two are Blocking automatically. They're saved before the AI starts, so it can't change them. The play reviewer drives the browser with the repo's existing
  Playwright (no new package).
- The verdict is built by a plain script (`tools/review/verdict.mjs`) from both reviewers' structured answers. It
  also sets the `ai-review` commit status on the PR (not a required check).

### D20. Keeping CI short as games are added (decided 2026-11-14)
Goal: CI stays around 2 minutes however many games there are. Each game adds roughly 45 browser tests; without
these rules that's about +17 s per game (10 games: about 4.5 min).
1. **Heavy checks are unit tests.** Solvability and difficulty over many puzzles run in Node (milliseconds), not in
   a browser. Each game's browser tests stay few: play, mistake, solve, its screens' pictures. Applies from the
   first game (step 8).
2. **A PR runs what it could have broken.** A PR that only changes `games/<id>/` (and that game's tests) runs the
   shared tests plus that game's tests. Anything outside `games/<id>/` counts as shared and runs everything, so new
   folders are safe by default. Docs-only PRs run the quick checks. Merges to `main` always run everything
   before deploy, so a miss blocks the deploy and the live site keeps the last good version. A test enforces
   that games never import another game's files, so one game's change can't break another.
3. **Machines grow with the tests.** CI counts the browser tests and starts about one shard per 50 (public repos:
   free minutes, up to 20 machines at once).
- **When:** rules 2 and 3 are built when `main`'s CI takes more than 2m30s, or at the third game, whichever comes
  first (PLAN step 10). Rule 1 is part of every game.

