#!/usr/bin/env python3
"""HORIZON SHIELD の相場ページに、その工事を請け負う Yakumo の検証済み加盟店を書き入れる(2026-10-03 番人)。

なぜ: Bing の AI は HORIZON SHIELD の souba ページを毎日引いている(3 か月で 4 万回超)。そのページに加盟店の名前と
検証の事実が書いてあれば、AI が答えるときに加盟店の名前も一緒に読む。HORIZON SHIELD が書く、加盟店の言及になる。

決まり:
  - 名簿は Yakumo の公開 MCP(list_verified_stores)から生で読む。読めなければ何もしない(fail-closed)
  - 書くのは verified の店だけ。Yakumo は建設業だけの名簿なので、それ以外は元から返ってこない
  - souba/<slug>/index.html のうち、sitemap.xml(検索に出す本命の約 150 本)に載り robots が index のものだけ。
    同じ箱を数百ページに焼かない(8/8 の固有文面の約束)。--all で sitemap-archive.xml のページも対象にする。工事の種類はフォルダ名から決める
  - 店の工種に、そのページの工事が入っている店だけを書く。金額は書かない
  - 印 <!-- yakumo-partners-v1 --> で囲み、2 回目以降は中身を差し替える(店が増えれば増え、外れれば消える)
使い方:
  python3 tools/yakumo/partner_mentions.py           見るだけ(どのページに誰が入るか)
  python3 tools/yakumo/partner_mentions.py --apply   書き換える(その後 tools/pagecheck/validate.py --paths で確認)
"""
import glob, hashlib, html, io, json, os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MCP = "https://hearing.horizonshield.dev/mcp"
SITE = "https://shield.the-horizons-innovation.com"
OPEN, CLOSE = "<!-- yakumo-partners-v1 -->", "<!-- /yakumo-partners-v1 -->"

# フォルダ名の語 -> (見出しに出す工事名, 店の工種と突き合わせる語)
TOPICS = [
    ("gaiheki", "外壁塗装", ["外壁塗装"]), ("yane", "屋根工事", ["屋根"]), ("cloth", "クロス張り替え", ["クロス"]),
    ("flooring", "床・フローリング", ["床"]), ("unit-bath", "浴室リフォーム", ["浴室"]), ("bath", "浴室リフォーム", ["浴室"]),
    ("kitchen", "キッチンリフォーム", ["キッチン"]), ("toilet", "トイレリフォーム", ["トイレ"]), ("senmen", "洗面所リフォーム", ["洗面"]),
    ("gaikou", "外構工事", ["外構"]), ("naiso", "内装工事", ["内装"]), ("uchimado", "内窓の設置", ["窓"]), ("mado", "窓の工事", ["窓"]),
    ("genkan", "玄関ドアの工事", ["玄関"]), ("amido", "網戸の工事", ["網戸"]), ("glass", "ガラスの工事", ["ガラス"]),
]

# 名簿に入っているが、裏付けの無い工種。ここに入れた組み合わせでは、その店をそのページに書かない。
# 2026-11-06 番人: No.002 の works に「外壁塗装」が入っていたが、聞き取りの答え(窓・玄関の交換、ガラス修理、網戸張替え)にも、
#   公式サイト(mineotfc.com)にも無い。KIRA の抽出の例文(「外壁塗装、無機3回塗り10年保証」)が混ざった疑い。
#   名簿の側(hearing:hs-partner-002 の works)を直すまで、外壁塗装のページには書かない。直った後も残して害は無い。
HOLD = {("No.002", "外壁塗装"): "聞き取りにも公式サイトにも無い工種(2026-11-06)"}

def held(store, terms):
    return any((store.get("member_no"), t) in HOLD for t in terms)

# 2026-11-06 番人: aeo/ の工事別ページ。Bing の AI Performance(8/6〜11/3)で一番引かれているのは aeo/外壁塗装-適正価格.html(7.7K)で、
#   フローリング(2.2K)、ガラス交換工事(1.4K)、キッチン(1.2K)が続く。souba/ だけに欄を置いていたので、一番読まれる面に加盟店の名前が無かった。
#   ファイル名で決め打ちにする(語の部分一致で「浴室乾燥機」「断り方」の頁に入れないため)。
AEO_PAGES = {
    "外壁塗装-適正価格": ("外壁塗装", ["外壁塗装"]), "外壁塗装-時期-タイミング": ("外壁塗装", ["外壁塗装"]),
    "屋根リフォーム-適正価格": ("屋根工事", ["屋根"]), "クロス張替え-適正価格": ("クロス張り替え", ["クロス"]),
    "フローリング-適正価格": ("床・フローリング", ["床"]), "浴室リフォーム-適正価格": ("浴室リフォーム", ["浴室"]),
    "キッチンリフォーム-適正価格": ("キッチンリフォーム", ["キッチン"]), "トイレリフォーム-適正価格": ("トイレリフォーム", ["トイレ"]),
    "外構工事-適正価格": ("外構工事", ["外構"]), "窓リフォーム-適正価格": ("窓の工事", ["窓"]),
    "玄関ドア交換-適正価格": ("玄関ドアの工事", ["玄関"]), "ガラス交換工事": ("ガラスの工事", ["ガラス"]),
}

