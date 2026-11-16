# -*- coding: utf-8 -*-
"""
/yakumo/souba/ の答えの頁を、同じ型にそろえる(2026-11-06。既にある頁の揃えは 2026-11-16)。

  1. 既にある工事 x 地域の頁(yakumo/souba/<工種>-<地域>/)に、generate.py の geo_answer と answer_block を当てる。
     変えるのは題名、og:title、description、h1、冒頭の答えの段(印 yakumo-answer-v1 で囲む)だけ。
     それ以外(canonical、加盟店の欄、本文、JSON-LD)は触らない。
     generate.ANSWER_HOLD の頁(題名に対照群の問いの語が入る 2 頁)は、2026-12-11 の後まで揃えない。
     generate.ANSWER_SKIP の頁(愛知県の頁と中身が重なる長久手市の 3 頁)は、日付に依らず揃えない。
     地域の表示に番地が入っていた頁(生成の時の profile の area が住所だった)は、地域のスラッグの名に直す。
     相場データに行の無い工事(窓ごとの交換、住宅の内装、網戸)は金額を書かず、行が無いとだけ書く。
  2. tools/yakumo/souba_questions.json の問いから、店の盤の答えの頁を作る(generate.question_page)。
     数は souba-db の行 x 地域係数だけ。行の無い問いには金額を書かない。
  3. 新しい頁を sitemap-yakumo.xml に足す。既にある URL の行は触らない。
  4. data/yakumo-content-manifest.json(重複ゼロ台帳)の指紋を差し替える。別の頁と重複する頁は書かない。

何度当てても同じ bytes になる(印の中を差し替える)。

使い方:
  python3 tools/yakumo/souba_answers.py                   見るだけ(どの頁がどう変わるか)
  python3 tools/yakumo/souba_answers.py --apply [--date YYYY-MM-DD]
  その後 python3 tools/pagecheck/validate.py --paths <変わった頁> で門に通す
"""
import argparse, datetime, html as _html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate as G  # noqa: E402

QUESTIONS = os.path.join(HERE, "souba_questions.json")
OPEN, CLOSE = "<!-- yakumo-answer-v1 -->", "<!-- /yakumo-answer-v1 -->"
ANSWER_RE = re.compile(re.escape(OPEN) + r".*?" + re.escape(CLOSE) + r"\n?", re.S)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
OLD_TITLE_RE = re.compile(r"^(.+?)の(.+?)｜適正価格を第三者検証で確かめる")
NEW_TITLE_RE = re.compile(r"^(.+?)で(.+?)の費用の相場はいくら？")
H1_RE = re.compile(r'<h1><span class="speakable">.*?</span></h1>', re.S)
STORE_RE = re.compile(re.escape(G.BASE) + r'/yakumo/(no\d{3})/">加盟No\.\d{3}')


def display_of(slug, table):
    for k, v in table.items():
        if v == slug:
            return k
    return None


def question_slugs():
    q = json.load(open(QUESTIONS, encoding="utf-8"))
    return {p["slug"] for s in q["stores"] for p in s["pages"]}


