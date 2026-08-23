# -*- coding: utf-8 -*-
"""
WEDJAT survey, report 1: 報告に載せる数字を、ひとつ残らずここで作る。

このファイルは、走行2が終わる前に書いて commit してある。理由は report 0 と同じで、
数字を見てから集計の仕方を選べる状態にしておかないためである。走行が終わったあとに
「この切り口が面白い」と思って足した数字は、その時点で選ばれた数字になる。

report 1 の HTML は、ここが吐いた JSON からしか数字を取らない。手で書き写さない。

使い方:
  python3 tools/survey1_report.py verify-directory/survey/data/survey1_walk_2026-08-23_run2.jsonl \
      --json verify-directory/survey/data/survey1_report_2026-08-23.json

集計の前に survey1_aggregate.py と同じ検査を通す。計器が壊れた形の記録は数えない。
"""

import argparse, collections, hashlib, json, os, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from survey1_aggregate import load, dedupe, tail_check, host_contradictions, TAIL_TRIP  # noqa: E402

# 我々自身の行。同じ母集団に入れ、同じ機械で同じ日に測る、と公開している。
OURS = ("horizonshield.dev", "the-horizons-innovation.com", "horizon-shield.ogasurfproject-jpg.deno.net")

# 走行が返す outcome を、公開済みの語彙に対応づける。ここも先に固定しておく。
MEASURED = ("speaks_mcp_and_lists_tools", "speaks_mcp_no_tool_list")
PENDING = ("no_mcp_at_declared_address", "initialize_rejected", "no_result_in_initialize")
HELD = ("not_reached", "authorization_required", "gateway_error", "method_not_allowed", "instrument_down")
SKIPPED = ("robots_disallowed",)


def registrable(host):
    """おおまかな組織の単位。公開接尾辞の一覧は持たないので、二段階の接尾辞だけ手当てする。"""
    parts = (host or "").split(".")
    if len(parts) < 3:
        return host or ""
    two = ".".join(parts[-2:])
    if two in ("co.uk", "co.jp", "com.au", "com.br", "co.in", "com.cn", "co.kr", "com.mx", "co.za"):
        return ".".join(parts[-3:])
    return two


def is_ours(host):
    h = host or ""
    return any(h == d or h.endswith("." + d) for d in OURS)


