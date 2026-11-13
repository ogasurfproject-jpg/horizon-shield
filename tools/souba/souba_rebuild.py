#!/usr/bin/env python3
"""souba_rebuild.py: one generator for every /souba/ page: the answer sentence first, sources and dates from the data.

    souba_rebuild.py <repo_root> [--write] [--only slug,...] [--exclude pages.json] [--subsidies f.json --snapshots DIR]
                     [--old f.json ...] [--report out.json] [--woven path/to/woven_check.py | --no-woven] [--move-cta]
    Pages are written with --write --published YYYY-MM-DD, and --fix-only or --only-manifest m.json (--subsidies, --woven)
    souba_rebuild.py selftest

What it does to each souba/<slug>/index.html, from the published data only (no number is typed by hand):
 1. Stamps: the souba-db version and date stamps and the averages the tables leave out, as souba_restamp.py does.
 2. Head: one sentence right after the h1, in the /souba/cloth/ form:
      「{工事}は、{単位}{下限}〜{上限}円、{よくある広さ}で{下限}〜{上限}円が適正です。」
    The rows are the souba-db rows the page already shows (the first ranges after the h1 that equal a row), else the rows
    of the page it forwards to (canonical), else the page whose slug it extends. A page whose rows cannot be found is
    reported and left without a head (never guessed).
 3. Preamble: a paragraph between the h1 and the first h2 that starts with この相場は or 最終更新 moves into the source
    section (the 最終更新 date is replaced by the data's date; 監修 stays).
 4. Source section (data-gen="souba-sources-v1"), before the store box, the first offer box or the end of the body:
    the souba-db version, date and rows; the update date; up to 3 public primary sources from the JCCDB copy in the repo
    (FY2026 MLIT design labour rates for the trades of the work, the MLIT construction cost deflator, the MLIT
    renovation survey), each with its URL and said to be reference figures the range was not computed from; the
    FY2026 subsidies of the work, only when read from a saved official page (gen_region_pages.subsidies_for).
 5. Dates: every dateModified in JSON-LD becomes _meta.updated_at; a page without one gets a WebPage item that has it.
 6. Machine parts of the page type when missing: FAQPage (h1 and the head sentence), Organization, three steps,
    and the llms.txt line as a comment. With --woven, woven_check itself says which are missing (steps, Organization).
 7. With --move-cta only: the reverse-estimate and EHN boxes (data-cta) move from under the first table to after the
    source section. Off by default.
v2 (2026-11-10): --published YYYY-MM-DD is required to write: dateModified and the page's own update date become the day
the page changes; the data's date (souba-db _meta.updated_at) is stated apart in the source section. Sentences that
state a subsidy amount with no official link nearby lose the amount (every mode; the amount is replaced by
所定の額, the sentence stays). --fix-only writes only the corrections
that go to every page whatever the draw (stamps, table averages, unlinked subsidy amounts). --only-manifest takes the
pages to rebuild from a souba_split.py manifest ("first"). The five national pages bath, kyutoki, shiroari, gaiheki and
yane get a 47-prefecture table (region multiplier, FY2026 MLIT labour rate of the trade with its URL, observation rows).
Writes only with --write. Standard library only; sends nothing.
"""
import csv
import glob
import hashlib
import html
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import souba_drift_check as chk  # noqa: E402
import souba_restamp as rs  # noqa: E402
import gen_region_pages as gen  # noqa: E402

SITE = "https://shield.the-horizons-innovation.com"
MARK_HEAD = 'data-gen="souba-head-v1"'
MARK_SRC = 'data-gen="souba-sources-v1"'
UNIT_WORDS = {"㎡": "㎡", "坪": "坪", "m": "1m", "1箇所": "1か所", "1台": "1台", "台": "1台", "枚": "1枚"}
SIZE = re.compile(r"(\d+(?:\.\d+)?\s*(?:畳|坪|号|㎡|L|台|か所|箇所|m|本|枚|K|LDK)|[0-9]+×[0-9]+)")
# souba-db cat -> trades in the MLIT design labour rate table (public works; shown as reference only)
TRADES = {
    "外壁塗装": ["塗装工", "とび工"], "屋根工事": ["板金工", "屋根ふき工"], "防水工事": ["防水工"], "足場": ["とび工"],
    "内装仕上げ": ["内装工", "大工"], "内装": ["内装工", "大工"], "フローリング": ["大工", "内装工"], "店舗内装": ["内装工", "大工"],
    "マンションリノベ": ["内装工", "大工"], "戸建てリノベ": ["大工", "内装工"], "新築": ["大工"], "商業・大規模": ["内装工", "大工"],
    "キッチン": ["配管工", "内装工"], "バスルーム": ["配管工", "内装工"], "トイレ": ["配管工"], "給湯器": ["配管工", "電工"],
    "水道工事": ["配管工"], "電気工事": ["電工"], "IHクッキングヒーター": ["電工"], "設備機器": ["設備機械工", "電工"],
    "外構・庭": ["ブロック工", "造園工"], "エクステリア": ["ブロック工"], "玄関ドア": ["サッシ工"], "内窓・二重窓": ["サッシ工", "ガラス工"],
    "面格子・防犯建材": ["サッシ工"], "解体工事": ["はつり工", "普通作業員"], "基礎工事": ["型わく工", "鉄筋工"], "断熱工事": ["保温工", "内装工"],
}
LEAD_LABEL = re.compile(r"(\s*\d[\d,]*\s*万円.*$|【.*?】|［.*?］|\[.*?\]|｜.*$|\|.*$|の(?:費用|相場|料金|値段|価格|適正価格|単価).*$|(?:費用|相場|料金|適正価格|単価)(?:・.*)?$|[?？].*$)")


