# -*- coding: utf-8 -*-
"""ヒアリングの立場を切り替える。

  prospect    見込みの相手。返事待ちの間は送らない。催促は 3・7・14・21日目。従来どおり。
  onboarding  契約済みで、データベース構築の期間中。返事待ちでも48時間おきに次を送り、
              3回続けて返事が無ければ送信を止めて人に回す(needs_human)。

なぜ要るか (2026-08-24):
  稼働中のコードにあっぷす様の値を入れて回したところ、返事待ちが開いている間、
  データベースを厚くする8問は一問も出ないことが分かった。上限まで含めて最長28日ゼロ。
  この上限は、見込みの相手を急かさないために置いたもので、そこは正しい。
  あっぷす様は契約済みで、このヒアリング自体が売った物である。
  同じ数字を両方に当てれば、どちらかが必ず間違う。

  相手の届き方を変える操作なので、既定では何もしない。
  --write を付けたときだけ書き、書く前に何がどう変わるかを出す。

  python3 tools/nursing/set_hearing_mode.py                       # いまの立場を一覧
  python3 tools/nursing/set_hearing_mode.py --id <店ID> --mode onboarding --write
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hs_admin  # noqa: E402

MODES = ("prospect", "onboarding")
EXPLAIN = {
    "prospect": "見込み。返事待ちの間は送らない。催促は 3・7・14・21日目",
    "onboarding": "契約済み・DB構築中。返事待ちでも48時間おき。3回無返答で人に回す",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", help="店ID(store_id)")
    ap.add_argument("--mode", choices=MODES)
    ap.add_argument("--write", action="store_true", help="実際に書き込む")
    a = ap.parse_args()

    key = hs_admin.admin_secret()
    rows = hs_admin.stores(key)

    # 2026-08-24 の教訓: 口が返していない欄について「無い」と言わない。
    visible = any("hearing_mode" in r for r in rows)
    print("\n加盟店: %d 件" % len(rows))
    if not visible:
        print("※ /admin/stores が hearing_mode を返していません。")
        print("  いまの立場は、この口からは見えません(worker を deploy すれば見えます)。")
    print("")
    for r in rows:
        cur = r.get("hearing_mode") if visible else None
        print("  %-22s %-28s %s"
              % (r["_id"], hs_admin.row_company(r) or "(社名なし)",
                 (cur or "?") if visible else "(見えない)"))
    print("")

    if not a.id or not a.mode:
        print("切り替えるには --id と --mode を付けてください。")
        for m in MODES:
            print("    %-11s %s" % (m, EXPLAIN[m]))
        return 0

    target = [r for r in rows if r["_id"] == a.id]
    if not target:
        print("その店IDは一覧にありません: %s" % a.id)
        return 1
    row = target[0]
    cur = row.get("hearing_mode") if visible else "(見えない)"
    print("変えるもの: %s  %s" % (a.id, hs_admin.row_company(row) or "(社名なし)"))
    print("  いま  : %s" % cur)
    print("  あとで: %s  … %s" % (a.mode, EXPLAIN[a.mode]))
    print("")
    if a.mode == "onboarding":
        print("  この店には、返事待ちのままでも48時間おきに問いが届くようになります。")
        print("  3回続けて返事が無ければ機械は止まり、needs_human が立ちます(人が電話する番)。")
    else:
        print("  この店への配信は、返事が来るまで止まります(催促を除く)。")
    print("")

    if not a.write:
        print("何も書いていません。実行するには --write を付けてください。")
        return 0

    # 書く直前に、指した店と書く店が同じであることを確かめる。
    # 2026-08-24、別の道具で「指した店と違う店に書く」を実際に作った。
    assert row["_id"] == a.id, "指した店と書く店が違う: %s != %s" % (row["_id"], a.id)
    res = hs_admin.call("/admin/hearing-mode", key,
                        {"store_id": a.id, "mode": a.mode})
    if not res or not res.get("ok"):
        print("書けませんでした: %s" % res)
        return 1
    print("書きました: %s  %s -> %s" % (res.get("store_id"), res.get("from"), res.get("to")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
