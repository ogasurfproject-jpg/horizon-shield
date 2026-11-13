#!/usr/bin/env python3
"""check_roumu_pages.py: every number on the labour-rate pages equals the CSV cell it names.

    check_roumu_pages.py <repo_root> <pages_dir> [--published YYYY-MM-DD] [--json out.json]
    check_roumu_pages.py selftest

Reads the same CSV rows and source records as gen_roumu_pages.py, and every index.html and facts.json under pages_dir.
Per page it checks:
  C1 each <data data-k="v"> value and its text equal the price of the row it names
  C2 each <data data-k="n"> names a not_set row and reads 設定なし; no not_set row is shown as a number (0 or other)
  C3 each change <data data-k="r"> equals round_half_up((value / previous - 1) x 100, 1) of the two rows it names
  C4 each date <data data-k="d"> equals the row's effective_from; each count <data data-k="c"> is recomputed
  C5 outside <data>, the text holds no yen amount and no percentage (no number escapes the check)
  C6 the attribution of every source the page uses is on the page; the public-works note is on the page
  C7 no avoided word (安全 保証 世界初 必ず 本当 正しい 独占 爆上げ 第三者) and no dash
  C8 dateModified (JSON-LD and facts.json) equals the publishing day (--published), else the latest retrieved_at
  C9 facts.json rows are of the latest period and equal the CSV rows (value, status, period, source_id, evidence_url)
     and the CSV sha256
Exit 0 when nothing is found, 1 otherwise. Standard library only; sends nothing.
"""
import glob
import hashlib
import html
import json
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_roumu_pages as gen  # noqa: E402

AVOID = ["安全", "保証", "世界初", "必ず", "本当", "正しい", "独占", "爆上げ", "第三者"]
DASH = re.compile("[" + chr(0x2012) + "-" + chr(0x2015) + "]")
DATA = re.compile(r'<data value="([^"]*)" data-k="(\w+)"([^>]*)>(.*?)</data>', re.S)


def attrs(s):
    return dict(re.findall(r'data-(\w+)="([^"]*)"', s))


