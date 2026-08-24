# -*- coding: utf-8 -*-
"""
現場質問への回答を集めて、公開前の控えに置く。公開はしない。

なぜ公開しないか (2026-08-23):
  JHNRD は公開リポジトリで、ライセンスは CC BY 4.0 である。
  現場質問の答えには、実地指導で指摘された点、返戻の理由、判断に迷った請求が入る。
  これを事業所名つきで公開すれば、こちらの都合で相手の弱いところを世に出すことになる。
  データベースを厚くしたいのはこちらの都合であって、それを理由に
  お客様の内部事情を公開してよいことにはならない。

  だからこの道具は、集めるところで止まる。
    集める : この道具            -> data/nursing/field_reports_pending.json (非公開)
    公開   : promote_field_reports.py -> jhnrd/data/rules_2024.json の field_reports

  公開に進めるのは、次の両方がそろったときだけ。
    ・その事業所から、公開してよいという返事を得ている (consent)
    ・事業所名を出すか、匿名にするかを決めてある (publish_as)

集めたものの扱い:
  これは「現場ではこう回っている」であって「こう定められている」ではない。
  規則の出典(sources)には決して入れない。JHNRD の検査がそれを見ている。

使い方:
  python3 tools/nursing/collect_field_reports.py            集める(ネットワークが要る)
  python3 tools/nursing/collect_field_reports.py --fixture <json>   手元の控えで動きを確かめる
"""

import io, json, os, re, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# 鍵の読み方と呼び方は hs_admin に1箇所だけ置く。写しを作らない。
import hs_admin  # noqa: E402
admin_secret = hs_admin.admin_secret
sys.path.insert(0, HERE)
from migrate_questions import HS, DB  # noqa: E402

PENDING = os.path.join(HS, "data", "nursing", "field_reports_pending.json")
KEYFILE = os.path.join(HS, "workers", "hs-hearing", "..", "..",
                       "HORIZON_SHIELD_鍵一覧_20260822.md")
HOSTS = ["https://hs-hearing.ogasurfproject.workers.dev"]
UA = ("HORIZON-SHIELD-tools/1.0 (collect_field_reports; "
      "contact@the-horizons-innovation.com)")   # Bot Fight Mode の error 1010 対策


def field_questions():
    db = json.load(io.open(DB, encoding="utf-8"))
    return {q["id"]: q for q in db.get("questions", []) if q.get("purpose") == "field"}


def harvest(stores, fq):
    """店の profile から、現場質問への答えを取り出す。"""
    out = []
    for st in stores:
        p = st.get("profile") or {}
        if p.get("industry") != "nursing":
            continue
        extra = p.get("extra") or {}
        for qid, q in fq.items():
            raw = extra.get(qid)
            # extra[qid] は {text, at, attributed, with, asked} の形で入る。
            # 2026-08-23、ここを str() で潰して辞書ごと本文にしていた。
            # 気づかなければ、辞書の中身がそのまま公開データベースに載っていた。
            if isinstance(raw, dict):
                text = str(raw.get("text") or "").strip()
                attributed = raw.get("attributed") or "unknown"
                asked = str(raw.get("asked") or "")
                with_q = raw.get("with") or []
                at = raw.get("at")
            else:
                text = str(raw or "").strip()
                attributed, asked, with_q, at = "unknown", "", [], None
            if not text:
                continue
            e = {
                "asked_via": qid,
                "asked_text": asked,
                "fills_gap": q.get("fills_gap"),
                "item_id": q.get("item_id"),          # 特定の項目についての話ならその id
                "store_id": st.get("id"),
                "reported_by": p.get("company") or st.get("id"),
                "reported_at": at or st.get("answered_at") or p.get("updated_at"),
                "text": text,
                # この答えが、本当にこの質問への答えかどうか。
                #   numbered  番号で切り分けられた
                #   sole      その質問だけを送って返ってきた
                #   ambiguous 複数送って1通返り、切り分けられなかった -> 人が確かめる
                "attributed": attributed,
                "asked_with": with_q,
                "needs_attribution": (attributed == "ambiguous"),
                # 公開の可否。人が決めるまで null のまま。
                "consent": None,
                "publish_as": None,
                "note": ("現場の運用。規則の出典にはしない。"
                         "公開するには、事業所の同意と、名前を出すかどうかの決定が要る。"),
            }
            out.append(e)
    return out


