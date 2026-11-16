# -*- coding: utf-8 -*-
"""
/yakumo/souba/ の答えの頁への入口を置く(2026-11-16)。

答えの頁(工事 x 地域、店の盤の問い)は、長久手市の 3 枚の外はサイトのどの頁からも link が無かった。
/yakumo/souba/ に一覧の頁が無く、店の頁も自分の地域の答えの頁に link していなかった。

  1. 一覧の頁 yakumo/souba/index.html を書く。載せるのは sitemap-yakumo.xml に在り、答えの印(yakumo-answer-v1)を持つ頁だけ。
     generate.ANSWER_HOLD(2026-12-11 の後まで揃えない頁)と generate.ANSWER_SKIP(揃えない頁)は載せない。
     地域(店の順)、工事の順に並べる。この頁は加盟店の面(yakumo/ の下、答えの頁の免除の外)なので金額を書かない。
     link の文字は各頁の問い(h1 の 1 行目)だけ。金額は各頁に、使った行と係数と一緒に在る。
  2. /yakumo/(yakumo/index.html)から一覧への link。
  3. 店の頁 yakumo/noNNN/index.html から、その店の答えの頁と一覧への link(検証の記録の節の前)。
  4. robots.txt に sitemap-yakumo.xml の行。llms.txt に一覧の節(Yakumo の節の前)。
  5. 一覧の頁の指紋を台帳 data/yakumo-content-manifest.json に、URL を sitemap-yakumo.xml に足す。

2 から 4 は印 yakumo-souba-index-v1 で囲み、2 回目以降は中身を差し替える。何度当てても同じ bytes になる(2 回目は 0 file)。
答えの頁と /souba/ の側の頁は触らない。

使い方:
  python3 tools/yakumo/souba_index.py                         見るだけ(どの file が変わるか)
  python3 tools/yakumo/souba_index.py --apply [--date YYYY-MM-DD]
  その後 python3 tools/pagecheck/validate.py --paths <変わった頁> で門に通す
"""
import argparse, datetime, html as _html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate as G  # noqa: E402
import souba_answers as SA  # noqa: E402

OPEN, CLOSE = "<!-- yakumo-souba-index-v1 -->", "<!-- /yakumo-souba-index-v1 -->"
BLOCK_RE = re.compile(r"[ \t]*" + re.escape(OPEN) + r".*?" + re.escape(CLOSE) + r"(?:\n\n|\n)?", re.S)
INDEX_REL = "yakumo/souba/index.html"
INDEX_URL = G.BASE + "/yakumo/souba/"
SITEMAP_LINE = "Sitemap: %s/sitemap-yakumo.xml" % G.BASE
LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
# 店の頁の差し込み先: 「検証の記録」の節の頭(字下げは店の頁に合わせる)
STORE_ANCHOR_RE = re.compile(r'^([ \t]*)<div class="sec">[ \t]*\n[ \t]*<h2>検証の記録</h2>', re.M)
MALL_ANCHORS = ("<!-- === 内部リンク補強", "<!-- Cloudflare Web Analytics", "</body>")
LLMS_ANCHOR = "## Yakumo (verified contractor mall)"
# 店の盤の問いの頁は題名に工事が無い。スラッグの頭の工種で並べ、当たらない物は「そのほかの問い」
TRADE_OF_SLUG = {}
for _k, _v in G.TRADE_SLUG.items():
    TRADE_OF_SLUG.setdefault(_v, _k)
OTHER = "そのほかの問い"


def rd(rel):
    p = os.path.join(G.REPO_ROOT, rel)
    return open(p, encoding="utf-8").read() if os.path.exists(p) else None


def has_money(s):
    return any(r.search(s) for r in G.MONEY_SUB_PATTERNS)


def trade_of(slug):
    # 頭の語で当て、当たらなければ中の語で当てる(amiiri-glass-bouhan -> ガラス)。長い工種を先に取る
    for pick in (lambda ts: slug.startswith(ts + "-"), lambda ts: ("-%s-" % ts) in ("-%s-" % slug)):
        best = ""
        for ts in TRADE_OF_SLUG:
            if pick(ts) and len(ts) > len(best):
                best = ts
        if best:
            return TRADE_OF_SLUG[best]
    return OTHER


