#!/usr/bin/env bash
# The /souba/ and /roumu/ pages come from generators in this folder and the data in this repository.
# This check fails when a page in the commit and its generator disagree:
#  1. the self tests of the generators and checkers
#  2. roumu/: rebuilt from data/jccdb-obs-v2 with the publishing day and the robots value the pages carry;
#     every file under roumu/ must be byte-equal to the rebuilt one (pref/ and trade/ in full when present),
#     and check_roumu_pages.py must find nothing
#  3. each souba/<slug>/index.html changed since BEFORE: souba_drift_check.py finds nothing on it, and a second
#     pass of the corrections (souba_rebuild.py --fix-only) leaves it byte-equal
# Usage: tools/souba/ci_check.sh [BEFORE]   (from anywhere in the repository; BEFORE is the commit before the push)
# Standard tools only; reads the repository and a temporary folder; sends nothing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
T=tools/souba
PY=(python3 -I -B)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0

echo "1. self tests"
for t in souba_rebuild souba_drift_check souba_restamp gen_region_pages llms_souba_list gen_roumu_pages check_roumu_pages; do
  if out=$("${PY[@]}" "$T/$t.py" selftest 2>&1) && grep -qx "SELFTEST ok" <<< "$out"; then
    echo "  ok  $t"
  else
    printf '%s\n' "$out" | tail -n 5
    echo "  NG  $t"
    fail=1
  fi
done

echo "2. roumu/"
if [ -f roumu/index.html ]; then
  read -r PUB ROBOTS < <("${PY[@]}" - roumu/index.html <<'EOF'
import json, re, sys
s = open(sys.argv[1], encoding="utf-8").read()
d = set()
for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("dateModified"), str):
                d.add(o["dateModified"][:10])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(json.loads(b))
m = re.search(r'<meta name="robots" content="([^"]+)"', s)
if len(d) != 1 or not m:
    sys.exit("roumu/index.html: one dateModified and one robots meta expected (dateModified %s)" % sorted(d))
print(d.pop(), m.group(1))
EOF
  )
  [ -n "${PUB:-}" ] && [ -n "${ROBOTS:-}" ] || { echo "  roumu/index.html: the publishing day or the robots value cannot be read"; exit 1; }
  TL=off
  [ ! -d roumu/trade ] || TL=on
  echo "  publishing day $PUB, robots $ROBOTS, trade links $TL"
  "${PY[@]}" "$T/gen_roumu_pages.py" . --out "$TMP/roumu" --published "$PUB" --robots "$ROBOTS" --trade-links "$TL" > /dev/null
  n=0
  while IFS= read -r -d '' f; do
    n=$((n + 1))
    if ! cmp -s "$f" "$TMP/$f"; then echo "  differs from the generator: $f"; fail=1; fi
  done < <(find roumu -type f -print0)
  for d in pref trade; do
    if [ -d "roumu/$d" ] && ! diff -rq "roumu/$d" "$TMP/roumu/$d" > /dev/null; then
      { diff -rq "roumu/$d" "$TMP/roumu/$d" || true; } | head -n 20 | sed 's/^/  /'
      fail=1
    fi
  done
  if out=$("${PY[@]}" "$T/check_roumu_pages.py" . roumu --published "$PUB" 2>&1); then
    echo "  $n files equal to the generator's; $(tail -n 1 <<< "$out")"
  else
    printf '%s\n' "$out" | tail -n 20
    fail=1
  fi
else
  echo "  no roumu/index.html"
fi

echo "3. souba/ pages changed in the push"
BEFORE="${1:-}"
CH=""
if [ -n "$BEFORE" ] && [ "$BEFORE" != "0000000000000000000000000000000000000000" ]; then
  git cat-file -e "$BEFORE^{commit}" 2>/dev/null || git fetch -q --no-tags --depth=1 origin "$BEFORE" 2>/dev/null || true
  if git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
    CH=$(git -c core.quotepath=false diff --name-only --diff-filter=ACM "$BEFORE" HEAD -- souba | grep -E '^souba/[^/]+/index\.html$' || true)
  else
    echo "  the commit before the push ($BEFORE) cannot be read; souba/ is not checked"
  fi
else
  echo "  no commit before the push was given; souba/ is not checked"
fi
if [ -n "$CH" ]; then
  echo "  $(wc -l <<< "$CH" | tr -d ' ') pages"
  while IFS= read -r p; do
    if ! out=$("${PY[@]}" "$T/souba_drift_check.py" . --pages-glob "$p" 2>&1); then
      { grep -v '^SUMMARY' <<< "$out" || true; } | head -n 10 | sed 's/^/  /'
      echo "  disagrees with data/souba-db.json: $p"
      fail=1
    fi
  done <<< "$CH"
  mkdir -p "$TMP/s"
  for e in * .[!.]*; do
    [ -e "$e" ] || continue
    [ "$e" = souba ] || [ "$e" = .git ] || ln -s "$PWD/$e" "$TMP/s/$e"
  done
  cp -R souba "$TMP/s/souba"
  SL=$(sed -e 's#^souba/##' -e 's#/index\.html$##' <<< "$CH" | paste -sd, -)
  "${PY[@]}" "$T/souba_rebuild.py" "$TMP/s" --write --fix-only --only "$SL" --published 2000-01-01 > /dev/null
  while IFS= read -r p; do
    if ! cmp -s "$p" "$TMP/s/$p"; then echo "  a second pass of the corrections changes: $p"; fail=1; fi
  done <<< "$CH"
else
  echo "  none"
fi

if [ "$fail" != 0 ]; then
  echo "SOUBA_CI NG"
  exit 1
fi
echo "SOUBA_CI ok"
