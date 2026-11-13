#!/usr/bin/env python3
"""gen_roumu_pages.py: pages of the MLIT public-works design labour rates (公共工事設計労務単価), from the JCCDB rows only.

    gen_roumu_pages.py <repo_root> --out DIR [--base /roumu/] [--robots noindex,follow] [--published YYYY-MM-DD] [--trade-links on|off]
    gen_roumu_pages.py selftest

Reads <repo_root>/data/jccdb-obs-v2/observations/jp/labor_mlit_roumu_*.csv (one row per prefecture x trade x period)
and <repo_root>/data/jccdb-obs-v2/sources/<source_id>.json (attribution, effective date, retrieval date).
Writes, under DIR: index.html; pref/<geo_code>/index.html (47: every trade's latest value, the year before, the change,
and the 14-period table); trade/tNN/index.html (50 trades of the latest period: the 47 values, highest and lowest);
each page with facts.json beside it (every value shown: obs_id, value or null, status, period, source_id, evidence_url,
the CSV file and its sha256), and pages.json (the list of pages and their sha256).

Every number that is a yen amount, a change, a date of application or a count sits in a <data> element that names the
CSV row(s) it comes from, so check_roumu_pages.py can recompute it. not_set rows read 設定なし, never 0.
v2 (2026-11-10): dateModified is the publishing day (--published; without it, the latest retrieved_at of the sources);
the retrieval date of the originals and the month the latest values apply from are stated apart on the page. The
prefecture page's first sentence names three trades (大工, 塗装工, 普通作業員; a trade with no value in that prefecture is
skipped and the next one in the table order fills in). facts.json holds the latest period only and points to the CSV
files for the 14 periods. --trade-links off (the default): the prefecture pages and the index do not link to the trade
pages, which are built and kept back (pages.json marks them "later"). No clock is read; two runs give the same bytes.
Standard library only; sends nothing.
"""
import csv
import glob
import hashlib
import html
import json
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP

SITE = "https://shield.the-horizons-innovation.com"
NOTE = "公共工事の設計単価で、リフォームの施主が払う額や業者の見積単価ではありません。"
HEAD_TRADES = ["大工", "塗装工", "普通作業員"]
CSV_BASE = "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/"
# trade -> related price pages on the site (links only; no numbers come from them)
SOUBA = {"塗装工": ["gaiheki"], "屋根ふき工": ["yane"], "板金工": ["bankin", "yane"], "内装工": ["cloth", "tenpo"], "大工": ["flooring"],
         "配管工": ["haikan", "kyutoki", "bath", "toilet"], "電工": ["aircon", "solar"], "防水工": ["veranda"], "とび工": ["gaiheki"],
         "サッシ工": ["mado"], "ガラス工": ["mado"], "建具工": ["genkan"], "造園工": ["gaiko"], "ブロック工": ["gaiko"],
         "はつり工": ["kaitai"], "普通作業員": ["kaitai"], "タイル工": ["bath"], "設備機械工": ["aircon", "kitchen"]}
SOUBA_CORE = ["gaiheki", "yane", "bath", "kyutoki", "flooring", "cloth"]


def load(root):
    d = os.path.join(root, "data", "jccdb-obs-v2")
    rows, files = [], {}
    for f in sorted(glob.glob(os.path.join(d, "observations", "jp", "labor_mlit_roumu_*.csv"))):
        raw = open(f, "rb").read()
        name = os.path.relpath(f, root)
        files[name] = hashlib.sha256(raw).hexdigest()
        for r in csv.DictReader(raw.decode("utf-8").splitlines()):
            if r.get("geo_level") != "pref":
                continue
            r["_file"] = name
            rows.append(r)
    sources = {}
    for sid in sorted({r["source_id"] for r in rows}):
        sources[sid] = json.load(open(os.path.join(d, "sources", sid + ".json"), encoding="utf-8"))
    return rows, files, sources


def yen(v):
    return "{:,}円".format(int(v))


def ym(iso):
    y, m = iso.split("-")[:2]
    return "%s年%d月" % (y, int(m))


