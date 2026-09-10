#!/usr/bin/env bash
# ops/agreement_first_record_prep.sh
#
# Prerequisites 3, 4 and 5 of ops/agreement_first_record_federico_20260910.md, in one pass.
# Read only. It walks, fetches and hashes. It signs nothing, submits nothing, deploys
# nothing, and never touches a private key. Run it on the Mac: the session container and
# the bridge VM both have their egress denied, so neither can reach these hosts.
#
#   bash ops/agreement_first_record_prep.sh
#
# It prints, at the end, exactly the values that fill the TODOs in section 5 of that file.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/ops/first_record_prep_out"
mkdir -p "$OUT"
cd "$ROOT" || exit 1

A_CARD="https://mcp.horizonshield.dev/.well-known/agent-card.json"
B_CARD="https://api.babyblueviper.com/.well-known/agent-card.json"
B_ORIGIN="https://api.babyblueviper.com"
B_ENDPOINT="https://api.babyblueviper.com/a2a"

say() { printf '\n=== %s\n' "$1"; }

# ---------------------------------------------------------------- 4. agent card sha256
# The hash is over the exact bytes served. Nothing is normalised, reformatted or reordered:
# a card that changes one space changes its sha256, which is the point of pinning it.
card_sha () {
  local url="$1" name="$2" f="$OUT/card_$2.json"
  local code
  code=$(curl -sS -m 25 -A "a2a-conduct-walk/1 (+https://gate.horizonshield.dev/ext/conduct/v1)" \
           -o "$f" -w '%{http_code}' "$url" 2>"$OUT/card_$2.err")
  if [ "$code" != "200" ]; then
    printf '  %-22s HTTP %s  (no hash: %s)\n' "$name" "$code" "$url"
    printf '  %-22s %s\n' "" "$(head -c 200 "$OUT/card_$2.err" 2>/dev/null)"
    rm -f "$f"
    return 1
  fi
  printf '  %-22s %s  %s bytes\n' "$name" "$(shasum -a 256 "$f" | cut -d' ' -f1)" "$(wc -c < "$f" | tr -d ' ')"
  return 0
}

say "4. agent card sha256, over the exact bytes served"
card_sha "$A_CARD" "horizonshield"   || true
card_sha "$B_CARD" "babyblueviper"   || true

# ---------------------------------------------------------- 3. the conduct walk of party B
# api.babyblueviper.com, not the apex. The apex is a Substack landing page and serves no
# card. The subject is then a host UNDER the counterparty domain, which the verifier
# accepts since yesterday, which is the rule Federico's own review produced.
#
# His card declares A2A 0.3.0 and no capabilities.extensions[], so conduct_ext_declared,
# compensation_well_formed and extension_echoed will record FAIL. That is an observation,
# not a verdict, and the walk writes the record either way. Read the FAILs before you
# decide whether this is the record to pin on a first agreement.
say "3. conduct walk of api.babyblueviper.com (no --submit: nothing is filed)"
# -u throughout: python block-buffers when stdout is a pipe, so `| sed` holds every line
# until the process exits. Same fault as the one removed from step 5 below, one step over.
python3 -u workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py \
  --origin "$B_ORIGIN" \
  --endpoint "$B_ENDPOINT" \
  --mode a2a --wire 0.3 \
  --witness-name "HORIZON SHIELD (The HORIZ音s株式会社)" \
  --vantage "operator workstation, Japan, residential network" \
  --transport curl \
  --out "$OUT/walk_babyblueviper.json" 2>&1 | sed 's/^/  /'

# ------------------------------------------------------------------ 5. the lower bound
# Bitcoin height and hash for lower_bound. The local headers were last synced 2026-09-06
# and are about 530 blocks behind, so they are re-synced here from peers before being read.
say "5. bitcoin lower_bound (re-syncing local headers first)"
# --from-manifest continues the freshest window (localheaders_catchup, tip 965850) and
# writes back to the same prefix. Bare, this script defaults to --out-prefix
# localheaders_p2p with no mode, which is not the window we read below. It needs
# outbound 8333 to reach peers; if that is refused the manifest simply does not advance,
# and the reader below says STALE rather than letting a four day old block through.
# No pipe here, on purpose. The first version sent this through `tail -6`, which holds
# every line until the process exits, so a peer catchup that was working looked frozen
# for minutes. A tool whose progress you cannot see is a tool you cannot tell from a
# dead one, which is the same fault as putting 402 and 500 in one bucket. It prints as
# it goes now. Ctrl+C is safe: the sync is fail-closed and writes nothing until it has
# enough agreeing peers, so an interrupted run leaves the manifest untouched.
echo "  (this talks to Bitcoin peers on port 8333 and can take minutes. Output is live."
echo "   Ctrl+C is safe: nothing is written until enough peers agree.)"
( cd workers/hs-ledger/nenrin/coordinate-v1 && \
  python3 sync_headers_p2p.py \
    --from-manifest localheaders_catchup.manifest.json \
    --out-prefix localheaders_catchup 2>&1 )
python3 -u - <<'PY' 2>&1 | sed 's/^/  /'
import datetime, glob, io, json, os
best = None
for f in glob.glob("workers/hs-ledger/nenrin/coordinate-v1/localheaders_*.manifest.json"):
    try:
        d = json.load(io.open(f, encoding="utf-8"))
    except Exception:
        continue
    if best is None or d.get("tip_height", 0) > best[1].get("tip_height", 0):
        best = (os.path.basename(f), d)
if best is None:
    print("no manifest readable")
else:
    f, d = best
    t = datetime.datetime.fromtimestamp(d["tip_time"], datetime.timezone.utc)
    age = (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds()
    print("source     %s" % f)
    print("height     %d" % d["tip_height"])
    print("hash       %s" % d["tip_hash"])
    print("tip_time   %s  (%.1f hours old)" % (t.isoformat(), age / 3600.0))
    if age > 6 * 3600:
        print("STALE: the sync did not advance. lower_bound must not name a block")
        print("       this far behind the signing time. Re-run the sync before signing.")
PY

say "what to do with this"
cat <<'TXT'
  The four values above fill parties[0].agent_card_sha256, parties[1].agent_card_sha256,
  parties[0].conduct_record.{sha256,url}, and lower_bound.{height,hash} in section 5 of
  ops/agreement_first_record_federico_20260910.md.

  conduct_record.url is empty until the walk record is filed. Filing is a publish, so it
  is your hand, not the watchman's. Nothing above filed anything.

  Still missing after this, and both are somebody's decision rather than a command:
    1. the HORIZON SHIELD agreement key            openssl genpkey -algorithm ed25519
    6. Federico serves a key and signs             his hand, and see section 8
TXT
