# -*- coding: utf-8 -*-
"""
make_coordinate_sources_seed.py (2026-09-04): coordinate-v1 の sources/quorum addendum を台帳投入用 seed にする

やること (make_coordinate_v3_seeds.py と同じ流儀、対象が変わっただけ):
  1. workers/hs-ledger/nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_sources_v1.md を読む
  2. addendum が「引用」している 3本 (v1 spec / time v3 addendum=entry24 / witness state 0001=entry25) の
     sha を、ディスク上の実ファイルから再計算して突き合わせる。1バイトでも違えば書かない(fail-closed)
  3. この addendum は harness を新たにピン留めしない(コード無改変)ことを明示的に確認する。
     もし「Harness files pinned」節が生えていたら、前提が変わったということなので中止する
  4. 既存の seed 形式 {claim_sha256, record_canonical, work} で
       seed_entry_coordinate_v1_addendum_sources_v1.json
     を workers/hs-ledger/ に書く

fail-closed:
  - ファイルが無い/短すぎる/プレースホルダが残っていれば1バイトも書かない
  - 引用 sha と実ファイルの sha が食い違えば中止(アンカー前の最後の検算)
  - 禁止ダッシュ(em/en/bar)が混じっていたら中止(掟)
  - 書いた後、読み戻して sha を再計算し、一致しなければ異常終了

使い方:
  cd ~/horizon-shield
  python3 workers/hs-ledger/make_coordinate_sources_seed.py
"""
import io, json, os, re, sys, hashlib

ROOT = "workers/hs-ledger"
CDIR = ROOT + "/nenrin/coordinate-v1"
ADDENDUM = CDIR + "/NENRIN_COORDINATE_v1_ADDENDUM_sources_v1.md"
DST = ROOT + "/seed_entry_coordinate_v1_addendum_sources_v1.json"

CITED = [
    "NENRIN_COORDINATE_SPEC_v1.md",
    "NENRIN_COORDINATE_v1_ADDENDUM_time_v3.md",
    "NENRIN_WITNESS_STATE_0001.md",
]

WORK = ("NENRIN Coordinate Integrity v1 addendum, sources and the quorum rule: a quorum buys operator "
        "independence and not implementation independence, corroboration from outside the quorum is evidence "
        "of a different kind and never a vote, and the rule for authentic is fixed at two of three with the six "
        "block window named and priced beside full unanimity. The dissent rule is rejected by both the operator "
        "and the founding witness. Cites NENRIN_COORDINATE_SPEC_v1, the time axis v3 addendum and witness state "
        "record 0001 by SHA-256. Pins no new harness bytes and changes no code.")

BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "−"]
SHA_LINE = re.compile(r"^\s{4}([0-9a-f]{64})\s{2}(\S+)")

def sha256_file(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()

def main():
    if not os.path.isdir(CDIR):
        print("NG %s が無い。リポジトリ根から実行しているか確認" % CDIR); sys.exit(1)
    if not os.path.exists(ADDENDUM):
        print("NG %s が無い" % ADDENDUM); sys.exit(1)

    text = io.open(ADDENDUM, encoding="utf-8").read()
    checks = [
        ("1000文字以上", len(text) > 1000),
        ("プレースホルダ無し", not any(m in text for m in BAD_MARKERS)),
        ("nenrin を含む", "nenrin" in text.lower()),
        ("禁止ダッシュ無し", not any(d in text for d in FORBIDDEN_DASH)),
        ("harness を新規ピンしない", "## Harness files pinned" not in text),
    ]
    for name in CITED:
        checks.append(("%s を引用" % name, name in text))
    for c, o in checks:
        print("  %s addendum: %s" % ("OK " if o else "NG ", c))
    if not all(o for _, o in checks):
        print("★ addendum の前提が違う。1バイトも書かずに終了。"); sys.exit(1)

    lines = text.splitlines()
    found = {}
    for ln in lines:
        m = SHA_LINE.match(ln)
        if m and m.group(2) in CITED and m.group(2) not in found:
            found[m.group(2)] = m.group(1)
    missing = [n for n in CITED if n not in found]
    if missing:
        print("NG 引用 sha 行が無い: %s" % ", ".join(missing)); sys.exit(1)

    for name in CITED:
        p = CDIR + "/" + name
        if not os.path.exists(p):
            print("NG 引用対象が無い: %s" % p); sys.exit(1)
        claimed = found[name]
        actual = sha256_file(p)
        ok = (claimed == actual)
        print("  %s cite %s: %s" % ("OK " if ok else "NG ", name, claimed[:16]))
        if not ok:
            print("★ %s の実 sha (%s) が addendum の引用 (%s) と違う。addendum を直すか、ファイルを戻せ。中止。"
                  % (name, actual[:16], claimed[:16])); sys.exit(1)

    for d in FORBIDDEN_DASH:
        if d in WORK:
            print("★ work に禁止ダッシュ。中止。"); sys.exit(1)

    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    seed = {"claim_sha256": sha, "record_canonical": text, "work": WORK}
    io.open(DST, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
    back = json.load(io.open(DST, encoding="utf-8"))
    re_sha = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
    if re_sha != sha or back["claim_sha256"] != sha:
        print("★ %s: 読み戻し検算に失敗。中止。" % DST); sys.exit(1)

    print("")
    print("書いた: %s" % DST)
    print("  claim_sha256: %s" % sha)
    print("  cites verified: %s" % ", ".join(CITED))
    print("  pins: なし(コード無改変。entry 24 のピンがそのまま現行)")
    print("")
    print("次(TOshi 手):")
    print("  1) git add -f workers/hs-ledger/make_coordinate_sources_seed.py")
    print("     git add    workers/hs-ledger/seed_entry_coordinate_v1_addendum_sources_v1.json")
    print("     git add    workers/hs-ledger/nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_sources_v1.md")
    print("     commit / push (原本が GitHub にある状態で anchor する)")
    print("  2) 台帳へ append(回転後の鍵で。既存 NENRIN / coordinate-v1 と同じ手順)")
    print("  3) ots stamp。数時間後に Bitcoin ブロックに入る")

if __name__ == "__main__":
    main()
