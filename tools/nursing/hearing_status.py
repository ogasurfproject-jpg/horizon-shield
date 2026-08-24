# -*- coding: utf-8 -*-
"""
加盟店ごとに、ヒアリングがどこまで進んでいるかを出す。不備を探すための目。

なぜ要る (2026-08-24):
  「現場質問の答えが0件」と出た。だがそれだけでは何も分からない。
  送ったのに答えが来ていないのか、まだ一度も送っていないのか。
  この2つは、打つ手がまるで違う。
  時刻表から推論はできるが、推論は記録ではない。記録を見る。

出すもの:
  ・業種、社名(薄い方/厚い方)、完成度
  ・いま返事待ちの設問と、送ってからの日数
  ・設問ごとの、送った回数と最後に送った日
  ・一度も送っていない設問(これが「答えが無い」の大半の理由でありうる)
  ・打ち切りに達した設問(3回送って埋まらなかったもの)

不備として名指しするもの:
  ・業種が store: 側に無い(名乗りと生成の振り分けが厚い方頼みになる)
  ・社名がどちらにも無い(「加盟店 さま」と呼ぶことになる)
  ・返事待ちが7日を超えている
  ・その業種の生成器が繋がっていない(答えが溜まっても出口が無い)
  ・機械が手を引いた店(needs_human)。人が電話をかける番である

  python3 tools/nursing/hearing_status.py
"""

import io, json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hs_admin  # noqa: E402

HS = hs_admin.HS
# 2026-08-24: 見るレジストリを外から差し替えられるようにした。
#   「生成器が繋がっていない店を名指しするか」を試すには、繋がっていない
#   レジストリが要る。本物を一時的に壊して試すと、戻し忘れがそのまま出荷される。
REG = os.environ.get("HS_INDUSTRY_REGISTRY") or os.path.join(
    HS, "data", "industries", "registry.json")


def age_days(ts):
    if not ts:
        return None
    try:
        t = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        now = datetime.datetime.now(datetime.timezone.utc)
        return (now - t).total_seconds() / 86400.0
    except Exception:
        return None


def industry_expectations():
    """業種ごとに、何問あるはずか・生成器が繋がっているか。"""
    if not os.path.exists(REG):
        return {}
    d = json.load(io.open(REG, encoding="utf-8"))
    return d.get("industries", {})


