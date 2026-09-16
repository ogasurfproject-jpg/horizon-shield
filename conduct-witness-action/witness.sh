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
# --- BEGIN witness-key-normalize (self-healing) ---
# Normalize the witness signing key before writing $KEY_FILE. Tolerates a PEM whose newline framing was
# lost in the GitHub secret box (MalformedFraming), a base64-of-PEM blob, or a bare base64 DER PKCS8 body.
# Validates by loading; never prints the private key. Exits non-zero with a clear message on failure.
CW_KEY_OUT="$KEY_FILE" python3 <<'PYEOF'
import os, re, sys, base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
raw = os.environ.get("CW_KEY_PEM", "")
out = os.environ.get("CW_KEY_OUT", "")
if not raw.strip():
    sys.stderr.write("witness: HS_WITNESS_KEY is empty; cannot sign\n"); sys.exit(2)
def framed(body, label="PRIVATE KEY"):
    b = re.sub(r"\s+", "", body)
    w = "\n".join(b[i:i+64] for i in range(0, len(b), 64))
    return "-----BEGIN %s-----\n%s\n-----END %s-----\n" % (label, w, label)
def cands(raw):
    yield raw
    m = re.search(r"-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----(.*?)-----END \1-----", raw, re.S)
    if m: yield framed(m.group(2), m.group(1))
    try:
        dec = base64.b64decode(re.sub(r"\s+", "", raw), validate=True).decode("utf-8", "replace")
        if "PRIVATE KEY" in dec:
            yield dec
            m2 = re.search(r"-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----(.*?)-----END \1-----", dec, re.S)
            if m2: yield framed(m2.group(2), m2.group(1))
    except Exception:
        pass
    yield framed(raw)
last = None
for c in cands(raw):
    try:
        k = serialization.load_pem_private_key(c.encode("utf-8"), password=None)
    except Exception as e:
        last = type(e).__name__; continue
    if not isinstance(k, Ed25519PrivateKey):
        last = "not-ed25519"; continue
    with open(out, "w") as f:
        f.write(c if c.endswith("\n") else c + "\n")
    os.chmod(out, 0o600)
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    sys.stderr.write("witness: recovered Ed25519 key, pub_b64=%s\n" % base64.b64encode(pub).decode())
    sys.exit(0)
sys.stderr.write("witness: could not recover a valid Ed25519 key from HS_WITNESS_KEY (last error: %s)\n" % last)
sys.exit(3)
PYEOF
if [ ! -s "$KEY_FILE" ]; then echo "witness: key normalization failed (empty $KEY_FILE)"; exit 1; fi
# --- END witness-key-normalize ---
  KEY_ARGS=(--key "$KEY_FILE" --key-url "$CW_KEY_URL")
  echo "signing: enabled, key_url $CW_KEY_URL"
else
  echo "signing: off (unsigned witness; counted by name only)"
fi

SUBMIT_ARGS=()
if [ "${CW_SUBMIT:-true}" = "true" ]; then SUBMIT_ARGS=(--submit); fi
INTAKE_ARGS=()
if [ -n "${CW_INTAKE:-}" ]; then INTAKE_ARGS=(--intake "$CW_INTAKE"); fi

# task binding (optional): fetch the binder + producer from the same ref, verify optional pins, enable --bind-task.
# Needs a key (the task observation is signed via the witness did:key). A missing key, a fetch failure or a pin
# mismatch only disables binding; the endpoint walk still runs. This never fails the job.
BIND_ARGS=()
if [ "${CW_BIND_TASK:-false}" = "true" ]; then
  if [ -z "${CW_KEY_PEM:-}" ]; then
    echo "::warning::bind_task is on but no key_pem was given; task observations are signed, so binding is skipped this run"
  else
    BIND_BASE="https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/${CW_WALKER_REF:-main}/workers/hs-ledger/nenrin/a2a-conduct-walk"
    OK_BIND=1
    for M in task_bind.py task_witness_emit.py; do
      if ! curl -fsSL "$BIND_BASE/$M" -o "$OUT_DIR/$M"; then echo "::warning::could not fetch $M; task binding skipped"; OK_BIND=0; break; fi
    done
    if [ "$OK_BIND" = "1" ] && [ -n "${CW_TASK_BIND_SHA256:-}" ]; then
      G=$(sha256sum "$OUT_DIR/task_bind.py" | cut -d' ' -f1)
      if [ "$G" != "$CW_TASK_BIND_SHA256" ]; then echo "::warning::task_bind.py sha256 $G does not match the pinned $CW_TASK_BIND_SHA256; task binding skipped"; OK_BIND=0; fi
    fi
    if [ "$OK_BIND" = "1" ] && [ -n "${CW_PRODUCER_SHA256:-}" ]; then
      G=$(sha256sum "$OUT_DIR/task_witness_emit.py" | cut -d' ' -f1)
      if [ "$G" != "$CW_PRODUCER_SHA256" ]; then echo "::warning::task_witness_emit.py sha256 $G does not match the pinned $CW_PRODUCER_SHA256; task binding skipped"; OK_BIND=0; fi
    fi
    if [ "$OK_BIND" = "1" ]; then BIND_ARGS=(--bind-task); echo "task binding: enabled (a2a origins file a signed observation to /witness/task under the real a2a.task.id)"; fi
  fi
fi

# origins: newline or comma separated, trimmed, blank lines dropped.
# A line may carry its own mode after a space ("https://gate.example mcp"); otherwise the job wide mode applies.
# Walk an MCP endpoint in mcp mode and an A2A endpoint in a2a mode: sending an A2A message to an MCP
# endpoint records a truthful FAIL (it does not answer A2A), which is a statement about your mode, not the agent.
mapfile -t ORIGINS < <(printf '%s' "${CW_ORIGINS:-}" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$')
if [ "${#ORIGINS[@]}" -eq 0 ]; then echo "::error::no origins given"; exit 3; fi

RECORDS="["
WALKED=0
SUBMITTED=0
TBOUND=0
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
      ${KEY_ARGS[@]+"${KEY_ARGS[@]}"} ${SUBMIT_ARGS[@]+"${SUBMIT_ARGS[@]}"} ${INTAKE_ARGS[@]+"${INTAKE_ARGS[@]}"} ${BIND_ARGS[@]+"${BIND_ARGS[@]}"} ) > "$LOG" 2>&1
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
  if grep -qE '^  task binding .* -> http 200' "$LOG"; then TBOUND=$((TBOUND+1)); fi
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
  if [ "${CW_BIND_TASK:-false}" = "true" ]; then echo "task bindings filed: $TBOUND (signed observations bound to the agent's real a2a.task.id, in the next task-witness ring on the ledger)."; echo ""; fi
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
