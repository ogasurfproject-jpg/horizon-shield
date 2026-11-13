#!/usr/bin/env python3
"""gen_region_pages.py: work x region fair-price pages, every number computed from the published data.

    gen_region_pages.py <repo_root> --works works.json --out DIR [--only gaiheki:tokyo,...] [--mcp path/to/mcp.js]
                        [--robots noindex,follow]   (the default keeps a trial build out of any index)
                        [--subsidies public_subsidies.json --snapshots DIR]
Page type (v0.2): the /souba/cloth/ head (one sentence, ranges in units, 適正です, no version), a 3-row table under it,
the basis line, steps, the full table, the national public figures (FY2026 labour rates of the prefecture, from the
JCCDB copy of the MLIT table, with the URL), FY2026 subsidies (only amounts read by a rule from a saved copy of the
official page whose sha256 matches; otherwise the section is left out and the programme listed as pending), the source
paragraph with the souba-db version, then the store directory, then the diagnosis offer, then the footnote.
    gen_region_pages.py selftest

Inputs (read only): <repo_root>/data/souba-db.json (rows, version, date, region multipliers),
<repo_root>/data/souba-db.basis.json (how each row compares with public prices),
<repo_root>/data/yakumo-store-places.json and <repo_root>/yakumo/noNNN/index.html JSON-LD (stores, areas, trades),
works.json (which rows make up each work, the words a homeowner uses, nothing numeric).
Optional --mcp: checks that the place-to-region table below equals resolveRegion's lists in mcp.js; stops if not.

Numbers: regional value = round_half_up(row value x _meta.region_multipliers[key]), the formula get_price_range states.
No number is typed by hand. Output per page: DIR/<work>/<region>/index.html, plus DIR/llms_lines.txt and
DIR/manifest.json (page, rows, multiplier, sha256 of the page). Standard library only; sends nothing.
"""
import hashlib
import html
import json
import math
import os
import re
import sys

REGIONS = {
    "tokyo": {"name": "東京都", "short": "東京", "pref": "東京都", "key": "kanto", "key_ja": "関東", "match": "東京", "table": "REGION_PREFS"},
    "nagoya": {"name": "名古屋市", "short": "名古屋市", "pref": "愛知県", "key": "chubu", "key_ja": "中部", "match": "名古屋", "table": "REGION_CITIES"},
    "hiratsuka": {"name": "平塚市", "short": "平塚市", "pref": "神奈川県", "key": "kanto", "key_ja": "関東", "match": "平塚", "table": "REGION_CITIES"},
}
SITE = "https://shield.the-horizons-innovation.com"
BANNED = ["独占", "爆上げ", "保証", "世界初", "人類未踏", "安全", "本当", "正しい", "必ず", "第三者"]
DASH = re.compile("[" + chr(0x2012) + "-" + chr(0x2015) + "]")


def half_up(x):
    return int(math.floor(x + 0.5))


def yen(v):
    return "{:,}円".format(v)


def man_or_yen(v):
    if v >= 10000 and v % 1000 == 0:
        x = v / 10000.0
        return (("%d" % x) if abs(x - round(x)) < 1e-9 else ("%.1f" % x)) + "万円"
    return yen(v)


def rng(lo, hi, unit):
    per = {"㎡": "/㎡", "坪": "/坪", "m": "/m"}.get(unit)
    if per:
        return "{:,}〜{:,}円{}".format(lo, hi, per)
    a, b = man_or_yen(lo), man_or_yen(hi)
    if a.endswith("万円") and b.endswith("万円"):
        return a[:-2] + "〜" + b
    if not a.endswith("万円") and not b.endswith("万円"):
        return a[:-1] + "〜" + b
    return a + "〜" + b


def avg_text(v, unit):
    if unit in ("㎡", "坪", "m"):
        return "{:,}円".format(v)
    return man_or_yen(v)


VERDICT_JA = {"consistent": "同じ工事と単位の公開の値が幅に入る", "partly": "一部だけ重なる(規模や範囲が違う出典を含む)",
              "inconsistent": "合わない", "none": "比べられる公開の値が見つからない"}


def kfmt(k):
    return ("%.1f" % k) if k == int(k) else ("%g" % k)


