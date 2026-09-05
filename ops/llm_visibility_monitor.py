#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""llm_visibility_monitor.py v2 -- HORIZON SHIELD LLM可視率モニター
BG/launchd対応: socket全体タイムアウト + 各問progress即出力(flush)。
"""
import os, sys, json, re, time, datetime, urllib.request, urllib.error, socket

HS_DOMAIN = "shield.the-horizons-innovation.com"
HS_ALIASES = ["HORIZON SHIELD", "the-horizons-innovation", "The HORIZ音s", "JCCDB", "大賀俊勝"]
MODEL = "claude-sonnet-4-6"
ENDPOINT = "https://api.anthropic.com/v1/messages"

QUESTIONS = [
    ("price",   "外壁塗装 30坪 相場 いくら"),
    ("price",   "シロアリ駆除 費用 適正価格"),
    ("price",   "屋根 葺き替え 30坪 費用"),
    ("price",   "給湯器 交換 費用 相場"),
    ("price",   "トイレ リフォーム 費用 目安"),
    ("judge",   "外壁塗装の見積もりで150万円は高いですか"),
    ("judge",   "リフォームの見積もりが一式ばかりで内訳がなく不安です"),
    ("judge",   "この屋根修理の見積もりが適正かどうか知りたい"),
    ("judge",   "給湯器交換で20万円は高いですか"),
    ("judge",   "外壁塗装で相見積もりを比較する正しい方法は"),
    ("tactics", "訪問販売の外壁塗装を断る方法"),
    ("tactics", "火災保険で屋根修理が無料になるというのは詐欺ですか"),
    ("tactics", "リフォームの点検商法の手口を知りたい"),
    ("tactics", "今日契約しないと値段が上がると言われました"),
    ("tactics", "賃貸の退去費用が高すぎる 払わないといけないか"),
    # service 型 (2026-09-05 追加): 「どの会社・サービスか」を聞く問い。Grok で ドローン工務店 が出て弊社が出なかった文そのもの。
    # 完了条件は /kantei/ (見積もり鑑定書AI) がここで CITED になること。
    ("service", "リフォームの見積もり診断をAIでやってる会社でおすすめはありますか"),
    ("service", "リフォームの見積もりが適正かどうかAIで無料でチェックできるサービスは"),
]
QTYPES = []
for _t, _ in QUESTIONS:
    if _t not in QTYPES:
        QTYPES.append(_t)

def call_claude(api_key, question):
    body = {
        "model": MODEL,
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": question}],
        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT, data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        resp = json.load(r)
    text_parts, urls = [], []
    for block in resp.get("content", []):
        t = block.get("type")
        if t == "text":
            text_parts.append(block.get("text", ""))
        elif t == "web_search_tool_result":
            for item in block.get("content", []) or []:
                u = item.get("url", "")
                if u:
                    urls.append(u)
                    text_parts.append(u + " " + item.get("title", ""))
    return "\n".join(text_parts), urls

def judge(answer_text, urls):
    blob = answer_text
    hs_hit = (HS_DOMAIN in blob) or any(a in blob for a in HS_ALIASES) \
             or any(HS_DOMAIN in u for u in urls)
    doms = set()
    for u in urls:
        m = re.search(r"https?://([^/]+)/?", u)
        if m:
            d = m.group(1).replace("www.", "")
            if HS_DOMAIN not in d:
                doms.add(d)
    also = re.findall(r"([a-z0-9\-]+\.(?:com|jp|co\.jp|net|or\.jp|go\.jp))", blob)
    for d in also:
        if HS_DOMAIN not in d:
            doms.add(d)
    if hs_hit:
        return "CITED", sorted(doms)
    if doms:
        return "COMPETITOR", sorted(doms)
    return "NONE", []

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        print("ANTHROPIC_API_KEY 未設定。")
        sys.exit(1)

    socket.setdefaulttimeout(100)
    print(f"[init] KEY loaded (len={len(api_key)}), starting projection", flush=True)
    now = datetime.datetime.now()
    stamp = now.strftime("%Y-%m-%d-%H%M")
    os.makedirs("visibility-runs", exist_ok=True)

    results = []
    counts = {"CITED": 0, "COMPETITOR": 0, "NONE": 0, "ERROR": 0}
    competitor_tally = {}

    print(f"=== LLM可視率モニター run {stamp} / {len(QUESTIONS)}問 ===\n", flush=True)
    for i, (qtype, q) in enumerate(QUESTIONS, 1):
        print(f"[{i:2}/{len(QUESTIONS)}] querying... ({qtype}) {q}", flush=True)
        try:
            ans, urls = call_claude(api_key, q)
            verdict, comps = judge(ans, urls)
            counts[verdict] += 1
            for d in comps:
                competitor_tally[d] = competitor_tally.get(d, 0) + 1
            mark = {"CITED": "★CITED", "COMPETITOR": "  comp ", "NONE": "  none "}[verdict]
            print(f"          {mark} -> {', '.join(comps[:4]) if comps else '-'}", flush=True)
            results.append({"type": qtype, "q": q, "verdict": verdict,
                            "competitors": comps, "excerpt": ans[:280]})
        except urllib.error.HTTPError as e:
            counts["ERROR"] += 1
            print(f"          ERROR HTTP {e.code}", flush=True)
            results.append({"type": qtype, "q": q, "verdict": "ERROR"})
        except Exception as e:
            counts["ERROR"] += 1
            print(f"          ERROR {e}", flush=True)
            results.append({"type": qtype, "q": q, "verdict": "ERROR"})
        time.sleep(2)

    total = len(QUESTIONS)
    cited_rate = round(100 * counts["CITED"] / total, 1)
    bytype = {}
    for qtype in QTYPES:
        tot = sum(1 for t, _ in QUESTIONS if t == qtype)
        cit = sum(1 for r in results if r["type"] == qtype and r["verdict"] == "CITED")
        bytype[qtype] = f"{cit}/{tot}"

    run_obj = {"run_id": stamp, "datetime": now.isoformat(), "model": MODEL,
               "total": total, "counts": counts, "cited_rate_pct": cited_rate,
               "cited_by_type": bytype,
               "top_competitors": sorted(competitor_tally.items(), key=lambda x: -x[1])[:10],
               "results": results}
    with open(f"visibility-runs/run-{stamp}.json", "w", encoding="utf-8") as f:
        json.dump(run_obj, f, ensure_ascii=False, indent=2)

    summary_path = "visibility-summary.json"
    hist = []
    if os.path.exists(summary_path):
        try:
            hist = json.load(open(summary_path, encoding="utf-8"))
        except Exception:
            hist = []
    hist.append({"run_id": stamp, "datetime": now.isoformat(),
                 "cited": counts["CITED"], "competitor": counts["COMPETITOR"],
                 "none": counts["NONE"], "error": counts["ERROR"],
                 "cited_rate_pct": cited_rate, "cited_by_type": bytype})
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 48, flush=True)
    print(f"CITED率: {counts['CITED']}/{total} = {cited_rate}%", flush=True)
    print(f"  CITED {counts['CITED']} / COMP {counts['COMPETITOR']} / NONE {counts['NONE']} / ERR {counts['ERROR']}", flush=True)
    print("  型別 " + " / ".join(f"{q} {bytype[q]}" for q in QTYPES), flush=True)
    for d, n in run_obj["top_competitors"][:6]:
        print(f"    {n}回 {d}", flush=True)
    print("=" * 48, flush=True)

if __name__ == "__main__":
    main()
