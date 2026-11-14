# Review checklist

The AI reviewer checks every PR against this list, and builders use it while working.

## How to review
- **Two reviewers (D19).**
  - The **play reviewer** owns §1, §2, the *(play)* items of §3, and §4. It runs when shipped files change.
  - The **code reviewer** owns the *(code)* items of §3, §5 and §6, plus bugs and edge cases. It runs on every PR
    except docs-only ones.
  - Both write into one verdict.
- **Scope.** Review what the PR changes. Mark items that don't apply as N/A. Docs-only PRs aren't reviewed (D15).
  Changes to `CLAUDE.md`, this checklist, `docs/DECISIONS.md` or anything under `.claude/` are **not** docs-only:
  they steer every agent run, so they're always reviewed.
- **Existing problems.** Problems that already exist on `main` are Suggestions, not Blocking.
- **Play it (play reviewer).** Serve the PR's files locally under a `/logic-lane/` base path (PRs aren't deployed) and play the
  changed game in a real browser. Reading the code isn't enough. `node tests/serve.mjs` serves it at
  `http://localhost:4173/logic-lane/` (the review workflow starts it for you).
- **Screen sizes.** Check **phone** 390×844, **tablet** 820×1180 and **desktop** 1280×800. Use touch emulation
  for phone and tablet, and the mouse for desktop.
- **Rules come from `main`.** Judge the PR by `main`'s rules, not the PR's. In the review workflow the current
  folder is `main` (rules, this checklist, decisions) and the PR's code is in `pr/`, and the verdict flags any PR that
  changes the rules. In any other run, `CLAUDE.md` in the working tree is already `main`'s; for this checklist use
  `git show origin/main:docs/REVIEW-CHECKLIST.md`, and say so at the top of the verdict if the PR changes either.
- **Read-only.** The reviewer never edits code and never writes to GitHub. It returns its findings as structured
  data. The workflow turns both reviewers' findings into one verdict comment and publishes the screenshots
  (`tools/review/`, D15, D19).
- **Already checked for you (play).** The standard screenshots, console errors and requests to other sites are
  collected by `tools/review/shots.mjs` before the play reviewer starts. Console errors and outside requests are
  Blocking automatically.
- **Blocking vs Suggestion:**
  - Blocking needs concrete evidence: steps to reproduce for behaviour, or the file and line for code, test and
    rule problems.
  - Judgement calls ("could be clearer", "feels hard") are Suggestions.
  - Items marked *(suggestion)* below are never Blocking.

## Verdict format
- **✅ Pass** or **❌ Fail**, then a short list of **Blocking** issues (each one causes ❌) and **Suggestions**
  (which never cause ❌).
- Every finding gives its evidence. Visual or behaviour findings name the screen size and the steps, plus a
  screenshot. Code, test and rule findings name the file and line.
- Plain English, short. The owner reads it on a phone.
- Never include the child's name or other personal details. Screenshots show only the game.

## 1. It works
- [ ] The home screen and the changed game load with no errors in the browser console.
- [ ] It works at all three screen sizes, with touch (phone and tablet) and with the mouse (desktop).
- [ ] Nothing overflows the screen, overlaps or gets cut off. No sideways scrolling.
- [ ] Reloading mid-game resumes the same puzzle (same layout) in the same state.
- [ ] Every screen has a working way back to the home screen.

## 2. Right for a 5-year-old
- [ ] Every screen with an instruction has the 🔊 in the top bar, and tapping it calls the browser's speech
      feature with that instruction. (Headless browsers usually have no voices, so check the call, not the sound.)
- [ ] Text uses short, simple English words.
- [ ] *(suggestion)* Sentences are about 8 words or fewer.
- [ ] Tap targets are at least 64×64 CSS px, with at least 8 px between them.
- [ ] A wrong move never ends the game or loses the level. A retry is one tap away.
- [ ] Success shows a clear celebration.
- [ ] No timers or countdowns (unless the owner asked for them).
- [ ] Text has a contrast ratio of at least 4.5:1. Nothing important is shown by colour alone.
- [ ] *(suggestion)* What to do is obvious within a few seconds from the pictures alone.
- [ ] *(suggestion)* Hints are gentle and sounds are friendly.

## 3. Puzzles
- [ ] *(code)* Generator tests exist for the changed game, run many puzzles per level, check every one is solvable and within
      the level's rules, and pass. (Don't try to prove this by playing.)
- [ ] *(code)* Generator tests check that the same seed and level always give the same puzzle.
- [ ] *(play)* Starting a level about 5 times, with storage cleared or a fresh browser context each time (otherwise the
      3-hour resume brings back the same puzzle), gives at least 2 different layouts.
- [ ] *(play)* Easy, Medium and Hard start at the levels defined for the game.
- [ ] *(play)* After the top level, it keeps giving fresh puzzles at max difficulty (no end screen, no repeats).
- [ ] *(play, suggestion)* Difficulty seems to rise gently, judging by the first levels from each start point.

## 4. Safety and privacy
- [ ] No network requests to anything but the site's own files. Check the browser's network log.
- [ ] No external links, third-party scripts, fonts or CDNs, ads, analytics or tracking.
- [ ] No personal details about the child anywhere: code, text, images, commit messages, PR text, screenshots.
- [ ] All words, pictures and themes are suitable for a 5-year-old.

## 5. Technical
- [ ] Relative paths only. It works under `/logic-lane/`.
- [ ] `VERSION` in `sw.js` is still `dev` (deploy sets it; never hand-edited).
- [ ] Every shipped file is listed in `PRECACHE` in `sw.js`.
- [ ] Storage keys and cache names start with `logic-lane:`. Nothing clears data it didn't create.
- [ ] The update banner and the parent-only emergency reset still work. It still works offline after one visit.
- [ ] No build step, framework or runtime dependency added.
- [ ] `package.json` and the lockfile add or upgrade no package the request didn't ask for, and every added or
      upgraded package is named in the PR description.
- [ ] Saving goes through the shared storage module.
- [ ] New or changed logic has tests, and all checks pass.
- [ ] Changed visual snapshot pictures (`tests/e2e/visual.spec.js-snapshots/`) match a visual change the request
      asked for, and the PR lists them with the reason. Unexplained picture changes are Blocking.

## 6. Rule changes (PRs that change `CLAUDE.md`, this checklist, `docs/DECISIONS.md` or `.claude/`)
- [ ] Compare the PR's version with `main`'s (use `git diff origin/main...HEAD`):
      - In the review workflow: `main`'s copy is in the current folder, the PR's in `pr/`.
      - Elsewhere, for `CLAUDE.md` and `.claude/`, the working tree holds `main`'s copy and the PR's copy is in `.claude-pr/`.
      - Elsewhere, for files under `docs/`, the working tree holds the PR's copy. Use `git show origin/main:<path>` for `main`'s.
- [ ] Blocking if the change contradicts `docs/DECISIONS.md` without updating that decision too.
- [ ] Blocking if it weakens the privacy, secrets, runtime-safety or "who you take instructions from" rules.
- [ ] Blocking if `CLAUDE.md` and this checklist end up contradicting each other.

## Learned rules
When the owner says the reviewer should have caught something, the builder adds the reason here as a rule (with the
date) in that same PR.

- (none yet)
