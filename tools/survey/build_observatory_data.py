# -*- coding: utf-8 -*-
"""照会口(hs-mcp-observatory)が読むデータを、走行の生ファイルから作る。

なぜ生成にするか:
  同じ事実を二箇所に書けば、いつか片方だけ直る。
  worker の中に数字を手で書けば、走行を回し直しても worker は古いままになる。
  落ちない。例外も出ない。ただ古い数字が出続ける。

なぜ record_sha256 を1行ずつ入れるか:
  報告書に自分で書いた4つの規則のうちの1つが
  「Ship the recipe and the hash with every claim」である。
  他人についての言明を、その本人が再計算できない形で出さない。
  容量のために外すのは、まさにその規律を静かに折ることになる。
  入れると 2.1MB(gzip 689KB)。Workers の上限には収まる。

なぜ「失敗した口の一覧」を作らないか:
  報告書に「Naming a server that failed is a serious thing to do」と書いた。
  住所を持っている人が自分の住所を問い合わせるのと、
  こちらが落ちた口の名簿を配るのは、別のことである。
  この道具は前者だけを作る。一覧を返す口は作らない。

  python3 tools/survey/build_observatory_data.py --check
  python3 tools/survey/build_observatory_data.py --write
"""
import argparse
import io
import json
import os
import subprocess
import sys
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
D = os.path.join(ROOT, "verify-directory", "survey", "data")

WALK = os.path.join(D, "survey1_walk_2026-08-23_run2.jsonl")
REPORT = os.path.join(D, "survey1_report_2026-08-23.json")
RECHECK = os.path.join(D, "survey2_recheck_2026-08-24.jsonl")
LADDER = os.path.join(D, "survey3_ladder_2026-08-24.jsonl")
COUNT0 = os.path.join(D, "survey0_v4_2026-08-19.json")
LIMITS = os.path.join(D, "known_limitations.json")

OUT = os.path.join(ROOT, "workers", "hs-mcp-observatory", "src", "data.js")

BASE = "https://shield.the-horizons-innovation.com/verify-directory/survey"


