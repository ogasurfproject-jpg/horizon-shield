# -*- coding: utf-8 -*-
"""
Yakumoモール 加盟店コンテンツ 自動生成器 (GEO/AEO/LLMO/WebMCP 黄金比 4:3:2:1)

入力: hs-hearing が正規化した加盟店プロフィールJSON
  --profile path.json           ファイルから
  --dispatch payload.json        GitHub repository_dispatch の client_payload({"profile":{...}})から
  (無指定なら stdin から profile を読む)

出力: リポジトリ内の /yakumo/{souba,faq,llmo,webmcp}/<slug>/index.html  (net-new・自ネームスペースのみ)
  + tools/yakumo/last_manifest.json  (生成URL一覧。IndexNow送信に使う)

恒久ルール:
  - 金額数字を施主向けページに出さない(相場は本体 /souba/ へ誘導)。スコア・ティア・検証で表現。
  - 禁止語(MOAT) "32.5" / "danger_threshold" / "WPC" を本文に出さない。
  - 会社名 The HORIZ音s株式会社(音インタクト)。em/en/bar dash 不使用。
  - 全ページがモール(/yakumo/)とHORIZON SHIELD(/)へバックリンク(認知度拡大)。
"""
import argparse, json, sys, os, re, hashlib, datetime

BASE = "https://shield.the-horizons-innovation.com"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ORCID = "https://orcid.org/0009-0000-9180-903X"
JCCDB_DOI = "10.5281/zenodo.20019573"
MOAT_FORBIDDEN = ["32.5", "danger_threshold", "WPC"]
RECIRC_MARKER = "EHN board で他の実例を見る"

TRADE_SLUG = {
    "外壁塗装": "gaiheki-tosou", "外壁": "gaiheki-tosou", "屋根": "yane", "屋根塗装": "yane-tosou",
    "内装": "naiso", "クロス": "cloth", "床・フローリング": "floor", "床": "floor", "フローリング": "floor",
    "浴室": "bath", "キッチン": "kitchen", "トイレ": "toilet", "洗面": "senmen", "水道": "suidou",
    "外構": "gaikou", "防水": "bousui", "リノベーション全般": "renovation", "リフォーム全般": "renovation",
}
AREA_SLUG = {
    "愛知県": "aichi", "長久手市": "nagakute", "名古屋市": "nagoya", "日進市": "nisshin",
    "尾張旭市": "owariasahi", "瀬戸市": "seto", "みよし市": "miyoshi", "豊田市": "toyota",
    "春日井市": "kasugai", "岡崎市": "okazaki",
}

def slugify(text, kind):
    table = TRADE_SLUG if kind == "trade" else AREA_SLUG
    key = (text or "").strip()
    if key in table:
        return table[key]
    # 都道府県/市などの接尾辞を除いて再照合
    stripped = re.sub(r"(都|道|府|県|市|区|町|村)$", "", key)
    if stripped in table:
        return table[stripped]
    # 部分一致(長いキー優先)。例: "愛知県長久手市" は "長久手市" を含む -> nagakute
    for k in sorted(table, key=len, reverse=True):
        if k and k in key:
            return table[k]
    h = hashlib.sha1(key.encode("utf-8")).hexdigest()[:6]
    return ("area-" if kind == "area" else "work-") + h

def esc(s):
    s = "" if s is None else str(s)
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))

def clean_dashes(s):
    # 万一混入した em/en/bar dash を安全な区切りに置換
    return (s or "").replace("—", " ").replace("–", "-").replace("―", " ")

