# -*- coding: utf-8 -*-
"""
make_coordinate_v3_seeds.py (2026-09-03): coordinate-v1 の time axis v3 addendum を台帳投入用 seed にする

やること (make_coordinate_seeds.py と同じ流儀、対象が addendum に変わっただけ):
  1. workers/hs-ledger/nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_time_v3.md を読む
  2. addendum が「引用」している v1 spec の sha と、「ピン留め」している harness 2本の sha を、
     ディスク上の実ファイルから再計算して突き合わせる。1バイトでも違えば書かない(fail-closed)
  3. 既存の seed 形式 {claim_sha256, record_canonical, work} で
       seed_entry_coordinate_v1_addendum_time_v3.json  (addendum 全文をアンカー)
     を workers/hs-ledger/ に書く

なぜ addendum 1枚で足りるか:
  addendum は自分の本文の中に harness 2本の sha256 を持っている(自己ピン留め)。addendum の sha が
  Bitcoin に入れば、その時点の harness のバイト列も同時に固定される。manifest と同じ理屈。
  さらに addendum は v1 spec の sha を引用しているので、v1 → v3 の系譜が台帳上で繋がる。

fail-closed:
  - ファイルが無い/短すぎる/プレースホルダが残っていれば1バイトも書かない
  - addendum が主張する sha と実ファイルの sha が食い違えば中止(アンカー前の最後の検算)
  - 禁止ダッシュ(em/en/bar)が混じっていたら中止(掟)
  - 書いた後、読み戻して sha を再計算し、一致しなければ異常終了

使い方:
  cd ~/horizon-shield
  python3 workers/hs-ledger/make_coordinate_v3_seeds.py
"""
import io, json, os, re, sys, hashlib

ROOT = "workers/hs-ledger"
CDIR = ROOT + "/nenrin/coordinate-v1"
ADDENDUM = CDIR + "/NENRIN_COORDINATE_v1_ADDENDUM_time_v3.md"
SPEC = CDIR + "/NENRIN_COORDINATE_SPEC_v1.md"
DST = ROOT + "/seed_entry_coordinate_v1_addendum_time_v3.json"
WORK = ("NENRIN Coordinate Integrity v1 addendum, time axis v3.2: multi source quorum beacon, forged vs "
        "unverifiable split, backdating check decoupled from quorum, veto derived from the highest reachable "
        "tip with the near tip residual bounded by chain convergence. Pins freshness_v3.py and "
        "freshness_v3_redteam.py by SHA-256, cites NENRIN_COORDINATE_SPEC_v1 by SHA-256.")

BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "−"]
SHA_LINE = re.compile(r"^\s{4}([0-9a-f]{64})\s{2}(\S+)\s*$")

def sha256_file(path):
    return hashlib.sha256(io.open(path, "rb").read()).hexdigest()

def main():
    if not os.path.isdir(CDIR):
        print("NG %s が無い。リポジトリ根から実行しているか確認" % CDIR); sys.exit(1)
    for p in (ADDENDUM, SPEC):
        if not os.path.exists(p):
            print("NG %s が無い" % p); sys.exit(1)

    text = io.open(ADDENDUM, encoding="utf-8").read()
    checks = [
        ("1000文字以上", len(text) > 1000),
        ("プレースホルダ無し", not any(m in text for m in BAD_MARKERS)),
        ("nenrin を含む", "nenrin" in text.lower()),
        ("禁止ダッシュ無し", not any(d in text for d in FORBIDDEN_DASH)),
        ("v1 spec を引用", "NENRIN_COORDINATE_SPEC_v1.md" in text),
    ]
    for c, o in checks:
        print("  %s addendum: %s" % ("OK " if o else "NG ", c))
    if not all(o for _, o in checks):
        print("★ addendum の前提が違う。1バイトも書かずに終了。"); sys.exit(1)

    # 引用している v1 spec の sha を addendum 本文から拾い、実ファイルと突き合わせる
    lines = text.splitlines()
    cited_spec = None
    for ln in lines:
        m = SHA_LINE.match(ln)
        if m and m.group(2) == "NENRIN_COORDINATE_SPEC_v1.md":
            cited_spec = m.group(1); break
    if not cited_spec:
        print("NG addendum に v1 spec の sha 行が無い"); sys.exit(1)
    actual_spec = sha256_file(SPEC)
    ok = (cited_spec == actual_spec)
    print("  %s v1 spec 引用 sha 一致: %s" % ("OK " if ok else "NG ", cited_spec[:16]))
    if not ok:
        print("★ addendum が引用する v1 spec の sha (%s) と実ファイル (%s) が違う。中止。" % (cited_spec[:16], actual_spec[:16])); sys.exit(1)

    # 「Harness files pinned by this addendum」以降の sha 行 = 現在のピン。superseded は対象外。
    try:
        start = next(i for i, ln in enumerate(lines) if ln.startswith("## Harness files pinned"))
    except StopIteration:
        print("NG 'Harness files pinned' セクションが無い"); sys.exit(1)
    pins = []
    for ln in lines[start:]:
        m = SHA_LINE.match(ln)
        if m:
            pins.append((m.group(1), m.group(2)))
    if len(pins) < 2:
        print("NG ピン留めされた harness が2本未満 (%d)" % len(pins)); sys.exit(1)
    for claimed, fname in pins:
        p = CDIR + "/" + fname
        if not os.path.exists(p):
            print("NG ピン対象が無い: %s" % p); sys.exit(1)
        actual = sha256_file(p)
        ok = (claimed == actual)
        print("  %s pin %s: %s" % ("OK " if ok else "NG ", fname, claimed[:16]))
        if not ok:
            print("★ %s の実 sha (%s) が addendum のピン (%s) と違う。addendum を直すか、ファイルを戻せ。中止。"
                  % (fname, actual[:16], claimed[:16])); sys.exit(1)

    # seed 1枚
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    seed = {"claim_sha256": sha, "record_canonical": text, "work": WORK}
    for d in FORBIDDEN_DASH:
        if d in WORK:
            print("★ work に禁止ダッシュ。中止。"); sys.exit(1)
    io.open(DST, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
    back = json.load(io.open(DST, encoding="utf-8"))
    re_sha = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
    if re_sha != sha or back["claim_sha256"] != sha:
        print("★ %s: 読み戻し検算に失敗。中止。" % DST); sys.exit(1)
    print("")
    print("書いた: %s" % DST)
    print("  claim_sha256: %s" % sha)
    print("  pins verified: %s" % ", ".join(f for _, f in pins))

    print("")
    print("次(TOshi 手):")
    print("  1) git add -f workers/hs-ledger/make_coordinate_v3_seeds.py")
    print("     git add    workers/hs-ledger/seed_entry_coordinate_v1_addendum_time_v3.json")
    print("     commit / push (原本が GitHub にある状態で anchor する)")
    print("  2) 台帳へ append(回転後の鍵で。既存 NENRIN / coordinate-v1 と同じ手順)")
    print("  3) ots stamp。数時間後に Bitcoin ブロックに入る")

if __name__ == "__main__":
    main()