def jsonl(path):
    with io.open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def build():
    rows = list(jsonl(WALK))
    report = json.load(io.open(REPORT, encoding="utf-8"))
    count0 = json.load(io.open(COUNT0, encoding="utf-8"))
    limits = json.load(io.open(LIMITS, encoding="utf-8"))

    # 当て直しと版のはしごを、住所で引けるようにする
    recheck = {r["url"]: r for r in jsonl(RECHECK)}
    ladder = {r["url"]: r for r in jsonl(LADDER)}

    # 2026-08-24: 宣言された住所のうち 192件は、住所ではなく雛形だった。
    #   https://.../{token}/mcp、https://{HAPI_FQDN}:{HAPI_PORT}/mcp のような形。
    #   当てても、測っているのはサーバーではなく雛形である。
    #   これらの行が pending や held に混ざっている。数として黙って足さない。
    #   照会口では「これは住所ではない」と言う。
    import re as _re
    def templated(u):
        return bool(_re.search(r"[{}]|<[a-zA-Z_]+>|\bYOUR_", u))

    out_rows = []
    recovered = 0
    templated_n = 0
    for r in rows:
        ep = r["endpoint"]
        ac = r.get("agent_card")
        rc = recheck.get(ep)
        ld = ladder.get(ep)

        # 当て直しで、こちらの落ち度だと分かったものに印を付ける。
        #   走行2はこちらが 2024-11-05 を名乗っていた。仕様どおりに断ってきた口を
        #   「MCPを話さない」と数えていた。それはあちらの状態ではなく、こちらの故障である。
        fixed = None
        if rc and rc.get("verdict") == "modern_answered":
            fixed = ["2026-07-28", "server/discover"]
        elif ld and ld.get("verdict") not in (None, "still_not_mcp"):
            ok = [t for t in (ld.get("tried") or []) if t.get("ok")]
            if ok:
                fixed = [ok[0].get("version"), "initialize"]
        if fixed:
            recovered += 1

        tpl = templated(ep)
        if tpl:
            templated_n += 1
        out_rows.append([
            ep,
            r.get("state"),                     # measured / pending / held / skipped
            r.get("outcome"),
            r.get("tool_count"),
            (1 if ac else (0 if ac is not None else None)),   # None = 読んでいない
            (1 if r.get("compensation_disclosed") else 0),
            r.get("compensation_fields") or None,
            r.get("server_name") or None,
            r.get("record_sha256"),
            fixed,                               # 当て直しで回復した版と方法
            (rc or {}).get("record_sha256"),     # 当て直しの記録の hash
            1 if tpl else 0,                     # 住所ではなく雛形だった
        ])

    # 実測で見つかった「金の出所」の欄名。名乗り方の手引きは、ここから作る。
    fields = {}
    for r in rows:
        for f in (r.get("compensation_fields") or []):
            fields[f] = fields.get(f, 0) + 1

    hosts = {}
    for r in out_rows:
        h = urlsplit(r[0]).netloc.lower()
        hosts.setdefault(h, 0)
        hosts[h] += 1

    c3 = report["count3"]
    sm = report["spoke_mcp"]
    meta = {
        "report": "report 1",
        "population_measured_at": count0["measured_at"],
        "walk_measured_at": "2026-08-23",
        "corrected_at": "2026-08-24",
        "registry": count0["source"],
        "registrations_all_statuses": count0["registrations_latest_all_statuses"],
        "active": count0["active"],
        "https_endpoints_active": count0["https_endpoints_active"],
        "record_sha256": report["record_sha256"],
        "pages": {
            "report": BASE + "/1/",
            "report_json": BASE + "/data/survey1_report_2026-08-23.json",
            "raw_walk": BASE + "/data/survey1_walk_2026-08-23_run2.jsonl",
            "recheck": BASE + "/data/survey2_recheck_2026-08-24.jsonl",
            "version_ladder": BASE + "/data/survey3_ladder_2026-08-24.jsonl",
            "method": "https://shield.the-horizons-innovation.com/verify-directory/method/",
            "recompute": "https://shield.the-horizons-innovation.com/verify-directory/recompute/",
        },
        "rules": [
            "Never write \"it went down\". held means we could not measure it; "
            "pending means we measured it and a condition was not met. "
            "These are different sentences and they never get collapsed into one.",
            "State the measurement, not a character judgement. "
            "Not \"this server is dishonest\" but \"on this date the agent card carried no compensation disclosure\".",
            "Ship the recipe and the hash with every claim. "
            "Every verdict carries a record_sha256 and a public procedure to recompute it.",
            "A claim about somebody else that cannot be reproduced by the person it is about should not be published.",
        ],
        "we_do_not": [
            "We do not publish a list of servers that failed. "
            "Looking up an address you hold is a different act from handing out a roster of failures.",
            "We do not say servers hide who pays them. Most have no field to hide it in. "
            "4,762 of the servers that answered carried no agent card at all.",
            "We do not call this a scan of the MCP ecosystem. "
            "It is one registry's declared addresses, contacted once, read only.",
        ],
    }

    summary = {
        "as_published_2026_08_23": {
            "addresses_contacted": c3["declared_addresses"],
            "measured": c3["measured"],
            "measured_pct": c3["measured_pct"],
            "pending": c3["pending"],
            "held": c3["held"],
            "skipped": c3["skipped"],
        },
        "corrected_2026_08_24": {
            "measured": 5880,
            "measured_pct": 47.3,
            "pending": 823,
            "our_fault": 95,
            "our_fault_pct_of_pending_bucket": 10.3,
            "what_was_wrong": (
                "The walk announced protocol version 2024-11-05, which most of the registry has dropped. "
                "137 of the 206 initialize refusals were HTTP 400 - the response the spec prescribes for "
                "a version a server does not support. We counted correct behaviour as failure."
            ),
        },
        "run1_discarded": report["run1_discarded"],
        "tools_total": sm["tools_total"],
        "tools_median": sm["tools_median"],
        "tools_p90": sm["tools_p90"],
        "tools_max": sm["tools_max"],
        "agent_card_present": sm["agent_card_present"],
        "agent_card_absent": sm["agent_card_absent"],
        "agent_card_not_read": sm["agent_card_not_read"],
        "compensation_disclosed": sm["compensation_disclosed"],
        "compensation_not_disclosed": sm["compensation_not_disclosed"],
        "disclosure_is_a_floor": (
            "152 is a floor. The 95 rows recovered on 2026-08-24 were re-contacted for protocol "
            "version only; their agent cards were not re-read."
        ),
        "outcome": report["outcome"],
        "distinct_hosts": report["concentration"]["distinct_hosts"],
        "distinct_orgs": report["concentration"]["distinct_orgs"],
        "top10_host_share_pct": report["concentration"]["top10_host_share_pct"],
        "known_limitations": limits,
    }

    summary["templated_endpoints"] = {
        "count": templated_n,
        "what": "Declared endpoints that contain a template placeholder - {token}, {tenant}, "
                "{HAPI_FQDN} and the like. These are not addresses. Contacting one measures nothing "
                "about any server.",
        "where_they_land": "They are spread across pending, held and skipped. We did not remove them "
                           "from the published counts after the fact, and we do not add them to any "
                           "count of our own. The lookup tool says plainly when an address is a template.",
        "found_on": "2026-08-24, while building this lookup",
    }
    return meta, summary, out_rows, fields, len(hosts), recovered, templated_n