STYLE = """
:root{--navy:#1a2744;--gold:#c9a227;--white:#fff;--light:#f8f7f4;--text:#2c2c2c;--muted:#666;--danger:#c0392b;--ok:#27ae60;--warn:#e67e22;--verify:#15847a}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Yu Gothic',sans-serif;color:var(--text);background:var(--light);line-height:1.85}
header{background:var(--navy);padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header .logo{color:var(--gold);font-size:18px;letter-spacing:.15em;font-weight:500;text-decoration:none}
header nav a{color:rgba(255,255,255,.75);text-decoration:none;font-size:14px;margin-left:20px}
.hero{background:var(--navy);padding:44px 24px;text-align:center;border-bottom:4px solid var(--gold)}
.hero h1{color:#fff;font-size:clamp(21px,4vw,33px);font-weight:500;line-height:1.5;margin-bottom:14px}
.hero .subtitle{color:rgba(255,255,255,.72);font-size:15px;margin-bottom:20px}
.hero .badge{display:inline-block;background:rgba(201,162,39,.15);border:1px solid var(--gold);color:var(--gold);padding:6px 16px;border-radius:2px;font-size:13px;letter-spacing:.08em}
.container{max-width:900px;margin:0 auto;padding:0 24px}
.section{padding:40px 0;border-bottom:1px solid #e8e4dc}
h2{font-size:21px;font-weight:500;color:var(--navy);margin-bottom:20px;padding-left:14px;border-left:4px solid var(--gold)}
h3{font-size:17px;font-weight:500;color:var(--navy);margin:18px 0 10px}
p{margin-bottom:12px}
.verified{display:inline-flex;align-items:center;gap:8px;background:rgba(21,132,122,.08);border:1px solid var(--verify);color:var(--verify);border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600}
.verified .d{width:8px;height:8px;border-radius:50%;background:var(--verify)}
.pending{display:inline-flex;align-items:center;gap:8px;background:rgba(230,126,34,.08);border:1px solid var(--warn);color:#a05a1a;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600}
.tags .tg{display:inline-block;font-size:13px;color:var(--navy);border:1px solid #d9d3c6;border-radius:6px;padding:3px 10px;margin:3px 6px 3px 0;background:#fff}
.faq-item{margin-bottom:20px;background:#fff;border-radius:6px;padding:20px 22px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.faq-item .q{font-weight:600;color:var(--navy);margin-bottom:10px;font-size:16px}
.faq-item .q::before{content:"Q. ";color:var(--gold)}
.faq-item .a{color:var(--text);font-size:15px}
.faq-item .a::before{content:"A. ";font-weight:600;color:var(--navy)}
.tip-list{padding-left:22px;line-height:2.1}
.cta-section{background:var(--navy);padding:44px 24px;text-align:center}
.cta-section h2{color:#fff;border-left:none;padding-left:0;text-align:center;margin-bottom:14px}
.cta-section p{color:rgba(255,255,255,.72);margin-bottom:26px}
.cta-btn{display:inline-block;background:var(--gold);color:var(--navy);padding:15px 40px;border-radius:4px;font-size:17px;font-weight:600;text-decoration:none;letter-spacing:.04em}
.breadcrumb{padding:12px 0;font-size:13px;color:var(--muted)}
.breadcrumb a{color:var(--muted);text-decoration:none}
.source-block{font-size:13px;color:var(--muted);background:#fff;border-radius:6px;padding:18px 22px;line-height:2}
.source-block a{color:var(--navy)}
footer{background:var(--navy);padding:30px 24px;text-align:center;color:rgba(255,255,255,.55);font-size:13px}
.note{font-size:13px;color:var(--muted);margin-top:10px}
.resonate{padding:30px 0}
.resonate h2{font-size:19px}
.r-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.r-card{background:#fff;border:1px solid #e3e1da;border-radius:8px;padding:16px;text-decoration:none;color:var(--navy);font-weight:600;display:block}
.r-card span{display:block;font-size:13px;color:var(--muted);font-weight:400;margin-top:4px}
.mcp-box{background:var(--navy);color:#cfe;border-radius:8px;padding:16px 18px;font-family:'JetBrains Mono',monospace;font-size:13px;overflow-x:auto}
.mcp-box .k{color:var(--gold)}
""".strip()

