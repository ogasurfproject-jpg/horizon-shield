#!/usr/bin/env python3
# core_restore_sitemap.py (2026-09-16, 番人)
#
# #2 archive-only の 12 本を core の sitemap.xml に足す。掟(Bing):
#   - sitemap-archive.xml / sitemap-yakumo.xml / robots.txt は開きもせん。
#   - sitemap の構造は変えん。既存の <url> は 1 バイトも動かさん。
#   - 12 本は archive にも残す(消さん)。ここは足すだけ。
#   - 冪等: 既に core にある slug は飛ばす。
#
# 既定は preview(sitemap.xml.preview に書いて差分を出す。本体は触らん)。
# 当てるのは TOshi の手: --apply で sitemap.xml を書き換え(sitemap.xml.bak-<日時> を残す)。
#
#   python3 ops/monitor_pages_20260915/core_restore_sitemap.py                 # 12 本 preview
#   python3 ops/monitor_pages_20260915/core_restore_sitemap.py --slugs a,b     # 一部だけ(波)
#   python3 ops/monitor_pages_20260915/core_restore_sitemap.py --apply         # 当てる

import os, io, sys, argparse, datetime

BASE = "https://shield.the-horizons-innovation.com"
DATE = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime("%Y-%m-%d")  # JST

# 検証済み 12 本(全部 souba 詳細ページ = changefreq monthly / priority 0.7)
SLUGS = [
    "souba/ecocute-370l-souba",
    "souba/unit-bath-1616-souba",
    "souba/shiroari-kujo-tanka-souba",
    "souba/toilet-tankless-souba",
    "souba/kitchen-middle-souba",
    "souba/shiroari-30tsubo-hiyou",
    "souba/yane-tosou-30tsubo-souba",
    "souba/genkan-door-cover-souba",
    "souba/yuka-dannetsu-souba",
    "souba/yane-cover-galvalume-souba",
    "souba/veranda-frp-bousui-souba",
    "souba/aircon-toritsuke-souba",
]

def block(slug):
    url = BASE + "/" + slug + "/"
    return ("<url>\n"
            "    <loc>" + url + "</loc>\n"
            "    <lastmod>" + DATE + "</lastmod>\n"
            "    <changefreq>monthly</changefreq>\n"
            "    <priority>0.7</priority>\n"
            "  </url>\n")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sitemap", default="sitemap.xml")
    ap.add_argument("--slugs", default="")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    sm = os.path.join(root, a.sitemap)
    s = io.open(sm, encoding="utf-8").read()
    end = "</urlset>"
    if s.count(end) != 1:
        print("REFUSE: </urlset> not found exactly once", file=sys.stderr); sys.exit(2)

    want = [x.strip() for x in a.slugs.split(",") if x.strip()] or SLUGS
    before = s.count("<loc>")
    add, skip = [], []
    for slug in want:
        if ("/" + slug + "/</loc>") in s:
            skip.append(slug)
        else:
            add.append(slug)

    ins = "".join(block(sl) for sl in add)
    out = s.replace(end, ins + end, 1)
    after = out.count("<loc>")

    print("date(lastmod):", DATE)
    print("core <loc> before:", before, "-> after:", after, "(+%d)" % (after - before))
    if skip: print("skip (already in core):", ", ".join(skip))
    print("add (%d):" % len(add))
    for sl in add: print("   +", BASE + "/" + sl + "/")

    if a.apply:
        import time
        bak = sm + ".bak-" + time.strftime("%Y%m%d-%H%M%S")
        io.open(bak, "w", encoding="utf-8").write(s)
        io.open(sm, "w", encoding="utf-8").write(out)
        print("APPLIED. backup:", os.path.basename(bak))
    else:
        pv = sm + ".preview"
        io.open(pv, "w", encoding="utf-8").write(out)
        print("preview written:", os.path.basename(pv), "(sitemap.xml untouched)")

if __name__ == "__main__":
    main()