def pct(n, d):
    return round(100.0 * n / d, 2) if d else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl")
    ap.add_argument("--json", dest="out_json")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    rows = load(a.jsonl)

    # --- 数える前に、数えてよいか -----------------------------------------
    problems = []
    tail = tail_check(rows)
    if tail >= TAIL_TRIP:
        problems.append("末尾 %d 行が連続して到達不能。計器が落ちた形。" % tail)
    downs = sum(1 for r in rows if r.get("outcome") == "instrument_down")
    if downs:
        problems.append("instrument_down が %d 行。" % downs)
    for h, nok, n in host_contradictions(rows):
        problems.append("%s は %d 回応答したのに、そのあと %d 件が全て到達不能。" % (h, nok, n))
    if problems and not a.force:
        print("検査: 赤。report 1 は作らない。", file=sys.stderr)
        for p in problems:
            print("  - " + p, file=sys.stderr)
        sys.exit(3)

    last = dedupe(rows)
    eps = list(last.values())
    N = len(eps)
    host_of = {ep: (urllib.parse.urlparse(ep).hostname or "") for ep in last}

    def bucket(r):
        o = r.get("outcome")
        if o in MEASURED: return "measured"
        if o in PENDING: return "pending"
        if o in SKIPPED: return "skipped"
        return "held"

    st = collections.Counter(bucket(r) for r in eps)
    oc = collections.Counter(r.get("outcome") for r in eps)

    spoke = [r for r in eps if r.get("outcome") in MEASURED]
    listed = [r for r in spoke if r.get("tools_listed")]

    # --- 母集団の集中度。ここが report 1 の本題になる可能性が高い ----------
    per_host = collections.Counter(host_of[r["endpoint"]] for r in eps)
    per_org = collections.Counter(registrable(host_of[r["endpoint"]]) for r in eps)
    top_hosts = per_host.most_common(15)
    top10_share = pct(sum(v for _, v in per_host.most_common(10)), N)

    spoke_hosts = collections.Counter(host_of[r["endpoint"]] for r in spoke)
    spoke_orgs = collections.Counter(registrable(host_of[r["endpoint"]]) for r in spoke)

    # --- 我々自身の行 ------------------------------------------------------
    ours = [r for r in eps if is_ours(host_of[r["endpoint"]])]

    # --- 応答したものについて、何が読めたか -------------------------------
    tools = sorted((r.get("tool_count") or 0) for r in listed)
    def q(p):
        return tools[min(len(tools) - 1, int(len(tools) * p))] if tools else 0

    report = {
        "report": "survey report 1, count 3",
        "source_file": os.path.basename(a.jsonl),
        "rows_read": len(rows),
        "endpoints": N,
        "checks_passed": not problems,
        "problems": problems,

        "count3": {
            "declared_addresses": N,
            "measured": st["measured"], "measured_pct": pct(st["measured"], N),
            "pending": st["pending"], "pending_pct": pct(st["pending"], N),
            "held": st["held"], "held_pct": pct(st["held"], N),
            "skipped": st["skipped"], "skipped_pct": pct(st["skipped"], N),
        },
        "outcome": {k: v for k, v in oc.most_common()},
        "outcome_pct": {k: pct(v, N) for k, v in oc.most_common()},

        "spoke_mcp": {
            "n": len(spoke),
            "listed_tools": len(listed),
            "initialize_only": len(spoke) - len(listed),
            # agent card は3値。取れなかったことを「無い」と数えない。
            "agent_card_present": sum(1 for r in spoke if r.get("agent_card") is True),
            "agent_card_absent": sum(1 for r in spoke if r.get("agent_card") is False),
            "agent_card_not_read": sum(1 for r in spoke if r.get("agent_card") is None),
            # 開示は、カードを読めた相手についてしか測っていない。母数はそれ。
            "cards_read": sum(1 for r in spoke if r.get("agent_card") is True),
            "compensation_disclosed": sum(1 for r in spoke if r.get("compensation_disclosed") is True),
            "session_required": sum(1 for r in spoke if r.get("session_required")),
            "redirected": sum(1 for r in spoke if r.get("redirected_to")),
            "retried_before_success": sum(1 for r in spoke if r.get("retried")),
            "tools_total": sum(tools),
            "tools_median": q(0.5), "tools_p90": q(0.9), "tools_max": max(tools) if tools else 0,
            "tools_zero": sum(1 for t in tools if t == 0),
        },

        "concentration": {
            "distinct_hosts": len(per_host),
            "distinct_orgs": len(per_org),
            "endpoints_per_host_median": sorted(per_host.values())[len(per_host) // 2] if per_host else 0,
            "top10_host_share_pct": top10_share,
            "top_hosts": [{"host": h, "declared": n,
                           "spoke_mcp": spoke_hosts.get(h, 0)} for h, n in top_hosts],
            "hosts_with_one_endpoint": sum(1 for v in per_host.values() if v == 1),
            "distinct_hosts_that_spoke": len(spoke_hosts),
            "distinct_orgs_that_spoke": len(spoke_orgs),
        },

        "ours": {
            "n": len(ours),
            "rows": [{"endpoint": r["endpoint"], "outcome": r.get("outcome"),
                      "tool_count": r.get("tool_count"),
                      "agent_card": r.get("agent_card"),
                      "compensation_disclosed": r.get("compensation_disclosed")} for r in ours],
        },

        "not_reached_reasons": [{"reason": k, "n": v} for k, v in collections.Counter(
            r.get("reason") for r in eps if r.get("outcome") == "not_reached").most_common(15)],

        "agent_card_notes": [{"note": k, "n": v} for k, v in collections.Counter(
            r.get("agent_card_note") for r in spoke).most_common(15)],

        # どの名前で開示が置かれていたか。空なら「置き場所が決まっていない」の観測であって、
        # 相手が黙っているという観測ではない。report ではそう書くこと。
        "compensation_field_names": [{"field": k, "n": v} for k, v in collections.Counter(
            f for r in spoke for f in (r.get("compensation_fields") or [])).most_common(20)],
    }

    body = json.dumps({k: report[k] for k in report if k != "record_sha256"},
                      separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    report["record_sha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()

    # --- 人が読む形 --------------------------------------------------------
    c = report["count3"]
    print("count 3: 宣言された住所 %d 件のうち" % N)
    print("  measured (MCPを話した)     %6d  %5.1f%%" % (c["measured"], c["measured_pct"]))
    print("  pending  (測った上で不成立) %6d  %5.1f%%" % (c["pending"], c["pending_pct"]))
    print("  held     (測れなかった)     %6d  %5.1f%%" % (c["held"], c["held_pct"]))
    print("  skipped  (robots)          %6d  %5.1f%%" % (c["skipped"], c["skipped_pct"]))
    print("\noutcome:")
    for k, v in oc.most_common():
        print("  %-28s %6d  %5.1f%%" % (k, v, pct(v, N)))
    s = report["spoke_mcp"]
    print("\nMCPを話した %d 件:" % s["n"])
    for k in ("listed_tools", "initialize_only",
              "agent_card_present", "agent_card_absent", "agent_card_not_read",
              "compensation_disclosed",
              "session_required", "redirected", "retried_before_success",
              "tools_total", "tools_median", "tools_p90", "tools_max", "tools_zero"):
        print("  %-24s %d" % (k, s[k]))
    if report["compensation_field_names"]:
        print("  開示が置かれていた名前:")
        for f in report["compensation_field_names"]:
            print("    %-28s %d" % (f["field"], f["n"]))
    else:
        print("  開示が置かれていた名前: なし "
              "(標準の置き場所が無いことの観測であって、相手が黙っているという観測ではない)")
    cc = report["concentration"]
    print("\n集中度:")
    for k in ("distinct_hosts", "distinct_orgs", "endpoints_per_host_median",
              "top10_host_share_pct", "hosts_with_one_endpoint",
              "distinct_hosts_that_spoke", "distinct_orgs_that_spoke"):
        print("  %-28s %s" % (k, cc[k]))
    print("  上位ホスト:")
    for h in cc["top_hosts"]:
        print("    %-44s 宣言 %5d / 話した %5d" % (h["host"][:44], h["declared"], h["spoke_mcp"]))
    print("\n我々自身の行 %d 件:" % report["ours"]["n"])
    for r in report["ours"]["rows"]:
        print("    %-56s %s" % (r["endpoint"][:56], r["outcome"]))
    print("\nrecord_sha256: " + report["record_sha256"])

    if a.out_json:
        with open(a.out_json, "w", encoding="utf-8") as f:
            f.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print("書いた: " + a.out_json)


if __name__ == "__main__":
    main()