def answer_pages():
    """一覧に載せる答えの頁。[{slug, url, q, area, trade, ms}]。読めない頁は ValueError(何も書かない)。"""
    locs = set(LOC_RE.findall(rd("sitemap-yakumo.xml") or ""))
    qa = {}
    for s in json.load(open(SA.QUESTIONS, encoding="utf-8"))["stores"]:
        for p in s["pages"]:
            qa[p["slug"]] = s["area"]
    out = []
    base = os.path.join(G.REPO_ROOT, "yakumo", "souba")
    for slug in sorted(os.listdir(base)):
        rel = "yakumo/souba/%s/index.html" % slug
        url = "%s/yakumo/souba/%s/" % (G.BASE, slug)
        if slug in G.ANSWER_HOLD or slug in G.ANSWER_SKIP or url not in locs or not os.path.isfile(os.path.join(G.REPO_ROOT, rel)):
            continue
        h = rd(rel)
        if SA.OPEN not in h:
            continue
        m = SA.H1_RE.search(h)
        sm = SA.STORE_RE.search(h)
        if not m or not sm:
            raise ValueError("h1 か店の link が無い: " + slug)
        inner = re.sub(r'^<h1><span class="speakable">|</span></h1>$', "", m.group(0))
        q = _html.unescape(re.sub(r"<[^>]+>", "", re.split(r"<br\s*/?>", inner)[0])).strip()
        if not q or has_money(q):
            raise ValueError("問いの文が空か、金額を含む: " + slug)
        t = SA.NEW_TITLE_RE.match(_html.unescape(SA.TITLE_RE.search(h).group(1)))
        if t:
            area, trade = t.group(1), t.group(2)
        elif slug in qa:
            area, trade = qa[slug], trade_of(slug)
        else:
            raise ValueError("地域と工事を読めない: " + slug)
        out.append({"slug": slug, "url": url, "q": q, "area": area, "trade": trade, "ms": sm.group(1)})
    return out


def stores(pages):
    """店の順(no001, no002, ...)に [(ms, member_no, name, [area...])]"""
    out = []
    for ms in sorted({p["ms"] for p in pages}):
        rec = G.verification_record(ms)
        if not rec:
            raise ValueError("検証の記録が無い: " + ms)
        areas = []
        for p in pages:
            if p["ms"] == ms and p["area"] not in areas:
                areas.append(p["area"])
        out.append((ms, rec[0].get("member_no"), rec[0].get("name"), areas))
    return out


def ordered(pages, ms, area):
    rows = [p for p in pages if p["ms"] == ms and p["area"] == area]
    return sorted(rows, key=lambda p: (p["trade"] == OTHER, p["trade"], p["slug"]))


def index_page(pages):
    title = "地域と工事で探す、相場と見積もりの答え｜Yakumo | HORIZON SHIELD"
    desc = G.clean_dashes("Yakumo の検証済み加盟店が受け持つ地域と工事ごとに、HORIZON SHIELD が相場データ(souba-db)の行から書いた答えの頁の一覧。"
                          "金額は各頁に、使った行と地域係数と一緒に載せています。Yakumoは紹介料を取らない中立モール。")
    st = stores(pages)
    items = []
    for ms, _no, _nm, areas in st:
        for area in areas:
            items += ordered(pages, ms, area)
    list_ld = {"@context": "https://schema.org", "@type": "CollectionPage", "@id": INDEX_URL + "#list", "name": "地域と工事で探す、相場と見積もりの答え",
               "url": INDEX_URL, "inLanguage": "ja",
               "mainEntity": {"@type": "ItemList", "numberOfItems": len(items), "itemListElement": [
                   {"@type": "ListItem", "position": i + 1, "url": p["url"], "name": p["q"]} for i, p in enumerate(items)]}}
    crumb_ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "HORIZON SHIELD", "item": G.BASE + "/"},
        {"@type": "ListItem", "position": 2, "name": "Yakumo", "item": G.BASE + "/yakumo/"},
        {"@type": "ListItem", "position": 3, "name": "相場と見積もりの答え", "item": INDEX_URL}]}
    body = G.header_html()
    body += '<div class="hero"><div class="container">'
    body += '<h1><span class="speakable">地域と工事で探す、相場と見積もりの答え</span></h1>'
    body += '<p class="subtitle">Yakumo の検証済み加盟店が受け持つ地域の、工事ごとの答えの頁</p>'
    body += '<span class="badge">建設実務30年 監修 ｜ 金額は各頁に、使った行と一緒に</span></div></div>'
    body += '<div class="container">'
    body += '<div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; 相場と見積もりの答え</div>' % G.BASE
    body += '<div class="section"><p class="speakable">それぞれの頁は、HORIZON SHIELD が相場データ(souba-db)の行に地域係数を掛けて書いた答えです。'
    body += '金額は各頁に、使った行と係数と一緒に載せています。相場データに行の無い工事には、金額を書いていません。</p>'
    body += '<p class="note">この一覧に載るのは、検証を通った加盟店の地域の頁だけです。HORIZON SHIELD は加盟店から紹介料を受け取っていません。</p></div>'
    for ms, no, name, areas in st:
        for area in areas:
            body += '<div class="section"><h2>%s</h2>' % G.esc(area)
            body += ('<p class="note">この地域の加盟店: <a href="%s/yakumo/%s/">加盟%s %s</a></p><ul class="tip-list">'
                     % (G.BASE, G.esc(ms), G.esc(no), G.esc(name)))
            for p in ordered(pages, ms, area):
                body += '<li><span class="tg">%s</span> <a href="%s">%s</a></li>' % (G.esc(p["trade"]), G.esc(p["url"]), G.esc(p["q"]))
            body += '</ul></div>'
    body += G.source_block()
    body += '</div>'
    body += G.recirc_and_mesh("yakumo-souba-index")
    body += G.cta_and_footer()
    return G.head(title, desc, INDEX_URL, [list_ld, crumb_ld, G.org_person_graph(INDEX_URL)]) + body