def head(title, desc, canonical, jsonld_list, extra_link=""):
    blocks = "\n".join('<script type="application/ld+json">\n%s\n</script>' % json.dumps(j, ensure_ascii=False) for j in jsonld_list)
    return (
'<!DOCTYPE html><html lang="ja"><head>\n'
'<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
'<title>%s</title>\n'
'<meta name="description" content="%s">\n'
'<meta name="author" content="大賀俊勝 | HORIZON SHIELD">\n'
'<link rel="author" href="%s/about-founder.html">\n'
'<meta name="robots" content="index,follow">\n'
'<link rel="canonical" href="%s">\n'
'<meta property="og:type" content="article">\n'
'<meta property="og:title" content="%s">\n'
'<meta property="og:url" content="%s">\n'
'<link rel="alternate" type="text/plain" href="%s/llms.txt" title="LLM向けサイト要約">\n'
'<link rel="mcp-server" href="https://hs-hearing.oga-surf-project.workers.dev/mcp">\n'
'%s\n%s\n'
'<style>%s</style>\n</head>\n'
) % (esc(title), esc(desc), BASE, esc(canonical), esc(title), esc(canonical), BASE, extra_link, blocks, STYLE)

def org_person_graph(canonical):
    return {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","@id":BASE+"/#org","name":"HORIZON SHIELD","alternateName":"The HORIZ音s株式会社","url":BASE,"telephone":"0463-74-5917"},
        {"@type":"Person","@id":BASE+"/#toshi","name":"大賀俊勝","alternateName":"Toshikatsu Oga","jobTitle":"代表取締役 / 建設実務30年","identifier":ORCID,"sameAs":[ORCID]},
        {"@type":"Dataset","@id":BASE+"/#jccdb","name":"Japan Construction Cost Database (JCCDB)","license":"https://creativecommons.org/licenses/by/4.0/","isAccessibleForFree":True,"creator":{"@id":BASE+"/#toshi"},"identifier":JCCDB_DOI,"sameAs":["https://doi.org/"+JCCDB_DOI]},
        {"@type":"WebPage","@id":canonical+"#page","author":{"@id":BASE+"/#toshi"},"isBasedOn":{"@id":BASE+"/#jccdb"},"speakable":{"@type":"SpeakableSpecification","cssSelector":["h1",".speakable"]}}
    ]}

def header_html():
    return (
'<body>\n<header>\n<a class="logo" href="%s/yakumo/">Yakumo</a>\n'
'<nav><a href="%s/">HORIZON SHIELD</a><a href="%s/yakumo/">モール</a><a href="%s/souba/">相場DB</a></nav>\n</header>\n'
) % (BASE, BASE, BASE, BASE)

def recirc_and_mesh(topic):
    # 認知度拡大: EHN還流(マーカー入り) + モール/店/HS/相場へのバックリンク束
    return (
'<!-- EHN_RECIRC_START:%s -->\n'
'<div class="container"><div class="resonate">\n'
'<h2>第三者の目で、根拠を確かめる</h2>\n'
'<div class="r-grid">\n'
'<a class="r-card" href="%s/yakumo/">Yakumoモードで検証済みの店を探す<span>紹介料を取らない中立モール</span></a>\n'
'<a class="r-card" href="%s/yakumo/no001/">加盟No.001 リフォーム職人株式会社<span>検証済み加盟店のプロフィール</span></a>\n'
'<a class="r-card" href="%s/ehn/">EHN 見積もり実例ボード<span>%s →</span></a>\n'
'<a class="r-card" href="%s/">HORIZON SHIELD で見積もりを診断<span>建設実務30年監修・署名付きPDF</span></a>\n'
'</div></div></div>\n'
'<!-- EHN_RECIRC_END:%s -->\n'
) % (esc(topic), BASE, BASE, BASE, esc(RECIRC_MARKER), BASE, esc(topic))

