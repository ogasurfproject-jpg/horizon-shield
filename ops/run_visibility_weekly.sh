#!/bin/zsh
setopt pipefail
OPS="$HOME/horizon-shield/ops"
KEYFILE="$HOME/.hs_anthropic_key"
MARK="$OPS/visibility_last_run.txt"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$OPS/visibility-runs"
printf 'STARTED %s\n' "$STAMP" > "$MARK"
if [ ! -f "$KEYFILE" ]; then
  printf 'FAIL %s keyfile missing: %s\n' "$STAMP" "$KEYFILE" > "$MARK"
  exit 1
fi
export ANTHROPIC_API_KEY="$(cat "$KEYFILE")"
cd "$OPS" || { printf 'FAIL %s cd failed: %s\n' "$STAMP" "$OPS" > "$MARK"; exit 1; }
LOG="$OPS/visibility-runs/run-$(date +%Y%m%d-%H%M%S).log"
if /usr/bin/python3 "$OPS/llm_visibility_monitor.py" 2>&1 | tee "$LOG"; then
  RATE=$(grep -h 'CITED率' "$LOG" | tail -1)
  printf 'OK %s %s %s\n' "$STAMP" "$LOG" "$RATE" > "$MARK"
else
  printf 'FAIL %s python exited nonzero, see %s\n' "$STAMP" "$LOG" > "$MARK"
  exit 1
fi
