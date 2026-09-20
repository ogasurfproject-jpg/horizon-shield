#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bing_ai_citation_summary.py  HORIZON SHIELD  AI 引用の主計器(Bing Webmaster Tools 書き出しを読む。stdlib のみ、送信なし、書き込みは --log の 1 行だけ)

読む物(Bing Webmaster Tools から書き出した CSV。ファイル名の一部で自動判別):
  *AIPerformanceOverviewStats*.csv   日付 / Citations / Cited Pages(日次)
  *AISearchQueriesReport*.csv        Grounding Query / Intent / Topic / Citations / Citation Share
  *SearchPerformanceOverview*.csv    日付 / クリック数 / インプレッション / 平均CTR(従来検索。比較用、無くても動く)

使い方:
  python3 ops/bing_ai_citation_summary.py ~/Downloads
  python3 ops/bing_ai_citation_summary.py ~/Downloads --log      # ops/bing_ai_log.txt に要約 1 行を追記
  python3 ops/bing_ai_citation_summary.py ~/Downloads --json     # 機械可読

同じ種類の CSV が複数あれば、ファイル名の日付が一番新しい物を使う。
数字は書き出しに書いてある値をそのまま足すだけ。推定はしない。
"""
import sys, os, csv, re, glob, json, datetime, io

PRICE_WORDS = ["相場", "費用", "価格", "単価", "料金", "値段", "いくら", "予算", "金額", "一覧", "坪単価", "工事費"]
JUDGE_WORDS = ["適正", "高い", "妥当", "ぼったくり", "比較", "見積", "見積もり", "見積り", "チェック", "確か"]
TACTIC_WORDS = ["一式", "訪問販売", "訪問", "点検商法", "点検", "手口", "値引き", "今日だけ", "無料点検", "契約", "断り", "断る", "クーリング"]
SERVICE_WORDS = ["第三者", "検証", "セカンドオピニオン", "鑑定", "ホライゾン", "HORIZON", "horizon", "shield", "シールド"]


def read_csv(path):
    with io.open(path, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    rows = [r for r in rows if r and any(c.strip() for c in r)]
    return rows[0], rows[1:]


def parse_date(s):
    s = s.strip()
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError("date format not recognised: " + s)


def to_int(s):
    return int(re.sub(r"[^0-9-]", "", s) or "0")


def to_pct(s):
    return float(re.sub(r"[^0-9.]", "", s) or "0")


def newest(folder, pattern):
    files = glob.glob(os.path.join(folder, "*" + pattern + "*.csv"))
    if not files:
        return None
    def key(p):
        m = re.search(r"(\d{4})_(\d{2})_(\d{2})", os.path.basename(p))
        return (m.group(0) if m else "", os.path.getmtime(p))
    return sorted(files, key=key)[-1]


def classify(q):
    q_l = q.lower()
    kinds = []
    if any(w in q for w in SERVICE_WORDS) or any(w in q_l for w in ["horizon", "shield"]):
        kinds.append("service")
    if any(w in q for w in TACTIC_WORDS):
        kinds.append("tactics")
    if any(w in q for w in JUDGE_WORDS):
        kinds.append("judge")
    if any(w in q for w in PRICE_WORDS):
        kinds.append("price")
    return kinds or ["other"]


def window(daily, end, days):
    start = end - datetime.timedelta(days=days - 1)
    rows = [(d, c, p) for d, c, p in daily if start <= d <= end]
    return start, rows


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = [a for a in sys.argv[1:] if a.startswith("--")]
    folder = os.path.expanduser(args[0]) if args else os.path.expanduser("~/Downloads")
    if not os.path.isdir(folder):
        print("folder not found:", folder); sys.exit(1)

    out = {"folder": folder, "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")}

    # 1. daily AI citations
    f_ai = newest(folder, "AIPerformanceOverviewStats")
    if not f_ai:
        print("AIPerformanceOverviewStats*.csv が無い。Bing Webmaster Tools の AI Performance を書き出して置け。"); sys.exit(1)
    hdr, rows = read_csv(f_ai)
    daily = []
    for r in rows:
        if len(r) < 3:
            continue
        try:
            daily.append((parse_date(r[0]), to_int(r[1]), to_int(r[2])))
        except ValueError:
            continue
    daily.sort()
    if not daily:
        print("日次の行が読めん:", f_ai); sys.exit(1)
    last = daily[-1][0]
    s7, w7 = window(daily, last, 7)
    s7p, w7p = window(daily, last - datetime.timedelta(days=7), 7)
    s28, w28 = window(daily, last, 28)
    c7 = sum(c for _, c, _ in w7); c7p = sum(c for _, c, _ in w7p); c28 = sum(c for _, c, _ in w28)
    pages7 = round(sum(p for _, _, p in w7) / max(1, len(w7)), 1)
    peak = max(daily, key=lambda t: t[1])
    out["ai_daily"] = {
        "file": os.path.basename(f_ai), "first": str(daily[0][0]), "last": str(last), "days": len(daily),
        "total": sum(c for _, c, _ in daily),
        "last7": {"from": str(s7), "to": str(last), "citations": c7, "per_day": round(c7 / max(1, len(w7)), 1), "cited_pages_avg": pages7, "days_present": len(w7)},
        "prev7": {"from": str(s7p), "citations": c7p, "days_present": len(w7p)},
        "last28": {"from": str(s28), "citations": c28, "days_present": len(w28)},
        "peak": {"date": str(peak[0]), "citations": peak[1], "cited_pages": peak[2]},
    }

    # 2. classic search, same window (optional)
    f_cl = newest(folder, "SearchPerformanceOverview")
    if f_cl:
        hdr, rows = read_csv(f_cl)
        cl = []
        for r in rows:
            if len(r) < 3:
                continue
            try:
                cl.append((parse_date(r[0]), to_int(r[1]), to_int(r[2])))
            except ValueError:
                continue
        _, cw7 = window(cl, last, 7)
        out["classic_last7"] = {"file": os.path.basename(f_cl), "clicks": sum(c for _, c, _ in cw7), "impressions": sum(i for _, _, i in cw7), "days_present": len(cw7)}
        imp = out["classic_last7"]["impressions"]
        out["ai_to_classic_impressions_ratio"] = round(c7 / imp, 2) if imp else None

    # 3. grounding queries
    f_q = newest(folder, "AISearchQueriesReport")
    if f_q:
        hdr, rows = read_csv(f_q)
        qs = []
        for r in rows:
            if len(r) < 5 or not r[0].strip():
                continue
            qs.append({"query": r[0].strip(), "citations": to_int(r[3]), "share": to_pct(r[4]), "kinds": classify(r[0])})
        qs.sort(key=lambda x: -x["citations"])
        total = sum(q["citations"] for q in qs)
        wshare = round(sum(q["citations"] * q["share"] for q in qs) / total, 1) if total else 0.0
        by_kind = {}
        for q in qs:
            for k in q["kinds"]:
                d = by_kind.setdefault(k, {"queries": 0, "citations": 0})
                d["queries"] += 1; d["citations"] += q["citations"]
        out["queries"] = {
            "file": os.path.basename(f_q), "n_queries": len(qs), "citations": total, "weighted_share_pct": wshare,
            "share_ge_30_pct": sum(1 for q in qs if q["share"] >= 30.0),
            "share_ge_50_pct": sum(1 for q in qs if q["share"] >= 50.0),
            "top": [{"query": q["query"], "citations": q["citations"], "share": q["share"]} for q in qs[:15]],
            "by_kind": by_kind,
            "kinds_absent": [k for k in ("price", "judge", "tactics", "service") if k not in by_kind],
        }

    if "--json" in flags:
        print(json.dumps(out, ensure_ascii=False, indent=2)); return

    a = out["ai_daily"]
    print("=== Bing AI 引用 主計器 ===  (書き出し: %s, 期間 %s 〜 %s, %d 日)" % (a["file"], a["first"], a["last"], a["days"]))
    print("直近 7 日 %s〜%s: 引用 %d 回 (%.1f/日, 被引用ページ 平均 %.1f)" % (a["last7"]["from"], a["last7"]["to"], a["last7"]["citations"], a["last7"]["per_day"], a["last7"]["cited_pages_avg"]))
    print("その前 7 日 %s〜: 引用 %d 回" % (a["prev7"]["from"], a["prev7"]["citations"]))
    print("直近 28 日: 引用 %d 回 / 全期間 %d 回 / 最大日 %s %d 回" % (a["last28"]["citations"], a["total"], a["peak"]["date"], a["peak"]["citations"]))
    if "classic_last7" in out:
        c = out["classic_last7"]
        print("従来検索 同 7 日: クリック %d, 表示 %d  (AI 引用 / 表示 = %s)" % (c["clicks"], c["impressions"], out["ai_to_classic_impressions_ratio"]))
    if "queries" in out:
        q = out["queries"]
        print("\n=== grounding query ===  (%s)" % q["file"])
        print("query %d 本, 引用 %d 回, 引用加重シェア %.1f%%, シェア 30%% 以上 %d 本, 50%% 以上 %d 本" % (q["n_queries"], q["citations"], q["weighted_share_pct"], q["share_ge_30_pct"], q["share_ge_50_pct"]))
        for k in ("price", "judge", "tactics", "service", "other"):
            d = q["by_kind"].get(k)
            print("  %-8s %s" % (k, ("%d 本 / %d 回" % (d["queries"], d["citations"])) if d else "0 本  (不在)"))
        print("  上位:")
        for t in q["top"]:
            print("    %4d  %5.1f%%  %s" % (t["citations"], t["share"], t["query"]))
    else:
        print("\nAISearchQueriesReport*.csv 無し(query 側は省略)")

    if "--log" in flags:
        here = os.path.dirname(os.path.abspath(__file__))
        logp = os.path.join(here, "bing_ai_log.txt")
        line = "%s | export_to=%s | last7=%d (%.1f/d, pages %.1f) | prev7=%d | last28=%d | peak=%s:%d" % (
            out["generated_at"], a["last"], a["last7"]["citations"], a["last7"]["per_day"], a["last7"]["cited_pages_avg"], a["prev7"]["citations"], a["last28"]["citations"], a["peak"]["date"], a["peak"]["citations"])
        if "queries" in out:
            q = out["queries"]
            line += " | q=%d cites=%d wshare=%.1f%% ge30=%d absent=%s" % (q["n_queries"], q["citations"], q["weighted_share_pct"], q["share_ge_30_pct"], ",".join(q["kinds_absent"]) or "none")
        if "classic_last7" in out:
            line += " | classic7 imp=%d clicks=%d" % (out["classic_last7"]["impressions"], out["classic_last7"]["clicks"])
        with io.open(logp, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        print("\n追記:", logp)


if __name__ == "__main__":
    main()
