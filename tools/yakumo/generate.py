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

# 施主向けページに金額を出さない(加盟店の自由記述に混ざった金額も伏せる)
MONEY_SUB_RE = re.compile(r'(¥\s*\d[\d,]*|\d[\d,]*\s*円|\d+\s*万円)')
def safe_pub(s):
    return MONEY_SUB_RE.sub("(金額 非公開)", clean_dashes(s or ""))

# ---------------- 重複ゼロ台帳(simhash指紋。workers/hs-hearing/src/autopilot.js と同一アルゴリズム) ----------------
CONTENT_LEDGER = os.path.join(REPO_ROOT, "data", "yakumo-content-manifest.json")
NORM_DROP_RE = re.compile(r"[、。・,.:;!?'\"()\[\]{}<>|/\\\-\s　]")
TITLE_RE_G = re.compile(r"<title>(.*?)</title>", re.S)
SCRIPT_STYLE_RE_G = re.compile(r'<(script|style)\b[^>]*>.*?</\1>', re.S)
TAG_RE_G = re.compile(r'<[^>]+>')

def norm_text(s):
    s = (s or "")[:20000].lower()
    s = TAG_RE_G.sub(" ", s)
    return NORM_DROP_RE.sub("", s)

def fnv1a64(s):
    h = 0xcbf29ce484222325
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h

def simhash64(text):
    t = norm_text(text)
    if len(t) < 3:
        return "0"
    acc = [0] * 64
    for i in range(len(t) - 2):
        h = fnv1a64(t[i:i + 3])
        for b in range(64):
            acc[b] += 1 if (h >> b) & 1 else -1
    out = 0
    for b in range(64):
        if acc[b] > 0:
            out |= 1 << b
    return format(out, "x")

def hamming64(a, b):
    return bin(int(a or "0", 16) ^ int(b or "0", 16)).count("1")

def visible_body(html):
    return TAG_RE_G.sub(" ", SCRIPT_STYLE_RE_G.sub(" ", html))

# 指紋は「そのページ固有の本文」から取る。全ページ共通のボイラープレート(ヘッダー/出典/CTA/還流網/フッター)を
# 除いてから simhash する。共通枠で距離が縮んで別内容のページ同士が誤検知されるのを防ぎ、
# 本文が同じなのに枠だけ違うダブりは今まで通り検出する。
BOILER_RES = [
    re.compile(r'<header>.*?</header>', re.S),
    re.compile(r'<!-- EHN_RECIRC_START.*?EHN_RECIRC_END:[^>]*-->', re.S),
    re.compile(r'<div class="section"><h2>出典・データソース</h2>.*?</div></div>', re.S),
    re.compile(r'<div class="cta-section">.*$', re.S),
]
def content_core(html):
    t = SCRIPT_STYLE_RE_G.sub(" ", html)
    for r in BOILER_RES:
        t = r.sub(" ", t)
    return TAG_RE_G.sub(" ", t)

def fingerprint(canonical, html, member=None):
    slug = canonical.replace(BASE + "/", "").strip("/")
    m = TITLE_RE_G.search(html)
    tsha = hashlib.sha256(norm_text(m.group(1) if m else "").encode("utf-8")).hexdigest()[:8]
    fp = {"slug": slug, "tsha": tsha, "simhash": simhash64(content_core(html))}
    if member:
        fp["m"] = member  # ページの持ち主(加盟店)。他店による同slug上書きを防ぐ
    return fp

def ledger_load():
    if os.path.exists(CONTENT_LEDGER):
        try:
            return json.load(open(CONTENT_LEDGER, encoding="utf-8"))
        except Exception:
            pass
    return {"schema": "yakumo-content-ledger/v1", "entries": []}