def put_block(text, block, anchors, label):
    """印の塊を差し替える。無ければ anchors の最初に当たった所の前に置く。"""
    if OPEN in text:
        return BLOCK_RE.sub(lambda _m: block, text, count=1)
    for a in anchors:
        i = text.find(a)
        if i >= 0:
            return text[:i] + block + text[i:]
    raise ValueError("差し込む所が無い: " + label)


def mall_block():
    return (OPEN + '\n'
            '<section style="max-width:960px;margin:40px auto 0;padding:22px 20px;background:#fbfaf8;border-top:1px solid #e6e2db;">\n'
            '<h2 style="font-size:1.05rem;color:#243b53;margin:0 0 10px;">地域と工事で探す、相場と見積もりの答え</h2>\n'
            '<p style="margin:0;font-size:.9rem;line-height:1.7;">加盟店の地域の工事ごとに、相場データ(souba-db)の行から書いた答えの頁を並べています。'
            '<a href="%s" style="color:#1E6B43;text-decoration:none;">答えの頁の一覧 →</a></p>\n'
            '</section>\n' % INDEX_URL + CLOSE + '\n\n')


def store_block(pages, ms, indent):
    rows = []
    for area in [a for m, _n, _c, areas in stores(pages) if m == ms for a in areas]:
        rows += ordered(pages, ms, area)
    i2 = indent + "  "
    b = indent + OPEN + "\n" + indent + '<div class="sec">\n'
    b += i2 + '<h2>この地域の相場と見積もりの答え</h2>\n'
    b += (i2 + '<p style="color:var(--ink-dim);font-size:14px;">HORIZON SHIELD が相場データ(souba-db)の行から書いた答えの頁です。'
          '金額は各頁に、使った行と地域係数と一緒に載せています。この店が書いた文ではありません。</p>\n')
    b += i2 + '<ul class="checklist">\n'
    for p in rows:
        b += i2 + '<li><a href="%s">%s</a></li>\n' % (G.esc(p["url"]), G.esc(p["q"]))
    b += i2 + '</ul>\n'
    b += i2 + '<p style="color:var(--ink-dim);font-size:13px;"><a href="%s">地域と工事で探す、答えの頁の一覧</a></p>\n' % INDEX_URL
    b += indent + '</div>\n' + indent + CLOSE + "\n\n"
    return b


def put_store(text, block_for_indent):
    if OPEN in text:
        m = re.search(r"^([ \t]*)" + re.escape(OPEN), text, re.M)
        return BLOCK_RE.sub(lambda _m: block_for_indent(m.group(1)), text, count=1)
    m = STORE_ANCHOR_RE.search(text)
    if not m:
        raise ValueError("店の頁に「検証の記録」の節が無い")
    return text[:m.start()] + block_for_indent(m.group(1)) + text[m.start():]


def llms_block(pages):
    b = OPEN + "\n## Yakumo answer pages (/yakumo/souba/)\n\n"
    b += ("- [地域と工事で探す、相場と見積もりの答え](%s): Index of the answer pages for the areas and trades of the verified Yakumo stores. "
          "Each page answers one question; amounts on a page come only from souba-db rows times the regional multiplier, and the rows are named on the page. "
          "A trade with no souba-db row shows no amount.\n" % INDEX_URL)
    for ms, no, name, areas in stores(pages):
        for area in areas:
            for p in ordered(pages, ms, area):
                b += "- [%s](%s): %s, %s. Store: %s %s (%s/yakumo/%s/).\n" % (p["q"], p["url"], area, p["trade"], no, name, G.BASE, ms)
    return b + CLOSE + "\n\n"


