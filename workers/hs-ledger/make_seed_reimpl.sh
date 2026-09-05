#!/bin/sh
# make_seed_reimpl.sh: JIDEC の seed を組む。「別人が別言語で spec だけから 8 リングをバイト一致で再現した」の記録。
# 何も送らない。seed の JSON を書くだけ。append は append_witness.sh (token は隠し入力)。
# 入力は全部その場で取りに行く: 彼の make_ring.js の生バイト (sha256)、その最新 commit、手元の spec と 8 リングと history の sha。
# 手で写した sha は一つも無い。
set -eu
cd "$HOME/horizon-shield/workers/hs-ledger"
REG="$HOME/mcp-conduct-register"
RAW="https://raw.githubusercontent.com/babyblueviper1/invinoveritas/main/scripts/nenrin_ring_reimpl/make_ring.js"
API="https://api.github.com/repos/babyblueviper1/invinoveritas/commits?path=scripts/nenrin_ring_reimpl/make_ring.js&per_page=1"
OUT="seed_entry_nenrin_reimpl_match_20260905.json"
TMP=$(mktemp -d)
curl -sSL --max-time 30 "$RAW" -o "$TMP/make_ring.js"
curl -sSL --max-time 30 -H "Accept: application/vnd.github+json" "$API" -o "$TMP/commit.json"
[ -s "$TMP/make_ring.js" ] || { echo "make_ring.js が取れなかった"; exit 1; }
[ -s "$TMP/commit.json" ] || { echo "commit 情報が取れなかった"; exit 1; }
[ -f "$REG/rings/2026-08.sha256" ] || { echo "$REG/rings/2026-08.sha256 が無い"; exit 1; }

TMP="$TMP" REG="$REG" OUT="$OUT" python3 - <<'PY'
import hashlib, io, json, os, glob, sys
tmp, reg, out = os.environ["TMP"], os.environ["REG"], os.environ["OUT"]
def sha(b): return hashlib.sha256(b).hexdigest()
js = io.open(os.path.join(tmp, "make_ring.js"), "rb").read()
c = json.load(io.open(os.path.join(tmp, "commit.json"), encoding="utf-8"))
if not isinstance(c, list) or not c:
    print("GitHub API の応答が commit 一覧でない:", str(c)[:200]); sys.exit(1)
commit = c[0]["sha"]; cdate = c[0]["commit"]["committer"]["date"]
spec = io.open(os.path.expanduser("~/horizon-shield/workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md"), "rb").read()
py = io.open(os.path.expanduser("~/horizon-shield/workers/hs-ledger/nenrin/ring-v1/make_ring.py"), "rb").read()
rings = io.open(os.path.join(reg, "rings", "2026-08.sha256"), encoding="utf-8").read().strip().splitlines()
hist = sorted(glob.glob(os.path.join(reg, "history", "*.json")))
lines = []
lines.append("schema: nenrin-ring-reimpl-match-v1")
lines.append("date: 2026-09-05")
lines.append("claim: a second, independent implementation of NENRIN Layer 3 (ring builder), written from the spec alone in a different language by a different person, reproduces all eight August 2026 rings byte for byte from the same history exports")
lines.append("spec: NENRIN_SPEC_v1.md sha256 %s (Layer 3)" % sha(spec))
lines.append("implementation_1: python, make_ring.py sha256 %s, author Toshikatsu Oga, horizon-shield workers/hs-ledger/nenrin/ring-v1" % sha(py))
lines.append("implementation_2: node.js, make_ring.js sha256 %s, %d bytes, author Federico Blanco Sanchez-Llanos, github.com/babyblueviper1/invinoveritas scripts/nenrin_ring_reimpl/make_ring.js commit %s (%s)" % (sha(js), len(js), commit, cdate))
lines.append("implementation_2_source_seen: none of implementation_1 (implementer's statement)")
lines.append("inputs: history exports as committed in github.com/ogasurfproject-jpg/mcp-conduct-register")
for h in hist:
    lines.append("  history %s sha256 %s" % (os.path.basename(h), sha(io.open(h, "rb").read())))
lines.append("outputs_expected: rings/2026-08.sha256 (JIDEC entry 32)")
for r in rings:
    lines.append("  " + r)
lines.append("result: 8 of 8 byte-identical (implementer's run, 2026-09-05; the eight sha256 values he reported equal the eight above)")
lines.append("implementation_note: python json.dumps(sort_keys=True) sorts object keys at every nesting level; JSON.stringify sorts none, so implementation_2 applies a recursive key sort (array order preserved) before serialising with 2-space indent and a trailing newline")
lines.append("limits: validates determinism of Layer 3 only; says nothing about the truth of the measurements inside history; n=2 implementations; August rings carry one witness; the witness-record path (witnesses >= 2) is first exercised by the September rings and is not covered by this record")
lines.append("supersedes: the sentence in mcp-conduct-register README 'a from-scratch reimplementation in another language ... has not yet been done' (2026-09-05, earlier the same day)")
rec = "\n".join(lines) + "\n"
seed = {"claim_sha256": sha(rec.encode("utf-8")), "record_canonical": rec,
        "work": "NENRIN Layer 3: second independent implementation (Node.js, from spec) reproduces Ring 001 byte for byte, 2026-09-05"}
io.open(out, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
print(rec)
print("claim_sha256:", seed["claim_sha256"])
print("wrote", out, len(json.dumps(seed, ensure_ascii=False).encode("utf-8")), "bytes")
bad = [ch for ch in rec if ch in "\u2014\u2013\u2015\u2500\u2501\uff0d"]
print("forbidden dashes in record:", len(bad))
PY
rm -rf "$TMP"
echo "次: zsh append_witness.sh $OUT   (token は隠し入力。送る前に上の record を目で読め)"
