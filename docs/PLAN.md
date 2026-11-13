# Logic Lane — Build Plan

Decisions behind this plan: [DECISIONS.md](DECISIONS.md).
Times are rough. "Me" = the parent/owner, "Claude" = the AI agent.

| # | Step | What happens | Owner | Your time | Claude's time |
|---|------|--------------|-------|-----------|---------------|
| 1 | Repo | Create public GitHub repo, push docs, enable Pages (Actions source), protect `main`, require approval for outside contributors' workflows | Both | 10 min | 15 min |
| 2 | AI access | Install Claude GitHub App on the repo, run `claude setup-token`, store it as a repo secret | Me (Claude guides) | 10 min | — |
| 3 | Rulebook | `CLAUDE.md` (agent rules), `REVIEW-CHECKLIST.md`, `README.md` (rollback, token renewal) | Claude, you approve | 10 min read | 30 min |
| 4 | Shared base | Home screen, difficulty picker, refresh protection (localStorage, 3 h resume window), seeded random, installable app, styles | Claude | — | 2–3 h |
| 5 | Tests | Unit tests, browser tests at phone + desktop sizes, type checking | Claude | — | 1 h |
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
