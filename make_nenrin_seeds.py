# -*- coding: utf-8 -*-
"""
make_nenrin_seeds.py (2026-08-15) — NENRIN の2文書を台帳投入用 seed JSON にする

やること:
  workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md
  workers/hs-ledger/nenrin/NENRIN_DISCREPANCY_0001.md
  を読み、既存の seed 形式 {claim_sha256, record_canonical, work} で
  workers/hs-ledger/seed_entry_nenrin_spec.json
  workers/hs-ledger/seed_entry_nenrin_discrepancy_0001.json
  を書く。claim_sha256 = sha256(record_canonical) は seed_entry_2 の実測形式と同一。

fail-closed:
  - ファイルが無い/短すぎる/プレースホルダが残っていれば1バイトも書かない
  - 書いた後、読み戻して sha を再計算し、一致しなければ異常終了

使い方:
  cd ~/Desktop/hs-docfix
  python3 make_nenrin_seeds.py
"""
import io, json, os, sys, hashlib

DOCS = [
    ("workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md",
     "workers/hs-ledger/seed_entry_nenrin_spec.json",
     "NENRIN v1 — Machine-Readable Tree Rings for Agent-Facing Services (SPEC anchor)"),
    ("workers/hs-ledger/nenrin/NENRIN_DISCREPANCY_0001.md",
     "workers/hs-ledger/seed_entry_nenrin_discrepancy_0001.json",
     "NENRIN Discrepancy Record 0001 — two witnesses, one target, both correct (founding record)"),
]

BAD_MARKERS = ["TBD", "TODO", "XXX", "<placeholder"]


def main():
    ok_all = True
    results = []
    for src, dst, work in DOCS:
        if not os.path.exists(src):
            print("NG %s が無い" % src)
            ok_all = False
            continue
        text = io.open(src, encoding="utf-8").read()
        checks = [
            ("1000文字以上ある", len(text) > 1000),
            ("プレースホルダが残っていない", not any(m in text for m in BAD_MARKERS)),
            ("アンカー文で終わる構造/固有名を含む", "nenrin" in text.lower()),
        ]
        bad = [c for c, o in checks if not o]
        for c, o in checks:
            print("  %s %s: %s" % ("OK " if o else "NG ", src.split("/")[-1], c))
        if bad:
            ok_all = False
            continue
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        results.append((src, dst, work, text, sha))

    if not ok_all:
        print("★ 前提が違う。1バイトも書かずに終了する。")
        sys.exit(1)

    for src, dst, work, text, sha in results:
        seed = {"claim_sha256": sha, "record_canonical": text, "work": work}
        io.open(dst, "w", encoding="utf-8").write(json.dumps(seed, ensure_ascii=False))
        back = json.load(io.open(dst, encoding="utf-8"))
        re_sha = hashlib.sha256(back["record_canonical"].encode("utf-8")).hexdigest()
        if re_sha != sha or back["claim_sha256"] != sha:
            print("★ %s: 読み戻し検算に失敗。中止。" % dst)
            sys.exit(1)
        print("")
        print("書いた: %s" % dst)
        print("  work        : %s" % work)
        print("  claim_sha256: %s" % sha)

    print("")
    print("次: 1) git add してコミット・push (原本がGitHubにある状態で anchor する)")
    print("    2) 台帳へ append (回転後の鍵で。手順は指示のとおり)")
    print("    3) stamp。数時間後に Bitcoin ブロックに入る")


if __name__ == "__main__":
    main()