def jp_label(h1, fallback):
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", h1 or ""))).strip()
    if re.search(r"[。？?]", t):
        # a question or a sentence as the h1 (シロアリ消毒で50万円。…): the work is the first clause before で+number, が, は
        c = re.split(r"[。？?]", t)[0]
        c = re.split(r"で\d|が|は|、|の見積", c)[0].strip("「」 ")
        return c if 2 <= len(c) <= 20 and not c.startswith("その") else fallback
    prev = None
    while prev != t:
        prev = t
        t = LEAD_LABEL.sub("", t).strip("・ 　")
    return t if 2 <= len(t) <= 24 else fallback


def size_word(work):
    m = SIZE.search(work or "")
    return m.group(1).replace(" ", "") if m else None


def part_unit(c):
    if c["min"] < 10000:
        return UNIT_WORDS.get(c["unit"], "") + "{:,}〜{:,}円".format(c["min"], c["max"])
    return UNIT_WORDS.get(c["unit"], "") + gen.rng(c["min"], c["max"], "一式")


def part_size(c):
    s = size_word(c["work"])
    return ("%sで" % s if s else "") + gen.rng(c["min"], c["max"], "一式")


def head_sentence(label, rows):
    unit_row = next((c for c in rows if c["unit"] != "一式"), None)
    size_row = next((c for c in rows if c["unit"] == "一式" and size_word(c["work"])), None) or next((c for c in rows if c["unit"] == "一式"), None)
    parts = []
    if unit_row:
        parts.append(part_unit(unit_row))
    if size_row and size_row is not unit_row:
        parts.append(part_size(size_row))
    if not parts:
        return None, []
    used = [c for c in (unit_row, size_row) if c]
    return "%sは、%sが適正です。" % (label, "、".join(parts)), used


CAT_WORDS = {
    "外壁塗装": "外壁|塗装", "屋根工事": "屋根|葺き|棟板金|雨漏", "防水工事": "防水|ベランダ|屋上", "足場": "足場",
    "内装仕上げ": "クロス|壁紙|内装|ガラス|畳|襖|障子", "内装": "クロス|壁紙|内装", "フローリング": "フローリング|床",
    "店舗内装": "店舗|カフェ|美容室|サロン|クリニック|飲食|内装", "マンションリノベ": "マンション|リノベ", "戸建てリノベ": "戸建|リノベ",
    "新築": "新築|注文住宅", "商業・大規模": "オフィス|商業|ビル|大規模", "キッチン": "キッチン|台所", "バスルーム": "浴室|風呂|ユニットバス|バス",
    "トイレ": "トイレ|便器|和式|洋式", "給湯器": "給湯|エコキュート|エコジョーズ|ボイラ", "水道工事": "水道|給水|排水|配管",
    "電気工事": "電気|分電盤|コンセント|エアコン", "IHクッキングヒーター": "IH|コンロ", "設備機器": "エアコン|食洗機|換気|設備|スマート|太陽光|蓄電",
    "外構・庭": "外構|庭|フェンス|ブロック|植栽|ウッドデッキ", "エクステリア": "カーポート|エクステリア|門", "玄関ドア": "玄関|ドア",
    "内窓・二重窓": "内窓|二重窓|窓", "面格子・防犯建材": "面格子|防犯", "解体工事": "解体", "基礎工事": "基礎", "断熱工事": "断熱",
    "シロアリ": "シロアリ|白蟻|防蟻", "床下工事": "床下", "特殊工事": "アスベスト|石綿|特殊", "サービス連携": "清掃|引越|整理|片付",
    "付帯工事": "付帯|雨樋|樋",
}


def row_words(c):
    return [w for w in re.split(r"[\s　()（）・、/×+＋]+", c.get("work", "")) if len(w) >= 2 and not re.match(r"^[\d,.]+", w)]


def page_rows(src, db):
    """souba-db rows the page shows, ranked: rows of the page's own work first (its words in the h1 and title),
    then by how early they appear after the h1. A range that equals rows of several works counts for each."""
    m = re.search(r"</h1>", src, re.I)
    rest = src[m.end():] if m else src
    hm = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
    tm = re.search(r"<title>(.*?)</title>", src, re.S | re.I)
    head_txt = chk.text_of((hm.group(1) if hm else "") + " " + (tm.group(1) if tm else ""))
    rest = re.sub(r"<script.*?</script>|<style.*?</style>", " ", rest, flags=re.S | re.I)
    txt = chk.text_of(rest)
    found = {}
    for r in chk.ranges_in(txt):
        for c in db.match(r["lo"], r["hi"]):
            f = found.setdefault(c["id"], {"row": c, "first": r["start"], "n": 0})
            f["n"] += 1
    for cells_t in re.findall(r"<table.*?</table>", rest, re.S | re.I):
        for cells in chk.table_rows(cells_t):
            vals = []
            for cc in cells:
                mm = chk.YEN_CELL.match(cc.replace(" ", ""))
                if mm:
                    vals.append(chk.to_yen(chk.num(mm.group(1)), mm.group(2) or "円"))
            if len(vals) >= 2:
                for c in db.match(vals[0], vals[-1]):
                    f = found.setdefault(c["id"], {"row": c, "first": 10 ** 8, "n": 0})
                    f["n"] += 1
    if not found:
        return []
    def cat_hit(cat):
        pat = CAT_WORDS.get(cat)
        return bool(pat and re.search(pat, head_txt))
    cat_score = {}
    for f in found.values():
        c = f["row"]
        cat_score[c["cat"]] = cat_score.get(c["cat"], 0) + f["n"] + (10 if cat_hit(c["cat"]) else 0)
    def key(f):
        c = f["row"]
        own = any(w in head_txt for w in row_words(c))
        return (-cat_score[c["cat"]], 0 if own else 1, f["first"])
    ranked = sorted(found.values(), key=key)
    top = ranked[0]["row"]["cat"]
    if not cat_hit(top) and not any(w in head_txt for w in row_words(ranked[0]["row"])):
        # the rows on the page are not the page's own work (a range that happens to equal another row): not used
        return []
    return [f["row"] for f in ranked if f["row"]["cat"] == top]


def canonical_slug(src):
    m = re.search(r'<link[^>]+rel="canonical"[^>]+href="https?://[^/]+/souba/([^/"]+)/"', src)
    return m.group(1) if m else None