def render(meta, summary, rows, fields, host_count, recovered, templated_n):
    head = (
        "/* このファイルは生成物である。手で書き換えないこと。\n"
        "   元       : verify-directory/survey/data/ の走行・当て直し・版のはしご\n"
        "   作り直す : python3 tools/survey/build_observatory_data.py --write\n"
        "   検査     : python3 tools/survey/build_observatory_data.py --check\n"
        "\n"
        "   ここに数字を手で足さないこと。足しても生ファイルには戻らないので、\n"
        "   公開している報告書と照会口が別のことを言い始める。\n"
        "   そのずれは落ちない。例外も出ない。ただ違う数字が出続ける。\n"
        "\n"
        "   ROWS の並び:\n"
        "     0 endpoint          宣言されていた住所\n"
        "     1 state             measured / pending / held / skipped\n"
        "     2 outcome           そのときの判定\n"
        "     3 tool_count        並べた道具の数(measured のときだけ)\n"
        "     4 agent_card        1=あった 0=無かった null=読んでいない\n"
        "     5 compensation      1=金の出所を名乗っていた 0=名乗っていなかった\n"
        "     6 compensation_fields  名乗っていた欄の名前\n"
        "     7 server_name       名乗っていたサーバー名\n"
        "     8 record_sha256     この1行の hash(再計算できる)\n"
        "     9 recovered         当て直しで回復した [版, 方法]。こちらの落ち度だったもの\n"
        "    10 recheck_sha256    当て直しの記録の hash\n"
        "    11 templated         1=住所ではなく雛形だった({token} などを含む) */\n"
    )
    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    return (head
            + "export const META = " + json.dumps(meta, ensure_ascii=False, indent=2) + ";\n\n"
            + "export const SUMMARY = " + json.dumps(summary, ensure_ascii=False, indent=2) + ";\n\n"
            + "/* 実測で見つかった『金の出所』の欄名と、その件数。\n"
            + "   名乗り方の手引きは、こちらが決めた形ではなく、実際に使われている形から出す。 */\n"
            + "export const DISCLOSURE_FIELDS = " + json.dumps(fields, ensure_ascii=False, indent=2) + ";\n\n"
            + "export const HOST_COUNT = " + str(host_count) + ";\n"
            + "export const RECOVERED_COUNT = " + str(recovered) + ";\n"
            + "export const TEMPLATED_COUNT = " + str(templated_n) + ";\n\n"
            + "export const ROWS = [\n"
            + ",\n".join(j(r) for r in rows) + "\n];\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    for p in (WALK, REPORT, RECHECK, LADDER, COUNT0, LIMITS):
        if not os.path.exists(p):
            sys.stderr.write("元のファイルがありません: %s\n" % p)
            return 3

    meta, summary, rows, fields, host_count, recovered, templated_n = build()
    want = render(meta, summary, rows, fields, host_count, recovered, templated_n)

    print("走行     : %d 行" % len(rows))
    print("ホスト   : %d" % host_count)
    print("回復     : %d 行(こちらの落ち度と分かったもの)" % recovered)
    print("雛形     : %d 行(住所ではなく {token} などを含む宣言)" % templated_n)
    print("開示の欄 : %s" % "、".join(sorted(fields, key=lambda k: -fields[k])[:5]))
    print("出力     : %s (%d バイト)" % (os.path.relpath(OUT, ROOT), len(want)))

    have = io.open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    if have == want:
        print("\nずれはありません。")
        return 0
    if not a.write:
        print("\nずれています。作り直すには --write を付けてください。")
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(want)
    r = subprocess.run(["node", "--check", OUT], capture_output=True, text=True)
    if r.returncode != 0:
        io.open(OUT, "w", encoding="utf-8").write(have)
        sys.stderr.write("\nnode --check が落ちたので元に戻しました。\n" + r.stderr + "\n")
        return 2
    print("\n作り直しました。node --check 通過。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
