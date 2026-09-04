#!/bin/zsh
# com.horizonshield.jidec (launchd、1 時間ごと) が回す。pending の OTS を upgrade して、Bitcoin に乗った entry の確定を台帳に書く。
#
# 2026-09-04: 前の台本(~/jidec/run_stamp.sh)は鍵を台本の中に直書きし、URL は旧 workers.dev を指していた。
#   鍵を回した日から毎時 401 で落ち、誰も気づかなかった(launchd.out は空、stamp.log にだけ FATAL が並んだ)。
#   鍵は台本に書かない。~/.hs_ledger_token (chmod 600) から読む。無い・長さが違う、なら1バイトも送らない。
#   作業ディレクトリは手動の append_witness.sh と同じ workers/hs-ledger(claim_N.txt / .ots はそこにある)。
set -u
export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:$HOME/Library/Python/3.9/bin:$PATH"
KEYFILE="$HOME/.hs_ledger_token"
LOG="$HOME/jidec/stamp.log"
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ ! -r "$KEYFILE" ]; then echo "$STAMP FAIL keyfile missing: $KEYFILE" >> "$LOG"; exit 1; fi
TOK="$(tr -d '[:space:]' < "$KEYFILE")"
if [ ${#TOK} -ne 64 ]; then echo "$STAMP FAIL key length ${#TOK}, need 64. nothing sent." >> "$LOG"; exit 1; fi
cd "$HOME/horizon-shield/workers/hs-ledger" || { echo "$STAMP FAIL cd" >> "$LOG"; exit 1; }
echo "$STAMP run" >> "$LOG"
LEDGER_URL="https://ledger.horizonshield.dev" LEDGER_ADMIN_TOKEN="$TOK" python3 "$HOME/jidec/jidec_stamp.py" >> "$LOG" 2>&1
rc=$?
unset TOK
echo "$STAMP rc=$rc" >> "$LOG"
exit $rc
