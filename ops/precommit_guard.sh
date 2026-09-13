#!/bin/bash
# horizon-shield pre-commit guard (fail-closed).
# install : cp ops/precommit_guard.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
# bypass  : git commit --no-verify   (deliberate commits only)
set -u
bad=0
staged=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$staged" ] && exit 0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    ops/*_dm_*|ops/outreach_*|ops/twzrd_*|ops/reply_*|ops/discord_*|ops/smithery_*|ops/linkedin_comment_*|ops/fed_*|ops/post_*|ops/note_*|HANDOFF*|*引き継ぎ*|handoff-*|PRIVATE_*)
      echo "REFUSE: private / DM-class draft is staged: $f"
      echo "        this belongs in ~/hs-core-private, not the public repo"
      bad=1 ;;
  esac
  if [ -f "$f" ]; then
    sz=$(wc -c < "$f" | tr -d ' ')
    if [ "$sz" -gt 52428800 ]; then
      echo "REFUSE: $f is $sz bytes (over 50MB; GitHub hard limit is 100MB)"
      bad=1
    fi
  fi
done <<< "$staged"
if [ "$bad" -ne 0 ]; then
  echo "pre-commit guard refused. unstage with: git restore --staged <file>"
  echo "if this commit is deliberate: git commit --no-verify"
  exit 1
fi
exit 0
