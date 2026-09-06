# -*- coding: utf-8 -*-
"""
make_conduct_ext_seed.py (2026-09-06): A2A Conduct Extension v1 の仕様(CONDUCT_EXT_v1.md)を台帳投入用 seed にする

やること (make_coordinate_seeds.py と同じ流儀):
  1. workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md を読む(URI https://gate.horizonshield.dev/ext/conduct/v1 が配る本文と同じ bytes)
  2. 本文の sha256 が、扉の /ext/conduct/v1 JSON の spec_markdown_sha256 と同じであることを前提にする(配備後に curl で照合してから走らせる)
  3. 既存の seed 形式 {claim_sha256, record_canonical, work} で
       workers/hs-ledger/seed_entry_conduct_ext_v1.json
     を書く

なぜ anchor するか:
  card が capabilities.extensions[].params で指す URI の「意味」は、この文書が決める。文書が Bitcoin の時刻に固定されると、
  「2026-09-06 に v1 が何を言っとったか」を運営者の協力無しに誰でも確かめられる。錨打ちの後は本文を直せん(直すなら v1.1 = 新 sha、URI は同じ、9 節/10 節の約束どおり)。

fail-closed:
  - ファイルが無い/短すぎる/プレースホルダが残っていれば1バイトも書かない
  - 10 節(License and governance)が無ければ書かない(9 節と 10 節が入った版だけを錨にする)
  - 書いた後、読み戻して sha を再計算し、一致しなければ異常終了
  - 禁止ダッシュ(em/en/bar)が本文に混じっていたら中止(掟)

使い方:
  cd ~/horizon-shield
  curl -sS -H 'Accept: text/markdown' https://gate.horizonshield.dev/ext/conduct/v1 | shasum -a 256   (本番の sha を見る)
  python3 workers/hs-ledger/make_conduct_ext_seed.py                                                   (同じ sha が出ることを確認)
"""
import io, json, os, sys, hashlib

ROOT = "workers/hs-ledger"
SPEC = "workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md"
DST = ROOT + "/seed_entry_conduct_ext_v1.json"
BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "−"]

def main():
    if not os.path.exists(SPEC):
        print("NG %s が無い。リポジトリ根から実行しているか確認" % SPEC); sys.exit(1)
    text = io.open(SPEC, encoding="utf-8").read()
    checks = [
        ("5000文字以上", len(text) > 5000),
        ("プレースホルダ無し", not any(m in text for m in BAD_MARKERS)),
        ("URI を含む", "https://gate.horizonshield.dev/ext/conduct/v1" in text),
        ("9 節 Prior art を含む", "## 9. Prior art" in text),
        ("10 節 License and governance を含む", "## 10. License and governance" in text),
        ("禁止ダッシュ無し", not any(d in text for d in FORBIDDEN_DASH)),
    ]
    for c, o in checks:
        print("  %s spec: %s" % ("OK " if o else "NG ", c))
    if not all(o for _, o in checks):
        print("★ spec の前提が違う。1バイトも書かずに終了。"); sys.exit(1)
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    print("  spec sha256: %s  (本番の /ext/conduct/v1 の spec_markdown_sha256 と同じか、目で照合)" % sha)
    seed = {
        "claim_sha256": sha,
        "record_canonical": text,
        "work": "A2A Conduct Extension v1 (conduct-v1) specification anchor: URI https://gate.horizonshield.dev/ext/conduct/v1, sections 1 to 10 as served on 2026-09-06 (Apache-2.0)",
    }
    io.open(DST, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
    back = json.load(io.open(DST, encoding="utf-8"))
    re_sha = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
    if re_sha != sha or back["claim_sha256"] != sha:
        print("★ 読み戻し検算に失敗。中止。"); sys.exit(1)
    print("書いた: %s" % DST)
    print("  claim_sha256: %s" % sha)
    print("")
    print("次(TOshi 手):")
    print("  1) git add workers/hs-ledger/seed_entry_conduct_ext_v1.json ; commit / push (原本が GitHub にある状態で anchor する)")
    print("  2) 台帳へ append(回転後の鍵で。coordinate-v1 と同じ手順)")
    print("  3) ots stamp。数時間後に Bitcoin ブロックに入る。以後、本文は直せん。直すなら v1.1 で新 sha")

if __name__ == "__main__":
    main()
