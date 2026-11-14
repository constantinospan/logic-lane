#!/usr/bin/env bash
# Gathers what the idea reviewer reads (D21), so it needs no GitHub access itself. Used by .github/workflows/claude.yml.
# Only the owner's own words and earlier idea-check comments (posted by this workflow) are collected.
#
# Usage: tools/idea/collect.sh <out-dir>
# Environment: GH_TOKEN, REPO, NUMBER (issue or PR), KIND (issue|pr), GITHUB_EVENT_PATH, GITHUB_EVENT_NAME.
set -euo pipefail

out=$1
mkdir -p "$out"
owner=constantinospan
marker='<!-- logic-lane:idea-review -->'

# The request that started this run, straight from the event (review bodies and inline PR comments aren't in the
# issue's comment list).
case "$GITHUB_EVENT_NAME" in
  issues) jq -r '"# " + .issue.title + "\n\n" + (.issue.body // "")' "$GITHUB_EVENT_PATH" ;;
  pull_request_review) jq -r '.review.body // ""' "$GITHUB_EVENT_PATH" ;;
  *) jq -r '.comment.body // ""' "$GITHUB_EVENT_PATH" ;;
esac > "$out/request.md"

# The thread: title and description (issues and PRs here are always the owner's own, see claude.yml), then the owner's
# comments and earlier idea checks, oldest first.
gh api "repos/${REPO}/issues/${NUMBER}" --jq '{title, body, author: .user.login}' > "$out/thread-start.json"
gh api "repos/${REPO}/issues/${NUMBER}/comments" --paginate --jq \
  "[.[] | select(.user.login == \"${owner}\" or (.user.login == \"github-actions[bot]\" and (.body | startswith(\"${marker}\"))))
     | {created_at, from: (if .user.login == \"${owner}\" then \"owner\" else \"idea-check\" end), body}]" \
  | jq -s 'add // []' > "$out/thread-comments.json"

if [ "$KIND" = pr ]; then
  gh pr view "$NUMBER" --repo "$REPO" --json files --jq '.files[].path' > "$out/pr-files.txt"
fi

echo "Idea inputs: request $(wc -c < "$out/request.md") bytes, $(jq length "$out/thread-comments.json") comments."
