#!/bin/sh
# make_seed_reimpl_correction.sh: JIDEC の seed を組む。entry 34 の二つの文言(「spec alone」「source_seen: none」)を
# 狭める訂正記録。entry 34 は編集しない。この記録を積んで、entry 34 を引用する。両方が読める。
# 何も送らない。seed の JSON を書くだけ。append は append_witness.sh (token は隠し入力)。
# 事実は全部その場で照合する: entry 34 の claim sha は手元の claim_34.txt から再計算、論文の commit は git から読む。
set -eu
cd "$HOME/horizon-shield/workers/hs-ledger"
OUT="seed_entry_nenrin_reimpl_correction_20260906.json"

OUT="$OUT" python3 - <<'PY'
import hashlib, io, os, json, subprocess, sys
out = os.environ["OUT"]
def sha(b): return hashlib.sha256(b).hexdigest()
c34 = io.open("claim_34.txt", "rb").read()
s34 = sha(c34)
if s34 != "fad6d00a25281102711573b151b321bc13b28c625fe65807c5eb3a12a04e393c":
    print("claim_34.txt does not hash to entry 34's claim; stop"); sys.exit(1)
if b"written from the spec alone" not in c34 or b"implementation_2_source_seen: none of implementation_1" not in c34:
    print("the two phrases are not in claim_34.txt as expected; stop"); sys.exit(1)
repo = os.path.expanduser("~/horizon-shield")
def git(*a):
    return subprocess.check_output(["git", "-C", repo, "--no-optional-locks"] + list(a), text=True).strip()
# the commit that carries the implementer's own account, and the merge that put it on main
fed_commit = git("log", "--format=%h", "-1", "--grep=three overclaims fixed", "main")
merge_commit = git("log", "--format=%h", "-1", "--grep=RFC 8785 collation note", "--merges", "main")
if not fed_commit or not merge_commit:
    print("could not find the implementer's commit or the merge on main; stop"); sys.exit(1)
lines = []
lines.append("schema: nenrin-ring-reimpl-match-v1-correction")
lines.append("date: 2026-09-06")
lines.append("corrects: JIDEC entry 34, claim sha256 %s, schema nenrin-ring-reimpl-match-v1, Bitcoin block 965627" % s34)
lines.append("method: the corrected entry is not edited; this record is appended and cites it, and both stay readable")
lines.append("phrase_1: \"written from the spec alone\" (the claim line of entry 34)")
lines.append("narrowed_1: the specification's Layer 3 sketch names 11 of a ring's 20 fields and does not state the canonical form; the remaining fields (first_instant, last_instant, instants_by_status, instants_by_consent_source, record_sha256_first, record_sha256_last, witness_identities, prev_ring, recompute) and the byte rules were taken by the implementer from the published ring files in mcp-conduct-register, read before the reimplementation was written")
lines.append("phrase_2: \"implementation_2_source_seen: none of implementation_1 (implementer's statement)\"")
lines.append("narrowed_2: in a recompute earlier the same day (reported 17:49 JST), the implementer cloned mcp-conduct-register, executed scripts/make_ring.py --verify against the eight rings as a black box, and read its docstring header for the specification hash it cites; the body of make_ring.py, the logic that turns history entries into ring fields, was not read before or during the reimplementation (implementer's statement)")
lines.append("what_was_blind: the byte comparison; the rebuilt bytes were not checked against the eight published rings until the verify run reported match or mismatch")
lines.append("what_stays: the eight byte-identical rings, their eight sha256 values, the specification and implementation hashes, and the nested key-order seam; none of these depends on the two phrases")
lines.append("source_of_narrowing: the implementer's own account in Section 4.2 of papers/nenrin-reproducibility/manuscript_v0.1.md, github.com/ogasurfproject-jpg/horizon-shield, his commit %s, on main by merge %s, written after the operator's review found the two phrases broader than the record supports" % (fed_commit, merge_commit))
lines.append("also_appended: mcp-conduct-register README, 2026-09-06 correction line under the 2026-09-05 update")
lines.append("limits: this record narrows two statements of provenance; it changes no hash and no result")
rec = "\n".join(lines) + "\n"
seed = {"claim_sha256": sha(rec.encode("utf-8")), "record_canonical": rec,
        "work": "NENRIN Layer 3 reimplementation record: correction narrowing two provenance phrases of entry 34, 2026-09-06"}
io.open(out, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
print(rec)
print("claim_sha256:", seed["claim_sha256"])
print("wrote", out, len(json.dumps(seed, ensure_ascii=False).encode("utf-8")), "bytes")
bad = [ch for ch in rec if ch in "\u2014\u2013\u2015\u2500\u2501\uff0d"]
print("forbidden dashes in record:", len(bad))
PY