def clean(s):
    s = s or ""
    for w in BANNED:
        if w in s:
            return ""
    # internal words of the dataset notes stay out of the page
    s = "。".join(x for x in s.split("。") if x and not re.search(r"danger|souba|[A-Za-z]{2,}\+", x))
    s = (s + "。") if s and not s.endswith("。") else s
    return DASH.sub("、", s)


def mcp_lists(path):
    src = open(path, encoding="utf-8").read()
    out = {}
    for table in ("REGION_PREFS", "REGION_CITIES"):
        m = re.search(r"const " + table + r" = \{(.*?)\n\};", src, re.S)
        if not m:
            raise ValueError("%s not found in %s" % (table, path))
        for k, body in re.findall(r"(\w+): \[([^\]]*)\]", m.group(1)):
            out.setdefault(table, {})[k] = re.findall(r'"([^"]+)"', body)
    return out, hashlib.sha256(src.encode("utf-8")).hexdigest()


def check_regions_against_mcp(path):
    lists, sha = mcp_lists(path)
    for slug, r in REGIONS.items():
        names = lists.get(r["table"], {}).get(r["key"], [])
        if r["match"] not in names:
            raise ValueError("%s: %s is not in %s.%s of mcp.js" % (slug, r["match"], r["table"], r["key"]))
        # the first table that matches wins in resolveRegion; prefectures are read first
        if r["table"] == "REGION_CITIES":
            for k, names2 in lists.get("REGION_PREFS", {}).items():
                if any(n in r["name"] for n in names2):
                    raise ValueError("%s would resolve by prefecture %s first" % (slug, k))
    return sha


def stores(root):
    places = json.load(open(os.path.join(root, "data", "yakumo-store-places.json"), encoding="utf-8"))["stores"]
    out = []
    for no, p in sorted(places.items()):
        n = no.replace("No.", "no")
        page = os.path.join(root, "yakumo", n, "index.html")
        areas, trades, sid = [], [], None
        try:
            src = open(page, encoding="utf-8").read()
        except OSError:
            continue
        for b in re.findall(r'<script[^>]+ld\+json[^>]*>(.*?)</script>', src, re.S):
            try:
                j = json.loads(b)
            except ValueError:
                continue
            for it in (j.get("@graph", [j]) if isinstance(j, dict) else j):
                if isinstance(it, dict) and "areaServed" in it:
                    areas = [a["name"] if isinstance(a, dict) else a for a in it["areaServed"]]
                    trades = it.get("knowsAbout") or []
                    sid = it.get("@id")
        out.append({"no": no, "areas": areas, "trades": trades, "id": sid, **p})
    return out