def align(path, html):
    """既にある工事 x 地域の頁 1 枚。(新しい html, 地域, 工種, 店) を返す。読めない頁は ValueError。"""
    slug = os.path.basename(os.path.dirname(path))
    t = _html.unescape(TITLE_RE.search(html).group(1))
    m = OLD_TITLE_RE.match(t) or NEW_TITLE_RE.match(t)
    if not m:
        raise ValueError("題名から地域と工種を読めない: " + t[:60])
    old_area, trade = m.group(1), m.group(2)
    ts = G.slugify(trade, "trade")
    if not slug.startswith(ts + "-"):
        raise ValueError("工種の名(%s)とフォルダ(%s)が合わない" % (trade, slug))
    area = old_area
    if re.search(r"\d", old_area):
        # 番地まで入った地域名は、地域のスラッグの名に直す(愛知県長久手戸田谷... -> 愛知県)
        area = display_of(slug[len(ts) + 1:], G.AREA_SLUG)
        if not area:
            raise ValueError("地域のスラッグの名が無い: " + slug)
        html = html.replace(old_area, area)
    sm = STORE_RE.search(html)
    if not sm:
        raise ValueError("店のカードが無い: " + slug)
    ms = sm.group(1)
    q_title, h1, lead, fig, gap = G.geo_answer(trade, area)
    title = "%s｜Yakumo | HORIZON SHIELD" % q_title
    desc = G.clean_dashes("%s Yakumoは紹介料を取らない中立モール。" % lead)
    html = TITLE_RE.sub(lambda _m: "<title>%s</title>" % G.esc(title), html, count=1)
    html = re.sub(r'<meta property="og:title" content="[^"]*">', lambda _m: '<meta property="og:title" content="%s">' % G.esc(title), html, count=1)
    html = re.sub(r'<meta name="description" content="[^"]*">', lambda _m: '<meta name="description" content="%s">' % G.esc(desc), html, count=1)
    if not H1_RE.search(html):
        raise ValueError("h1 が無い: " + slug)
    html = H1_RE.sub(lambda _m: '<h1><span class="speakable">%s</span></h1>' % h1, html, count=1)
    block = G.answer_block(lead, fig, ms, gap)
    if OPEN in html:
        html = ANSWER_RE.sub(lambda _m: block, html, count=1)
    else:
        i = html.find('<div class="breadcrumb">')
        if i < 0:
            raise ValueError("breadcrumb が無い: " + slug)
        html = html[:i] + block + html[i:]
    return html, area, trade, ms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--date", default=datetime.date.today().strftime("%Y-%m-%d"), help="sitemap に足す行の lastmod")
    a = ap.parse_args()
    root = G.REPO_ROOT
    out = []   # (relpath, canonical, html, member, new?)
    qs = question_slugs()
    base_dir = os.path.join(root, "yakumo", "souba")
    for slug in sorted(os.listdir(base_dir)):
        p = os.path.join(base_dir, slug, "index.html")
        if slug in G.ANSWER_SKIP and os.path.isfile(p):
            print("%-6s %-45s 揃えない(generate.ANSWER_SKIP。愛知県の頁と中身が重なる)" % ("SKIP", slug))
            continue
        if slug in G.ANSWER_HOLD and os.path.isfile(p):
            print("%-6s %-45s 揃えるのは 2026-12-11 の後(generate.ANSWER_HOLD)" % ("HOLD", slug))
            continue
        if slug in qs or not os.path.isfile(p):
            continue
        old = open(p, encoding="utf-8").read()
        new, area, trade, ms = align(p, old)
        out.append(("yakumo/souba/%s/index.html" % slug, "%s/yakumo/souba/%s/" % (G.BASE, slug), new, ms, False, old != new))
        print("%-6s %-45s %s / %s / %s" % ("ALIGN" if old != new else "SAME", slug, area, trade, ms))
    q = json.load(open(QUESTIONS, encoding="utf-8"))
    for s in q["stores"]:
        rec = G.verification_record(s["member_slug"])
        if not rec:
            print("止めた: %s の検証の記録が無い" % s["member_slug"], file=sys.stderr)
            return 1
        profile = {"company": rec[0].get("name"), "member_no": rec[0].get("member_no")}
        for page in s["pages"]:
            canonical, h = G.question_page(profile, page, s["area"])
            rel = G.canonical_to_path(canonical)[len(root) + 1:]
            ex = os.path.join(root, rel)
            old = open(ex, encoding="utf-8").read() if os.path.exists(ex) else None
            out.append((rel, canonical, h, s["member_slug"], old is None, old != h))
            print("%-6s %-45s %s" % ("NEW" if old is None else ("UPDATE" if old != h else "SAME"), page["slug"], page["question"]))
    if not a.apply:
        print("見るだけ。--apply で書く。")
        return 0
    ledger = G.ledger_load()
    known = list(ledger.get("entries", []))
    for rel, canonical, h, ms, is_new, changed in out:
        fp = G.fingerprint(canonical, h, member=ms)
        why, hit = G.duplicate_of(fp, known)
        if why and not (why.startswith("slug:") and hit and hit.get("m") in (None, ms)):
            print("止めた: %s は %s と重複(%s)。何も書いていない。" % (rel, hit.get("slug") if hit else "?", why), file=sys.stderr)
            return 1
        # 同じ slug の行はその場で差し替え、新しい頁は末尾に足す(台帳の並びを動かさない)
        idx = [i for i, e in enumerate(known) if e.get("slug") == fp["slug"]]
        if idx:
            known[idx[0]] = fp
        else:
            known.append(fp)
    for rel, canonical, h, ms, is_new, changed in out:
        if changed:
            os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
            open(os.path.join(root, rel), "w", encoding="utf-8").write(h)
    if any(c for *_x, c in out):
        ledger["entries"] = known[-5000:]
        ledger["updated_at"] = a.date + "T00:00:00Z"
        G.ledger_save(ledger)
    added = G.update_sitemap([c for _r, c, _h, _m, n, _c in out if n], a.date)
    print("WROTE %d page(s), SITEMAP +%d url(s)" % (sum(1 for *_x, c in out if c), added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