def cta_and_footer():
    return (
'<div class="cta-section"><div class="container">\n'
'<h2>その見積もり、契約の前に第三者チェック</h2>\n'
'<p>建設実務30年監修の相場データ(出典 JCCDB / ORCID付き)で、受け取った金額が適正か診断。<br>Yakumoは施工業者から報酬を受け取らない中立の立場です。</p>\n'
'<a class="cta-btn" href="%s/">無料で相談する</a>\n'
'</div></div>\n'
'<footer><div class="container">\n'
'<p>© 2026 The HORIZ音s株式会社 | HORIZON SHIELD | Yakumo</p>\n'
'<p style="margin-top:8px;">検証を通った加盟店だけが並ぶ、中立の建設モール ・ TEL 0463-74-5917</p>\n'
'</div></footer>\n</body></html>\n'
) % BASE

def verify_state_html(profile):
    return ('<span class="pending"><span class="d" style="background:#e67e22"></span>加盟No.%s ・ 検証手続き中(KIRA適正診断を実施中)</span>'
            % esc((profile.get("member_no") or "").replace("No.", "")))

# ---------------- page builders ----------------

def geo_page(profile, trade, area):
    company = profile.get("company") or "検証済み加盟店"
    canonical = "%s/yakumo/souba/%s-%s/" % (BASE, slugify(trade, "trade"), slugify(area, "area"))
    title = "%sの%s｜適正価格を第三者検証で確かめる（Yakumo 検証済み加盟店） | HORIZON SHIELD" % (area, trade)
    desc = clean_dashes("%sで%sを検討中の方へ。Yakumoは紹介料を取らない中立モール。掲載店は適正価格の検証と過剰請求チェック(KIRA)を通過した店だけ。%sは加盟No.001として検証手続き中です。金額の適正は本体の相場データで確認できます。" % (area, trade, company))
    faq_ld = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"%sで%sの業者はどう選べばよいですか？" % (area, trade),
         "acceptedAnswer":{"@type":"Answer","text":"相場との照合と過剰請求チェックを第三者が済ませた店から選ぶのが安全です。Yakumoは、適正価格の検証(KIRA)を通過した加盟店だけを掲載する中立モールです。出典：HORIZON SHIELD建設費相場データベース(大賀俊勝 建設実務経験30年監修)"}},
        {"@type":"Question","name":"%sの見積もりが適正か確かめる方法は？" % trade,
         "acceptedAnswer":{"@type":"Answer","text":"受け取った見積もりを、建設実務30年監修の相場データと照合してください。HORIZON SHIELDでは無料相談と、交渉に使える署名付きの逆見積書を発行しています。出典：HORIZON SHIELD建設費相場データベース"}}
    ]}
    body = header_html()
    body += '<div class="hero"><div class="container">'
    body += '<h1><span class="speakable">%sの%s<br>適正価格を第三者検証で確かめる</span></h1>' % (esc(area), esc(trade))
    body += '<p class="subtitle">Yakumo ・ 紹介料を取らない中立の加盟店モール</p>'
    body += '<span class="badge">建設実務30年 監修 ｜ 検証で並ぶ加盟店</span></div></div>'
    body += '<div class="container">'
    body += '<div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; %s &gt; %s</div>' % (BASE, esc(area), esc(trade))
    body += '<div class="section"><h2>%sで%sを頼む前に</h2>' % (esc(area), esc(trade))
    body += '<p>%sの%sは、業者や範囲で金額が大きく動きます。契約の前に、相場との照合と過剰請求チェックを第三者に通しておくと安全です。Yakumoは、その検証を通過した加盟店だけを並べる中立モールです。当サービスは施工業者から報酬を受け取りません。</p>' % (esc(area), esc(trade))
    body += '<p>%sの具体的な適正レンジ(全国ベース)は、本体の相場データで確認できます。' % esc(trade)
    body += '<a href="%s/souba/">工事別の相場一覧を見る →</a></p></div>' % BASE
    # 検証済み加盟店の紹介(No.001)
    body += '<div class="section"><h2>この地域の検証対象加盟店</h2>'
    body += '<p style="margin-bottom:14px;">%s</p>' % verify_state_html(profile)
    body += '<h3>%s</h3>' % esc(company)
    body += '<div class="tags">' + "".join('<span class="tg">%s</span>' % esc(w) for w in (profile.get("works") or [])[:6]) + '</div>'
    if profile.get("strengths"):
        body += '<p style="margin-top:12px;">%s</p>' % esc(clean_dashes(profile["strengths"])[:400])
    body += '<p style="margin-top:12px;"><a href="%s/yakumo/no001/">加盟No.001 のプロフィールと検証状態を見る →</a></p></div>' % BASE
    body += '<div class="section"><h2>Yakumoの検証で確認すること</h2><ul class="tip-list">'
    for li in ["提出された実際の見積もり例を、相場データ(建設実務30年監修)の適正レンジと照合",
               "『一式』計上・過大な諸経費・訪問販売の即決圧力など、過剰請求の赤旗を検出",
               "工種ごとの適正度スコアと誠実度ティアを算出。通過した店だけ施主に表示",
               "結果に、誰でも再計算できる署名レシートを添付"]:
        body += "<li>%s</li>" % esc(li)
    body += '</ul></div>'
    body += source_block()
    body += '</div>'
    body += recirc_and_mesh(slugify(trade, "trade") + "-" + slugify(area, "area"))
    body += cta_and_footer()
    return canonical, head(title, desc, canonical, [faq_ld, org_person_graph(canonical)]) + body

