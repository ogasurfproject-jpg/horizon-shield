# -*- coding: utf-8 -*-
"""二つの回を比べる。観測所は、1回では観測所にならない。

なぜ要るか (2026-08-24):
  8月に1回数えた。それは写真であって、観測ではない。
  「金の出所を名乗ったのは2.6%」という数字の価値は、
  来年それが何%になったかを言えるところにある。
  そして来年それを言えるのは、今年数えた人だけである。

  だから、回と回の差を出す道具を先に作る。
  作っておかないと、2回目を回した日に「で、何が変わったの?」を
  手で数えることになり、手で数えたものは間違える。

何を比べるか:
  count  レジストリの数え(survey0)。母集団がどう動いたか
  walk   走行(survey1)。1本1本がどう動いたか

比べるときの規律:
  ・「消えた」と「届かなかった」を混ぜない。
    前回 measured で今回 held は、あちらが消えたのではなく、こちらが測れなかった。
  ・新しく名乗り始めた口と、名乗るのをやめた口を、必ず両方向で出す。
    増えた方だけ出すのは、数え方ではなく宣伝である。
  ・母集団から消えた口を「落ちた」と言わない。登録を取り下げただけかもしれない。

  python3 tools/survey/survey_diff.py --count  古い.json  新しい.json
  python3 tools/survey/survey_diff.py --walk   古い.jsonl 新しい.jsonl
  python3 tools/survey/survey_diff.py --walk a.jsonl b.jsonl --json out.json
"""
import argparse
import io
import json
import os
import sys

# 母集団の数え。動きを見たい欄だけを並べる(全部並べると差が読めない)
COUNT_FIELDS = [
    ("registrations_latest_all_statuses", "登録(最新版・全状態)"),
    ("active", "生きている登録"),
    ("active_with_https_remote", "うち外から叩ける名前"),
    ("https_endpoints_active", "https の口の本数"),
    ("unique_hosts_active", "ホスト数"),
    ("hosts_with_more_than_one_endpoint", "2本以上が相乗りしているホスト"),
    ("active_published_last_30_days", "直近30日に公開された active"),
    ("active_published_last_90_days", "直近90日に公開された active"),
]


def load_jsonl(path):
    out = {}
    with io.open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            key = r.get("endpoint") or r.get("url")
            if key:
                out[key] = r
    return out


def diff_count(a_path, b_path):
    a = json.load(io.open(a_path, encoding="utf-8"))
    b = json.load(io.open(b_path, encoding="utf-8"))
    rows = []
    for key, label in COUNT_FIELDS:
        av, bv = a.get(key), b.get(key)
        if av is None and bv is None:
            continue
        d = None
        if isinstance(av, int) and isinstance(bv, int):
            d = bv - av
        rows.append({"field": key, "label": label, "before": av, "after": bv, "delta": d})

    st_a = a.get("by_status") or {}
    st_b = b.get("by_status") or {}
    statuses = []
    for k in sorted(set(st_a) | set(st_b)):
        statuses.append({"status": k, "before": st_a.get(k, 0), "after": st_b.get(k, 0),
                         "delta": st_b.get(k, 0) - st_a.get(k, 0)})

    return {
        "kind": "count",
        "before": {"file": os.path.basename(a_path), "measured_at": a.get("measured_at")},
        "after": {"file": os.path.basename(b_path), "measured_at": b.get("measured_at")},
        "fields": rows,
        "by_status": statuses,
        "caution": [
            "母集団から消えた登録を「落ちた」と言わない。登録を取り下げただけかもしれない。",
            "ここでは1本も叩いていない。生きているかは、この数え方では分からない。",
        ],
    }