def labour_table(root):
    path = os.path.join(root, "data", "jccdb-obs-v2", "observations", "jp", "labor_mlit_roumu_r8.csv")
    out = {}
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("geo_level") == "pref" and row.get("price"):
                out.setdefault(row["item_name"], []).append(row)
    return out


def deflator_latest(root):
    path = os.path.join(root, "data", "jccdb-obs-v2", "observations", "jp", "index_mlit_deflator.csv")
    best = None
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("item_name") == "住宅総合" and re.match(r"^\d{4}-\d{2}$", row.get("period", "")) and row.get("price"):
                if best is None or row["period"] > best["period"]:
                    best = row
    return best


def reform_survey(root):
    path = os.path.join(root, "data", "jccdb-obs-v2", "observations", "jp", "spending_mlit_reform_fy2025.csv")
    with open(path, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if "住宅" in row.get("item_name", "") and "受注件数" in row.get("item_name", "") and row.get("spec", "").find("「住宅」") >= 0 and row.get("price"):
                return row
    return None


def public_sources(cat, labour, defl, survey):
    out = []
    trades = [t for t in TRADES.get(cat, []) if t in labour]
    if trades:
        bits = []
        url = None
        for t in trades[:2]:
            vals = [int(r["price"]) for r in labour[t]]
            url = labour[t][0]["evidence_url"]
            bits.append("%s %s〜%s円/日(%d 都道府県)" % (t, "{:,}".format(min(vals)), "{:,}".format(max(vals)), len(vals)))
        out.append(("国土交通省 令和8年度 公共工事設計労務単価(8時間あたり、2026年3月から)", "、".join(bits), url))
    if defl:
        out.append(("国土交通省 建設工事費デフレーター(2020年度=100)", "住宅総合 %s(%s)" % (defl["price"], defl["period"]), defl["evidence_url"]))
    if survey:
        out.append(("国土交通省 建築物リフォーム・リニューアル調査(令和7年度)", "住宅の受注 %s 件" % "{:,}".format(int(float(survey["price"]))), survey["evidence_url"]))
    return out[:3]


LABOUR_NOTE = "国土交通省の労務単価は公共工事の設計単価で、リフォームの見積単価ではありません。"


def labour_note(pubs):
    return ("<p>%s</p>" % LABOUR_NOTE) if any("労務単価" in n for n, v, u in pubs) else ""


def sources_block(ver, upd, rows, moved, pubs, sub_lines, label, published=None):
    pre = "".join("<p>%s</p>" % m for m in moved)
    pub = ""
    if pubs:
        pub = ("<p>公的な出典(参考。この頁の幅はこれらから計算していません。工事の手間や物価の動きを見る時の目安です):</p><ul>%s</ul>" %
               "".join("<li>%s: %s。<a href=\"%s\">%s</a></li>" % (html.escape(n), html.escape(v), html.escape(u), html.escape(u)) for n, v, u in pubs))
    sub = ""
    if sub_lines:
        sub = "<h3>使える補助金(2026 年度)</h3><ul>%s</ul>" % "".join(
            "<li>%s(%s): %s。<a href=\"%s\">公式の頁</a>(%s に読んだ写し)</li>" % (
                html.escape(x["programme"]), html.escape(x["ministry"]), html.escape("、".join(x["values"])), html.escape(x["url"]), html.escape(x["retrieved"])) for x in sub_lines)
    return ('<section class="hs-sources" %s>\n<h2>数字の出どころ</h2>\n'
            '<p>相場の幅: HORIZON SHIELD 相場データ souba-db %s(%s 更新、建設実務30年 大賀俊勝 監修)の行 %s。<a href="%s/data/souba-db.json">souba-db.json</a> で公開しています。データの版の日 %s。この頁の更新日 %s。</p>\n'
            '%s\n%s%s\n%s\n</section>\n') % (MARK_SRC, ver, upd, "、".join(c["id"] for c in rows), SITE, upd, published or upd, pre, pub, labour_note(pubs), sub)


STEPS = ["見積書の{w}の行を「数量 × 単価」で拾い、合計がこの頁の幅に収まるか照らす。",
         "業者の建設業許可の番号と業種を、国土交通省の建設業者・宅建業者等企業情報検索システムで照合する。",
         "「一式」の行は数量と単価に分けて書き直してもらい、分けられない物が何かを聞く。"]


def jsonld_items(src):
    out = []
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', src, re.S | re.I):
        try:
            j = json.loads(b)
        except ValueError:
            continue
        for it in (j if isinstance(j, list) else [j]):
            if isinstance(it, dict):
                out.append(it)
                out.extend(g for g in it.get("@graph", []) if isinstance(g, dict))
    return out


def types_of(src):
    t = set()
    for it in jsonld_items(src):
        x = it.get("@type")
        t.update(x if isinstance(x, list) else [x])
    return t


def page_dates(src, upd):
    """the page's own update dates in the body (最終更新: …, 監修 ｜ …更新/最新) become the data's date.
    Dates of other things (the roster check, a survey, a receipt) are not touched."""
    y, mo, d = upd.split("-")
    ja = "%s年%d月%d日" % (y, int(mo), int(d))
    src = re.sub(r"(最終更新日?[:：]\s*)20\d\d-\d\d-\d\d", lambda m: m.group(1) + upd, src)
    src = re.sub(r"(監修\s*[｜|]\s*)20\d\d年\d{1,2}月(?:\d{1,2}日)?(?:最新|更新)", lambda m: m.group(1) + ja + "更新", src)
    return src


def set_date_modified(src, upd):
    n = 0

    def rep(m):
        nonlocal n
        n += 1
        return m.group(1) + upd + m.group(3)
    src = re.sub(r'("dateModified"\s*:\s*")([^"]*)(")', rep, src)
    return src, n


def rebuild_page(src, slug, db, ctx):
    """returns (new_src, info). ctx: rows_by_slug, labour, defl, survey, subs, snaps, ver, upd"""
    info = {"slug": slug, "rows": [], "head": None, "moved": 0, "public": 0, "dm": 0, "skip": None}
    ver, upd = db.version, db.updated_at
    pub_day = ctx.get("published") or upd
    if MARK_HEAD in src or MARK_SRC in src:
        info["skip"] = "already rebuilt"
        return src, info
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
    if not m:
        info["skip"] = "no h1"
        return src, info
    rows = ctx["rows_by_slug"].get(slug) or []
    stub = bool(re.search(r'http-equiv="refresh"', src)) or "統合しました" in src[m.end():m.end() + 600]
    parent = canonical_slug(src)
    if (stub or not rows) and parent and parent != slug:
        rows = ctx["rows_by_slug"].get(parent) or rows
        info["from"] = parent
    if not rows:
        base = slug
        while "-" in base and not rows:
            base = base.rsplit("-", 1)[0]
            rows = ctx["rows_by_slug"].get(base) or []
        if rows:
            info["from"] = base
    if not rows:
        info["skip"] = "no souba-db row on the page or its parent (stamps and dateModified only)"
        return dates_only(src, slug, db, m, ctx), info
    plabel = ctx["labels"].get(info.get("from", slug)) if info.get("from") else None
    label = (plabel if stub and plabel else None) or jp_label(m.group(1), rows[0]["cat"])
    sent, used = head_sentence(label, rows)
    if not sent:
        info["skip"] = "rows give no range"
        return src, info
    if stub:
        sent = sent[:-1] + "(全国の値)。"
    info["rows"] = [c["id"] for c in used]
    info["head"] = sent
    info["label"] = label
    # 1. stamps
    src, _ = rs.restamp(src, db)
    findings = chk.check_page(src, db)
    src, _ = rs.add_table_avgs(src, db, findings)
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
    src, moved = move_preamble(src, m)
    info["moved"] = len(moved)
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
    # 2. head right after the h1
    head_html = '\n<p class="answer-first speakable" %s>%s</p>\n' % (MARK_HEAD, html.escape(sent))
    src = src[:m.end()] + head_html + src[m.end():]
    # 4. sources
    cat = rows[0]["cat"]
    pubs = public_sources(cat, ctx["labour"], ctx["defl"], ctx["survey"])
    info["public"] = len(pubs)
    work_slug = info.get("from", slug)
    sub_lines, _pending = gen.subsidies_for(work_slug, ctx["subs"], ctx["snaps"])
    block = sources_block(ver, upd, used or rows[:2], moved, pubs, sub_lines, label, pub_day)
    if slug in PREF_TABLE and not stub:
        block = pref_table_block(rows, used, label, ctx) + block
        info["pref_table"] = True
    src = place_block(src, m, block)
    src, info["subsidy_dropped"] = drop_unlinked_subsidy(src)

    # 5. dates: the day the page's content changes (the publishing day); the data's date stays in the source section
    src = page_dates(src, pub_day)
    src, n = set_date_modified(src, pub_day)
    info["dm"] = n
    q = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
    add = []
    t = types_of(src)
    if n == 0:
        add.append({"@context": "https://schema.org", "@type": "WebPage", "name": q, "url": "%s/souba/%s/" % (SITE, slug),
                    "dateModified": pub_day, "isBasedOn": {"@type": "Dataset", "name": "HORIZON SHIELD souba-db", "version": ver,
                                                       "url": SITE + "/data/souba-db.json"}})
    if "FAQPage" not in t and not stub:
        add.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": sent}}]})
    if "Organization" not in t:
        add.append({"@context": "https://schema.org", "@type": "Organization", "@id": SITE + "/#org", "name": "HORIZON SHIELD", "url": SITE + "/"})
    llms = "<!-- llms.txt: - [%s](%s/souba/%s/): %s -->\n" % (html.escape(q), SITE, slug, html.escape(sent))
    ins = "".join('<script type="application/ld+json">%s</script>\n' % json.dumps(x, ensure_ascii=False) for x in add)
    hd = re.search(r"</head>", src, re.I)
    if hd:
        src = src[:hd.start()] + ins + src[hd.start():]
    b = re.search(r"</body>", src, re.I)
    if b:
        src = src[:b.start()] + llms + src[b.start():]
    info["stub"] = stub
    return src, info


PREAMBLE = re.compile(r"^(この相場は|最終更新|建設実務\s*30\s*年\s*大賀俊勝\s*監修\s*[｜|])")


def move_preamble(src, m):
    """preamble paragraphs after the h1 (この相場は…, 最終更新…, 建設実務30年 大賀俊勝 監修 ｜ …更新) come out, returned as text;
    their own update dates are dropped (the source section states the data's date)"""
    moved = []

    def take(pm):
        t = chk.text_of(pm.group(0)).strip()
        if not PREAMBLE.search(t) or (not t.startswith("この相場は") and len(t) > 80):
            return pm.group(0)
        if not t.startswith("この相場は"):
            t = re.sub(r"(最終更新[:：]?\s*)?[0-9]{4}[-年/][0-9]{1,2}[-月/]?[0-9]{0,2}日?\s*(更新)?\s*[｜|]?\s*", "", t).strip(" ｜|")
        if t:
            moved.append(html.escape(t))
        return ""
    body = re.sub(r"<p\b[^>]*>.*?</p>", take, src[m.end():], flags=re.S | re.I)
    return src[:m.end()] + body, moved


def cat_from_h1(h1):
    t = chk.text_of(h1 or "")
    for cat, pat in CAT_WORDS.items():
        if re.search(pat, t):
            return cat
    return None


def place_block(src, m, block):
    for pat in (r'<section class="yakumo-partners"', r"<h2[^>]*>\s*(この相場を出しているのは誰か|この基準は誰が|相場を読む前に)", r"<footer\b", r"</main>", r"</body>"):
        a = re.search(pat, src[m.end():], re.I)
        if a:
            k = m.end() + a.start()
            return src[:k] + block + src[k:]
    return src + block


def dates_only(src, slug, db, m, ctx=None):
    """a page whose prices are not souba-db rows: stamps, dates, the preamble moved down, public sources if the work is known"""
    pub_day = (ctx or {}).get("published") or db.updated_at
    src, _ = rs.restamp(src, db)
    src, _n = drop_unlinked_subsidy(src)
    src = page_dates(src, pub_day)
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
    src, moved = move_preamble(src, m)
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
    cat = cat_from_h1(m.group(1))
    pubs = public_sources(cat, ctx["labour"], ctx["defl"], ctx["survey"]) if (ctx and cat) else []
    if moved or pubs:
        pre = "".join("<p>%s</p>" % x for x in moved)
        pub = ""
        if pubs:
            pub = ("<p>公的な出典(参考。この頁の数字はこれらから計算していません):</p><ul>%s</ul>" %
                   "".join("<li>%s: %s。<a href=\"%s\">%s</a></li>" % (html.escape(n), html.escape(v), html.escape(u), html.escape(u)) for n, v, u in pubs))
        block = ('<section class="hs-sources" %s>\n<h2>数字の出どころ</h2>\n%s\n%s%s\n<p>この頁の更新日 %s。souba-db %s の版の日 %s。</p>\n</section>\n') % (
            MARK_SRC, pre, pub, labour_note(pubs), pub_day, db.version, db.updated_at)
        src = place_block(src, m, block)
    src, n = set_date_modified(src, pub_day)
    if n == 0:
        q = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
        item = {"@context": "https://schema.org", "@type": "WebPage", "name": q, "url": "%s/souba/%s/" % (SITE, slug), "dateModified": pub_day}
        hd = re.search(r"</head>", src, re.I)
        if hd:
            src = src[:hd.start()] + '<script type="application/ld+json">%s</script>\n' % json.dumps(item, ensure_ascii=False) + src[hd.start():]
    return src


_KEY = r"(補助金?|補助額|助成金?|支援事業|推進事業|窓リノベ\d*|給湯省エネ\d*|エコ住宅\d*|DR補助金|V2H補助金)"
_AMT = r"(?:\d[\d,\.]*(?:\s*[〜~]\s*\d[\d,\.]*)?\s*万円(?:程度)?)"
# near the programme name any amount; a little further only an amount that starts with 最大
SUBSIDY_AMT = re.compile(_KEY + r"(?:([^。<>\"｜|]{0,12}?)((?:最大\s*)?" + _AMT + r")|([^。<>\"｜|]{13,30}?)(最大\s*" + _AMT + r"))")
OFFICIAL_LINK = re.compile(r'href="https?://[^"]*(go\.jp|window-renovation|kyutou|jutaku-shoene|mirai-eco|kosodate)[^"]*"')
NO_AMOUNT = "所定の額"


def drop_unlinked_subsidy(src):
    """a subsidy amount with no link to an official page nearby is taken out: only the amount (最大200万円, 30〜100万円) is
    replaced by 所定の額; the sentence, the tags and the JSON around stay as they are. The amount may be of
    another year; an amount reaches a page only from a saved copy of the official page (the subsidy section)."""
    out, last, n = [], 0, 0
    for m in SUBSIDY_AMT.finditer(src):
        if OFFICIAL_LINK.search(src[max(0, m.start() - 400):m.end() + 400]):
            continue
        g = 3 if m.group(3) else 5
        out.append(src[last:m.start(g)])
        out.append(NO_AMOUNT)
        last = m.end(g)
        n += 1
    out.append(src[last:])
    # a figure worked out from the removed amount goes too (補助金…で実質0〜50万円)
    return re.sub(NO_AMOUNT + r"で実質\s*" + _AMT, NO_AMOUNT, "".join(out)), n


def fix_page(src, slug, db, ctx):
    """only the corrections that go to every page, whatever the draw: stamps and table averages, unlinked subsidy amounts out;
    when that changes the page, its dates become the publishing day"""
    pub_day = ctx.get("published") or db.updated_at
    new, _ = rs.restamp(src, db)
    new, _ = rs.add_table_avgs(new, db, chk.check_page(new, db))
    new, k = drop_unlinked_subsidy(new)
    info = {"slug": slug, "fix": True, "subsidy_dropped": k}
    if new != src:
        new = page_dates(new, pub_day)
        new, n = set_date_modified(new, pub_day)
        if n == 0:
            m = re.search(r"<h1[^>]*>(.*?)</h1>", new, re.S | re.I)
            q = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else slug
            item = {"@context": "https://schema.org", "@type": "WebPage", "name": q, "url": "%s/souba/%s/" % (SITE, slug), "dateModified": pub_day}
            hd = re.search(r"</head>", new, re.I)
            if hd:
                new = new[:hd.start()] + '<script type="application/ld+json">%s</script>\n' % json.dumps(item, ensure_ascii=False) + new[hd.start():]
    return new, info


PREF_TABLE = {"bath", "kyutoki", "shiroari", "gaiheki", "yane"}
PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
         "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
         "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
         "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]
# prefecture -> region key, as hs-mcp mcp.js REGION_PREFS (checked by --mcp)
REGION_OF = {}
for _k, _ps in {"kanto": ["東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬"], "kinki": ["大阪", "京都", "兵庫", "奈良", "滋賀", "和歌山", "三重"],
                "chubu": ["愛知", "岐阜", "静岡", "長野", "山梨", "新潟", "富山", "石川", "福井"], "tohoku": ["青森", "岩手", "宮城", "秋田", "山形", "福島"],
                "other": ["北海道", "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"]}.items():
    for _p in _ps:
        REGION_OF[_p] = _k
REGION_JA = {"kanto": "関東", "kinki": "近畿", "chubu": "中部", "tohoku": "東北", "other": "その他"}


def region_key(pref):
    return next((REGION_OF[k] for k in REGION_OF if k in pref), None)


def labour_all(root):
    out = {}
    for f in sorted(glob.glob(os.path.join(root, "data", "jccdb-obs-v2", "observations", "jp", "labor_mlit_roumu_*.csv"))):
        with open(f, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row.get("geo_level") == "pref":
                    out.setdefault((row["geo_name"], row["item_name"]), []).append(row)
    return out


def pref_table_block(rows, used, label, ctx):
    """47 prefectures for a national page: the range with the region's multiplier, the difference from the national value,
    the FY2026 MLIT design labour rate of the work's trade in that prefecture, and how many observation rows JCCDB holds"""
    mult = ctx["mult"]
    row = next((c for c in (used or rows) if c["unit"] == "一式"), (used or rows)[0])
    trades = TRADES.get(row["cat"], [])
    la = ctx["labour_all"]
    trs = []
    for p in PREFS:
        k = region_key(p)
        f = float(mult[k])
        lo, hi = (int(math.floor(row[x] * f + 0.5)) for x in ("min", "max"))
        diff = int(round((f - 1) * 100))
        obs = [r for t in trades for r in la.get((p, t), []) if r.get("price")]
        latest = None
        for t in trades:
            cand = [r for r in la.get((p, t), []) if r.get("price") and r.get("period", "") >= "2026-03"]
            if cand:
                latest = cand[0]
                break
        if latest:
            lab = '%s %s円/日(<a href="%s">原本</a>)' % (html.escape(latest["item_name"]), "{:,}".format(int(latest["price"])), html.escape(latest["evidence_url"]))
            nobs = "%d 行" % len(obs)
        else:
            lab = "観測なし(全国の値と係数で出した)"
            nobs = "0 行"
        trs.append("<tr><td>%s</td><td>%s %s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
            p, REGION_JA[k], kfmt(f), man_range(lo, hi, row["unit"]), ("%+d%%" % diff) if diff else "0%", lab, nobs))
    return ('<section class="hs-pref-table" data-gen="souba-pref-table-v1">\n<h2>47 都道府県の%s(%s)</h2>\n'
            '<p>全国の基準 %s に、souba-db の地域係数(5 つの地域)を掛けた幅です。職種の日当は国土交通省の令和8年度 公共工事設計労務単価(参考)です。%s観測の行数は、その職種の都道府県の行が JCCDB に何行あるか(平成25年度から令和8年度)。観測の無い都道府県は「観測なし」と書き、全国の値と係数だけで出しています。</p>\n'
            '<table><tr><th>都道府県</th><th>地域と係数</th><th>適正な幅</th><th>全国との差</th><th>職種の日当</th><th>観測の行数</th></tr>\n%s\n</table>\n</section>\n') % (
        html.escape(label), html.escape(row["work"]), man_range(row["min"], row["max"], row["unit"]), LABOUR_NOTE, "\n".join(trs))


def man_range(lo, hi, unit):
    """both ends in one form: 万円 to two decimals when both are 10,000 or more, else yen with commas"""
    from decimal import Decimal
    per = {"㎡": "/㎡", "坪": "/坪", "m": "/m"}.get(unit)
    if per or lo < 10000:
        return "{:,}〜{:,}円{}".format(lo, hi, per or "")
    f = lambda v: format((Decimal(v) / Decimal(10000)).normalize(), "f")  # noqa: E731
    return "%s〜%s万円" % (f(lo), f(hi))


def kfmt(k):
    return ("%.1f" % k) if k == int(k) else ("%g" % k)


def woven_needs(src):
    """the woven checks a page lacks that the generator can add without touching prose"""
    need = set()
    body = chk.text_of(src)
    li = [chk.text_of(x) for x in re.findall(r"<li[^>]*>(.*?)</li>", src, re.S | re.I)]
    if sum(1 for x in li if re.search(r"(照らす|照合|拾う|分けて|聞く|確かめ|見比べ|計算|合計)", x)) < 3:
        need.add("W3")
    return need


def build_ctx(root, db, subs=None, snaps=None):
    rows_by_slug, labels = {}, {}
    for p in sorted(glob.glob(os.path.join(root, "souba", "*", "index.html"))):
        slug = os.path.basename(os.path.dirname(p))
        src = open(p, encoding="utf-8").read()
        r = page_rows(src, db)
        if r:
            rows_by_slug[slug] = r
        m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S | re.I)
        labels[slug] = jp_label(m.group(1) if m else "", r[0]["cat"] if r else "")
    return {"rows_by_slug": rows_by_slug, "labels": labels, "labour": labour_table(root), "defl": deflator_latest(root),
            "labour_all": labour_all(root), "mult": db.meta.get("region_multipliers", {}),
            "survey": reform_survey(root), "subs": subs, "snaps": snaps, "need": woven_needs}


