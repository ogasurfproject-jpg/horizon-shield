# -*- coding: utf-8 -*-
"""
make_coordinate_refusals_v1_seed.py (2026-09-04): coordinate-v1 の refusals v1 addendum(拒否は記録である)を台帳投入用 seed にする

やること (make_coordinate_localheaders_v3_seed.py と同じ流儀):
  1. nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_refusals_v1.md を読む
  2. 「引用」8本(spec / time v3 / sources v1 / localheaders v1 / v2 / v3 / freshness_v3.py / localheaders.py)と
     「ピン留め」4本(client v3 / red team / seed maker / 拒否記録 json)の sha を、ディスク上の実ファイルから再計算して突き合わせる。
     1バイトでも違えば書かない(fail-closed)。entry 29 の旧 sha 2本が superseded として書かれとらんと書かない。
  3. {claim_sha256, record_canonical, work} で seed_entry_coordinate_v1_addendum_refusals_v1.json を書く

fail-closed: 無い/短い/プレースホルダ/禁止ダッシュ/sha 不一致/読み戻し不一致 のどれでも1バイトも書かない
使い方: cd ~/horizon-shield && python3 workers/hs-ledger/make_coordinate_refusals_v1_seed.py
"""
import io, json, os, re, sys, hashlib

ROOT = "workers/hs-ledger"
CDIR = ROOT + "/nenrin/coordinate-v1"
ADDENDUM = CDIR + "/NENRIN_COORDINATE_v1_ADDENDUM_refusals_v1.md"
DST = ROOT + "/seed_entry_coordinate_v1_addendum_refusals_v1.json"
CITED = ["NENRIN_COORDINATE_SPEC_v1.md", "NENRIN_COORDINATE_v1_ADDENDUM_time_v3.md",
         "NENRIN_COORDINATE_v1_ADDENDUM_sources_v1.md", "NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v1.md",
         "NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v2.md", "NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v3.md",
         "freshness_v3.py", "localheaders.py"]
PINNED = ["sync_headers_p2p.py", "p2p_redteam.py", "make_refusal_seed.py", "refusal_record_redteam_c07.json"]
SUPERSEDED = {"sync_headers_p2p.py": "b7e5a27f9cf5b4aef151f4361297fa089d3aa8cd7f832fef8542c965dd4c02d8",
              "p2p_redteam.py": "d848b12f63d1473dae316a45c95d4e0a52a01e12e648e28a7dfc16af905abd93"}
WORK = ("NENRIN Coordinate Integrity v1 addendum, refusals v1: a refusal is a record. The p2p header client now writes a "
        "machine readable refusal record on every refusal, naming the reason, the height, both peers and both hashes when peers "
        "disagree, and every dropped peer, while still writing no header byte. A seed maker turns a refusal record into a ledger "
        "entry of its own, fail closed. The red team's two valid chains refusal, byte reproducible on two machines, is appended to "
        "the ledger as the entry preceding this one, citable by its own sha. Raised by an outside verifier's question. Cites entries "
        "22, 24, 26, 27, 28, 29, freshness_v3.py and localheaders.py by SHA-256; pins the client v3, its red team, the seed maker "
        "and the refusal record by SHA-256; entry 29's superseded shas stay on record. No pinned file of an earlier entry modified.")
BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "−"]
SHA_LINE = re.compile(r"^\s{4}([0-9a-f]{64})\s{2}(\S+)")

def sha256_file(p):
    h = hashlib.sha256()
    with io.open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()

def main():
    if not os.path.isdir(CDIR): print("NG %s が無い。リポジトリ根から実行" % CDIR); sys.exit(1)
    if not os.path.exists(ADDENDUM): print("NG %s が無い" % ADDENDUM); sys.exit(1)
    text = io.open(ADDENDUM, encoding="utf-8").read()
    checks = [("1000文字以上", len(text) > 1000), ("プレースホルダ無し", not any(m in text for m in BAD_MARKERS)),
              ("nenrin を含む", "nenrin" in text.lower()), ("禁止ダッシュ無し", not any(d in text for d in FORBIDDEN_DASH)),
              ("Files pinned 節あり", "## Files pinned by this addendum" in text)]
    for name in CITED + PINNED: checks.append(("%s を記載" % name, name in text))
    for name, sha in SUPERSEDED.items(): checks.append(("%s の entry 29 sha を記載(superseded)" % name, sha in text))
    for c, o in checks: print("  %s addendum: %s" % ("OK " if o else "NG ", c))
    if not all(o for _, o in checks): print("★ 前提が違う。1バイトも書かずに終了。"); sys.exit(1)
    found = {}
    for ln in text.splitlines():
        m = SHA_LINE.match(ln)
        if m and m.group(2) not in found: found[m.group(2)] = m.group(1)
    for name in CITED + PINNED:
        if name not in found: print("NG sha 行が無い: %s" % name); sys.exit(1)
        p = CDIR + "/" + name
        if not os.path.exists(p): print("NG 実ファイルが無い: %s" % p); sys.exit(1)
        actual = sha256_file(p); ok = (found[name] == actual)
        print("  %s %s %s: %s" % ("OK " if ok else "NG ", "cite" if name in CITED else "pin ", name, found[name][:16]))
        if not ok: print("★ %s の実 sha (%s) が addendum (%s) と違う。中止。" % (name, actual[:16], found[name][:16])); sys.exit(1)
    for name, old in SUPERSEDED.items():
        if found[name] == old: print("★ %s の sha が entry 29 と同じ。v3 が入っとらん。中止。" % name); sys.exit(1)
    for d in FORBIDDEN_DASH:
        if d in WORK: print("★ work に禁止ダッシュ。中止。"); sys.exit(1)
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    io.open(DST, "w", encoding="utf-8").write(json.dumps({"claim_sha256": sha, "record_canonical": text, "work": WORK}, ensure_ascii=False))
    back = json.load(io.open(DST, encoding="utf-8"))
    if hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest() != sha or back["claim_sha256"] != sha:
        print("★ 読み戻し検算に失敗。中止。"); sys.exit(1)
    print("\n書いた: %s\n  claim_sha256: %s\n  cites %d / pins %d verified, superseded %d recorded" % (DST, sha, len(CITED), len(PINNED), len(SUPERSEDED)))
    print("\n次(TOshi 手): add は ops/refusals_v1_files.txt の個別指定(.bin 本体は入れん) → commit / push → append_witness.sh で先に seed_entry_refusal_redteam_c07.json(拒否記録そのもの)、次にこの seed → stamp")

if __name__ == "__main__":
    main()