def build(root, works, out_dir, only=None, mcp=None, robots="noindex,follow", subs=None, snap_dir=None):
    db = json.load(open(os.path.join(root, "data", "souba-db.json"), encoding="utf-8"))
    raw = open(os.path.join(root, "data", "souba-db.json"), "rb").read()
    db_sha = hashlib.sha256(raw).hexdigest()
    basis = {r["id"]: r for r in json.load(open(os.path.join(root, "data", "souba-db.basis.json"), encoding="utf-8"))["rows"]}
    basis_meta = json.load(open(os.path.join(root, "data", "souba-db.basis.json"), encoding="utf-8"))
    meta = db["_meta"]
    ver, upd, mult = meta["version"], meta["updated_at"], meta["region_multipliers"]
    rows = {c["id"]: c for c in db["categories"]}
    mcp_sha = check_regions_against_mcp(mcp) if mcp else None
    st = stores(root)
    labor = labor_rates(root)
    manifest = {"souba_db": {"version": ver, "updated_at": upd, "sha256": db_sha}, "mcp_js_sha256": mcp_sha, "pages": []}
    llms = []
    for w in works["works"]:
        for slug, r in REGIONS.items():
            if only and "%s:%s" % (w["slug"], slug) not in only:
                continue
            k = float(mult[r["key"]])
            head = rows[w["rows"][0]]
            lo, av, hi = (half_up(head[f] * k) for f in ("min", "avg", "max"))
            page = render(w, slug, r, k, rows, basis, basis_meta, ver, upd, db_sha, st, (lo, av, hi), mult, robots, labor, subs, snap_dir)
            d = os.path.join(out_dir, w["slug"], slug)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as fh:
                fh.write(page["html"])
            llms.append(page["llms"])
            manifest["pages"].append({"path": "/souba/%s/%s/" % (w["slug"], slug), "work": w["label"], "region": r["name"],
                                      "region_key": r["key"], "multiplier": k, "rows": w["rows"],
                                      "headline": {"row": head["id"], "min": lo, "avg": av, "max": hi},
                                      "stores": page["stores"], "public_sources": page["public_sources"],
                                      "subsidy_lines": page["subsidy_lines"], "subsidy_pending": page["subsidy_pending"],
                                      "sha256": hashlib.sha256(page["html"].encode("utf-8")).hexdigest()})
    with open(os.path.join(out_dir, "llms_lines.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(llms) + "\n")
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    return manifest


def labor_rates(root):
    """FY2026 public-works design labour rates (国土交通省 公共工事設計労務単価) as JCCDB holds them, by (prefecture, trade)"""
    import csv
    path = os.path.join(root, "data", "jccdb-obs-v2", "observations", "jp", "labor_mlit_roumu_r8.csv")
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                out[(row["geo_name"], row["item_name"])] = row
    except OSError:
        pass
    return out


def subsidies_for(work_slug, subs, snap_dir):
    """subsidy lines whose amount was read by a rule from a saved copy of the official page; nothing typed by hand.
    returns (lines, pending) where pending lists programmes with no usable saved copy"""
    lines, pending = [], []
    for e in (subs or {}).get("programmes", []):
        if work_slug not in e.get("works", []):
            continue
        snap = os.path.join(snap_dir, e["snapshot"]) if snap_dir and e.get("snapshot") else None
        if not snap or not os.path.exists(snap) or not e.get("url"):
            pending.append(e["programme"])
            continue
        raw = open(snap, "rb").read()
        if e.get("snapshot_sha256") and hashlib.sha256(raw).hexdigest() != e["snapshot_sha256"]:
            pending.append(e["programme"] + "(写しの sha が違う)")
            continue
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw.decode("utf-8", "replace")))
        got = []
        for x in e.get("extract", []):
            m = re.search(x["pattern"], txt)
            if m:
                got.append("%s %s" % (x["label"], m.group(1)))
        if not got:
            pending.append(e["programme"] + "(写しから読めない)")
            continue
        lines.append({"programme": e["programme"], "ministry": e.get("ministry", ""), "url": e["url"],
                      "retrieved": e.get("retrieved", ""), "values": got})
    return lines, pending


