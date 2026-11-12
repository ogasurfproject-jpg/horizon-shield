# -*- coding: utf-8 -*-
"""
/yakumo/souba/ の答えの頁の型を確かめる(2026-11-06)。網に出ない。リポジトリの頁と data/souba-db.json だけを読む。

  python3 tools/yakumo/souba_answers_test.py

見ること(答えの頁ごと。答えの頁は印 yakumo-answer-v1 を持つ頁。盤の問いの頁は全部が答えの頁):
  1. 題名と h1 が同じ問いの語で始まる。行のある頁は題名に数がある
  2. 冒頭の段落(class="answer")が 100 字以内で、結論と出どころ(souba-db の版と地域の係数)を持つ
  3. KIRA の検証の記録への 1 行があり、書いた sha256 が yakumo/<店>/verification-record.json の bytes と同じ
  4. 店への 1 行に紹介料を受け取らない開示がある
  5. 宣言した行(data-souba-rows)の min / avg / max x 地域係数(floor(x + 0.5))が、¥1,320,000 / 1,320,000円 / 132万円 の
     どれかの形で全部載っている(店の証人の kit と同じ数え方)。宣言した行が tools/yakumo/generate.py の表と同じ
  6. souba_answers.py をもう一度当てても bytes が変わらない(写しの上で確かめる)
  7. 代わりの値を載せない(2026-11-06 の決め): 相場データに行の無い工事(窓ごとの交換、住宅の内装、網戸)と、
     その行が無い問い(網入りガラスの防犯、窓の交換の見積もり。souba_questions.json に在る時)は、生成器の表でも頁でも金額 0
  8. 自動公開の地域の名: profile の area が番地入りの住所でも、工事 x 地域の頁の題名と本文に住所を出さない。URL は変わらない
"""
import glob, hashlib, html as _html, json, math, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import generate as G  # noqa: E402

results = []


def chk(name, ok, detail=""):
    results.append(bool(ok))
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)[:300]))


def printed(n, page):
    forms = ["¥{:,}".format(n), "{:,}円".format(n)]
    if n >= 10000 and n % 1000 == 0:
        forms.append("{:g}万円".format(n / 10000))
    return any(re.search(r"(?<![0-9,.])" + re.escape(f), page) for f in forms)