def woven_fill(src, wc, label):
    """add the machine parts woven_check finds missing (steps, Organization); prose is not touched"""
    if wc is None or 'http-equiv="refresh"' in src:
        return src
    ng = {r["check"] for r in wc.check(src, "ja", "org") if not r["ok"]}
    if "W3_steps" in ng:
        steps = '<h3>自分で確かめる手順</h3>\n<ol>%s</ol>\n' % "".join("<li>%s</li>" % html.escape(x.format(w=label)) for x in STEPS)
        if MARK_SRC in src:
            k = src.index("</section>", src.index(MARK_SRC))
            src = src[:k] + steps + src[k:]
        else:
            m = re.search(r"<h1[^>]*>.*?</h1>", src, re.S | re.I)
            src = place_block(src, m, '<section class="hs-sources" %s>\n%s</section>\n' % (MARK_SRC, steps))
    if "W6_entity" in ng:
        item = {"@context": "https://schema.org", "@type": "Organization", "@id": SITE + "/#org", "name": "HORIZON SHIELD", "url": SITE + "/"}
        hd = re.search(r"</head>", src, re.I)
        if hd:
            src = src[:hd.start()] + '<script type="application/ld+json">%s</script>\n' % json.dumps(item, ensure_ascii=False) + src[hd.start():]
    return src