def put_llms(text, block):
    if OPEN in text:
        return BLOCK_RE.sub(lambda _m: block, text, count=1)
    i = text.find(LLMS_ANCHOR)
    if i < 0:
        raise ValueError("llms.txt に Yakumo の節が無い")
    return text[:i] + block + text[i:]


def put_robots(text):
    if SITEMAP_LINE in text.splitlines():
        return text
    lines = text.rstrip("\n").split("\n")
    last = max([i for i, l in enumerate(lines) if l.startswith("Sitemap: ")] or [len(lines) - 1])
    lines.insert(last + 1, SITEMAP_LINE)
    return "\n".join(lines) + "\n"


def put_sitemap(text, date):
    if "<loc>%s</loc>" % INDEX_URL in text:
        return text
    if "</urlset>" not in text:
        raise ValueError("sitemap-yakumo.xml に </urlset> が無い")
    row = '  <url><loc>%s</loc><lastmod>%s</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n' % (INDEX_URL, date)
    return text.replace("</urlset>", row + "</urlset>", 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--date", default=datetime.date.today().strftime("%Y-%m-%d"), help="sitemap に足す行の lastmod")
    a = ap.parse_args()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", a.date):
        print("止めた: --date は YYYY-MM-DD", file=sys.stderr)
        return 2
    try:
        pages = answer_pages()
        if not pages:
            print("止めた: 一覧に載せる答えの頁が 0", file=sys.stderr)
            return 1
        idx = index_page(pages)
        if has_money(re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", idx, flags=re.S))):
            print("止めた: 一覧の頁に金額の形が在る", file=sys.stderr)
            return 1
        new = {INDEX_REL: idx}
        new["yakumo/index.html"] = put_block(rd("yakumo/index.html"), mall_block(), MALL_ANCHORS, "yakumo/index.html")
        for ms, _no, _nm, _areas in stores(pages):
            rel = "yakumo/%s/index.html" % ms
            new[rel] = put_store(rd(rel), lambda ind, ms=ms: store_block(pages, ms, ind))
        new["robots.txt"] = put_robots(rd("robots.txt"))
        new["llms.txt"] = put_llms(rd("llms.txt"), llms_block(pages))
        new["sitemap-yakumo.xml"] = put_sitemap(rd("sitemap-yakumo.xml"), a.date)
    except ValueError as e:
        print("止めた: %s。何も書いていない。" % e, file=sys.stderr)
        return 1
    for p in pages:
        print("%-6s %-45s %s / %s / %s" % ("LIST", p["slug"], p["area"], p["trade"], p["ms"]))
    for s in sorted(G.ANSWER_HOLD | G.ANSWER_SKIP):
        print("%-6s %-45s 載せない(generate.ANSWER_HOLD か ANSWER_SKIP)" % ("SKIP", s))
    ledger = G.ledger_load()
    known = list(ledger.get("entries", []))
    fp = G.fingerprint(INDEX_URL, idx)
    why, hit = G.duplicate_of(fp, [e for e in known if e.get("slug") != fp["slug"]])
    if why:
        print("止めた: %s は %s と重複(%s)。何も書いていない。" % (INDEX_REL, hit.get("slug") if hit else "?", why), file=sys.stderr)
        return 1
    old_fp = [e for e in known if e.get("slug") == fp["slug"]]
    led_changed = not old_fp or old_fp[0] != fp
    changed = sorted(r for r, t in new.items() if rd(r) != t)
    for r in changed:
        print("%-6s %s" % ("NEW" if rd(r) is None else "UPDATE", r))
    if led_changed:
        print("%-6s %s" % ("LEDGER", "data/yakumo-content-manifest.json(%s の指紋)" % fp["slug"]))
    if not a.apply:
        print("見るだけ。--apply で書く。")
        return 0
    for r in changed:
        p = os.path.join(G.REPO_ROOT, r)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w", encoding="utf-8").write(new[r])
    if led_changed:
        idxs = [i for i, e in enumerate(known) if e.get("slug") == fp["slug"]]
        if idxs:
            known[idxs[0]] = fp
        else:
            known.append(fp)
        ledger["entries"] = known
        G.ledger_save(ledger)
    print("WROTE %d file(s), LEDGER +%d" % (len(changed) + (1 if led_changed else 0), 1 if led_changed else 0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
