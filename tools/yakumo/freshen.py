#!/usr/bin/env python3
"""中身を変えた頁の更新日を、本当に変えた日に合わせる(2026-11-06 番人)。
なぜ: 答えのエンジンは新しい日付の頁を選ぶ(SIGIR 2026 "What Gets Cited": 新しい日付は 6 モデルすべてで最大級の効き)。
  ところが一番引かれている aeo/外壁塗装-適正価格.html の dateModified は 2026-07-04 のままで、sitemap の lastmod も 7 月や 10 月だった。
決まり: 渡された頁だけを触る(中身を変えていない頁の日付は動かさない)。JSON-LD の dateModified を書き換え、sitemap の lastmod を合わせる。
使い方: python3 tools/yakumo/freshen.py <日付 YYYY-MM-DD> <頁の一覧の file> [--apply]"""
import io, json, os, re, sys, urllib.parse
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://shield.the-horizons-innovation.com"
day, listf = sys.argv[1], sys.argv[2]; apply = "--apply" in sys.argv
assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", day)
paths = [l.strip() for l in io.open(listf, encoding="utf-8") if l.strip().endswith(".html")]
urls, nld = set(), 0
for p in paths:
    f = os.path.join(ROOT, p); t = io.open(f, encoding="utf-8").read()
    def fix(m):
        global nld
        body = re.sub(r'("dateModified"\s*:\s*)"[^"]*"', lambda x: x.group(1) + '"%s"' % day, m.group(2))
        if body != m.group(2): nld += 1
        try: json.loads(body)
        except ValueError: return m.group(0)
        return m.group(1) + body + m.group(3)
    n = re.sub(r'(<script type="application/ld\+json">)(.*?)(</script>)', fix, t, flags=re.S)
    if apply and n != t: io.open(f, "w", encoding="utf-8").write(n)
    u = SITE + "/" + (p[:-len("index.html")] if p.endswith("/index.html") else p)
    urls.add(u); urls.add(SITE + "/" + urllib.parse.quote(u[len(SITE) + 1:]))
nsm = 0
for sm in ("sitemap.xml", "sitemap-archive.xml", "sitemap-yakumo.xml"):
    f = os.path.join(ROOT, sm); t = io.open(f, encoding="utf-8").read()
    def lm(m):
        global nsm
        if m.group(2) in urls:
            nsm += 1
            return re.sub(r"<lastmod>[^<]*</lastmod>", "<lastmod>%s</lastmod>" % day, m.group(0))
        return m.group(0)
    n = re.sub(r"(<url>\s*<loc>)([^<]+)(</loc>.*?</url>)", lm, t, flags=re.S)
    if apply and n != t: io.open(f, "w", encoding="utf-8").write(n)
print("頁 %d 本、JSON-LD の dateModified を直した頁 %d、sitemap の lastmod %d 件%s" % (len(paths), nld, nsm, "(書き換えた)" if apply else "(見るだけ)"))