CTA = re.compile(r'\n?<div data-cta="(?:reverse-v1|ehn-v1)"[^>]*>.*?</a></div>', re.S)


def move_cta(src):
    """the reverse-estimate and EHN boxes (data-cta, under the first table) go after the answer: right after the source section"""
    if MARK_SRC not in src:
        return src
    boxes = CTA.findall(src)
    if not boxes:
        return src
    src = CTA.sub("", src)
    k = src.index("</section>", src.index(MARK_SRC)) + len("</section>")
    return src[:k] + "\n" + "\n".join(b.strip() for b in boxes) + src[k:]


def load_woven(path):
    if not path:
        return None
    import importlib.util
    spec = importlib.util.spec_from_file_location("woven_check", path)
    wc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wc)
    return wc


def run(root, write, only=None, exclude=(), subs=None, snaps=None, old=(), woven=None, cta=False, published=None, fix_only=False):
    db = chk.Db(json.load(open(os.path.join(root, "data", "souba-db.json"), encoding="utf-8")))
    for f in sorted(glob.glob(os.path.join(root, "data", "souba-db-*.json"))) + list(old):
        db.add_old(json.load(open(f, encoding="utf-8")))
    ctx = build_ctx(root, db, subs, snaps)
    ctx["published"] = published
    report = []
    for p in sorted(glob.glob(os.path.join(root, "souba", "*", "index.html"))):
        slug = os.path.basename(os.path.dirname(p))
        if only and slug not in only:
            continue
        if "/souba/%s/" % slug in exclude:
            report.append({"slug": slug, "skip": "held (registered experiment)"})
            continue
        src = open(p, encoding="utf-8").read()
        if fix_only:
            new, info = fix_page(src, slug, db, ctx)
            info["changed"] = new != src
            report.append(info)
            if write and new != src:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(new)
            continue
        new, info = rebuild_page(src, slug, db, ctx)
        if new != src:
            new = woven_fill(new, woven, info.get("label") or ctx["labels"].get(slug) or "工事")
            if cta:
                new = move_cta(new)
        info["changed"] = new != src
        report.append(info)
        if write and new != src:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(new)
    return report