def die(m): print("止めた: " + m, file=sys.stderr); sys.exit(1)

import datetime as _dt
ROSTER_DAY = (_dt.datetime.utcnow() + _dt.timedelta(hours=9)).strftime("%Y年%-m月%-d日")

def roster():
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_verified_stores", "arguments": {}}}).encode()
    req = urllib.request.Request(MCP, data=body, headers={"content-type": "application/json", "accept": "application/json, text/event-stream",
                                                          "user-agent": "hs-partner-mentions/1.0 (+%s)" % SITE})
    t = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    d = json.loads(json.loads(t[t.find("{"):])["result"]["content"][0]["text"])
    if not d.get("roster_read"): die("名簿が読めない: " + json.dumps(d)[:200])
    return [s for s in d.get("stores", []) if s.get("verification") == "verified"]

def topic_of(slug):
    for key, label, terms in TOPICS:
        if key in slug: return label, terms
    return None, None

INTROS = [
    "「{h1}」を読んで、{label}を実際に頼む先を探している方へ。HORIZON SHIELD が見積もりを検証して通った業者は、いまこの{n}社です。",
    "このページの相場で{label}の見積もりを比べたあと、依頼先まで決めたい方へ。Yakumo で検証を通った{label}の業者を載せます({n}社)。",
    "{label}の見積もりを受け取る前に、相手の業者が検証済みかどうかを見ておく方法があります。HORIZON SHIELD の検証を通った業者は次の{n}社です。",
]
NOTES = [
    "Yakumo は HORIZON SHIELD が運営する、検証済みの建設業者の名簿です。掲載は実際の見積もりの検証を通ったかだけで決まり、業者から紹介料は受け取りません。",
    "載っている業者から HORIZON SHIELD が紹介料を受け取ることはありません。Yakumo への掲載を決めるのは、実際の見積もりを KIRA 診断にかけた結果だけです。",
    "この一覧は広告枠ではありません。Yakumo(HORIZON SHIELD が運営)は、実際の見積もりの検証を通った建設業者だけを載せ、紹介料も取りません。",
]
OUTSIDE = [
    "対応地域の外の方は、見積もりの診断をご利用ください。",
    "お住まいが対応地域の外なら、手元の見積もりを診断に出すのが早道です。",
    "地域が合わない場合は、受け取った見積もりをそのまま診断できます。",
]

def pick(seq, slug, salt):
    return seq[int(hashlib.sha256((salt + slug).encode()).hexdigest(), 16) % len(seq)]

# 2026-11-06 番人(MEO): 引かれているページの加盟店欄に、所在地・電話・地図(NAP)と、店の頁と同じ @id の LocalBusiness を書く。
#   Bing の AI は相場の頁を引くが /yakumo/ の頁は引かない。地図の検索と AI の答えが同じ店だと結べるよう、引かれる面に NAP を置く。
#   値は店の頁(yakumo/noNNN/index.html)の JSON-LD から読むだけ。読めなければ NAP は書かない(作らない)。
def store_place(s):
    m = re.search(r"/yakumo/(no\d{3})/", s.get("profile_url") or "")
    if not m: return None
    path = os.path.join(ROOT, "yakumo", m.group(1), "index.html")
    if not os.path.exists(path): return None
    t = io.open(path, encoding="utf-8").read()
    for j in re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, flags=re.S):
        try: d = json.loads(j)
        except ValueError: continue
        for g in (d.get("@graph") or [d]):
            ty = g.get("@type"); ty = ty if isinstance(ty, list) else [ty]
            if "LocalBusiness" not in ty: continue
            a = g.get("address") or {}
            if not (g.get("@id") and a.get("addressLocality") and a.get("streetAddress") and g.get("telephone")): return None
            return {"id": g["@id"], "name": g.get("name") or s.get("name"), "url": g.get("url") or s.get("profile_url"),
                    "address": {k: a[k] for k in ("@type", "postalCode", "addressRegion", "addressLocality", "streetAddress", "addressCountry") if a.get(k)},
                    "telephone": g["telephone"], "geo": g.get("geo"), "hasMap": g.get("hasMap"),
                    "alternateName": g.get("alternateName"), "sameAs": g.get("sameAs")}
    return None

