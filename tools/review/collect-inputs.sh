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

echo "Review inputs: $(wc -l < "$out/files.txt") changed files, $(wc -l < "$out/ci-tests.txt") test summary lines."