def ratio(a, b):
    return (Decimal(a) / Decimal(b) * 100 - 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def d_val(r):
    if r is None:
        return '<data value="" data-k="none">行なし</data>'
    if r["price_status"] == "not_set" or not r["price"]:
        return '<data value="" data-k="n" data-obs="%s">設定なし</data>' % r["obs_id"]
    return '<data value="%s" data-k="v" data-obs="%s">%s</data>' % (r["price"], r["obs_id"], yen(r["price"]))


def d_url(r):
    return '<a href="%s">原本</a>' % html.escape(r["evidence_url"])


def d_ratio(cur, prev):
    if cur is None or prev is None or not cur["price"] or not prev["price"]:
        return "-"
    x = ratio(cur["price"], prev["price"])
    return '<data value="%s" data-k="r" data-obs="%s" data-prev="%s">%s%s%%</data>' % (x, cur["obs_id"], prev["obs_id"], "+" if x > 0 else "", x)


def d_date(r):
    return '<data value="%s" data-k="d" data-obs="%s">%s</data>' % (r["effective_from"], r["obs_id"], ym(r["effective_from"]))


def d_count(n, what):
    return '<data value="%d" data-k="c" data-what="%s">%d</data>' % (n, html.escape(what), n)


def head_sentence(pref, picks):
    """picks: [(trade, cur_row, prev_row)] (three trades with a value)"""
    s = "%sの公共工事設計労務単価は、%s(8 時間、%sから)。" % (pref, "、".join("%s %s" % (t, d_val(c)) for t, c, p in picks), d_date(picks[0][1]))
    s += "前年は %s。" % "、".join("%s %s" % (t, d_val(p) if p is not None else "行なし") for t, c, p in picks)
    return s


def page(title, url, head, body, srcs, sources, upd, facts, base_rel, retrieved="", effective=""):
    attrib = "".join("<li>%s(%s)</li>" % (html.escape(sources[s]["attribution"]), html.escape(sources[s]["license"])) for s in sorted(srcs))
    ld = {"@context": "https://schema.org", "@type": "Dataset", "name": title, "url": url, "dateModified": upd,
          "creator": {"@type": "Organization", "name": "国土交通省"},
          "publisher": {"@type": "Organization", "name": "HORIZON SHIELD", "url": SITE + "/"},
          "license": "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
          "isBasedOn": [sources[s]["url"] for s in sorted(srcs)],
          "distribution": {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": url + "facts.json"},
          "description": NOTE}
    return """<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} | HORIZON SHIELD</title>
<link rel="canonical" href="{url}">
<meta name="robots" content="{{robots}}">
<script type="application/ld+json">{ld}</script>
</head><body>
<h1>{title}</h1>
<p class="answer-first">{head}</p>
<p>{note}</p>
{body}
<h2>出典</h2>
<ul>{attrib}</ul>
<p>この頁の値は JCCDB の観測層(data/jccdb-obs-v2)の行から機械で写しています。最新の期の値の行と CSV の sha256 は <a href="facts.json">facts.json</a> に、14 期の全部の行は CSV(facts.json の csv_files)にあります。この頁の更新日 {upd}。原本の取得日 {retrieved}。最新の値の適用 {effective}から。</p>
<p><a href="{base}">労務単価の索引</a></p>
</body></html>
""".format(title=html.escape(title), url=url, ld=json.dumps(ld, ensure_ascii=False), head=head, note=NOTE, body=body,
           attrib=attrib, upd=upd, base=base_rel, retrieved=retrieved, effective=effective)


def build(root, out, base="/roumu/", robots="noindex,follow", published=None, trade_links=True):
    """published: the day the pages go out (dateModified). trade_links False: pages that go out first (prefectures and
    the index) do not link to the trade pages, which are built but kept back"""
    rows, files, sources = load(root)
    retrieved = max(sources[s]["retrieved_at"] for s in sources)
    upd = published or retrieved
    periods = sorted({r["period"] for r in rows})
    last, prevp = periods[-1], periods[-2]
    by = {(r["geo_code"], r["item_name"], r["period"]): r for r in rows}
    prefs = sorted({(r["geo_code"], r["geo_name"]) for r in rows})
    trades_last = []
    for r in rows:
        if r["period"] == last and r["item_name"] not in trades_last:
            trades_last.append(r["item_name"])
    trades_all = list(trades_last) + sorted({r["item_name"] for r in rows} - set(trades_last))
    tslug = {t: "t%02d" % (i + 1) for i, t in enumerate(trades_last)}
    pages = []
    effective = ym(max(r["effective_from"] for r in rows))
    csv_files = [{"csv": f, "sha256": files[f], "url": CSV_BASE + f} for f in sorted(files)]
    tname = (lambda t: '<a href="%strade/%s/">%s</a>' % (base, tslug[t], html.escape(t))) if trade_links else (lambda t: html.escape(t))

    def fact(r):
        return {"obs_id": r["obs_id"], "value": int(r["price"]) if r["price"] else None, "status": r["price_status"], "pref": r["geo_name"],
                "trade": r["item_name"], "period": r["period"], "effective_from": r["effective_from"], "source_id": r["source_id"],
                "evidence_url": r["evidence_url"], "csv": r["_file"], "csv_sha256": files[r["_file"]]}

    def write(rel, title, head, body, used, extra_links=""):
        url = SITE + base + rel
        srcs = {r["source_id"] for r in used}
        facts = {"page": base + rel, "dateModified": upd, "retrieved_at": retrieved, "period": last, "csv_files": csv_files,
                 "rows": [fact(r) for r in sorted(used, key=lambda r: r["obs_id"]) if r["period"] == last]}
        h = page(title, url, head, body + extra_links, srcs, sources, upd, facts, base, retrieved, effective).replace("{robots}", robots)
        d = os.path.join(out, rel)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(h)
        fj = json.dumps(facts, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
        open(os.path.join(d, "facts.json"), "w", encoding="utf-8").write(fj)
        pages.append({"path": base + rel, "publish": "later" if rel.startswith("trade/") else "first", "sha256": hashlib.sha256(h.encode("utf-8")).hexdigest(),
                      "facts_sha256": hashlib.sha256(fj.encode("utf-8")).hexdigest()})

    def souba_links(trades=(), slugs0=()):
        slugs = []
        for s in list(slugs0) + [x for t in trades for x in SOUBA.get(t, [])]:
            if s not in slugs and os.path.exists(os.path.join(root, "souba", s, "index.html")):
                slugs.append(s)
        if not slugs:
            return ""
        return "<h2>関係する相場の頁</h2>\n<ul>%s</ul>\n" % "".join('<li><a href="%s/souba/%s/">/souba/%s/</a></li>' % (SITE, s, s) for s in slugs)

    # prefecture pages
    for code, name in prefs:
        used = []
        order = HEAD_TRADES + [t for t in trades_last if t not in HEAD_TRADES]
        picks = [(t, by[(code, t, last)], by.get((code, t, prevp))) for t in order if by.get((code, t, last)) and by[(code, t, last)]["price"]][:3]
        cur_head = picks[0][1]
        head = head_sentence(name, picks)
        used += [x for t, c, p in picks for x in (c, p) if x]
        trs = []
        for t in trades_last:
            c, p = by.get((code, t, last)), by.get((code, t, prevp))
            used += [x for x in (c, p) if x]
            trs.append('<tr><td>%s</td><td>%s %s</td><td>%s</td><td>%s</td></tr>' % (
                tname(t), d_val(c), d_url(c) if c else "", d_val(p) if p else "行なし", d_ratio(c, p)))
        body = ("<h2>%sの職種別の単価(%s から)</h2>\n<table><tr><th>職種</th><th>%s</th><th>前年</th><th>前年比</th></tr>\n%s\n</table>\n" %
                (name, d_date(cur_head), "最新", "\n".join(trs)))
        hdr = "".join("<th>%s</th>" % ym(p + "-01") for p in periods)
        trs2 = []
        for t in trades_all:
            cells = []
            for p in periods:
                r = by.get((code, t, p))
                if r:
                    used.append(r)
                cells.append("<td>%s</td>" % (d_val(r) if r else "行なし"))
            trs2.append("<tr><td>%s</td>%s</tr>" % (html.escape(t), "".join(cells)))
        body += "<h2>%sの %s 期の表</h2>\n<table><tr><th>職種</th>%s</tr>\n%s\n</table>\n" % (name, d_count(len(periods), "periods"), hdr, "\n".join(trs2))
        uniq = {r["obs_id"]: r for r in used}.values()
        write("pref/%s/" % code, "%sの公共工事設計労務単価(%s)" % (name, ym(last + "-01")), head, body, list(uniq), souba_links(slugs0=SOUBA_CORE))
    # trade pages
    for t in trades_last:
        cur = [(code, name, by.get((code, t, last)), by.get((code, t, prevp))) for code, name in prefs]
        valued = [x for x in cur if x[2] and x[2]["price"]]
        hi = max(valued, key=lambda x: (int(x[2]["price"]), x[0])) if valued else None
        lo = min(valued, key=lambda x: (int(x[2]["price"]), x[0])) if valued else None
        if valued:
            head = ("%sの公共工事設計労務単価は、%s 都道府県で %s(%s)から %s(%s)まで(8 時間、%sから)。単価の設定が無い都道府県は %s。" % (
                t, d_count(len(valued), "valued:" + t), d_val(lo[2]), lo[1], d_val(hi[2]), hi[1], d_date(hi[2]), d_count(len(cur) - len(valued), "not_set:" + t)))
        else:
            head = "%sの公共工事設計労務単価は、%s から全部の都道府県で設定なしです。" % (t, ym(last + "-01"))
        used = [x for c in cur for x in (c[2], c[3]) if x]
        trs = ['<tr><td><a href="%spref/%s/">%s</a></td><td>%s %s</td><td>%s</td><td>%s</td></tr>' % (
            base, code, name, d_val(c), d_url(c) if c else "", d_val(p) if p else "行なし", d_ratio(c, p)) for code, name, c, p in cur]
        body = "<h2>%sの都道府県別の単価</h2>\n<table><tr><th>都道府県</th><th>最新</th><th>前年</th><th>前年比</th></tr>\n%s\n</table>\n" % (t, "\n".join(trs))
        write("trade/%s/" % tslug[t], "%sの公共工事設計労務単価 都道府県別(%s)" % (t, ym(last + "-01")), head, body, used, souba_links([t]))
    # index
    first, lastrow = min(rows, key=lambda r: r["effective_from"]), max(rows, key=lambda r: r["effective_from"])
    head = ("国土交通省の公共工事設計労務単価を、%s 都道府県 × %s 職種、%s 期(%sから%sまで)の行で載せています。" % (
        d_count(len(prefs), "prefs"), d_count(len(trades_last), "trades_last"), d_count(len(periods), "periods"), d_date(first), d_date(lastrow)))
    body = "<h2>都道府県</h2>\n<ul>%s</ul>\n" % "".join('<li><a href="%spref/%s/">%s</a></li>' % (base, c, n) for c, n in prefs)
    if trade_links:
        body += "<h2>職種</h2>\n<ul>%s</ul>\n" % "".join('<li>%s</li>' % tname(t) for t in trades_last)
    write("", "公共工事設計労務単価 47 都道府県 × 職種(国土交通省)", head, body, [first, lastrow], souba_links(["塗装工", "配管工", "内装工", "大工", "屋根ふき工"]))
    pages.sort(key=lambda p: p["path"])
    pj = json.dumps({"base": base, "dateModified": upd, "retrieved_at": retrieved, "trade_links": trade_links, "csv": files, "pages": pages},
                    ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    open(os.path.join(out, "pages.json"), "w", encoding="utf-8").write(pj)
    return {"pages": len(pages), "pages_json_sha256": hashlib.sha256(pj.encode("utf-8")).hexdigest(), "dateModified": upd}


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
        o1, o2 = os.path.join(d, "o1"), os.path.join(d, "o2")
        m1, m2 = build(d, o1), build(d, o2)
        a = open(os.path.join(o1, "pref", "13", "index.html"), encoding="utf-8").read()
        head = re.search(r'<p class="answer-first">(.*?)</p>', a).group(1)
        txt = re.sub(r"<[^>]+>", "", head)
        ok = txt == "東京都の公共工事設計労務単価は、普通作業員 27,000円(8 時間、2026年3月から)。前年は 普通作業員 26,000円。"
        fails += not ok
        print("%s the head sentence (%s)" % ("ok  " if ok else "NG  ", txt))
        ok = "設定なし" in a and not re.search(r'data-obs="b2">0', a) and '"dateModified": "2026-09-26"' in a and "出典：テスト(s8)を加工して作成" in a and NOTE in a and "+3.8%" in a
        fails += not ok
        print("%s not_set reads 設定なし, dateModified is the data's date, attribution and the note are there, the change is computed" % ("ok  " if ok else "NG  "))
        ok = m1 == m2 and open(os.path.join(o1, "pages.json"), "rb").read() == open(os.path.join(o2, "pages.json"), "rb").read()
        fails += not ok
        print("%s two builds give the same bytes (pages %d)" % ("ok  " if ok else "NG  ", m1["pages"]))
    print("SELFTEST %s" % ("ok" if not fails else "NG"))
    return 0 if not fails else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return 2
    if argv[0] == "selftest":
        return selftest()
    arg = lambda k, dflt=None: argv[argv.index(k) + 1] if k in argv else dflt  # noqa: E731
    if not arg("--out"):
        print(__doc__); return 2
    pub = arg("--published")
    if pub is not None and not re.fullmatch(r"20\d\d-\d\d-\d\d", pub):
        print("--published must be YYYY-MM-DD"); return 2
    m = build(argv[0], arg("--out"), arg("--base", "/roumu/"), arg("--robots", "noindex,follow"), pub, arg("--trade-links", "off") == "on")
    print("PAGES %d, pages.json sha256 %s, dateModified %s" % (m["pages"], m["pages_json_sha256"], m["dateModified"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
