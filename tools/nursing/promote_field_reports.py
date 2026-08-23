# -*- coding: utf-8 -*-
"""
現場からの報告を、公開データベース(JHNRD)に載せる。人が決めたものだけを載せる。

この道具が守る3つの門 (2026-08-23):

  1) 同意     consent が true でなければ載せない。
              JHNRD は公開リポジトリで、ライセンスは CC BY 4.0 である。
              実地指導で指摘された点、返戻の理由、判断に迷った請求。
              データベースを厚くしたいのはこちらの都合であって、
              それを理由にお客様の内部事情を公開してよいことにはならない。

  2) 名乗り方 publish_as が決まっていなければ載せない。
              事業所名を出すのか、匿名にするのか。
              「現場では」とだけ書かれた報告は、誰の話か分からず、
              分からないものは突き合わせもできない。

  3) 出所     needs_attribution が立っていれば載せない。
              2問まとめて送って1通返ってきたとき、どちらへの答えか
              切り分けられないことがある。そのまま載せれば、
              実地指導について尋ねた欄に、別の質問の答えが入る。
              人が確かめて attribution_confirmed を立てるまで待つ。

  どれも「載せない」側に倒す。載せてから消すのでは間に合わない。

そして、載せたあとも規則ではない:
  field_reports は sources ではない。事業所がそう回しているという事実は、
  そう定められているという根拠ではない。JHNRD の validate.py がそれを見ている。
  条文が取れたとき、現場の運用とずれていたら、そのずれ自体が見つけるべきものである。
  どちらかを消さず、両方を残す。

使い方:
  python3 tools/nursing/promote_field_reports.py           下見(何が載り、何が止まるか)
  python3 tools/nursing/promote_field_reports.py --apply   載せる
"""

import io, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from migrate_questions import HS, JHNRD  # noqa: E402

PENDING = os.path.join(HS, "data", "nursing", "field_reports_pending.json")
OWNER = os.path.join(JHNRD, "data", "rules_2024.json")


def gate(e):
    """載せてよいか。理由つきで返す。"""
    if e.get("consent") is not True:
        return False, "同意がまだ (consent が true でない)"
    if not e.get("publish_as"):
        return False, "名乗り方が決まっていない (publish_as が空)"
    if e.get("needs_attribution") and not e.get("attribution_confirmed"):
        return False, "どちらの質問への答えか未確認 (attribution_confirmed が無い)"
    if not str(e.get("text") or "").strip():
        return False, "本文が空"
    return True, ""


def main():
    apply = "--apply" in sys.argv
    if not os.path.exists(PENDING):
        print("控えがありません。先に collect_field_reports.py を動かしてください。")
        return
    if not os.path.exists(OWNER):
        sys.stderr.write("JHNRD が手元にありません: %s\n" % OWNER); sys.exit(2)

    rows = json.load(io.open(PENDING, encoding="utf-8")).get("reports", [])
    db = json.load(io.open(OWNER, encoding="utf-8"))
    have = {r.get("id") for r in (db.get("field_reports") or [])}

    ok, held = [], []
    for e in rows:
        good, why = gate(e)
        rid = "fr-%s-%s" % (e.get("store_id"), e.get("asked_via"))
        if not good:
            held.append((rid, why, e)); continue
        if rid in have:
            held.append((rid, "既に載っている", e)); continue
        ok.append({
            "id": rid,
            "item_id": e.get("item_id"),
            "fills_gap": e.get("fills_gap"),
            "asked_via": e.get("asked_via"),
            "asked_text": e.get("asked_text"),
            "reported_by": e.get("publish_as"),
            "reported_at": e.get("reported_at"),
            "attributed": e.get("attributed"),
            "text": e.get("text"),
            "consent": "事業所から公開の同意を得ている",
            "not_a_source": True,
            "note": ("現場での実際の運用。規則の出典ではない。"
                     "そう回しているという事実は、そう定められているという根拠ではない。"),
        })

    print("控え: %d 件" % len(rows))
    print("  載せられるもの: %d 件" % len(ok))
    for e in ok:
        print("    ・%-34s %s: %s" % (e["id"], e["reported_by"], str(e["text"])[:38]))
    print("  止めたもの    : %d 件" % len(held))
    for rid, why, _e in held:
        print("    ・%-34s %s" % (rid, why))

    if not ok:
        print("\n載せるものがありません。")
        return
    if not apply:
        print("\n(--apply が無いので、まだ書いていません)")
        return

    db.setdefault("field_reports", [])
    db["field_reports"].extend(ok)
    io.open(OWNER, "w", encoding="utf-8").write(json.dumps(db, ensure_ascii=False, indent=2) + "\n")

    # 書いたら、必ずデータベースの検査を通す。通らなければ戻す。
    r = subprocess.run(["python3", os.path.join(JHNRD, "tools", "validate.py"), OWNER],
                       capture_output=True, text=True)
    if r.returncode != 0:
        db["field_reports"] = [x for x in db["field_reports"] if x["id"] not in {e["id"] for e in ok}]
        io.open(OWNER, "w", encoding="utf-8").write(json.dumps(db, ensure_ascii=False, indent=2) + "\n")
        print("\nJHNRD の検査に落ちたので、書いたぶんを戻しました。", file=sys.stderr)
        print(r.stdout[-1200:], file=sys.stderr)
        sys.exit(3)
    print("\nJHNRD に %d 件を載せ、検査を通しました。" % len(ok))
    print("  これは現場の報告であって、規則の出典ではありません。")


if __name__ == "__main__":
    main()
