# -*- coding: utf-8 -*-
"""
WEDJAT survey, report 1: 集計。

survey1_walk.py が書いた JSONL を読み、endpoint ごとに最後の行を採って数える。
--resume が到達できなかった行を測り直すため、同じ endpoint の行が複数あり得る。

この道具の主な仕事は、数えることではなく、数えてよいかを先に確かめることである。
2026-08-23 の最初の全件走行では、開始18分後に自機の名前解決が落ち、そのあとの
11,307 件が一件残らず「到達できなかった」として記録された。そのまま集計すれば、
「12,429件中 11,794件は落ちている」という、事実に反する数字を publish していた。
よって、集計の前に次を検査して、危なければ拒む:

  1. 末尾に、成功が一度も混じらない到達不能の連続があるか(計器が落ちた形)
  2. 走行の途中で state が回復しない断絶があるか
  3. instrument_down の行があるか(走行が自分で気づいて止めた形)

使い方:
  python3 survey1_aggregate.py results.jsonl
  python3 survey1_aggregate.py results.jsonl --json out.json
  python3 survey1_aggregate.py results.jsonl --force   # 検査が赤でも数える
"""

import argparse, collections, json, sys, urllib.parse

TAIL_TRIP = 200     # これだけ連続で「到達できない」が続き成功が一度もなければ、計器を疑う


def load(path):
    rows = []
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            print("  ! %s:%d 読めない行を飛ばした" % (path, n), file=sys.stderr)
    return rows


def dedupe(rows):
    """endpoint ごとに最後の行。順序は元のファイルの順序に従う。"""
    last = {}
    for r in rows:
        ep = r.get("endpoint")
        if ep:
            last[ep] = r
    return last


def tail_check(rows):
    """末尾から遡って、到達できた行が一度も出てこない連続の長さを数える。"""
    n = 0
    for r in reversed(rows):
        if r.get("outcome") in ("not_reached", "instrument_down"):
            n += 1
        else:
            break
    return n


def host_contradictions(rows):
    """応答した実績があるホストが、そのあと全て到達不能になっていないか。

    api.m2mcent.com は 113 回 HTTP で答えたあと、残る 148 件が全て到達不能だった。
    113回答えたサーバーは消えない。これは相手ではなく、こちらが落ちた印である。
    """
    last_ok = {}
    n_ok = collections.Counter()
    out = []
    per_host = collections.defaultdict(list)
    for i, r in enumerate(rows):
        h = urllib.parse.urlparse(r.get("endpoint", "")).hostname or ""
        per_host[h].append((i, r))
        if r.get("outcome") not in ("not_reached", "instrument_down"):
            last_ok[h] = i          # 最後に応答した位置。最初ではない。
            n_ok[h] += 1
    for h, at in last_ok.items():
        after = [r for i, r in per_host[h] if i > at]
        if len(after) >= 20 and all(r.get("outcome") in ("not_reached", "instrument_down") for r in after):
            out.append((h, n_ok[h], len(after)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl")
    ap.add_argument("--json", dest="out_json")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    rows = load(a.jsonl)
    print("読んだ行: %d" % len(rows))

    # --- 集計してよいかの検査 ---------------------------------------------
    problems = []
    tail = tail_check(rows)
    if tail >= TAIL_TRIP:
        problems.append("末尾 %d 行が連続して到達不能で、その間に成功が一度もない。"
                        "計器が落ちた形である。" % tail)
    downs = sum(1 for r in rows if r.get("outcome") == "instrument_down")
    if downs:
        problems.append("instrument_down が %d 行ある。走行が自分で計器の故障に気づいて止めている。" % downs)
    for h, nok, n in host_contradictions(rows):
        problems.append("%s は %d 回 応答した実績があるのに、そのあと %d 件が全て到達不能。"
                        "応答したホストは消えない。" % (h, nok, n))

    if problems:
        print("\n検査: 赤")
        for p in problems:
            print("  - " + p)
        print("\n  これらの行は、相手についての観測ではない。"
              "\n  規則2により、この状態のまま数字を publish してはならない。"
              "\n  --resume で測り直すこと(到達できなかった行は既定で測り直される)。")
        if not a.force:
            sys.exit(3)
        print("\n  --force が指定されたので、そのまま数える。この数字は公開に使えない。")
    else:
        print("検査: 緑 (末尾の到達不能連続 %d 行, instrument_down %d 行, 矛盾ホスト 0)" % (tail, downs))

    # --- 集計 --------------------------------------------------------------
    last = dedupe(rows)
    print("\n重複を除いた endpoint: %d" % len(last))
    st = collections.Counter(r.get("state") for r in last.values())
    oc = collections.Counter(r.get("outcome") for r in last.values())
    print("\nstate:")
    for k, v in st.most_common():
        print("  %-10s %6d  (%.1f%%)" % (k, v, 100.0 * v / len(last)))
    print("\noutcome:")
    for k, v in oc.most_common():
        print("  %-28s %6d  (%.1f%%)" % (k, v, 100.0 * v / len(last)))

    measured = [r for r in last.values() if r.get("state") == "measured"]
    if measured:
        tools = [r.get("tool_count") or 0 for r in measured]
        tools_sorted = sorted(tools)
        print("\n応答して MCP を話した %d 件:" % len(measured))
        print("  tools/list に答えた      : %d" % sum(1 for r in measured if r.get("tools_listed")))
        print("  agent card があった      : %d" % sum(1 for r in measured if r.get("agent_card")))
        print("  報酬の開示が読み取れた   : %d" % sum(1 for r in measured if r.get("compensation_disclosed")))
        print("  session id を要求した    : %d" % sum(1 for r in measured if r.get("session_required")))
        print("  ツール数 中央値          : %d" % (tools_sorted[len(tools_sorted) // 2] if tools_sorted else 0))
        print("  ツール数 合計            : %d" % sum(tools))

    # 到達不能の理由。ここが "URLError" だけで埋まっていたら、次は診断できない。
    nr = [r for r in last.values() if r.get("outcome") == "not_reached"]
    if nr:
        print("\n到達できなかった %d 件の理由:" % len(nr))
        for k, v in collections.Counter(r.get("reason") for r in nr).most_common(12):
            print("  %-72s %d" % (str(k)[:72], v))

    if a.out_json:
        payload = {
            "source": a.jsonl, "rows_read": len(rows), "endpoints": len(last),
            "checks_passed": not problems, "problems": problems,
            "state": dict(st), "outcome": dict(oc),
        }
        with open(a.out_json, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n")
        print("\n書いた: %s" % a.out_json)


if __name__ == "__main__":
    main()