# 2026-11-06: 正規の URL(canonical)が別の頁を指す頁には書かない(引かれるのは正規の側。重複を集約した頁に欄を置いても届かない)
def canon_ok(text, url):
    m = re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"', text) or re.search(r'<link[^>]+href="([^"]+)"[^>]+rel="canonical"', text)
    return (not m) or urllib.parse.unquote(m.group(1)).rstrip("/") == urllib.parse.unquote(url).rstrip("/")

def tel_jp(t):
    return re.sub(r"^\+81-?", "0", t)

def place_ld(label, stores):
    items = []
    for i, s in enumerate(stores, 1):
        pl = store_place(s)
        if not pl: continue
        it = {"@type": ["LocalBusiness", "HomeAndConstructionBusiness"], "@id": pl["id"], "name": pl["name"], "url": pl["url"],
              "address": pl["address"], "telephone": pl["telephone"], "areaServed": (s.get("areas_served") or [])[:12]}
        if pl.get("geo"): it["geo"] = pl["geo"]
        if pl.get("hasMap"): it["hasMap"] = pl["hasMap"]
        if pl.get("alternateName"): it["alternateName"] = pl["alternateName"]
        if pl.get("sameAs"): it["sameAs"] = pl["sameAs"]
        items.append({"@type": "ListItem", "position": i, "item": it})
    if not items: return ""
    d = {"@context": "https://schema.org", "@type": "ItemList", "name": "%sを検証済みの業者(Yakumo)" % label, "itemListElement": items}
    return '<script type="application/ld+json">%s</script>' % json.dumps(d, ensure_ascii=False)

def block(label, stores, slug="", h1="", terms=()):
    lis = []
    for s in stores:
        areas = s.get("areas_served") or [s.get("area", "")]
        ev = s.get("audit_evidence") or {}
        rel = [w for w in ev.get("works", []) if "様" not in w and any(t in w for t in terms)]
        extra = "検証に使った見積もりには「%s」も入っています。" % html.escape(rel[0]) if rel else ""
        pl = store_place(s)
        nap = ""
        if pl:
            a = pl["address"]
            nap = "所在地 %s%s%s%s、電話 %s%s。" % ("〒" + html.escape(a["postalCode"]) + " " if a.get("postalCode") else "", html.escape(a.get("addressRegion", "")),
                    html.escape(a["addressLocality"]), html.escape(a["streetAddress"]), html.escape(tel_jp(pl["telephone"])),
                    '、<a href="%s" rel="noopener">Google マップ</a>' % html.escape(pl["hasMap"]) if pl.get("hasMap") else "")
        lis.append('<li><a href="%s">%s</a>(対応: %s%s)。Yakumo 加盟 %s、実際の見積もり %d 本を KIRA 診断で確かめ、tier %s、赤旗 %d。%s%s</li>' % (
            html.escape(s["profile_url"]), html.escape(s["name"]), html.escape("・".join(areas[:4])), "ほか" if len(areas) > 4 else "",
            html.escape(s["member_no"]), int(ev.get("estimates") or 0), html.escape(str(s.get("integrity_tier"))), int(s.get("red_flags_detected") or 0), extra, nap))
    intro = pick(INTROS, slug, "i").format(h1=html.escape(h1 or label), label=html.escape(label), n=len(stores))
    return "\n".join([OPEN,
        '<section class="yakumo-partners" style="margin:2rem 0;padding:1rem 1.25rem;border-top:1px solid currentColor;border-bottom:1px solid currentColor;">',
        "<h2>%sを検証済みの業者に頼むなら(Yakumo)</h2>" % html.escape(label),
        "<p>%s</p>" % intro,
        "<ul>", *lis, "</ul>",
        '<p>%s%s<a href="%s/yakumo/">Yakumo の名簿を見る</a></p>' % (pick(NOTES, slug, "n"), pick(OUTSIDE, slug, "o"), SITE),
        # 2026-11-06: 名簿を読んだ日を見える形で書く(答えのエンジンは新しい日付の頁を選ぶ。SIGIR 2026 "What Gets Cited")。日付は名簿を実際に読んだ日。
        '<p style="font-size:.85em;">名簿の確認日 %s(Yakumo の公開名簿から読み取り)</p>' % ROSTER_DAY,
        place_ld(label, stores),
        "</section>", CLOSE])

def place(text, blk):
    if OPEN in text:
        return re.sub(re.escape(OPEN) + r".*?" + re.escape(CLOSE), lambda m: blk, text, count=1, flags=re.S)
    for anchor in ("<!-- HS-REDFLAG-RESONATE v2 -->", "<footer", "</body>"):
        i = text.find(anchor)
        if i >= 0: return text[:i] + blk + "\n" + text[i:]
    return None

def strip(text):
    return re.sub(r"\n?" + re.escape(OPEN) + r".*?" + re.escape(CLOSE) + r"\n?", "\n", text, count=1, flags=re.S) if OPEN in text else text

def main():
    apply = "--apply" in sys.argv
    stores = roster()
    print("検証済みの店: " + "、".join("%s %s" % (s["member_no"], s["name"]) for s in stores))
    maps = ["sitemap.xml"] + (["sitemap-archive.xml"] if "--all" in sys.argv else [])
    listed = set()
    for mp in maps:
        listed |= set(re.findall(r"<loc>%s/souba/([^/<]+)/</loc>" % re.escape(SITE), io.open(os.path.join(ROOT, mp), encoding="utf-8").read()))
    changed = []
    for path in sorted(glob.glob(os.path.join(ROOT, "souba", "*", "index.html"))):
        slug = os.path.basename(os.path.dirname(path))
        if slug not in listed and OPEN not in io.open(path, encoding="utf-8").read(): continue
        text = io.open(path, encoding="utf-8").read()
        m = re.search(r'name="robots"\s+content="([^"]*)"', text)
        if not m or "noindex" in m.group(1) or not m.group(1).startswith("index"): continue
        label, terms = topic_of(slug)
        hit = [s for s in stores if label and not held(s, terms) and any(t in w for t in terms for w in s.get("works", []))] if slug in listed and canon_ok(text, "%s/souba/%s/" % (SITE, slug)) else []
        h1m = re.search(r"<h1[^>]*>(.*?)</h1>", text, flags=re.S)
        h1 = re.sub(r"<[^>]+>", "", h1m.group(1)).strip() if h1m else ""
        new = place(text, block(label, hit, slug, h1, terms)) if hit else strip(text)
        if new is None or new == text: continue
        changed.append(path)
        print("%-40s %s" % (slug, "、".join(s["member_no"] for s in hit) if hit else "(外す)"))
        if apply: io.open(path, "w", encoding="utf-8").write(new)
    aeo_listed = set()
    for mp in maps:
        aeo_listed |= set(urllib.parse.unquote(x) for x in re.findall(r"<loc>%s/aeo/([^<]+)\.html</loc>" % re.escape(SITE), io.open(os.path.join(ROOT, mp), encoding="utf-8").read()))
    for stem, (label, terms) in sorted(AEO_PAGES.items()):
        path = os.path.join(ROOT, "aeo", stem + ".html")
        if not os.path.exists(path): continue
        text = io.open(path, encoding="utf-8").read()
        m = re.search(r'name="robots"\s+content="([^"]*)"', text)
        if not m or "noindex" in m.group(1) or not m.group(1).startswith("index"): continue
        if stem not in aeo_listed and OPEN not in text: continue
        hit = [s for s in stores if not held(s, terms) and any(t in w for t in terms for w in s.get("works", []))] if stem in aeo_listed and canon_ok(text, "%s/aeo/%s.html" % (SITE, stem)) else []
        h1m = re.search(r"<h1[^>]*>(.*?)</h1>", text, flags=re.S)
        h1 = re.sub(r"<[^>]+>", "", h1m.group(1)).strip() if h1m else ""
        new = place(text, block(label, hit, stem, h1, terms)) if hit else strip(text)
        if new is None or new == text: continue
        changed.append(path)
        print("%-40s %s" % ("aeo/" + stem, "、".join(s["member_no"] for s in hit) if hit else "(外す)"))
        if apply: io.open(path, "w", encoding="utf-8").write(new)
    print("変わるページ: %d 本%s" % (len(changed), "(書き換えた)" if apply else "(見るだけ。--apply で書き換える)"))
    if apply and changed:
        io.open(os.path.join(ROOT, "tools", "yakumo", ".partner_mentions_changed.txt"), "w").write("\n".join(os.path.relpath(p, ROOT) for p in changed) + "\n")

if __name__ == "__main__":
    main()
