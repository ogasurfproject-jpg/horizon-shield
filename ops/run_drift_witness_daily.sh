#!/bin/bash
# TSUGI の日次証人 (設計書 13 節「drift_witness を cron に」の Mac 版。Worker の cron に載せるまでの本番)。
# launchd: ops/com.horizonshield.driftwitness.plist (毎日 09:00)。手でも回せる: bash ops/run_drift_witness_daily.sh
# 何をするか: 扉の 8 表面を測り、前回の走りと比べ、drift が 1 つでも有れば ALERT file と macOS 通知。記録は drift_runs/ に JSONL (git には入れん)。
# 期待 commit は deploy_gate.sh が ~/.config/hs/last_gate_commit.txt に残した物。無ければ「ピンされとるか」だけ見る。
set -u
REPO="$HOME/horizon-shield"
DIR="$REPO/workers/hs-ledger/nenrin/recovery-v0"
RUNS="$DIR/drift_runs"
mkdir -p "$RUNS"
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$RUNS/drift_$TS.jsonl"
BASE="$RUNS/latest.jsonl"
ARGS=(https://gate.horizonshield.dev --repo "$REPO" --out "$OUT")
if [ -s "$HOME/.config/hs/last_gate_commit.txt" ]; then ARGS+=(--expect-commit "$(tr -d '[:space:]' < "$HOME/.config/hs/last_gate_commit.txt")"); fi
if [ -s "$BASE" ]; then ARGS+=(--baseline "$BASE"); fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$DIR" || exit 2
node drift_witness.mjs "${ARGS[@]}" 2> "$RUNS/last_run.txt"
RC=$?
cat "$RUNS/last_run.txt"
if [ $RC -eq 0 ]; then
  cp "$OUT" "$BASE"
  echo "OK $TS 0 drift, baseline advanced" >> "$RUNS/history.txt"
elif [ $RC -eq 1 ]; then
  cp "$OUT" "$RUNS/ALERT_$TS.jsonl"
  echo "DRIFT $TS $(cat "$RUNS/last_run.txt")" >> "$RUNS/history.txt"
  MSG=$(head -c 200 "$RUNS/last_run.txt" | tr '"' "'")
  osascript -e "display notification \"$MSG\" with title \"TSUGI drift witness\" subtitle \"gate.horizonshield.dev\"" 2>/dev/null
else
  echo "ERROR $TS rc=$RC $(cat "$RUNS/last_run.txt")" >> "$RUNS/history.txt"
fi
exit $RC
