#!/bin/zsh
# append one seed to the JIDEC ledger and stamp it. The token is typed (hidden) when asked,
# never passed on the command line, never written anywhere. Nothing is sent unless it is 64 chars.
set -u
cd "$HOME/horizon-shield/workers/hs-ledger" || exit 1
SEED="${1:-seed_entry_witness_state_0001.json}"
[ -f "$SEED" ] || { echo "seed not found: $SEED"; exit 1; }
printf 'Paste LEDGER_ADMIN_TOKEN now (hidden), then press Enter: '
read -rs TOK; echo
TOK="${TOK//[[:space:]]/}"
if [ ${#TOK} -ne 64 ]; then echo "wrong length ${#TOK}, need 64. Nothing was sent."; exit 1; fi
RESP=$(curl -s -X POST https://ledger.horizonshield.dev/ledger/append -H "X-Ledger-Key: $TOK" -H "content-type: application/json" --data @"$SEED")
echo "$RESP" | python3 -m json.tool
if ! echo "$RESP" | grep -q '"n"'; then echo "append failed, not stamping."; unset TOK; exit 1; fi
PATH="$HOME/Library/Python/3.9/bin:$PATH" LEDGER_URL="https://ledger.horizonshield.dev" LEDGER_ADMIN_TOKEN="$TOK" python3 "$HOME/jidec/jidec_stamp.py"
unset TOK
echo "done."