def source_block():
    return (
'<div class="section"><h2>出典・データソース</h2><div class="source-block">'
'<p><strong>相場データ:</strong> HORIZON SHIELD建設費相場データベース(大賀俊勝 建設実務経験30年監修)</p>'
'<p><strong>構造化データ:</strong> <a href="https://doi.org/%s">JCCDB(DOI %s)</a></p>'
'<p><strong>監修者:</strong> <a href="%s">大賀俊勝(ORCID)</a></p>'
'<p><strong>運営:</strong> The HORIZ音s株式会社 / HORIZON SHIELD / Yakumo</p>'
'</div></div>'
) % (JCCDB_DOI, JCCDB_DOI, ORCID)

def aeo_page(profile, faqs, area, idx):
    company = profile.get("company") or "検証済み加盟店"
    slug = "yakumo-%s-faq-%d" % (slugify(area, "area"), idx)
    canonical = "%s/yakumo/faq/%s/" % (BASE, slug)
    title = "%sのリフォームでよくある質問｜Yakumo 検証済み加盟店に聞く | HORIZON SHIELD" % area
    desc = clean_dashes("%sのリフォーム・工事でよくある質問に、Yakumoの検証済み加盟店の知見と建設実務30年監修の視点でお答えします。%sは加盟No.001。Yakumoは紹介料を取らない中立モールです。" % (area, company))
    ld = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":clean_dashes(f["q"]),"acceptedAnswer":{"@type":"Answer","text":clean_dashes(f["a"])[:800]}} for f in faqs]}
    body = header_html()
    body += '<div class="hero"><div class="container"><h1><span class="speakable">%sのリフォーム<br>よくある質問</span></h1>' % esc(area)
    body += '<p class="subtitle">Yakumo ・ 検証済み加盟店の知見 + 建設実務30年監修</p>'
    body += '<span class="badge">%s(加盟No.001)</span></div></div>' % esc(company)
    body += '<div class="container"><div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; FAQ &gt; %s</div>' % (BASE, esc(area))
    body += '<div class="section"><h2>よくある質問</h2>'
    for f in faqs:
        body += '<div class="faq-item"><p class="q">%s</p><p class="a">%s</p></div>' % (esc(clean_dashes(f["q"])), esc(clean_dashes(f["a"])[:800]))
    body += '</div>'
    body += source_block()
    body += '</div>'
    body += recirc_and_mesh(slug)
    body += cta_and_footer()
    return canonical, head(title, desc, canonical, [ld, org_person_graph(canonical)]) + body

