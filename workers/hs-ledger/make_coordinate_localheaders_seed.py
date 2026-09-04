# -*- coding: utf-8 -*-
"""
make_coordinate_localheaders_seed.py (2026-09-04): coordinate-v1 の localheaders addendum を台帳投入用 seed にする

やること (make_coordinate_sources_seed.py と同じ流儀):
  1. nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v1.md を読む
  2. 「引用」4本(spec / time v3 / sources v1 / freshness_v3.py)と「ピン留め」11本(コード5 + ヘッダー鎖2 + manifest2 + snapshot2)の
     sha を、ディスク上の実ファイルから再計算して突き合わせる。1バイトでも違えば書かない(fail-closed)
  3. {claim_sha256, record_canonical, work} で seed_entry_coordinate_v1_addendum_localheaders_v1.json を書く

fail-closed: 無い/短い/プレースホルダ/禁止ダッシュ/sha 不一致/読み戻し不一致 のどれでも1バイトも書かない
使い方: cd ~/horizon-shield && python3 workers/hs-ledger/make_coordinate_localheaders_seed.py
"""
import io, json, os, re, sys, hashlib

ROOT = "workers/hs-ledger"
CDIR = ROOT + "/nenrin/coordinate-v1"
ADDENDUM = CDIR + "/NENRIN_COORDINATE_v1_ADDENDUM_localheaders_v1.md"
DST = ROOT + "/seed_entry_coordinate_v1_addendum_localheaders_v1.json"
CITED = ["NENRIN_COORDINATE_SPEC_v1.md", "NENRIN_COORDINATE_v1_ADDENDUM_time_v3.md",
         "NENRIN_COORDINATE_v1_ADDENDUM_sources_v1.md", "freshness_v3.py"]
PINNED = ["localheaders.py", "localheaders_redteam.py", "sync_headers.py", "sources_live.py", "freshness_live.py",
          "localheaders_mainnet.bin", "localheaders_mainnet.manifest.json", "localheaders_mainnet_mempool.bin",
          "localheaders_mainnet_mempool.manifest.json", "explorer_blockstream_snapshot.json", "explorer_mempool_snapshot.json"]
WORK = ("NENRIN Coordinate Integrity v1 addendum, localheaders: the third beacon source is a locally synced set of raw "
        "Bitcoin block headers verified against consensus rules (hash, linkage, proof of work, difficulty retarget, median "
        "time past, future drift, checkpoints), one violation refuses the file. Red team mines real proof of work, 25 "
        "checks. Real mainnet window 961632..965452 synced from two explorers as couriers, byte identical over 3820 "
        "headers, freshness_v3 run offline against three real sources with five verdicts pinned by record hash. Cites "
        "entries 22, 24 and 26 and freshness_v3.py by SHA-256; pins five code files, two header sets, two manifests and "
        "two explorer snapshots by SHA-256. freshness_v3.py unchanged.")
BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "−"]
SHA_LINE = re.compile(r"^\s{4}([0-9a-f]{64})\s{2}(\S+)")

def sha256_file(p): return hashlib.sha256(io.open(p, "rb").read()).hexdigest()

def main():
    if not os.path.isdir(CDIR): print("NG %s が無い。リポジトリ根から実行" % CDIR); sys.exit(1)
    if not os.path.exists(ADDENDUM): print("NG %s が無い" % ADDENDUM); sys.exit(1)
    text = io.open(ADDENDUM, encoding="utf-8").read()
    checks = [("1000文字以上", len(text) > 1000), ("プレースホルダ無し", not any(m in text for m in BAD_MARKERS)),
              ("nenrin を含む", "nenrin" in text.lower()), ("禁止ダッシュ無し", not any(d in text for d in FORBIDDEN_DASH)),
              ("Files pinned 節あり", "## Files pinned by this addendum" in text)]
    for name in CITED + PINNED: checks.append(("%s を記載" % name, name in text))
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
    for d in FORBIDDEN_DASH:
        if d in WORK: print("★ work に禁止ダッシュ。中止。"); sys.exit(1)
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    io.open(DST, "w", encoding="utf-8").write(json.dumps({"claim_sha256": sha, "record_canonical": text, "work": WORK}, ensure_ascii=False))
    back = json.load(io.open(DST, encoding="utf-8"))
    if hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest() != sha or back["claim_sha256"] != sha:
        print("★ 読み戻し検算に失敗。中止。"); sys.exit(1)
    print("\n書いた: %s\n  claim_sha256: %s\n  cites %d / pins %d verified" % (DST, sha, len(CITED), len(PINNED)))
    print("\n次(TOshi 手): add は個別指定(addendum, seed, この台本, コード5本, .bin 2本, manifest 2本, snapshot 2本) → commit / push → append_witness.sh でこの seed → stamp")

if __name__ == "__main__":
    main()
