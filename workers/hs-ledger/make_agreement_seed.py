# -*- coding: utf-8 -*-
"""
make_agreement_seed.py (2026-09-10): 合意記録の草案(AGREEMENT_EXT_v0_DRAFT.md)を台帳投入用 seed にする

なぜ錨を打つか:
  git の日付は git を握っとる者が動かせる。設計の先行を主張したいなら、動かせん時計で挟むしかない。
  この草案の sha を JIDEC に入れて Bitcoin に stamp すれば、「2026-09-10 にこの設計が存在した」ことを
  運営者の協力無しに誰でも確かめられる。conduct-v1 の仕様を entry 37 で錨打ちしたのと同じ形。

  隣に先客が居る(Cedulon draft-dogru-cedulon-08、1F916 Agent Record draft-01)。
  どっちも IETF の個人 draft で日付がある。こっちも日付を持っておく。

錨を打つのは「草案」であって「仕様」やない。work 欄にそう書く。URI でも配っとらんし、実装も無い。
それを曖昧にしたら、この事業が狩っとる側と同じことをすることになる。

fail-closed:
  - ファイルが無い/短すぎる/プレースホルダが残っとれば 1 バイトも書かん
  - DRAFT の断り書きと 6 節(Prior art)が無ければ書かん
  - 禁止ダッシュ(em/en/bar)が混じっとったら中止(掟)
  - 書いた後、読み戻して sha を再計算し、一致せんかったら異常終了

使い方:
  cd ~/horizon-shield
  python3 workers/hs-ledger/make_agreement_seed.py
  zsh workers/hs-ledger/append_witness.sh seed_entry_agreement_v0.json    (token は隠し入力、TOshi の手)
"""
import io, json, os, sys, hashlib

SRC = "ops/AGREEMENT_EXT_v0_DRAFT.md"
DST = "workers/hs-ledger/seed_entry_agreement_v0.json"
BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]
FORBIDDEN_DASH = ["—", "–", "―", "‒", "−"]
WORK = (
    "Agreement Record v0 DRAFT (a2a-agreement-v1) design anchor, 2026-09-10: a record of terms two agents "
    "both signed, carrying each party's conduct record by sha at that moment, refused by the intake unless "
    "both signatures cover the same bytes, anchored in the existing daily batch, with no custody, no matching "
    "and no fee that varies with the deal. This is a dated draft, not a specification in force: it is not "
    "served at a URI, has no implementation, and prior art is named in its section 6."
)

def main():
    if not os.path.exists(SRC):
        print("NG %s が無い。リポジトリ根から実行しとるか確認" % SRC); sys.exit(1)
    text = io.open(SRC, encoding="utf-8").read()
    checks = [
        ("3000 文字以上", len(text) > 3000),
        ("プレースホルダ無し", not any(m in text for m in BAD_MARKERS)),
        ("schema 名を含む", "a2a-agreement-v1" in text),
        ("DRAFT の断りを含む", "DRAFT" in text and "NOT served at a URI" in text),
        ("6 節 Prior art を含む", "## 6. Prior art" in text),
        ("双方署名の受理規則を含む", "one_sided" in text),
        ("禁止ダッシュ無し", not any(d in text for d in FORBIDDEN_DASH)),
    ]
    for name, ok in checks:
        print(("ok   " if ok else "NG   ") + name)
    if not all(ok for _n, ok in checks):
        print("NG 1 つでも落ちたら書かん(fail closed)"); sys.exit(1)

    claim = hashlib.sha256(text.encode("utf-8")).hexdigest()
    seed = {"claim_sha256": claim, "record_canonical": text, "work": WORK}
    io.open(DST, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False) + "\n")

    back = json.loads(io.open(DST, encoding="utf-8").read())
    again = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
    if again != claim or back["claim_sha256"] != claim:
        print("NG 読み戻しの sha が合わん。seed を捨てろ"); sys.exit(1)
    print("")
    print("wrote  " + DST)
    print("bytes  " + str(len(text.encode("utf-8"))))
    print("claim  " + claim)
    print("")
    print("次(TOshi の手): zsh workers/hs-ledger/append_witness.sh seed_entry_agreement_v0.json")

if __name__ == "__main__":
    main()