def main():
    db = json.load(open(os.path.join(ROOT, "data", "souba-db.json"), encoding="utf-8"))
    by_id = {c["id"]: c for c in db["categories"]}
    mults = db["_meta"]["region_multipliers"]
    qs = json.load(open(os.path.join(HERE, "souba_questions.json"), encoding="utf-8"))
    qrows = {p["slug"]: p["rows"] for s in qs["stores"] for p in s["pages"]}
    pages = []
    for p in sorted(glob.glob(os.path.join(ROOT, "yakumo", "souba", "*", "index.html"))):
        slug = os.path.basename(os.path.dirname(p))
        h = open(p, encoding="utf-8").read()
        if "<!-- yakumo-answer-v1 -->" in h:
            pages.append((p, slug, h))
        else:
            chk("%s 答えの型でない頁は盤の問いの頁でない" % slug, slug not in qrows)
    chk("盤の問いの頁が全部ある(%d)" % len(qrows), set(qrows) <= {s for _p, s, _h in pages}, sorted(set(qrows) - {s for _p, s, _h in pages}))
    n_fig = 0
    for p, slug, h in pages:
        title = _html.unescape(re.search(r"<title>(.*?)</title>", h, re.S).group(1))
        h1 = _html.unescape(re.sub(r"<br>", " ", re.search(r'<h1><span class="speakable">(.*?)</span></h1>', h, re.S).group(1)))
        chk("%s 1 題名と h1 が同じ問い" % slug, title.startswith(h1), (title, h1))
        lead = _html.unescape(re.sub(r"<[^>]+>", "", re.search(r'<p class="answer speakable">(.*?)</p>', h, re.S).group(1)))
        decl = re.search(r'data-souba-db="([^"]*)" data-souba-region="([^"]*)" data-souba-rows="([^"]*)"', h)
        if decl:
            chk("%s 2 冒頭 100 字以内に結論と出どころ" % slug, len(lead) <= 100 and ("souba-db " + decl.group(1)) in lead and "の係数" in lead, (len(lead), lead))
            chk("%s 1 題名に数" % slug, re.search(r"[¥\d]", h1.split("？")[-1]) is not None, title)
        else:
            sec = _html.unescape(re.sub(r"<[^>]+>", "", re.search(r"<!-- yakumo-answer-v1 -->(.*?)<!-- /yakumo-answer-v1 -->", h, re.S).group(1)))
            chk("%s 2 行の無い頁は数を書かず、そう言う" % slug, len(lead) <= 100 and "相場データ" in sec and re.search(r"行が無い|まだ無い|まだありません", sec)
                and not re.search(r"¥|￥|\d円|万円|&#165;", h), lead)
        rec = re.search(r'/yakumo/(no\d{3})/verification-record\.json">verification-record\.json</a> sha256 <code>([0-9a-f]{64})</code>', h)
        rb = open(os.path.join(ROOT, "yakumo", rec.group(1), "verification-record.json"), "rb").read() if rec else b""
        chk("%s 3 KIRA の記録の sha256 が記録の bytes と同じ" % slug, bool(rec) and hashlib.sha256(rb).hexdigest() == rec.group(2))
        chk("%s 4 店への 1 行と紹介料なしの開示" % slug, re.search(r'class="store-line">この地域の加盟店: <a href="[^"]+/yakumo/no\d{3}/">加盟No\.\d{3} [^<]+</a>。HORIZON SHIELD はこの店から紹介料を受け取っていません。', h))
        if decl:
            ver, region, rows = decl.group(1), decl.group(2), decl.group(3).split(",")
            want = qrows.get(slug) or G.SOUBA_ROWS.get(slug.rsplit("-", 1)[0], {}).get("rows")
            chk("%s 5 宣言した行が生成器の表と同じ" % slug, rows == want, (rows, want))
            missing = []
            for i in rows:
                for k in ("min", "avg", "max"):
                    n = int(math.floor(by_id[i][k] * mults[region] + 0.5))
                    if not printed(n, h):
                        missing.append("%s.%s=%d" % (i, k, n))
            n_fig += 3 * len(rows)
            chk("%s 5 行 %d x 3 の値が全部載っている(版 %s、%s x %s)" % (slug, len(rows), ver, region, mults[region]), not missing and ver == db["_meta"]["version"], missing)
    # 7 代わりの値を載せない
    for t in ("mado-koukan", "naiso", "amido-harikae"):
        chk("7 生成器の表: %s は行 0(別の工事の行を代わりに載せない)" % t, G.SOUBA_ROWS[t]["rows"] == [] and G.SOUBA_ROWS[t]["title"] == [], G.SOUBA_ROWS[t]["rows"])
    for qs_ in ("amiiri-glass-bouhan-hiratsuka", "mado-koukan-mitsumori-hiratsuka"):
        if qs_ not in qrows:
            continue   # まだ souba_questions.json に無い問いは、頁も無い(上の「盤の問いの頁が全部ある」で照らす)
        hh = dict((s_, h_) for _p, s_, h_ in pages).get(qs_, "")
        chk("7 盤の問い: %s は行 0 で、頁に金額も宣言も無い" % qs_, qrows.get(qs_) == [] and hh and "data-souba-db" not in hh and not re.search(r"¥|￥|\d円|万円|&#165;", hh))
    # 8 自動公開の地域の名(No.001 の profile の area は番地入りの住所だった)
    for a, want_a, want_s in (("愛知県長久手戸田谷1405", "愛知県", "aichi"), ("愛知県長久手市", "愛知県長久手市", "nagakute"), ("平塚市", "平塚市", "hiratsuka"),
                              ("長久手市戸田谷１４０５", "長久手市", "nagakute")):
        d = G.display_area(a)
        chk("8 地域の名 %s -> %s(URL の %s は同じ)" % (a, want_a, want_s), d == want_a and G.slugify(d, "area") == G.slugify(a, "area") == want_s, d)
    prof = {"company": "試験の工務店", "member_no": "No.001", "industry": "construction", "area": "愛知県長久手戸田谷1405",
            "areas_served": ["愛知県", "長久手市"], "works": ["外壁塗装", "屋根", "内装", "クロス"]}
    geo = [(c, h_) for t_, c, h_ in G.plan_pages(prof, {}) if t_ == "geo"]
    want_urls = ["%s/yakumo/souba/%s/" % (G.BASE, x) for x in ("gaiheki-tosou-aichi", "yane-aichi", "naiso-aichi", "cloth-aichi")]
    chk("8 番地入りの profile から作る工事 x 地域の頁は今の 4 頁と同じ URL", [c for c, _h in geo] == want_urls, [c for c, _h in geo])
    chk("8 その 4 頁の題名と本文に住所(戸田谷、1405)が無く、題名は「愛知県」で始まる",
        geo and all("戸田谷" not in h_ and "1405" not in h_ and re.search(r"<title>愛知県(の|で)", h_) for _c, h_ in geo))
    # 6 もう一度当てても同じ bytes(写しの上で)
    tmp = tempfile.mkdtemp(prefix="souba_answers_test_")
    try:
        for rel in ("tools", "yakumo", "data", "sitemap-yakumo.xml"):
            s, d = os.path.join(ROOT, rel), os.path.join(tmp, rel)
            (shutil.copytree if os.path.isdir(s) else shutil.copy)(s, d)
        before = {f: open(f, "rb").read() for f in glob.glob(os.path.join(tmp, "yakumo", "souba", "*", "index.html")) + [os.path.join(tmp, "sitemap-yakumo.xml")]}
        r = subprocess.run([sys.executable, "-I", "-B", os.path.join(tmp, "tools", "yakumo", "souba_answers.py"), "--apply", "--date", "2026-11-06"],
                           capture_output=True, text=True)
        after = {f: open(f, "rb").read() for f in before}
        chk("6 もう一度当てても頁と sitemap の bytes が同じ", r.returncode == 0 and before == after, r.stdout[-300:] + r.stderr[-300:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n頁 %d、照らした値 %d、確かめ %d / 失敗 %d" % (len(pages), n_fig, len(results), results.count(False)))
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