def diff_walk(a_path, b_path):
    a = load_jsonl(a_path)
    b = load_jsonl(b_path)

    only_a = sorted(set(a) - set(b))
    only_b = sorted(set(b) - set(a))
    both = sorted(set(a) & set(b))

    def disc(r):
        return 1 if r.get("compensation_disclosed") else 0

    started, stopped, state_moves = [], [], {}
    tool_moves = []
    for k in both:
        ra, rb = a[k], b[k]
        if disc(ra) == 0 and disc(rb) == 1:
            started.append({"endpoint": k, "fields": rb.get("compensation_fields") or []})
        elif disc(ra) == 1 and disc(rb) == 0:
            stopped.append({"endpoint": k,
                            "before_fields": ra.get("compensation_fields") or [],
                            "note": "前回は記載があり、今回は無かった。"
                                    "書類が変わったのか、今回そこまで読めなかったのかは、この差だけでは分からない。"})
        sa, sb = ra.get("state"), rb.get("state")
        if sa != sb:
            state_moves[sa + " -> " + sb] = state_moves.get(sa + " -> " + sb, 0) + 1
        ta, tb = ra.get("tool_count"), rb.get("tool_count")
        if isinstance(ta, int) and isinstance(tb, int) and ta != tb:
            tool_moves.append({"endpoint": k, "before": ta, "after": tb, "delta": tb - ta})

    # 「消えた」と「測れなかった」を混ぜない
    lost_measured_to_held = sum(1 for k in both
                                if a[k].get("state") == "measured" and b[k].get("state") == "held")

    tool_moves.sort(key=lambda x: -abs(x["delta"]))
    return {
        "kind": "walk",
        "before": {"file": os.path.basename(a_path), "rows": len(a)},
        "after": {"file": os.path.basename(b_path), "rows": len(b)},
        "population": {
            "in_both": len(both),
            "only_in_before": len(only_a),
            "only_in_after": len(only_b),
        },
        "disclosure": {
            "started_disclosing": started,
            "stopped_disclosing": stopped,
            "net": len(started) - len(stopped),
            "before_total": sum(disc(a[k]) for k in a),
            "after_total": sum(disc(b[k]) for k in b),
        },
        "state_moves": dict(sorted(state_moves.items(), key=lambda x: -x[1])),
        "measured_then_unmeasurable": {
            "count": lost_measured_to_held,
            "what_this_is": "前回は測れて今回は測れなかった数。"
                            "これはあちらの状態ではなく、こちらの計器の話である。"
                            "多ければ、この回の走行そのものを疑う。",
        },
        "tool_count_moves_top20": tool_moves[:20],
        "caution": [
            "前回に無く今回にある住所は「新しく建った」ではない。レジストリに載った、である。",
            "前回にあり今回に無い住所は「落ちた」ではない。登録の一覧から消えた、である。",
            "名乗るのをやめたように見える口は、書類が変わったのか読めなかったのかを、"
            "1件ずつ確かめてからでないと言えない。",
        ],
    }


def show(d):
    print("== %s の差" % ("母集団の数え" if d["kind"] == "count" else "走行"))
    print("   前: %s" % json.dumps(d["before"], ensure_ascii=False))
    print("   後: %s" % json.dumps(d["after"], ensure_ascii=False))
    print()
    if d["kind"] == "count":
        for r in d["fields"]:
            sign = "" if r["delta"] is None else ("%+d" % r["delta"])
            print("   %-30s %8s -> %-8s %s" % (r["label"], r["before"], r["after"], sign))
        print()
        for s in d["by_status"]:
            print("   status %-14s %6d -> %-6d %+d" % (s["status"], s["before"], s["after"], s["delta"]))
    else:
        p = d["population"]
        print("   両方にある %d / 前だけ %d / 後だけ %d"
              % (p["in_both"], p["only_in_before"], p["only_in_after"]))
        dis = d["disclosure"]
        print()
        print("   金の出所を名乗った数  %d -> %d (%+d)"
              % (dis["before_total"], dis["after_total"], dis["after_total"] - dis["before_total"]))
        print("     新しく名乗り始めた  %d" % len(dis["started_disclosing"]))
        for x in dis["started_disclosing"][:10]:
            print("       %s  %s" % (x["endpoint"][:60], "、".join(x["fields"])))
        print("     名乗らなくなった    %d" % len(dis["stopped_disclosing"]))
        for x in dis["stopped_disclosing"][:10]:
            print("       %s" % x["endpoint"][:60])
        print()
        print("   判定が動いた組み合わせ:")
        for k, v in list(d["state_moves"].items())[:10]:
            print("     %-34s %d" % (k, v))
        m = d["measured_then_unmeasurable"]
        print()
        print("   前回は測れて今回は測れなかった: %d" % m["count"])
        print("     %s" % m["what_this_is"])
    print()
    for c in d["caution"]:
        print("   ※ %s" % c)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", action="store_true", help="母集団の数え(json)を比べる")
    ap.add_argument("--walk", action="store_true", help="走行(jsonl)を比べる")
    ap.add_argument("--json", help="結果をこのファイルにも書く")
    ap.add_argument("before")
    ap.add_argument("after")
    a = ap.parse_args()

    if a.count == a.walk:
        sys.stderr.write("--count か --walk のどちらか一つを指定してください。\n")
        return 2
    for p in (a.before, a.after):
        if not os.path.exists(p):
            sys.stderr.write("ファイルがありません: %s\n" % p)
            return 3

    d = diff_count(a.before, a.after) if a.count else diff_walk(a.before, a.after)
    show(d)
    if a.json:
        io.open(a.json, "w", encoding="utf-8").write(
            json.dumps(d, ensure_ascii=False, indent=2))
        print("\n書きました: %s" % a.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