def main():
    key = hs_admin.admin_secret()
    reg = industry_expectations()
    rows = hs_admin.stores(key)
    print("\n加盟店: %d 件\n" % len(rows))
    problems = []

    # 2026-08-24: 「その欄がどの行にも無い」と「その口がその欄を返さない」は別である。
    #   industry を1行ずつ見て undefined だったので「業種が無い」と報告し続けた。
    #   実際は /admin/stores が industry を返していなかっただけで、
    #   書き込みは成功していた。見えない欄について「無い」とは言えない。
    #   どの行にも1つも無い欄は、返っていないものとして扱う。
    def exposed(field):
        return any(field in r for r in rows)

    ind_visible = exposed("industry")
    if not ind_visible:
        print("※ /admin/stores が industry を返していません。")
        print("  store: 側の業種は、この口からは見えません。")
        print("  見えないものについて「無い」とは言いません。")
        print("  (worker を deploy すれば見えるようになります)\n")

    for row in rows:
        sid = row["_id"]
        thin_co = hs_admin.row_company(row)
        ex = hs_admin.export(sid, key)
        prof = (ex or {}).get("profile") or {}
        ap_res = hs_admin.call("/admin/autopilot/" + sid, key)
        ap = (ap_res or {}).get("autopilot") or {}
        comp = (ap_res or {}).get("completeness")
        ind = prof.get("industry") or row.get("industry")

        print("=" * 66)
        print("%s" % sid)
        print("  社名   : store側=%s / profile側=%s"
              % (thin_co or "(空)", prof.get("company") or "(空)"))
        store_ind = row.get("industry") if ind_visible else "(この口からは見えない)"
        print("  業種   : profile側=%s / store側=%s   完成度: %s"
              % (prof.get("industry") or "(無し)", store_ind or "(無し)", comp))

        # 2026-08-24 ヒアリングの立場。届き方が変わるので、必ず出す。
        mode_visible = exposed("hearing_mode")
        mode = row.get("hearing_mode") if mode_visible else None
        if mode_visible:
            label = {"onboarding": "契約済み・DB構築中(48時間おき/3回無返答で人に回す)",
                     "prospect": "見込み(従来どおり。返事待ちの間は送らない)"}.get(mode, mode)
            print("  立場   : %s" % label)
        else:
            print("  立場   : (この口からは見えない。deploy すれば見えます)")

        # 機械が手を引いたか
        nh = ap.get("needs_human")
        streak = ap.get("unanswered_sends")
        if nh:
            print("  ★ 機械は手を引きました: %s (%s から)"
                  % (nh.get("why") or "理由なし", str(nh.get("since"))[:16]))
            problems.append((sid, "機械が手を引いています。人が連絡する番です: %s"
                             % (nh.get("why") or "理由なし")))
        elif streak:
            print("  連続無返答: %s 回" % streak)

        if ind_visible and not row.get("industry"):
            problems.append((sid, "store: 側に業種が無い。名乗りと生成の振り分けが厚い方頼みになる"))
        if not thin_co and not prof.get("company"):
            problems.append((sid, "社名がどちらにも無い。「加盟店 さま」と呼ぶことになる"))

        # 返事待ち
        pend = ap.get("pending")
        if pend:
            d = age_days(pend.get("sent_at"))
            print("  返事待ち: %s  (%s に %s で送信, %.1f 日前)"
                  % ("、".join(pend.get("qids") or []), str(pend.get("sent_at"))[:16],
                     pend.get("via"), d if d is not None else -1))
            # 2026-08-24: 返事待ちは「波」で持つ。どの群がいつ出たのかを出す。
            #   1通の返事を全部の設問に当てないための区切りが、ここに見えていないと確かめられない。
            for w in (ap.get("pending") or {}).get("waves") or []:
                wd = age_days(w.get("sent_at"))
                print("      波 %-8s %s  (%s, %.1f 日前)"
                      % (w.get("kind") or "-", "、".join(w.get("qids") or []),
                         str(w.get("sent_at"))[:16], wd if wd is not None else -1))
            if d is not None and d > 7:
                problems.append((sid, "返事待ちが %.0f 日。放置になっている" % d))
        else:
            print("  返事待ち: なし")

        # 2026-08-24: 誰が最後にこの店を書いたか。
        #   送信履歴(asked)が消えた件は、どの経路で消えたかが分からないままである。
        #   分からないものを分かったふりで直さず、名前だけ残すようにした。
        #   ここはその名前を読む場所である。
        writes = ap.get("_writes") or row.get("autopilot", {}).get("writes") or []
        if writes:
            print("  書き手  : %s" % " -> ".join(
                "%s(%s)" % (w.get("by"), str(w.get("at"))[11:16]) for w in writes[-5:]))
        over = ap.get("_pending_overwritten") or row.get("autopilot", {}).get("pending_overwritten") or []
        if over:
            for o in over[-3:]:
                print("  ★ 新しい返事待ちを踏み消した書き込みがあります: %s が %s を消しました(%s)"
                      % (o.get("by"), "、".join(o.get("lost_qids") or []), str(o.get("lost_sent_at"))[:16]))
            problems.append((sid, "返事待ちを踏み消した書き込みがある(%s)"
                             % "、".join(sorted({o.get("by") for o in over}))))
        rec = ap.get("_asked_recovered") or row.get("autopilot", {}).get("asked_recovered") or []
        if rec:
            print("  拾い直し: 送信履歴を %d 回ぶん拾い直しました(%s)"
                  % (len(rec), "、".join(sorted({r.get("by") for r in rec}))))

        # 送った履歴
        asked = ap.get("asked") or []
        hist = {}
        for a in asked:
            q = a.get("qid")
            hist.setdefault(q, []).append(a.get("at"))
        print("  送った設問: %d 種 / のべ %d 回" % (len(hist), len(asked)))

        # 2026-08-24: 返事待ちに載っているのに、送信履歴に無い設問。
        #   平田様の記録で見つけた。0.2日前に2問送ってあるのに asked が空だった。
        #   記録が食い違っているときは、こちらの結論(「まだ送っていない」)も
        #   その記録に乗っているので、同じだけ疑わしい。黙って数えない。
        lost = [q for q in ((pend or {}).get("qids") or []) if q not in hist]
        if lost:
            print("  ★ 送信履歴に無いのに返事待ちになっている設問: %s" % "、".join(lost))
            print("     記録が食い違っています。下の「まだ送っていない」も、")
            print("     この記録に乗っているので、同じだけ疑ってください。")
            problems.append((sid, "送信履歴が失われている(返事待ち %s が asked に無い)"
                             % "、".join(lost)))
        maxed = [q for q, ts in hist.items() if len(ts) >= 3]
        if maxed:
            print("    打ち切りに達したもの(3回): %s" % "、".join(maxed))

        # その業種で送るはずの設問のうち、一度も送っていないもの
        if ind and ind in reg:
            g = (reg[ind].get("generator") or {})
            if g.get("status") != "wired":
                problems.append((sid, "業種 %s の生成器が %s。答えが溜まっても出口が無い"
                                 % (ind, g.get("status"))))
            print("  生成器 : %s (%s)" % (g.get("status"), g.get("tool") or "-"))

        never = [q for q in FIELD_QIDS if q not in hist]
        if ind == "nursing":
            print("  DBを厚くする現場質問: 全%d問中、まだ一度も送っていない %d問"
                  % (len(FIELD_QIDS), len(never)))
            if never:
                print("    %s" % "、".join(never))
                print("    → 答えが無いのは、送っていないからです。相手は無反応ではありません。")

    print("=" * 66)
    if problems:
        print("\n不備: %d 件" % len(problems))
        for sid, p in problems:
            print("  ・%-18s %s" % (sid, p))
    else:
        print("\n不備は見つかりませんでした。")


FIELD_QIDS = []
try:
    _v = json.load(io.open(os.path.join(HS, "data", "visibility", "requirements.json"), encoding="utf-8"))
except Exception:
    _v = {}
try:
    _n = json.load(io.open(os.path.join(HS, "data", "nursing", "rules_2024.json"), encoding="utf-8"))
    FIELD_QIDS = [q["id"] for q in _n.get("questions", []) if q.get("purpose") == "field"]
except Exception:
    FIELD_QIDS = []

if __name__ == "__main__":
    main()
