#!/bin/sh
# Make the ring for one month (YYYY-MM) for every history/<slug>.json, chained to the previous
# month's ring when one exists, with every witness record under witness/<slug>/<month>/*.json
# (each file exactly as GET /witness/{sha} returned it), then write rings/<month>.sha256 for anchoring.
set -eu
cd "$(dirname "$0")"
m="${1:?usage: make_month.sh YYYY-MM}"
prevm=$(python3 -c 'import sys; y, mo = map(int, sys.argv[1].split("-")); mo -= 1
if mo == 0: y -= 1; mo = 12
print("%04d-%02d" % (y, mo))' "$m")
for h in history/*.json; do
  slug=$(basename "$h" .json)
  set -- python3 make_ring.py --month "$m" --history "$h" --out rings
  prev="rings/$slug/$prevm.json"
  if [ -f "$prev" ]; then set -- "$@" --prev "$prev"; fi
  for w in "witness/$slug/$m"/*.json; do
    [ -f "$w" ] && set -- "$@" --witness "$w"
  done
  "$@"
done
shasum -a 256 rings/*/"$m".json > "rings/$m.sha256"
echo "--- rings/$m.sha256 (anchor this file)"
cat "rings/$m.sha256"