def check(root, pages_dir, published=None):
    rows, files, sources = gen.load(root)
    obs = {r["obs_id"]: r for r in rows}
    upd = published or max(s["retrieved_at"] for s in sources.values())
    periods = sorted({r["period"] for r in rows})
    last = periods[-1]
    counts = {"prefs": len({r["geo_code"] for r in rows}), "periods": len(periods),
              "trades_last": len({r["item_name"] for r in rows if r["period"] == last})}
    for t in {r["item_name"] for r in rows if r["period"] == last}:
        lr = [r for r in rows if r["period"] == last and r["item_name"] == t]
        counts["valued:" + t] = sum(1 for r in lr if r["price"])
        counts["not_set:" + t] = sum(1 for r in lr if not r["price"])
    found, n_pages, n_data = [], 0, 0
    for p in sorted(glob.glob(os.path.join(pages_dir, "**", "index.html"), recursive=True)):
        n_pages += 1
        rel = os.path.relpath(p, pages_dir)
        src = open(p, encoding="utf-8").read()
        add = lambda code, note: found.append({"page": rel, "check": code, "note": note})  # noqa: E731
        used_src = set()
        for v, k, rest, text in DATA.findall(src):
            n_data += 1
            a = attrs(rest)
            r = obs.get(a.get("obs"))
            if k in ("v", "n", "d", "r") and not r:
                add("C1", "unknown row %s" % a.get("obs")); continue
            if r:
                used_src.add(r["source_id"])
            if k == "v":
                if not r["price"] or v != r["price"] or text != gen.yen(r["price"]):
                    add("C1", "%s shows %s / %s, CSV %s" % (r["obs_id"], v, text, r["price"] or r["price_status"]))
            elif k == "n":
                if r["price"] or r["price_status"] != "not_set" or text != "設定なし":
                    add("C2", "%s shows %s, CSV %s" % (r["obs_id"], text, r["price_status"]))
            elif k == "r":
                pr = obs.get(a.get("prev"))
                if not pr or not r["price"] or not pr["price"]:
                    add("C3", "change without two values %s"); continue
                used_src.add(pr["source_id"])
                x = (Decimal(r["price"]) / Decimal(pr["price"]) * 100 - 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
                if v != str(x) or text != "%s%s%%" % ("+" if x > 0 else "", x):
                    add("C3", "%s/%s shows %s, recomputed %s" % (r["obs_id"], pr["obs_id"], text, x))
            elif k == "d":
                if v != r["effective_from"] or text != gen.ym(r["effective_from"]):
                    add("C4", "%s date %s, CSV %s" % (r["obs_id"], text, r["effective_from"]))
            elif k == "c":
                if counts.get(a.get("what")) is None or str(counts[a["what"]]) != v or text != v:
                    add("C4", "count %s shows %s, recomputed %s" % (a.get("what"), text, counts.get(a.get("what"))))
            elif k == "none":
                pass
            else:
                add("C1", "unknown kind %s" % k)
        rest_txt = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", " ", DATA.sub(" ", src), flags=re.S)))
        if re.search(r"\d[\d,]*\s*円", rest_txt) or re.search(r"\d\s*%", rest_txt):
            add("C5", "a yen amount or a percentage outside <data>: %s" % re.findall(r".{0,15}\d[\d,]*\s*(?:円|%).{0,5}", rest_txt)[:3])
        for sid in used_src:
            if sources[sid]["attribution"] not in html.unescape(src):
                add("C6", "attribution of %s missing" % sid)
        if gen.NOTE not in src:
            add("C6", "the public-works note is missing")
        vis = html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>|<head.*?</head>", " ", src, flags=re.S)))
        for w in AVOID:
            if w in vis:
                add("C7", "avoided word %s" % w)
        if DASH.search(vis):
            add("C7", "dash")
        m = re.search(r'"dateModified": "([^"]+)"', src)
        if not m or m.group(1) != upd:
            add("C8", "dateModified %s, data %s" % (m.group(1) if m else None, upd))
        fp = os.path.join(os.path.dirname(p), "facts.json")
        try:
            facts = json.load(open(fp, encoding="utf-8"))
        except (OSError, ValueError):
            add("C9", "facts.json missing"); continue
        if facts.get("dateModified") != upd:
            add("C8", "facts.json dateModified")
        for f in facts.get("rows", []):
            if f.get("period") != last:
                add("C9", "facts row %s is not of the latest period" % f["obs_id"])
            r = obs.get(f["obs_id"])
            if not r or f["value"] != (int(r["price"]) if r["price"] else None) or f["status"] != r["price_status"] or f["period"] != r["period"] \
                    or f["source_id"] != r["source_id"] or f["evidence_url"] != r["evidence_url"] or f["csv_sha256"] != files.get(f["csv"]):
                add("C9", "facts row %s differs from the CSV" % f["obs_id"])
    return found, n_pages, n_data


def selftest():
    import tempfile
    fails = 0
    with tempfile.TemporaryDirectory() as d:
        jp = os.path.join(d, "data", "jccdb-obs-v2", "observations", "jp")
        sd = os.path.join(d, "data", "jccdb-obs-v2", "sources")
        os.makedirs(jp); os.makedirs(sd)
        hdr = "obs_id,item_name,geo_level,geo_code,geo_name,price,price_status,period,effective_from,source_id,evidence_url,license\n"
        open(os.path.join(jp, "labor_mlit_roumu_r7.csv"), "w", encoding="utf-8").write(hdr +
            "a1,普通作業員,pref,13,東京都,26000,published_pdl,2025-03,2025-03-01,s7,https://x/7.pdf,PDL1.0\n"
            "a2,石工,pref,13,東京都,,not_set,2025-03,2025-03-01,s7,https://x/7.pdf,PDL1.0\n")
        open(os.path.join(jp, "labor_mlit_roumu_r8.csv"), "w", encoding="utf-8").write(hdr +
            "b1,普通作業員,pref,13,東京都,27000,published_pdl,2026-03,2026-03-01,s8,https://x/8.pdf,PDL1.0\n"
            "b2,石工,pref,13,東京都,,not_set,2026-03,2026-03-01,s8,https://x/8.pdf,PDL1.0\n")
        for s, day in (("s7", "2026-09-25"), ("s8", "2026-09-26")):
            json.dump({"attribution": "出典：テスト(%s)を加工して作成" % s, "license": "PDL1.0", "url": "https://x/%s" % s, "retrieved_at": day},
                      open(os.path.join(sd, s + ".json"), "w", encoding="utf-8"))
        o = os.path.join(d, "o")
        gen.build(d, o)
        f, n, k = check(d, o)
        ok = not f and n == 4
        fails += not ok
        print("%s a fresh build passes (%d pages, %d values, findings %s)" % ("ok  " if ok else "NG  ", n, k, f[:2]))
        p = os.path.join(o, "pref", "13", "index.html")
        a = open(p, encoding="utf-8").read()
        for name, bad, want in (("a changed value", a.replace('data-obs="b1">27,000円', 'data-obs="b1">28,000円', 1), "C1"),
                                ("not_set shown as 0", a.replace('data-k="n" data-obs="b2">設定なし', 'data-k="n" data-obs="b2">0円', 1), "C2"),
                                ("a number outside the check", a.replace("<h2>出典</h2>", "<p>参考 30,000円</p><h2>出典</h2>"), "C5"),
                                ("attribution removed", a.replace("出典：テスト(s8)を加工して作成", ""), "C6"),
                                ("an avoided word", a.replace("<h2>出典</h2>", "<p>安全です</p><h2>出典</h2>"), "C7"),
                                ("another date", a.replace('"dateModified": "2026-09-26"', '"dateModified": "2026-11-10"'), "C8")):
            open(p, "w", encoding="utf-8").write(bad)
            f, _, _ = check(d, o)
            ok = any(x["check"] == want for x in f)
            fails += not ok
            print("%s %s is caught (%s)" % ("ok  " if ok else "NG  ", name, want))
            open(p, "w", encoding="utf-8").write(a)
    print("SELFTEST %s" % ("ok" if not fails else "NG"))
    return 0 if not fails else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return 2
    if argv[0] == "selftest":
        return selftest()
    found, n, k = check(argv[0], argv[1], argv[argv.index("--published") + 1] if "--published" in argv else None)
    for f in found[:50]:
        print("%-4s %s  %s" % (f["check"], f["page"], f["note"]))
    by = {}
    for f in found:
        by[f["check"]] = by.get(f["check"], 0) + 1
    print("SUMMARY pages %d, values checked %d, findings %d %s" % (n, k, len(found), json.dumps(by, sort_keys=True)))
    if "--json" in argv:
        json.dump(found, open(argv[argv.index("--json") + 1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0 if not found else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
