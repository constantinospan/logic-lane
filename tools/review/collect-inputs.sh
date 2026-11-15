#!/usr/bin/env bash
# Gathers what the AI reviewers read, before they start, so they need no GitHub access themselves (their token is
# read-only, and secrets are hidden from the commands they run). Used by .github/workflows/review.yml.
#
# Usage: tools/review/collect-inputs.sh <out-dir> <pr-checkout-dir>
# Environment: GH_TOKEN, REPO, PR (number), RUN_ID (the CI run that passed).
set -euo pipefail

out=$1
pr_dir=$2
mkdir -p "$out"

gh pr view "$PR" --repo "$REPO" --json number,title,body,author,labels,headRefName,baseRefName,url > "$out/pr.json"
git -C "$pr_dir" diff --name-only --no-renames origin/main...HEAD > "$out/files.txt"
git -C "$pr_dir" diff --no-renames --stat origin/main...HEAD > "$out/diff-stat.txt"
git -C "$pr_dir" diff --no-renames origin/main...HEAD > "$out/diff.patch"

gh run view "$RUN_ID" --repo "$REPO" --json conclusion,event,headSha,jobs > "$out/ci.json"
# The lines that say how many tests ran, passed or were skipped, so PR claims can be checked against them.
gh run view "$RUN_ID" --repo "$REPO" --log 2>/dev/null \
  | sed -E 's/\x1b\[[0-9;]*m//g' \
  | grep -E '[0-9]+ (passed|failed|skipped|flaky|did not run)|Tests +[0-9]+|Test Files +[0-9]+' \
  | tail -n 80 > "$out/ci-tests.txt" || true

# The agreed brief (D21): the idea check's comments on this PR and on the issues it closes, plus the owner's PR
# comments. Soft: if anything here fails there's simply no brief, and the review carries on.
collect_brief() {
  # Called in an `||` list, where `set -e` is off, so each step returns on failure itself.
  local tmp issues n
  tmp=$(mktemp -d)
  issues=$(gh pr view "$PR" --repo "$REPO" --json closingIssuesReferences \
    --jq '.closingIssuesReferences[].number') || return 1
  gh api "repos/${REPO}/issues/${PR}/comments" --paginate > "$tmp/pr-pages.json" || return 1
  for n in $issues; do
    gh api "repos/${REPO}/issues/${n}/comments" --paginate > "$tmp/pages-$n.json" || return 1
    jq -s --argjson n "$n" '{number: $n, comments: (add // [])}' "$tmp/pages-$n.json" > "$tmp/issue-$n.json" || return 1
  done
  jq -s 'add // []' "$tmp/pr-pages.json" > "$tmp/pr.json" || return 1
  if ls "$tmp"/issue-*.json > /dev/null 2>&1; then jq -s '.' "$tmp"/issue-*.json; else echo '[]'; fi > "$tmp/issues.json"
  jq -n --argjson pr "$PR" --slurpfile c "$tmp/pr.json" --slurpfile i "$tmp/issues.json" \
    '{pr: $pr, prComments: $c[0], issues: $i[0]}' > "$tmp/threads.json" || return 1
  node "$(dirname "$0")/brief.mjs" "$tmp/threads.json" > "$out/idea-brief.md" || return 1
  [ -s "$out/idea-brief.md" ] || rm -f "$out/idea-brief.md"
  rm -rf "$tmp"
}
collect_brief || { echo "No brief: collecting it failed."; rm -f "$out/idea-brief.md"; }

echo "Review inputs: $(wc -l < "$out/files.txt") changed files, $(wc -l < "$out/ci-tests.txt") test summary lines, brief: $([ -s "$out/idea-brief.md" ] && echo yes || echo none)."