def render(w, slug, r, k, rows, basis, basis_meta, ver, upd, db_sha, st, headline, mult, robots, labor=None, subs=None, snap_dir=None):
    head = rows[w["rows"][0]]
    lo, av, hi = headline
    url = "%s/souba/%s/%s/" % (SITE, w["slug"], slug)
    q = "%sで%sを頼むと費用はいくらか" % (r["name"], w["label"])
    unit = head["unit"]

    def reg(c):
        return tuple(half_up(c[f] * k) for f in ("min", "avg", "max"))
    # 1. head: the /souba/cloth/ form. One sentence, the work, ranges in units, 適正です. No version in it.
    parts = []
    for rid, say in (w.get("head") or [[w["rows"][0], w["scope"] + "で"]])[:2]:
        c = rows[rid]
        l2, a2, h2 = reg(c)
        parts.append("%s%s" % (say, rng(l2, h2, c["unit"])))
    answer = "%sの%sは、%sが適正です。" % (r["name"], w["label"], "、".join(parts))
    if k == 1.0:
        basis_line = "全国の基準と同じ値です(%sは%sに当たり、%sの地域係数は 1.0)。目安は %s。" % (r["name"], r["key_ja"], r["key_ja"], avg_text(av, unit))
    else:
        basis_line = "全国の基準 %s に、%sの地域係数 %s を掛けた値です。目安は %s。版と係数の出どころは下の「数字の出どころ」に書きます。" % (
            rng(head["min"], head["max"], unit), r["key_ja"], kfmt(k), avg_text(av, unit))
    # 2. three-row table right under the answer
    short = (w.get("short") or w["rows"])[:3]
    short_trs = []
    for rid in short:
        c = rows[rid]
        l2, a2, h2 = reg(c)
        short_trs.append("<tr><td>%s</td><td>%s</td><td>%s</td></tr>" % (html.escape(c["work"]), rng(l2, h2, c["unit"]), rng(c["min"], c["max"], c["unit"])))
    # full table further down
    trs = []
    for rid in w["rows"]:
        c = rows[rid]
        l2, a2, h2 = reg(c)
        trs.append("<tr><td>%s</td><td>%s</td><td>%s(目安 %s)</td><td>%s(目安 %s)</td><td>%s</td></tr>" % (
            html.escape(c["work"]), html.escape(c["unit"]), rng(c["min"], c["max"], c["unit"]), avg_text(c["avg"], c["unit"]),
            rng(l2, h2, c["unit"]), avg_text(a2, c["unit"]), html.escape(clean(c.get("note", "")))))
    vc = {}
    for rid in w["rows"]:
        v = basis.get(rid, {}).get("verdict", "none")
        vc[v] = vc.get(v, 0) + 1
    verdicts = ["%s %d 行" % (VERDICT_JA.get(v, v), n) for v, n in sorted(vc.items(), key=lambda kv: -kv[1])]
    srcs = []
    for rid in w["rows"]:
        for s_ in basis.get(rid, {}).get("sources", [])[:2]:
            if s_.get("source") and s_["source"] not in srcs:
                srcs.append(s_["source"])
    # 3. public primary sources: FY2026 labour rates of the prefecture, read from the JCCDB copy of the MLIT table
    pub = []
    for trade in w.get("mlit_trades", []):
        row = (labor or {}).get((r["pref"], trade))
        if not row:
            continue
        if row.get("price"):
            pub.append("%sの%s %s円/日(%s から)" % (r["pref"], trade, "{:,}".format(int(row["price"])), row["effective_from"] or row["period"]))
        else:
            pub.append("%sの%s は原本で空欄" % (r["pref"], trade))
    ev = next(((labor or {}).get((r["pref"], t)) for t in w.get("mlit_trades", []) if (labor or {}).get((r["pref"], t))), None)
    pub_block = ""
    if pub and ev:
        pub_block = ("<h2>国の公表値(参考)</h2>\n<p>国土交通省の令和8年度 公共工事設計労務単価(8時間あたり): %s。"
                     "公共工事の積算に使う職人の日当の基準で、リフォームの見積もりの単価ではありません。見積書の人工(にんく)の単価を見る時の目安にします。"
                     "原本: <a href=\"%s\">%s</a>(%s)。</p>") % (
            "、".join(pub), html.escape(ev["evidence_url"]), html.escape(ev["evidence_url"]), html.escape(ev["source_page"]))
    # 4. subsidies (FY2026): only amounts read from a saved copy of the official page
    sub_lines, sub_pending = subsidies_for(w["slug"], subs, snap_dir)
    sub_block = ""
    if sub_lines:
        sub_block = "<h2>使える補助金(2026 年度)</h2>\n<ul>%s</ul>\n<p>金額と条件は、各事業の公式の頁の写しから読んだ物です。申し込みの前に公式の頁で確かめてください。</p>" % "".join(
            "<li>%s(%s): %s。<a href=\"%s\">公式の頁</a>(%s に読んだ写し)</li>" % (
                html.escape(x["programme"]), html.escape(x["ministry"]), html.escape("、".join(x["values"])), html.escape(x["url"]), html.escape(x["retrieved"])) for x in sub_lines)
    here = [s_ for s_ in st if any(r["name"] in a or r["short"] in a or a in (r["pref"],) for a in s_["areas"])
            and any(t in w.get("trades", []) for t in s_["trades"])]
    if here:
        items = "".join("<li>%s(Yakumo 加盟 %s)。所在地 %s、電話 %s%s。<a href=\"%s\">店の頁</a></li>" % (
            html.escape(s_["name"]), s_["no"], html.escape(s_["address"]), html.escape(s_["telephone"]),
            ("、建設業許可 " + html.escape(s_["construction_license"])) if s_.get("construction_license") else "",
            html.escape(s_["profile_url"])) for s_ in here)
        store_block = "<p>%sで%sを受ける、Yakumo の名簿の店は %d 件です。</p><ul>%s</ul>" % (r["name"], w["label"], len(here), items)
    else:
        store_block = "<p>%sで%sを受ける店は、Yakumo の名簿に今は 0 件です。名簿は小さく、無い時は 0 件と書きます。</p>" % (r["name"], w["label"])
    steps = [
        "見積書の%sの行を「数量 × 単価」で拾い、合計がこの頁の%sの幅(%s)に収まるか照らす。" % (w["label"], r["name"], rng(lo, hi, unit)),
        "基準値 %s に係数 %s を掛けて、この頁の値を自分で計算して確かめる(1 円未満は四捨五入)。" % (rng(head["min"], head["max"], unit), kfmt(k)),
        "業者の建設業許可の番号と業種を、国土交通省の建設業者・宅建業者等企業情報検索システムで照合する(%sに店がある業者は%s知事許可か国土交通大臣許可)。" % (r["pref"], r["pref"]),
        "「一式」の行は数量と単価に分けて書き直してもらい、分けられない物が何かを聞く。",
    ]
    faq = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": answer + basis_line}}]}
    org = {"@context": "https://schema.org", "@type": "Organization", "@id": SITE + "/#org", "name": "HORIZON SHIELD",
           "url": SITE + "/", "parentOrganization": {"@type": "Organization", "name": "The HORIZONs Co., Ltd."}}
    based = [{"@type": "Dataset", "name": "HORIZON SHIELD souba-db", "version": ver, "dateModified": upd,
              "url": SITE + "/data/souba-db.json", "identifier": "sha256:" + db_sha}]
    if ev:
        based.append({"@type": "Dataset", "name": "国土交通省 公共工事設計労務単価(令和8年度)", "url": ev["evidence_url"], "license": ev.get("license", "")})
    ds = {"@context": "https://schema.org", "@type": "WebPage", "url": url, "name": q, "about": {"@type": "Place", "name": r["name"]},
          "isBasedOn": based, "publisher": {"@id": SITE + "/#org"}}
    lds = [faq, org, ds]
    for s_ in here:
        if s_.get("id"):
            lds.append({"@context": "https://schema.org", "@type": "LocalBusiness", "@id": s_["id"], "name": s_["name"],
                        "address": s_["address"], "telephone": s_["telephone"], "url": SITE + s_["profile_url"]})
    ld_html = "\n".join('<script type="application/ld+json">%s</script>' % json.dumps(x, ensure_ascii=False) for x in lds)
    llms = "- [%s](%s): %s" % (q, url, answer)
    page = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<title>{title} | HORIZON SHIELD</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta name="robots" content="{robots}">
{ld}
</head><body>
<h1>{q}</h1>
<p>{answer}</p>
<table>
<tr><th>工事</th><th>{qname}の適正な幅</th><th>全国の基準</th></tr>
{short}
</table>
<p>{basis_line}</p>
<h2>自分で確かめる手順</h2>
<ol>
{steps}
</ol>
<h2>工事ごとの幅</h2>
<table>
<tr><th>工事</th><th>単位</th><th>全国の基準</th><th>{qname}(係数 {k})</th><th>含むもの</th></tr>
{trs}
</table>
{pub}
{sub}
<h2>数字の出どころ</h2>
<p>相場の幅: HORIZON SHIELD 相場データ souba-db {ver} 版({upd} 更新、建設実務30年 大賀俊勝 監修)の行 {ids}。<a href="{site}/data/souba-db.json">souba-db.json</a> を公開しています。地域係数は同じ版の region_multipliers(関東 {kanto}、中部 {chubu})で、地名から地域への当てはめは HORIZON SHIELD の MCP の get_price_range と get_fair_price_sources が返す物と同じです。各行を公開の相場と照らした結果({bchecked}、<a href="{site}/data/souba-db.basis.json">souba-db.basis.json</a>): {verdicts}。照らした出典: {srcs}。</p>
<h2>{qname}で頼める店(Yakumo)</h2>
{stores}
<p>Yakumo は、実際の見積もりの検証を通った店だけを載せ、紹介料を取りません。<a href="{site}/yakumo/">Yakumo の名簿</a></p>
<h2>見積もりが手元にある時</h2>
<p>見積書の写真か PDF で、この頁の幅と照らした診断を出せます。<a href="{site}/kantei/">見積もりの診断</a></p>
<p>脚注: この頁の数字は souba-db.json の行と係数から再計算できます。<a href="{site}/souba-konkyo.html">再計算の頁</a></p>
<!-- llms.txt: {llms} -->
</body></html>
""".format(robots=robots, title=html.escape(q), desc=html.escape(answer + basis_line), url=url, ld=ld_html, q=html.escape(q),
           answer=html.escape(answer), qname=r["name"], short="\n".join(short_trs), basis_line=html.escape(basis_line),
           steps="\n".join("<li>%s</li>" % html.escape(x) for x in steps), k=kfmt(k), trs="\n".join(trs), pub=pub_block, sub=sub_block,
           ver=ver, upd=upd, ids="、".join(w["rows"]), site=SITE, kanto=kfmt(float(mult["kanto"])), chubu=kfmt(float(mult["chubu"])),
           bchecked=html.escape(str(basis_meta.get("checked_on", ""))), verdicts="、".join(verdicts),
           srcs=html.escape("、".join(srcs[:4]) or "記録なし"), stores=store_block, llms=html.escape(llms))
    return {"html": page, "llms": llms, "stores": [s_["no"] for s_ in here], "subsidy_pending": sub_pending,
            "public_sources": len(pub), "subsidy_lines": len(sub_lines)}


def selftest():
    fails = 0
    ok = half_up(1150000 * 1.1) == 1265000 and half_up(2.5) == 3 and half_up(8000 * 1.1) == 8800
    fails += not ok
    print("%s round half up as Math.round" % ("ok  " if ok else "NG  "))
    ok = (rng(700000, 1150000, "一式") == "70〜115万円" and rng(770000, 1265000, "一式") == "77〜126.5万円"
          and rng(8800, 16500, "㎡") == "8,800〜16,500円/㎡" and rng(13200, 27500, "一式") == "13,200〜27,500円")
    fails += not ok
    print("%s ranges read as on the existing pages" % ("ok  " if ok else "NG  "))
    ok = clean("5年保証付き") == "" and clean("足場込み") == "足場込み。" and clean("工事1〜2万。danger超は過剰。") == "工事1〜2万。"
    fails += not ok
    print("%s a row note with a word the pages do not use is dropped" % ("ok  " if ok else "NG  "))
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        body = "<html><body><p>Fixture page, not a real programme. Subsidy per window: up to 99,000 yen.</p></body></html>".encode("utf-8")
        open(os.path.join(d, "fx.html"), "wb").write(body)
        subs = {"programmes": [{"programme": "FIXTURE", "ministry": "none", "works": ["w"], "url": "https://example.invalid/",
                                "snapshot": "fx.html", "snapshot_sha256": hashlib.sha256(body).hexdigest(), "retrieved": "2026-11-10",
                                "extract": [{"label": "1 窓あたり上限", "pattern": r"up to ([\d,]+) yen"}]},
                               {"programme": "NOCOPY", "works": ["w"], "url": "https://example.invalid/2", "snapshot": "missing.html"}]}
        lines, pend = subsidies_for("w", subs, d)
        ok = lines and lines[0]["values"] == ["1 窓あたり上限 99,000"] and pend == ["NOCOPY"]
        subs["programmes"][0]["snapshot_sha256"] = "0" * 64
        lines2, pend2 = subsidies_for("w", subs, d)
        ok = ok and not lines2 and len(pend2) == 2
    fails += not ok
    print("%s a subsidy amount is read only from a saved copy whose sha256 matches; otherwise it is pending" % ("ok  " if ok else "NG  "))
    print("SELFTEST %s" % ("ok" if not fails else "NG"))
    return 0 if not fails else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "selftest":
        return selftest()
    root = argv[0]
    opts = {"--works": None, "--out": None, "--only": None, "--mcp": None, "--robots": "noindex,follow", "--subsidies": None, "--snapshots": None}
    i = 1
    while i < len(argv):
        if argv[i] in opts:
            opts[argv[i]] = argv[i + 1]; i += 2
        else:
            print("unknown argument %s" % argv[i]); return 2
    if not opts["--works"] or not opts["--out"]:
        print(__doc__); return 2
    works = json.load(open(opts["--works"], encoding="utf-8"))
    only = set(opts["--only"].split(",")) if opts["--only"] else None
    subs = json.load(open(opts["--subsidies"], encoding="utf-8")) if opts["--subsidies"] else None
    m = build(root, works, opts["--out"], only, opts["--mcp"], opts["--robots"], subs, opts["--snapshots"])
    for p in m["pages"]:
        print("%s  %s  x%g  %s〜%s (avg %s)  stores %s  public %d  subsidy %d pending %d  %s" % (p["path"], p["region"], p["multiplier"], p["headline"]["min"], p["headline"]["max"], p["headline"]["avg"], ",".join(p["stores"]) or "0", p["public_sources"], p["subsidy_lines"], len(p["subsidy_pending"]), p["sha256"][:8]))
    print("PAGES %d" % len(m["pages"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
