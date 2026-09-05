#!/bin/sh
# Export /history for every endpoint in endpoints.txt into history/<slug>.json.
# The gate keeps a bounded number of records per endpoint and drops the oldest beyond it,
# so this export is the raw material of the month's rings and must be taken before it is gone.
set -eu
cd "$(dirname "$0")"
mkdir -p history
while IFS= read -r ep; do
  case "$ep" in ""|\#*) continue ;; esac
  slug=$(python3 -c 'import sys, make_ring; print(make_ring.slug(sys.argv[1]))' "$ep")
  curl -sS --fail --max-time 60 "https://gate.horizonshield.dev/history?endpoint=$ep&cb=$(date +%s)" -o "history/$slug.json"
  python3 -c 'import sys, json, collections
d = json.load(open(sys.argv[1])); e = d.get("entries") or []
m = collections.Counter(x.get("at", "")[:7] for x in e)
print("%-36s %3d entries  %s  kept_max=%s" % (sys.argv[2], len(e), dict(sorted(m.items())), (d.get("retention") or {}).get("kept_max", "unstated")))' "history/$slug.json" "$slug"
done < endpoints.txt
