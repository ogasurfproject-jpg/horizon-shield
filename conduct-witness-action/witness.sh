#!/usr/bin/env bash
# conduct-witness-action / witness.sh
# Walks each origin with the reference witness client (a2a_conduct_walk.py) and files what it saw.
# A FAIL outcome is a record, not an error: this script never fails the job on a verdict.
# It fails only when no record could be produced (walker missing, hash pin mismatch, python error).
set -u

OUT_DIR="conduct-witness-out"
mkdir -p "$OUT_DIR"
WALKER_URL="${CW_WALKER_URL:-https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/${CW_WALKER_REF:-main}/workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py}"
WALKER="$OUT_DIR/a2a_conduct_walk.py"

echo "fetching walker: $WALKER_URL"
if ! curl -fsSL "$WALKER_URL" -o "$WALKER"; then
  echo "::error::could not fetch the reference walker; nothing was walked"
  exit 3
fi
GOT_SHA=$(sha256sum "$WALKER" | cut -d' ' -f1)
echo "walker sha256: $GOT_SHA"
if [ -n "${CW_WALKER_SHA256:-}" ] && [ "$GOT_SHA" != "$CW_WALKER_SHA256" ]; then
  echo "::error::walker sha256 $GOT_SHA does not match the pinned $CW_WALKER_SHA256; refusing to walk with a tool you did not pin"
  exit 3
fi

VANTAGE="${CW_VANTAGE:-}"
if [ -z "$VANTAGE" ]; then VANTAGE="github-actions hosted runner (${CW_RUNNER_OS:-linux}) for ${CW_REPO:-unknown-repo}"; fi

KEY_ARGS=()
if [ -n "${CW_KEY_PEM:-}" ]; then
  if [ -z "${CW_KEY_URL:-}" ]; then
    echo "::error::key_pem was given without key_url; a signature nobody can attribute is not a signature"
    exit 3
  fi
  python3 -m pip install --quiet cryptography >/dev/null 2>&1 || { echo "::error::could not install the cryptography package needed for signing"; exit 3; }
  KEY_FILE="$RUNNER_TEMP/conduct-witness-key.pem"
  umask 077
  printf '%s\n' "$CW_KEY_PEM" > "$KEY_FILE"
  KEY_ARGS=(--key "$KEY_FILE" --key-url "$CW_KEY_URL")
  echo "signing: enabled, key_url $CW_KEY_URL"
else
  echo "signing: off (unsigned witness; counted by name only)"
fi

SUBMIT_ARGS=()
if [ "${CW_SUBMIT:-true}" = "true" ]; then SUBMIT_ARGS=(--submit); fi
INTAKE_ARGS=()
if [ -n "${CW_INTAKE:-}" ]; then INTAKE_ARGS=(--intake "$CW_INTAKE"); fi