def main():
    fq = field_questions()
    print("現場質問: %d 問" % len(fq))
    for qid, q in sorted(fq.items(), key=lambda kv: kv[1].get("order", 0)):
        print("  %-20s 穴: %s" % (qid, str(q.get("fills_gap"))[:50]))

    if "--fixture" in sys.argv:
        stores = json.load(io.open(sys.argv[sys.argv.index("--fixture") + 1], encoding="utf-8"))
        print("\n(控えのデータで動かしています。通信していません)")
    else:
        key = admin_secret()
        r = hs_admin.call("/admin/stores", key)
        ids = [s.get("id") for s in (r.get("stores") or r.get("items") or [])]
        stores = []
        for sid in ids:
            e = hs_admin.call("/admin/export/" + sid, key)
            if e.get("ok"):
                stores.append({"id": sid, "profile": e.get("profile"),
                               "answered_at": e.get("answered_at")})
        print("\n店: %d 件" % len(stores))

    rows = harvest(stores, fq)
    nursing = [s for s in stores if (s.get("profile") or {}).get("industry") == "nursing"]
    print("訪問看護の店: %d 件 / 回答のあった現場質問: %d 件" % (len(nursing), len(rows)))
    MARK = {"numbered": "  ", "sole": "  ", "ambiguous": "※ ", "unknown": "? "}
    for e in rows:
        print("  %s%-20s %s: %s" % (MARK.get(e["attributed"], "? "),
                                    e["asked_via"], e["reported_by"], e["text"][:40]))
    amb = [e for e in rows if e["needs_attribution"]]
    if amb:
        print("\n※ 2問まとめて送って1通返ってきたため、どちらへの答えか切り分けられなかったもの: %d 件"
              % len(amb))
        print("   本文は両方に同じものが入っています。公開の前に、人が確かめてください。")
        for e in amb:
            print("   ・%s (同時に送ったのは %s)" % (e["asked_via"], "、".join(e["asked_with"]) or "-"))

    unanswered = sorted(set(fq) - {e["asked_via"] for e in rows})
    if nursing and unanswered:
        print("\nまだ答えが来ていない現場質問: %d 問" % len(unanswered))
        print("  %s" % "、".join(unanswered))
        print("  (毎日のヒアリングで、重みの順に2問ずつ届きます)")

    old = {}
    if os.path.exists(PENDING):
        for e in json.load(io.open(PENDING, encoding="utf-8")).get("reports", []):
            old[(e.get("store_id"), e.get("asked_via"))] = e
    kept = 0
    for e in rows:
        k = (e["store_id"], e["asked_via"])
        if k in old:
            # 人が付けた同意の判断は、取り直しても消さない。
            e["consent"] = old[k].get("consent")
            e["publish_as"] = old[k].get("publish_as")
            if old[k].get("attribution_confirmed"):
                e["attribution_confirmed"] = old[k]["attribution_confirmed"]
                e["needs_attribution"] = False
            kept += 1

    io.open(PENDING, "w", encoding="utf-8").write(json.dumps({
        "what": "現場質問への回答。公開前の控え。ここは非公開のリポジトリである。",
        "never": ("このファイルの中身を、そのまま JHNRD に写さないこと。"
                  "公開には事業所の同意と、名前を出すかどうかの決定が要る。"),
        "how_to_publish": "consent と publish_as を埋めてから promote_field_reports.py",
        "reports": rows,
    }, ensure_ascii=False, indent=2) + "\n")
    print("\n控えに書きました: %s (%d 件、うち既存の同意判断を引き継いだもの %d 件)"
          % (os.path.relpath(PENDING, HS), len(rows), kept))
    pend = [e for e in rows if e["consent"] is None]
    if pend:
        print("公開の可否がまだ決まっていないもの: %d 件" % len(pend))
        print("  同意を得るまで、JHNRD には1件も出ません。")


if __name__ == "__main__":
    main()