def selftest():
    import tempfile
    fails = 0
    ok = (jp_label("クロス・壁紙張替えの費用・相場【2026年最新】", "x") == "クロス・壁紙張替え" and jp_label("<span>外壁塗装 30坪の相場はいくらか</span>", "x") == "外壁塗装 30坪"
          and jp_label("シロアリ消毒で50万円。薬の原価はいくらですか", "x") == "シロアリ消毒" and jp_label("その塗装の見積もり、金額はどこで膨らんでいるか。", "外壁塗装") == "外壁塗装")
    fails += not ok
    print("%s the work name comes from the h1" % ("ok  " if ok else "NG  "))
    rows = [{"id": "cloth_sqm", "work": "クロス張り替え 単価", "unit": "㎡", "min": 900, "avg": 1200, "max": 1600, "cat": "内装"},
            {"id": "cloth_6jo", "work": "クロス張り替え 6畳（全壁＋天井）", "unit": "一式", "min": 45000, "avg": 60000, "max": 80000, "cat": "内装"}]
    s, used = head_sentence("クロス・壁紙張替え", rows)
    ok = s == "クロス・壁紙張替えは、㎡900〜1,600円、6畳で4.5〜8万円が適正です。"
    fails += not ok
    print("%s the cloth sentence comes out of the rows (%s)" % ("ok  " if ok else "NG  ", s))
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "data", "jccdb-obs-v2", "observations", "jp"))
        jp = os.path.join(d, "data", "jccdb-obs-v2", "observations", "jp")
        open(os.path.join(jp, "labor_mlit_roumu_r8.csv"), "w", encoding="utf-8").write("geo_level,geo_name,item_name,price,evidence_url\npref,東京都,内装工,34400,https://www.mlit.go.jp/x.pdf\n")
        open(os.path.join(jp, "index_mlit_deflator.csv"), "w", encoding="utf-8").write("item_name,period,price,evidence_url\n住宅総合,2026-08,126.0,https://www.mlit.go.jp/d.xlsx\n")
        open(os.path.join(jp, "spending_mlit_reform_fy2025.csv"), "w", encoding="utf-8").write("item_name,spec,price,evidence_url\n")
        json.dump({"_meta": {"version": "2.3.0", "updated_at": "2026-10-18"}, "categories": rows}, open(os.path.join(d, "data", "souba-db.json"), "w"))
        for slug, body in (("cloth", '<html><head><script type="application/ld+json">{"@type":"Article","dateModified":"2026-11-06"}</script></head><body><h1>クロス・壁紙張替えの費用・相場</h1>'
                                     '<p>この相場は HORIZON SHIELD の相場データ souba-db(2.2.0、2026年8月17日更新)に基づきます。</p><table><tr><td>量産</td><td>900〜1,600円</td><td>4.5〜8万円</td></tr></table><h2>x</h2></body></html>'),
                           ("cloth-aichi", '<html><head><meta http-equiv="refresh" content="0;url=/souba/cloth/"><link rel="canonical" href="https://shield.the-horizons-innovation.com/souba/cloth/"></head><body><h1>愛知県のクロス相場</h1><p>愛知県のクロス相場は、全国版ページに統合しました。</p></body></html>')):
            os.makedirs(os.path.join(d, "souba", slug))
            open(os.path.join(d, "souba", slug, "index.html"), "w", encoding="utf-8").write(body)
        rep = run(d, True)
        a = open(os.path.join(d, "souba", "cloth", "index.html"), encoding="utf-8").read()
        b = open(os.path.join(d, "souba", "cloth-aichi", "index.html"), encoding="utf-8").read()
        first = re.search(r"</h1>\s*<p[^>]*>(.*?)</p>", a, re.S).group(1)
        ok = (first.startswith("クロス・壁紙張替えは、㎡900〜1,600円") and '"dateModified": "2026-10-18"' in a.replace('"dateModified":"', '"dateModified": "')
              and "souba-db(2.3.0、2026年10月18日更新)" in a and a.index("この相場は") > a.index(MARK_SRC) and "https://www.mlit.go.jp/x.pdf" in a
              and "llms.txt:" in a and "FAQPage" in a)
        fails += not ok
        print("%s a page: head first, preamble moved into the sources, version and dateModified from the data, public URL, FAQ, llms line" % ("ok  " if ok else "NG  "))
        ok = re.search(r"</h1>\s*<p[^>]*>クロス・壁紙張替えは、.*?\(全国の値\)。</p>", b) is not None and 'http-equiv="refresh"' in b
        fails += not ok
        print("%s a merged prefecture page gets the national sentence and keeps its forwarding" % ("ok  " if ok else "NG  "))
        again = run(d, True)
        ok = all(not r.get("changed") for r in again)
        fails += not ok
        print("%s a second run changes nothing" % ("ok  " if ok else "NG  "))
    t = page_dates("<span>建設実務30年 監修 ｜ 2026年4月最新</span><p>最終更新: 2026-07-08｜監修</p><p>名簿の確認日 2026年11月6日</p>", "2026-10-18")
    ok = t == "<span>建設実務30年 監修 ｜ 2026年10月18日更新</span><p>最終更新: 2026-10-18｜監修</p><p>名簿の確認日 2026年11月6日</p>"
    fails += not ok
    print("%s the page's own update dates follow the data, other dates stay" % ("ok  " if ok else "NG  "))
    t, k = drop_unlinked_subsidy("<title>内窓の費用と補助金｜1箇所4〜20万円</title><p>内窓は 1 か所 4〜10万円。先進的窓リノベ2024事業の補助金最大200万円。工期は 1 日。</p>"
                                 '<script>{"text":"給湯省エネ2026事業で最大12〜14万円の補助"}</script>')
    ok = (t == "<title>内窓の費用と補助金｜1箇所4〜20万円</title><p>内窓は 1 か所 4〜10万円。先進的窓リノベ2024事業の補助金所定の額。工期は 1 日。</p>"
          '<script>{"text":"給湯省エネ2026事業で所定の額の補助"}</script>') and k == 2
    t3, k3 = drop_unlinked_subsidy("<p>給湯省エネ事業(国の補助金)でエコキュートやエコジョーズへの交換に最大13万円。長期優良住宅化リフォーム推進事業(最大250万円)。補助金申請前に工事契約、外構一式計上で内訳不明の案件に100万円超。内窓 → 補助金最大200万円で実質0〜50万円</p>")
    ok = ok and k3 == 3 and t3 == "<p>給湯省エネ事業(国の補助金)でエコキュートやエコジョーズへの交換に所定の額。長期優良住宅化リフォーム推進事業(所定の額)。補助金申請前に工事契約、外構一式計上で内訳不明の案件に100万円超。内窓 → 補助金所定の額</p>"
    t2, k2 = drop_unlinked_subsidy('<p>給湯省エネ2026事業で最大13万円(<a href="https://kyutou-shoene2026.meti.go.jp/">公式</a>)。</p>')
    ok = ok and k2 == 0
    fails += not ok
    print("%s a subsidy amount with no official link nearby is replaced (a price range after ｜ is not); one with a link stays" % ("ok  " if ok else "NG  "))
    print("SELFTEST %s" % ("ok" if not fails else "NG"))
    return 0 if not fails else 1


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return 2
    if argv[0] == "selftest":
        return selftest()
    root = argv[0]
    arg = lambda k: argv[argv.index(k) + 1] if k in argv else None  # noqa: E731
    only = set(arg("--only").split(",")) if arg("--only") else None
    if arg("--only-manifest"):
        only = set(json.load(open(arg("--only-manifest"), encoding="utf-8"))["first"])
    pub = arg("--published")
    if pub and not re.fullmatch(r"20\d\d-\d\d-\d\d", pub):
        print("stop: --published must be YYYY-MM-DD"); return 2
    if "--write" in argv and not pub:
        print("stop: --write needs --published YYYY-MM-DD (the day the pages change; dateModified and the page's date become that day)")
        return 2
    exclude = set()
    if arg("--exclude"):
        for ps in (json.load(open(arg("--exclude"), encoding="utf-8")).get("experiments") or {}).values():
            exclude.update(ps)
    subs = json.load(open(arg("--subsidies"), encoding="utf-8")) if arg("--subsidies") else None
    old = [argv[i + 1] for i, a in enumerate(argv) if a == "--old"]
    if "--write" in argv and not arg("--woven") and "--no-woven" not in argv and "--fix-only" not in argv:
        print("stop: --write needs --woven path/to/woven_check.py (the steps and Organization it adds are part of the published diff); "
              "pass --no-woven to write without them on purpose")
        return 2
    rep = run(root, "--write" in argv, only, exclude, subs, arg("--snapshots"), old, load_woven(arg("--woven")), "--move-cta" in argv, pub, "--fix-only" in argv)
    ch = [r for r in rep if r.get("changed")]
    sk = [r for r in rep if r.get("skip")]
    for r in sk:
        print("skip  %s  %s" % (r["slug"], r["skip"]))
    print("SUMMARY pages %d, %s %d, skipped %d, heads %d, preambles moved %d, pages with public sources %d, dateModified set %d" % (
        len(rep), "rebuilt" if "--write" in argv else "would rebuild", len(ch), len(sk), sum(1 for r in rep if r.get("head")),
        sum(r.get("moved", 0) for r in rep), sum(1 for r in rep if r.get("public")), sum(1 for r in rep if r.get("changed"))))
    print("subsidy amounts replaced %d (pages %d), 47-prefecture tables %d" % (sum(r.get("subsidy_dropped") or 0 for r in rep),
          sum(1 for r in rep if r.get("subsidy_dropped")), sum(1 for r in rep if r.get("pref_table"))))
    if arg("--report"):
        json.dump(rep, open(arg("--report"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