# origins: newline or comma separated, trimmed, blank lines dropped.
# A line may carry its own mode after a space ("https://gate.example mcp"); otherwise the job wide mode applies.
# Walk an MCP endpoint in mcp mode and an A2A endpoint in a2a mode: sending an A2A message to an MCP
# endpoint records a truthful FAIL (it does not answer A2A), which is a statement about your mode, not the agent.
mapfile -t ORIGINS < <(printf '%s' "${CW_ORIGINS:-}" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$')
if [ "${#ORIGINS[@]}" -eq 0 ]; then echo "::error::no origins given"; exit 3; fi

RECORDS="["
WALKED=0
SUBMITTED=0
FIRST=1
{
  echo "## conduct-witness"
  echo ""
  echo "witness: \`$CW_WITNESS_NAME\`  vantage: \`$VANTAGE\`  mode: \`$CW_MODE\`  privacy: \`$CW_PRIVACY\`  submit: \`${CW_SUBMIT:-true}\`"
  echo ""
  echo "| origin | mode | outcome | pass | record sha256 | intake |"
  echo "|---|---|---|---|---|---|"
} >> "$GITHUB_STEP_SUMMARY"

i=0
for LINE in "${ORIGINS[@]}"; do
  i=$((i+1))
  if [ "$i" -gt 1 ]; then sleep "${CW_PAUSE:-3}"; fi
  read -r ORIGIN OMODE _ <<< "$LINE"
  OMODE="${OMODE:-$CW_MODE}"
  case "$OMODE" in mcp|a2a) ;; *) echo "::warning::unknown mode '$OMODE' for $ORIGIN; using $CW_MODE"; OMODE="$CW_MODE";; esac
  echo "----- walking $ORIGIN (mode $OMODE)"
  LOG="$OUT_DIR/walk_$(echo -n "$ORIGIN" | sha256sum | cut -c1-12).log"
  ( cd "$OUT_DIR" && python3 a2a_conduct_walk.py --origin "$ORIGIN" --mode "$OMODE" \
      --witness-name "$CW_WITNESS_NAME" --vantage "$VANTAGE" --privacy "$CW_PRIVACY" --transport "$CW_TRANSPORT" \
      ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} ${SUBMIT_ARGS[@]+"${SUBMIT_ARGS[@]}"} ${INTAKE_ARGS[@]+"${INTAKE_ARGS[@]}"} ) > "$LOG" 2>&1
  RC=$?
  cat "$LOG"
  # walk line, exactly as the walker prints it (purpose itself holds a colon, a space and the origin):
  #   walk a2a-conduct-walk-v1: https://mcp.horizonshield.dev  PASS 5/5  sha256 <64hex>  -> walk_<sha12>.json
  WLINE=$(grep -E '^walk ' "$LOG" | tail -1)
  PARSED=$(printf '%s' "$WLINE" | sed -nE 's/^walk .* +([A-Z_]+) ([0-9]+)\/([0-9]+) +sha256 ([0-9a-f]{64}) +-> (.*)$/\1|\2|\3|\4|\5/p')
  OUTCOME=""; NPASS=""; NTOTAL=""; SHA=""; FILE=""
  if [ -n "$PARSED" ]; then IFS='|' read -r OUTCOME NPASS NTOTAL SHA FILE <<< "$PARSED"; fi
  # submit line: "submitted to <intake>: http <status> <json>". The intake answers 201 on a new record; 200 is a dedup.
  HTTP=$(grep -E '^submitted to ' "$LOG" | tail -1 | sed -nE 's/.*: http ([0-9]{3}).*/\1/p')
  NOSUB=$(grep -E 'not submitted' "$LOG" | tail -1)
  if [ -z "$SHA" ]; then
    echo "::warning::no record produced for $ORIGIN (walker exit $RC); see $LOG"
    echo "| $ORIGIN | $OMODE | (no record) | | | walker exit $RC |" >> "$GITHUB_STEP_SUMMARY"
    continue
  fi
  WALKED=$((WALKED+1))
  INTAKE_CELL="${HTTP:-}"
  if [ "${HTTP:-}" = "200" ] || [ "${HTTP:-}" = "201" ]; then SUBMITTED=$((SUBMITTED+1)); INTAKE_CELL="filed (http $HTTP)"; fi
  if [ -z "${HTTP:-}" ]; then INTAKE_CELL="${NOSUB:-not submitted}"; fi
  if [ "$FIRST" -eq 0 ]; then RECORDS="$RECORDS,"; fi
  FIRST=0
  RECORDS="$RECORDS{\"origin\":\"$ORIGIN\",\"mode\":\"$OMODE\",\"outcome\":\"$OUTCOME\",\"n_pass\":${NPASS:-0},\"n_total\":${NTOTAL:-0},\"record_sha256\":\"$SHA\",\"submitted_http\":\"${HTTP:-}\",\"file\":\"$FILE\"}"
  echo "| $ORIGIN | $OMODE | $OUTCOME | ${NPASS:-?}/${NTOTAL:-?} | \`$SHA\` | $INTAKE_CELL |" >> "$GITHUB_STEP_SUMMARY"
done
RECORDS="$RECORDS]"

{
  echo ""
  echo "records: $WALKED walked, $SUBMITTED filed. Keep the sha256: it is your receipt and appears in the next daily bundle on the ledger."
  echo ""
  echo "A FAIL is a record, not an error. Two witnesses who disagree are kept as a discrepancy, never resolved. Recompute any record: sha256 of the file in this run's artifact must equal the sha shown."
} >> "$GITHUB_STEP_SUMMARY"

echo "records=$RECORDS" >> "$GITHUB_OUTPUT"
echo "walked=$WALKED" >> "$GITHUB_OUTPUT"
echo "submitted=$SUBMITTED" >> "$GITHUB_OUTPUT"

if [ "$WALKED" -eq 0 ]; then
  echo "::error::no origin produced a record"
  exit 3
fi
exit 0