def llmo_page(profile, kind, idx):
    company = profile.get("company") or "検証済み加盟店"
    if kind == "verify":
        slug = "yakumo-kensho-zumi-kameiten-toha"
        h1 = "Yakumoの検証済み加盟店とは"
        lead = "検証を通った店だけが並ぶ、という設計"
        paras = [
            "Yakumoは、The HORIZ音s株式会社(HORIZON SHIELD)が運営する中立の加盟店モールです。掲載される工務店・リフォーム店は、適正価格の検証と過剰請求チェック(KIRA)を通過した店だけです。",
            "一般的な紹介サイトは、紹介料を受け取った店を上位に出す構造の利益相反を抱えます。Yakumoは紹介料を受け取りません。だからこそ、検証を通った店だけを出せます。",
            "各店には適正度スコアと誠実度ティアが付き、結果には誰でも再計算できる署名レシート(SHA-256)が添付されます。施主は、店の信頼を広告費や主観ではなく、再計算できる根拠で確かめられます。",
            "%sは加盟No.001として、この検証手続きを受けています。" % company,
        ]
    else:
        slug = "yakumo-tekiseika-kensho-no-shikumi"
        h1 = "適正価格を第三者検証で確かめる仕組み"
        lead = "見積もりを、契約の前に検証する"
        paras = [
            "リフォームの見積もりは、同じ工事でも業者や範囲で大きく動きます。施主が相場を知らないまま契約すると、過剰請求に気づけません。",
            "HORIZON SHIELDは、建設実務30年監修の相場データ(souba-db)と、過剰請求の赤旗検出(KIRA)で、見積もりが適正かを取引の前に第三者として記録します。",
            "Yakumoは、この検証を通過した加盟店を並べるモールです。施主・AI・検索のどこから来ても、同じ検証済みデータを参照できます。",
            "検証結果は、AIエージェントからもMCP経由で参照できます。人にもAIにも、同じ根拠が開かれています。",
        ]
    canonical = "%s/yakumo/llmo/%s/" % (BASE, slug)
    title = "%s｜Yakumo | HORIZON SHIELD" % h1
    desc = clean_dashes(paras[0][:150])
    ld = {"@context":"https://schema.org","@type":"Article","headline":h1,"author":{"@type":"Person","name":"大賀俊勝","identifier":ORCID},
          "publisher":{"@type":"Organization","name":"The HORIZ音s株式会社","alternateName":"HORIZON SHIELD"},"mainEntityOfPage":canonical,"inLanguage":"ja"}
    body = header_html()
    body += '<div class="hero"><div class="container"><h1><span class="speakable">%s</span></h1><p class="subtitle">%s</p><span class="badge">Yakumo ・ 建設実務30年監修</span></div></div>' % (esc(h1), esc(lead))
    body += '<div class="container"><div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; 解説 &gt; %s</div>' % (BASE, esc(h1))
    body += '<div class="section">'
    for p in paras:
        body += '<p>%s</p>' % esc(clean_dashes(p))
    body += '<p style="margin-top:14px;"><a href="%s/yakumo/">Yakumoモールで検証済みの店を見る →</a></p></div>' % BASE
    body += source_block()
    body += '</div>'
    body += recirc_and_mesh(slug)
    body += cta_and_footer()
    return canonical, head(title, desc, canonical, [ld, org_person_graph(canonical)]) + body