def ledger_save(led):
    os.makedirs(os.path.dirname(CONTENT_LEDGER), exist_ok=True)
    json.dump(led, open(CONTENT_LEDGER, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def answer_sha(profile):
    """店の回答本文の指紋。別の店が同じ回答(丸コピー)を出してきたら店単位で検出する。"""
    parts = [profile.get("strengths") or "", profile.get("trust") or ""]
    for f in (profile.get("faqs") or []):
        parts.append((f.get("q") or "") + (f.get("a") or ""))
    for v in (profile.get("extra") or {}).values():
        if isinstance(v, dict):
            parts.append(v.get("text") or "")
    t = norm_text("".join(parts))
    if len(t) < 60:
        return None  # 素材が薄いうちは判定しない(誤検知防止)
    return hashlib.sha256(t.encode("utf-8")).hexdigest()[:12]

def duplicate_of(fp, entries):
    for e in entries:
        if e.get("slug") == fp["slug"]:
            return ("slug:" + e["slug"], e)
        if e.get("tsha") and e["tsha"] == fp["tsha"]:
            return ("title:" + e["slug"], e)
        if e.get("simhash") and fp["simhash"] != "0" and hamming64(fp["simhash"], e["simhash"]) <= 6:
            return ("near-dup:" + e["slug"], e)
    return (None, None)

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

# ---------------- 工種別の実務知識(建設実務30年監修の一般知識。金額なし・地域固有の創作なし) ----------------
TRADE_TIPS = {
    "外壁塗装": {
        "tips": ["下地処理(高圧洗浄・ケレン・ひび補修)を省く業者は塗膜が早期に剥がれます。工程写真の提出を求めましょう",
                 "塗料は下塗り・中塗り・上塗りの3回塗りが基本。缶数(使用量)を見積もりに明記させると水増しを防げます",
                 "足場は近隣挨拶と飛散防止ネットまで含むのが通常。別途請求の連発は赤旗です"],
        "faq": [("外壁塗装に適した季節はいつですか？", "気温5度以上・湿度85%未満が塗装の基本条件です。梅雨と真冬は工期が延びやすい一方、業者の閑散期で日程は取りやすくなります。"),
                ("塗料のグレードはどう選べばいいですか？", "耐用年数と再塗装周期のバランスで選びます。シリコンは標準的、フッ素や無機は高耐久です。建物を何年使うかから逆算するのが実務の考え方です。")],
    },
    "屋根": {
        "tips": ["屋根は施主が直接見えない場所。ドローンや写真での現況報告を出せる業者を選ぶと安全です",
                 "カバー工法か葺き替えかは下地(野地板)の状態で決まります。下地を確認せずに即決を迫るのは赤旗です",
                 "板金(棟・谷)の劣化が雨漏りの主因になりやすく、瓦本体より先に傷みます"],
        "faq": [("雨漏りしたらすぐ葺き替えが必要ですか？", "原因の多くは板金や防水紙の部分劣化で、部分補修で止まる例も多いです。原因特定の調査報告を先に求めましょう。"),
                ("カバー工法のデメリットは？", "屋根が重くなるため耐震面の確認が必要です。下地が傷んでいる場合は施工できません。")],
    },
    "内装": {
        "tips": ["解体後にしか分からない下地の傷みは追加費用になりがち。見積もりに『下地補修の単価』を先に入れさせると安心です",
                 "造作家具や建具は既製品との価格差が大きい部分。どちらで見積もっているか確認しましょう",
                 "工事中の養生範囲(廊下・エレベーター)を契約前に確認するとトラブルを防げます"],
        "faq": [("居住しながら内装工事はできますか？", "部屋ごとの分割施工で可能ですが、工期は延びます。水回りを含む場合は使えない期間の説明を先に受けてください。"),
                ("工期はどのくらい見ればいいですか？", "範囲によります。解体を伴う場合は、解体後の下地確認で工程が変わる前提で余裕を持つのが実務的です。")],
    },
    "クロス": {
        "tips": ["量産品と1000番台(機能性)クロスで単価が変わります。部屋ごとにどちらを使うか明記させましょう",
                 "下地パテ処理の丁寧さが仕上がりを決めます。既存クロス剥がし後の下地処理費が含まれているか確認を",
                 "サンプルは大きめで、昼と夜の照明の下で確認するのが失敗しないコツです"],
        "faq": [("クロスの張り替え時期の目安は？", "10年前後で継ぎ目や日焼けが目立ちます。剥がれや浮きは下地の湿気サインの場合があるので原因確認が先です。"),
                ("家具の移動はやってもらえますか？", "業者により含む範囲が違います。見積もりに家具移動と養生の記載があるか確認してください。")],
    },
    "床・フローリング": {
        "tips": ["重ね張り(上張り)か張り替えかで工事の重さが変わります。床下地の状態確認が先です",
                 "マンションは管理規約の遮音等級(LL値)指定があるため、材料選定の前に規約確認が必須です",
                 "床鳴りは下地の緩みが原因のことが多く、表面材の交換だけでは直りません"],
        "faq": [("重ね張りと張り替えはどちらがいいですか？", "下地が健全なら重ね張りは工期も廃材も少なく済みます。沈みや腐れがあるなら張り替え一択です。"),
                ("無垢材と複合フローリングの違いは？", "無垢は質感と補修性、複合は寸法安定性と施工性に優れます。床暖房対応かは製品ごとに確認が必要です。")],
    },
    "浴室": {
        "tips": ["ユニットバス交換は本体価格より『既存解体と配管移設』の条件で総額が動きます。現地調査なしの見積もりは危険です",
                 "在来浴室からユニットへの変更は土間打ちなど下地工事が発生します。工程表で確認しましょう",
                 "換気扇と窓の断熱もセットで検討するとヒートショック対策になります"],
        "faq": [("浴室リフォームの工期は？", "ユニットからユニットへの交換で数日、在来からの変更は下地工事を含みさらにかかります。入浴できない期間の代替を先に確認しましょう。"),
                ("追い焚き機能の後付けはできますか？", "給湯器と配管の対応状況によります。現地調査で配管ルートを確認してからが確実です。")],
    },
    "キッチン": {
        "tips": ["キッチン移動を伴うプランは給排水・電気・換気ダクトの移設費が大きく動きます。移動なしとの差額を出させましょう",
                 "食洗機や水栓のグレードで総額が変わります。型番まで見積もりに明記させるのが基本です",
                 "吊戸棚の撤去や下地補強の有無も事前に確認を"],
        "faq": [("キッチン交換の工期は？", "同位置交換なら短期間で済みます。レイアウト変更は配管・電気工事が加わり延びます。"),
                ("対面キッチンへの変更は可能ですか？", "梁・配管・換気ルートの制約で可否が決まります。現地調査時に構造の確認を求めてください。")],
    },
    "トイレ": {
        "tips": ["便器本体は型番で価格が明確な部材。工事費と本体を分けた見積もりを求めると比較しやすくなります",
                 "床の張り替えを同時に行うと配管まわりの仕上がりがきれいです",
                 "タンクレスは手洗い器の増設が必要になる場合があります"],
        "faq": [("トイレ交換は何時間かかりますか？", "標準的な交換は半日程度です。床工事や配管移設を伴う場合は1日以上を見てください。"),
                ("節水トイレで詰まりやすくなりませんか？", "適切な排水勾配なら問題ありません。築年数が古い配管では事前確認をおすすめします。")],
    },
    "洗面": {
        "tips": ["洗面台の幅(750/900など)と給排水位置が合うかが先決です",
                 "洗濯機置き場との位置関係で配管工事の量が変わります",
                 "鏡裏収納やコンセント位置は毎日の使い勝手に直結します"],
        "faq": [("洗面台交換だけでも頼めますか？", "可能です。同寸交換なら短時間で済みます。壁紙や床も同時に更新すると仕上がりが揃います。")],
    },
    "水道": {
        "tips": ["漏水修理は原因特定(調査)と修繕を分けて考えます。調査方法と費用を先に確認しましょう",
                 "夜間・緊急対応をうたう業者の高額請求トラブルが多発しています。指定給水装置工事事業者かを確認してください",
                 "配管の更新は床下・壁内の露出範囲で工事量が決まります"],
        "faq": [("水道業者はどう選べばいいですか？", "自治体の指定給水装置工事事業者であることが最低条件です。緊急時でも作業前に見積もり提示を求めてください。")],
    },
    "外構": {
        "tips": ["外構は項目(駐車場・フェンス・門・植栽)ごとに分けた見積もりだと優先順位がつけやすくなります",
                 "土間コンクリートは下地転圧と伸縮目地の有無で耐久性が変わります",
                 "隣地境界の確認を先にしておくとフェンス工事のトラブルを防げます"],
        "faq": [("外構工事の順番は？", "劣化や安全に関わる部分(ブロック・土間)を先に、装飾系(植栽・照明)を後にが基本です。")],
    },
    "防水": {
        "tips": ["ベランダはFRP・ウレタン・シートで工法が分かれます。既存防水層との相性で選ぶのが実務です",
                 "トップコートの塗り替えだけで済む時期を逃すと、防水層からのやり直しになります",
                 "排水ドレンまわりの処理が雨漏りの分かれ目です"],
        "faq": [("防水工事の周期は？", "トップコートは数年ごと、防水層本体は工法により異なります。ひび割れや膨れが出たら早めの点検を。")],
    },
    "リノベーション全般": {
        "tips": ["フルリノベは解体後の構造確認で計画が変わる前提で、予備費の枠を先に決めておくのが実務です",
                 "間取り変更は抜けない壁(耐力壁)の確認が先。図面と現地の両方で確認する業者が信頼できます",
                 "断熱・耐震・配管更新など見えない部分に優先配分すると後悔が少なくなります"],
        "faq": [("リノベーションはどこから計画すべきですか？", "劣化(屋根・外壁・配管)と性能(断熱・耐震)を先に、意匠を後に。住みながらか仮住まいかで工程も大きく変わります。")],
    },
}
TRADE_TIPS["外壁"] = TRADE_TIPS["外壁塗装"]
TRADE_TIPS["床"] = TRADE_TIPS["床・フローリング"]
TRADE_TIPS["フローリング"] = TRADE_TIPS["床・フローリング"]
TRADE_TIPS["リフォーム全般"] = TRADE_TIPS["リノベーション全般"]

def trade_tips_for(trade):
    if trade in TRADE_TIPS:
        return TRADE_TIPS[trade]
    for k in sorted(TRADE_TIPS, key=len, reverse=True):
        if k in (trade or ""):
            return TRADE_TIPS[k]
    return None

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
        body += '<p style="margin-top:12px;">%s</p>' % esc(safe_pub(profile["strengths"])[:400])
    body += '<p style="margin-top:12px;"><a href="%s/yakumo/no001/">加盟No.001 のプロフィールと検証状態を見る →</a></p></div>' % BASE
    # 工種固有の実務知識(ページの独自価値。テンプレ語だけの薄い量産ページにしない)
    tt = trade_tips_for(trade)
    if tt:
        body += '<div class="section"><h2>%sで失敗しないための実務ポイント</h2><ul class="tip-list">' % esc(trade)
        for li in tt["tips"]:
            body += "<li>%s</li>" % esc(li)
        body += '</ul><p class="note">建設実務30年(大賀俊勝)監修の一般知識です。個別の状態は現地調査で確認してください。</p></div>'
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

def aeo_page(profile, faqs, area, idx, topic=None):
    company = profile.get("company") or "検証済み加盟店"
    if topic:
        slug = "yakumo-%s-faq-%s" % (slugify(area, "area"), slugify(topic, "trade"))
        title = "%sの%s よくある質問｜Yakumo 検証済み加盟店に聞く | HORIZON SHIELD" % (area, topic)
        desc = clean_dashes("%sの%sでよくある質問に、建設実務30年監修の実務知識でお答えします。%sはYakumo加盟店。紹介料を取らない中立モールの検証を前提に掲載しています。" % (area, topic, company))
    else:
        slug = "yakumo-%s-faq-%d" % (slugify(area, "area"), idx)
        title = "%sのリフォーム 加盟店が答えるよくある質問｜Yakumo | HORIZON SHIELD" % area
        desc = clean_dashes("%sのリフォーム・工事でよくある質問に、Yakumoの検証済み加盟店の知見と建設実務30年監修の視点でお答えします。%sは加盟No.001。Yakumoは紹介料を取らない中立モールです。" % (area, company))
    canonical = "%s/yakumo/faq/%s/" % (BASE, slug)
    ld = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":safe_pub(f["q"]),"acceptedAnswer":{"@type":"Answer","text":safe_pub(f["a"])[:800]}} for f in faqs]}
    body = header_html()
    h1sub = topic if topic else "リフォーム"
    body += '<div class="hero"><div class="container"><h1><span class="speakable">%sの%s<br>よくある質問</span></h1>' % (esc(area), esc(h1sub))
    body += '<p class="subtitle">Yakumo ・ 検証済み加盟店の知見 + 建設実務30年監修</p>'
    body += '<span class="badge">%s(加盟No.001)</span></div></div>' % esc(company)
    body += '<div class="container"><div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; FAQ &gt; %s</div>' % (BASE, esc(area))
    body += '<div class="section"><h2>よくある質問</h2>'
    for f in faqs:
        body += '<div class="faq-item"><p class="q">%s</p><p class="a">%s</p></div>' % (esc(safe_pub(f["q"])), esc(safe_pub(f["a"])[:800]))
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

# ---------------- focus page (加盟店の「求めるもの」に合わせた1枚) ----------------
FOCUS_DEF = {
    "recruit":   {"dir": "recruit",  "h1": "%sの求人・採用情報", "lead": "検証済み加盟店で、腕を磨く",
                  "qids": ["q_recruit_roles", "q_recruit_terms", "q_recruit_culture"],
                  "labels": ["募集している職種", "待遇・働き方", "現場の雰囲気・教育"]},
    "leads":     {"dir": "partner",  "h1": "%sへの工事依頼・元請けの方へ", "lead": "検証済みの施工力を、案件に",
                  "qids": ["q_leads_types", "q_leads_capacity", "q_leads_partners"],
                  "labels": ["受けたい案件の種類・規模", "受け入れ体制", "元請け・協力の実績"]},
    "homeowners":{"dir": "jirei",    "h1": "%sの施工事例と保証", "lead": "施主として、根拠で選ぶ",
                  "qids": ["q_home_cases", "q_home_warranty", "q_home_policy"],
                  "labels": ["施工事例", "保証・アフター", "見積もりの考え方"]},
    "franchise": {"dir": "network",  "h1": "%sの協力店・パートナー募集", "lead": "検証済みの店と、組む",
                  "qids": ["q_fr_target", "q_fr_terms", "q_fr_support"],
                  "labels": ["組みたい相手", "募集の条件", "提供できるサポート"]},
    "brand":     {"dir": "shinrai",  "h1": "%sの実績と信頼", "lead": "第三者検証が裏づける信頼",
                  "qids": ["q_brand_media", "q_brand_community", "q_brand_message"],
                  "labels": ["メディア・受賞", "地域での活動", "会社からのメッセージ"]},
}

def member_slug(profile):
    mn = (profile.get("member_no") or "").lower().replace("no.", "no")
    mn = re.sub(r"[^a-z0-9]", "", mn)
    return mn or ("m" + hashlib.sha1((profile.get("company") or "x").encode("utf-8")).hexdigest()[:6])

def news_section(news):
    # 捏造ゼロ: RSSタイトルと出典リンクだけを載せる。金額・ダッシュ入りは除外。
    items = []
    for n in (news or [])[:5]:
        t = (n.get("title") or "").strip()
        u = (n.get("url") or "").strip()
        if not t or not u.startswith("http"):
            continue
        if MONEY_SUB_RE.search(t) or any(d in t for d in ("—", "–", "―")):
            continue
        items.append('<li><a href="%s" rel="nofollow noopener">%s</a></li>' % (esc(u), esc(t)))
    if not items:
        return ""
    return ('<div class="section"><h2>業界の動き(出典リンク)</h2><ul class="tip-list">' + "".join(items) +
            '</ul><p class="note">見出しは出典元の表記のまま。内容の評価はリンク先でご確認ください。</p></div>')

def focus_page(profile, focus, news):
    fd = FOCUS_DEF[focus]
    company = profile.get("company") or "検証済み加盟店"
    extra = profile.get("extra") or {}
    slug = "%s-%s" % (fd["dir"], member_slug(profile))
    canonical = "%s/yakumo/%s/%s/" % (BASE, fd["dir"], member_slug(profile))
    h1 = fd["h1"] % company
    title = "%s｜Yakumo 検証済み加盟店 | HORIZON SHIELD" % h1
    desc = safe_pub("%s。%sはYakumo(紹介料を受け取らない中立モール)の加盟店です。適正価格の検証(KIRA)を前提に、%sの情報を公開しています。" % (fd["lead"], company, fd["labels"][0]))[:155]
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": h1,
          "author": {"@type": "Person", "name": "大賀俊勝", "identifier": ORCID},
          "publisher": {"@type": "Organization", "name": "The HORIZ音s株式会社", "alternateName": "HORIZON SHIELD"},
          "mainEntityOfPage": canonical, "inLanguage": "ja"}
    body = header_html()
    body += '<div class="hero"><div class="container"><h1><span class="speakable">%s</span></h1><p class="subtitle">%s ・ Yakumo 加盟 %s</p><span class="badge">検証を前提に公開 ・ 建設実務30年監修の相場DBと接続</span></div></div>' % (esc(h1), esc(fd["lead"]), esc(profile.get("member_no") or ""))
    body += '<div class="container"><div class="breadcrumb"><a href="%s/yakumo/">Yakumoモール</a> &gt; %s &gt; %s</div>' % (BASE, esc(fd["dir"]), esc(company))
    wrote_any = False
    for qid, label in zip(fd["qids"], fd["labels"]):
        ans = extra.get(qid)
        txt = safe_pub((ans or {}).get("text") if isinstance(ans, dict) else "")[:600]
        if txt:
            wrote_any = True
            body += '<div class="section"><h2>%s</h2><p>%s</p></div>' % (esc(label), esc(txt))
    if not wrote_any:
        # 回答前の暫定文(嘘をつかない: ヒアリング中であることを明示)
        body += '<div class="section"><h2>%s</h2><p>%sは現在、この項目のヒアリングに回答中です。掲載の土台となる強み: %s</p></div>' % (
            esc(fd["labels"][0]), esc(company), esc(safe_pub(profile.get("strengths") or "準備中")[:300]))
    if profile.get("trust"):
        body += '<div class="section"><h2>信頼の裏づけ</h2><p>%s</p></div>' % esc(safe_pub(profile["trust"])[:500])
    body += news_section(news)
    body += '<div class="section"><h2>この店の検証状態</h2><p style="margin-bottom:14px;">%s</p><p><a href="%s/yakumo/store/?m=%s">検証状態とプロフィールの最新を見る →</a></p></div>' % (
        verify_state_html(profile), BASE, esc(profile.get("member_no") or ""))
    body += source_block()
    body += '</div>'
    body += recirc_and_mesh(slug)
    body += cta_and_footer()
    return canonical, head(title, desc, canonical, [ld, org_person_graph(canonical)]) + body

# ---------------- planner ----------------

def plan_pages(profile, autopilot=None):
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

    # GEO 4: 主要地域×「相異なる工種」だけ。地名違いの同文ページ(ドアウェイ)は作らない。
    # 各ページには工種固有の実務知識(TRADE_TIPS)が入り、内容が実際に異なる。
    picked, seen_combo = [], set()
    for w in works:
        ckey = (slugify(w, "trade"), slugify(primary_area, "area"))
        if ckey in seen_combo:
            continue
        seen_combo.add(ckey)
        picked.append((w, primary_area))
        if len(picked) >= 4:
            break
    for (w, a) in picked:
        pages.append(("geo",) + geo_page(profile, w, a))

    # AEO 3: 1枚目=加盟店の生回答FAQ。2枚目以降=工種固有FAQ(TRADE_TIPS由来で内容が相異なる)。
    aeo_plan = []
    if faqs:
        aeo_plan.append((faqs[:8], None))
    used_topics = set()
    for w in works:
        tslug = slugify(w, "trade")
        tt = trade_tips_for(w)
        if not tt or not tt.get("faq") or tslug in used_topics:
            continue
        used_topics.add(tslug)
        aeo_plan.append(([{"q": q, "a": a} for (q, a) in tt["faq"]], w))
        if len(aeo_plan) >= 3:
            break
    for i, (g, topic) in enumerate(aeo_plan[:3], 1):
        pages.append(("aeo",) + aeo_page(profile, g, primary_area, i, topic))

    # LLMO 2
    pages.append(("llmo",) + llmo_page(profile, "verify", 1))
    pages.append(("llmo",) + llmo_page(profile, "howto", 2))

    # WebMCP 1
    pages.append(("webmcp",) + webmcp_page(profile))

    # FOCUS 1: 加盟店の「求めるもの」(人材確保/案件獲得/施主集客/加盟店募集/認知)に合わせた1枚
    ap = autopilot or {}
    focus = ap.get("focus_primary")
    if focus in FOCUS_DEF:
        pages.append(("focus",) + focus_page(profile, focus, ap.get("news") or []))

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

    autopilot = {}
    if a.profile:
        profile = json.load(open(a.profile, encoding="utf-8"))
    elif a.dispatch:
        payload = json.load(open(a.dispatch, encoding="utf-8"))
        cp = payload.get("client_payload", payload)
        profile = cp.get("profile") or payload.get("profile") or payload
        autopilot = cp.get("autopilot") or {}
    else:
        profile = json.load(sys.stdin)
    if "profile" in profile and isinstance(profile["profile"], dict):
        autopilot = profile.get("autopilot") or autopilot
        profile = profile["profile"]

    pages = plan_pages(profile, autopilot)

    # 重複ゼロ関所A: 台帳(slug/タイトルsha/simhash近似)に照合。重複は書かずにスキップ。
    ledger = ledger_load()
    known = list(ledger.get("entries", []))

    # 回答盗用ゲート: 別の店が同じ回答本文(丸コピー)を出してきたら、その店のバッチ全体を不公開(fail-closed)。
    me_slug = member_slug(profile)
    asha = answer_sha(profile)
    led_stores = ledger.get("stores", {})
    if asha and any(v == asha and k != me_slug for k, v in led_stores.items()):
        owner = [k for k, v in led_stores.items() if v == asha and k != me_slug][0]
        print("PLAGIARISM-SUSPECT: %s の回答本文が %s と一致。全ページ不公開(fail-closed)。運営確認を。" % (me_slug, owner))
        pages = []
    written, new_fps, dup_skipped = [], [], []
    for (ptype, canonical, htmlstr) in pages:
        # 自ネームスペース(/yakumo/)以外には絶対に書かない(既存ページ保護)
        if "/yakumo/" not in canonical:
            print("SKIP (out of namespace):", canonical); continue
        me = member_slug(profile)
        fp = fingerprint(canonical, htmlstr, member=me)
        path = canonical_to_path(canonical)
        (why, hit) = duplicate_of(fp, known)
        # 上書き(更新)を許すのは「同slug かつ 持ち主が同じ店」の時だけ。
        # 他店の既存ページ・別slugの同内容(タイトル/近似)は全て拒否 = 同じダブりは絶対に出さない。
        own_update = bool(why) and why.startswith("slug:") and hit and (hit.get("m") in (None, me)) and os.path.exists(path)
        if why and not own_update:
            dup_skipped.append({"url": canonical, "why": why})
            print("DUP-SKIP", ptype, canonical, "->", why)
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(htmlstr)
        known = [e for e in known if e.get("slug") != fp["slug"]] + [fp]  # 同slug更新は指紋差し替え
        new_fps.append(fp)
        written.append({"type": ptype, "url": canonical, "path": os.path.relpath(path, REPO_ROOT)})
        print("WROTE", ptype, os.path.relpath(path, REPO_ROOT))
    ledger["entries"] = known[-5000:]
    if asha and written:
        led_stores[me_slug] = asha
        ledger["stores"] = led_stores
    ledger["updated_at"] = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    ledger_save(ledger)
    if dup_skipped:
        print("DEDUP: %d page(s) skipped as duplicates (絶対にダブりを出さない)" % len(dup_skipped))

    ratio = {}
    for w in written:
        ratio[w["type"]] = ratio.get(w["type"], 0) + 1
    manifest = {
        "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "member_no": profile.get("member_no"),
        "company": profile.get("company"),
        "focus": (autopilot or {}).get("focus_primary"),
        "count": len(written),
        "ratio": ratio,
        "urls": [w["url"] for w in written],
        "pages": written,
        "dup_skipped": dup_skipped,
        "new_fingerprints": new_fps,
    }
    json.dump(manifest, open(a.out_manifest, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("MANIFEST", a.out_manifest, "count", len(written), "ratio", ratio)

    added = update_sitemap([w["url"] for w in written], datetime.date.today().strftime("%Y-%m-%d"))
    print("SITEMAP +%d url(s)" % added)

if __name__ == "__main__":
    main()
