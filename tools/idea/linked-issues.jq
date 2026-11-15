# The issues a PR closes, from `gh pr view --json closingIssuesReferences`, as one number per line (D21). Only this
# repo's issues ($ENV.REPO, owner/name, any letter case): a PR can close an issue in another repo, and looking its
# number up here would read the wrong issue. Used by tools/idea/collect.sh and tools/review/collect-inputs.sh.
.closingIssuesReferences[]
| select(((.repository.owner.login // "") + "/" + (.repository.name // "") | ascii_downcase) == ($ENV.REPO | ascii_downcase))
| .number