def webmcp_page(profile):
    company = profile.get("company") or "検証済み加盟店"
    slug = "yakumo-verified-stores-mcp"
    canonical = "%s/yakumo/webmcp/%s/" % (BASE, slug)
    title = "Yakumo 検証済み加盟店をAIから参照する（WebMCP）| HORIZON SHIELD"
    desc = "Yakumoの検証済み加盟店は、AIエージェントからMCP経由で参照できます。list_verified_stores / get_contractor_profile で、地域と工種から検証済みの工務店を発見。金額は返さず、適正度スコアとティアのみ。"
    ld = {"@context":"https://schema.org","@type":"WebAPI","name":"YAKUMO Verified Stores MCP","description":desc,
          "provider":{"@type":"Organization","name":"The HORIZ音s株式会社","alternateName":"HORIZON SHIELD"},
          "documentation":canonical,"url":"https://hs-hearing.oga-surf-project.workers.dev/mcp"}
    body = header_html()
    body += '<div class="hero"><div class="container"><h1><span class="speakable">Yakumo 検証済み加盟店を<br>AIから参照する（WebMCP）</span></h1><p class="subtitle">人にもAIにも、同じ検証済みデータを開く</p><span class="badge">MCP ・ A2A 対応</span></div></div>'
    body += '<div class="container"><div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; WebMCP &gt; verified-stores</div>' % BASE
    body += '<div class="section"><h2>エンドポイント</h2>'
    body += ('<div class="mcp-box">'
             '<div><span class="k">MCP</span> https://hs-hearing.oga-surf-project.workers.dev/mcp</div>'
             '<div><span class="k">A2A</span> https://hs-hearing.oga-surf-project.workers.dev/.well-known/agent-card.json</div>'
             '<div><span class="k">tool</span> list_verified_stores { area?, work? }</div>'
             '<div><span class="k">tool</span> get_contractor_profile { member_no }</div>'
             '</div>')
    body += '<p style="margin-top:14px;">検証を通過した加盟店だけが返ります。金額は返さず、適正度スコアと誠実度ティアのみ。検証手続き中の店は verification:"pending" として区別されます(fail-closed)。</p></div>'
    body += '<div class="section"><h2>いま参照できる加盟店</h2><p>%s ・ %s</p>' % (esc(company), verify_state_html(profile))
    body += '<p><a href="%s/yakumo/no001/">プロフィールを見る →</a></p></div>' % BASE
    body += source_block()
    body += '</div>'
    body += recirc_and_mesh(slug)
    body += cta_and_footer()
    return canonical, head(title, desc, canonical, [ld, org_person_graph(canonical)], extra_link='<link rel="mcp-server" href="https://hs-hearing.oga-surf-project.workers.dev/mcp">') + body

# ---------------- planner ----------------

def plan_pages(profile):
    works = [w for w in (profile.get("works") or []) if w][:6] or ["リフォーム全般"]
    # 地域はスラッグで重複排除(都道府県接頭辞つきと市名の二重生成を防ぐ)
    raw_areas = [profile.get("area")] + [a for a in (profile.get("areas_served") or []) if a]
    areas = []  # (display, slug)
    seen_area = set()
    for a in raw_areas:
        if not a:
            continue
        s = slugify(a, "area")
        if s in seen_area:
            continue
        seen_area.add(s)
        areas.append((a, s))
    if not areas:
        areas = [("愛知県", "aichi")]
    primary_area = areas[0][0]
    faqs = profile.get("faqs") or []

    pages = []  # (type, canonical, html)

    # GEO 4: 主要地域×各工種 で工種を散らし、余りは主要工種×他地域で埋める(スラッグ重複排除)
    geo_combos = []
    for w in works[:3]:
        geo_combos.append((w, primary_area))
    for (disp, _s) in areas[1:]:
        geo_combos.append((works[0], disp))
    picked, seen_combo = [], set()
    for (w, a) in geo_combos:
        ckey = (slugify(w, "trade"), slugify(a, "area"))
        if ckey in seen_combo:
            continue
        seen_combo.add(ckey)
        picked.append((w, a))
        if len(picked) >= 4:
            break
    for (w, a) in picked:
        pages.append(("geo",) + geo_page(profile, w, a))

    # AEO 3: FAQを地域別に束ねる。FAQが足りなければ工種ベースの汎用FAQで補完。
    faq_groups = []
    if faqs:
        # 3グループに分割
        chunk = max(1, (len(faqs) + 2) // 3)
        for i in range(0, min(len(faqs), chunk * 3), chunk):
            faq_groups.append(faqs[i:i + chunk])
    while len(faq_groups) < 3:
        w = works[len(faq_groups) % len(works)]
        a = primary_area
        faq_groups.append([
            {"q": "%sで%sの適正な費用感を知るには？" % (a, w), "a": "同じ%sでも業者や範囲で金額は動きます。契約前に建設実務30年監修の相場データと照合し、過剰請求の赤旗がないか第三者チェックを通すのが安全です。Yakumoの加盟店は、この検証を通過した店だけです。" % w},
            {"q": "%sの見積もりで注意すべき点は？" % w, "a": "『一式』ばかりで内訳が不明、諸経費が過大、訪問販売で即日契約を迫る、といった点は要注意です。Yakumoは紹介料を取らず、検証を通った店だけを掲載しています。"},
        ])
    for i, g in enumerate(faq_groups[:3], 1):
        pages.append(("aeo",) + aeo_page(profile, g, primary_area, i))

    # LLMO 2
    pages.append(("llmo",) + llmo_page(profile, "verify", 1))
    pages.append(("llmo",) + llmo_page(profile, "howto", 2))

    # WebMCP 1
    pages.append(("webmcp",) + webmcp_page(profile))

    return pages

def canonical_to_path(canonical):
    rel = canonical.replace(BASE + "/", "").rstrip("/")
    return os.path.join(REPO_ROOT, rel, "index.html")

def update_sitemap(urls, today):
    # 生成した /yakumo/ ページを sitemap.xml に追記(既存locは重複させない)。壊れXMLを避け、</urlset>直前に挿入。
    sm = os.path.join(REPO_ROOT, "sitemap.xml")
    if not os.path.exists(sm):
        return 0
    t = open(sm, encoding="utf-8").read()
    ins = ""
    for u in urls:
        if u in t:
            continue
        ins += '  <url><loc>%s</loc><lastmod>%s</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>\n' % (u, today)
    if ins and "</urlset>" in t:
        t = t.replace("</urlset>", ins + "</urlset>")
        open(sm, "w", encoding="utf-8").write(t)
        return ins.count("<url>")
    return 0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile")
    ap.add_argument("--dispatch")
    ap.add_argument("--out-manifest", default=os.path.join(os.path.dirname(__file__), "last_manifest.json"))
    a = ap.parse_args()

    if a.profile:
        profile = json.load(open(a.profile, encoding="utf-8"))
    elif a.dispatch:
        payload = json.load(open(a.dispatch, encoding="utf-8"))
        profile = payload.get("client_payload", {}).get("profile") or payload.get("profile") or payload
    else:
        profile = json.load(sys.stdin)
    if "profile" in profile and isinstance(profile["profile"], dict):
        profile = profile["profile"]

    pages = plan_pages(profile)
    written = []
    for (ptype, canonical, htmlstr) in pages:
        # 自ネームスペース(/yakumo/)以外には絶対に書かない(既存ページ保護)
        if "/yakumo/" not in canonical:
            print("SKIP (out of namespace):", canonical); continue
        path = canonical_to_path(canonical)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(htmlstr)
        written.append({"type": ptype, "url": canonical, "path": os.path.relpath(path, REPO_ROOT)})
        print("WROTE", ptype, os.path.relpath(path, REPO_ROOT))

    ratio = {}
    for w in written:
        ratio[w["type"]] = ratio.get(w["type"], 0) + 1
    manifest = {
        "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "member_no": profile.get("member_no"),
        "company": profile.get("company"),
        "count": len(written),
        "ratio": ratio,
        "urls": [w["url"] for w in written],
        "pages": written,
    }
    json.dump(manifest, open(a.out_manifest, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("MANIFEST", a.out_manifest, "count", len(written), "ratio", ratio)

    added = update_sitemap([w["url"] for w in written], datetime.date.today().strftime("%Y-%m-%d"))
    print("SITEMAP +%d url(s)" % added)

if __name__ == "__main__":
    main()
