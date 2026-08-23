# -*- coding: utf-8 -*-
"""
訪問看護 事業所ページ 生成器 (GEO/AEO/LLMO/WebMCP 黄金比)

なぜ generate.py を改造せず、別に作るのか:
  tools/yakumo/generate.py は建設の加盟店が現に使っている生きたパイプラインである。
  工種、相場、JCCDB、建設業許可、モールへの必須バックリンク、
  「先輩職人が段階的に技術を伝えます」という文面。すべて建設の前提の上に立っている。
  それを訪問看護1件のために作り変えて不安定にする理由が無い。
  受け継ぐのは規律であって、コードではない。

受け継ぐ規律:
  ・重複を作らない(指紋台帳で近似重複も拒む)
  ・全ページに canonical / description / robots / author / JSON-LD
  ・金額を出さない
  ・禁止ダッシュを使わない
  ・黄金比で本数を決める。ただし本数は autopilot.golden_ratio から取る。数え方を埋め込まない。
  ・fail-closed。検証を通らなければ公開しない(validate.py が門)

訪問看護でだけ守ること:
  ・言われていない医療処置を書かない。works にあるものだけを書く。
  ・「要相談」「全域」などの条件を落とさない。落とすと、
    ケアマネさんに対して、ご本人が言っていない範囲を対応可能と名乗ることになる。
  ・単位数・加算・算定の可否を書かない。JHNRD の規律と同じで、
    「算定できます」を言った瞬間に、返戻の責任の所在が壊れる。
  ・Yakumo のモールに載せない。あれは建設業向けであり、
    訪問看護は対象外だと industry.js が既に決めている(mall: null)。
"""

import argparse, hashlib, json, os, re, sys, unicodedata

BASE = "https://shield.the-horizons-innovation.com"
ROOT = "care"                      # 出力の名前空間。/yakumo/ ではない。
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# 黄金比の既定。dispatch が golden_ratio を持っていればそちらが優先される。
DEFAULT_RATIO = {"geo": 40, "aeo": 30, "llmo": 20, "webmcp": 10}
BATCH = 10                          # 比を本数に直すときの分母

FORBIDDEN_DASH = "—–―"
MONEY_RE = re.compile(r"(¥\s*\d|\d[\d,]*\s*円|\d+\s*万円|\d+\s*単位|\d+\s*点)")


# --------------------------------------------------------------------------
# 言葉の扱い
# --------------------------------------------------------------------------
def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def no_dash(s):
    """禁止ダッシュを混ぜない。検証器が弾く前に、ここで入れない。"""
    for ch in FORBIDDEN_DASH:
        s = s.replace(ch, "、")
    return s


def slugify(s, prefix):
    """日本語はローマ字化しない。安定したハッシュに落とす。
    読めるスラッグより、同じ語がいつも同じスラッグになることを優先する。"""
    t = unicodedata.normalize("NFKC", str(s or "")).strip()
    ascii_part = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
    if ascii_part and len(ascii_part) >= 3:
        return ascii_part[:40]
    return prefix + "-" + hashlib.sha1(t.encode("utf-8")).hexdigest()[:8]


AREA_QUALIFIER = re.compile(r"[（(]?\s*(要相談|応相談|要確認|一部|全域)\s*[）)]?\s*$")


def split_area(a):
    """「二宮町(要相談)」を、地名と条件に分ける。条件は捨てない。

    落とすと、ご本人が言っていない範囲を対応可能として公開することになる。
    2026-08-23、抽出がこれを落とし、あとで手で戻した。二度としない。
    """
    s = str(a or "").strip()
    m = AREA_QUALIFIER.search(s)
    if not m:
        return s, ""
    return s[:m.start()].strip(" 　（）()"), m.group(1)


def area_phrase(a):
    """本文に書くときの言い方。条件つきなら、条件を必ず添える。"""
    name, q = split_area(a)
    if not q:
        return name
    if q == "全域":
        return name + "全域"
    return name + "(" + q + ")"


# --------------------------------------------------------------------------
# 骨組み
# --------------------------------------------------------------------------
def org_graph(canonical, profile):
    """このページの出所。建設のときの JCCDB ではなく JHNRD を指す。

    Dataset を貼るのは、数字の裏づけがあると言うためではない。
    どの物差しを使っているかを、読む側と機械に見せるためである。
    JHNRD はまだ8項目で、そのことも JHNRD 側に書いてある。
    """
    company = profile.get("company") or ""
    areas = [area_phrase(a) for a in (profile.get("areas_served") or []) if a]
    works = [w for w in (profile.get("works") or []) if w]
    g = [
        {"@type": "Organization", "@id": BASE + "/#org", "name": "HORIZON SHIELD",
         "url": BASE + "/"},
        {"@type": "Person", "@id": BASE + "/#toshi", "name": "大賀俊勝",
         "url": "https://orcid.org/0009-0000-9180-903X"},
        {"@type": "Dataset", "@id": BASE + "/#jhnrd",
         "name": "JHNRD 訪問看護 算定要件データベース",
         "description": "訪問看護の減算・加算・指示書の期限について、要件と、その要件がどの資料に基づくかを記録したもの。",
         "url": "https://github.com/ogasurfproject-jpg/jhnrd"},
        {"@type": "WebPage", "@id": canonical + "#page",
         "url": canonical, "isPartOf": {"@id": BASE + "/#org"},
         "author": {"@id": BASE + "/#toshi"}},
    ]
    if company:
        biz = {"@type": "MedicalBusiness", "@id": canonical + "#provider",
               "name": company}
        if areas:
            biz["areaServed"] = areas
        if works:
            # 言われた処置だけ。増やさない。
            biz["availableService"] = [{"@type": "MedicalProcedure", "name": w} for w in works[:20]]
        g.append(biz)
    return {"@context": "https://schema.org", "@graph": g}


def head(title, desc, canonical, profile, extra_ld=None):
    title = no_dash(title)
    desc = no_dash(desc)
    blocks = [org_graph(canonical, profile)]
    if extra_ld:
        blocks.append(extra_ld)
    ld = "\n".join(
        '<script type="application/ld+json">%s</script>' % json.dumps(b, ensure_ascii=False)
        for b in blocks)
    return (
        '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<title>%s</title>\n'
        '<meta name="description" content="%s">\n'
        '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">\n'
        '<meta name="author" content="The HORIZONs株式会社 / HORIZON SHIELD">\n'
        '<link rel="canonical" href="%s">\n'
        '<meta property="og:type" content="website">\n'
        '<meta property="og:title" content="%s">\n'
        '<meta property="og:description" content="%s">\n'
        '<meta property="og:url" content="%s">\n'
        '%s\n</head>\n<body>\n'
    ) % (esc(title), esc(desc), esc(canonical), esc(title), esc(desc), esc(canonical), ld)


def source_block(profile):
    """出典。建設費データベースではない。

    ここに「算定できます」を一切書かない。書けるのは、どの物差しを見ているかまで。
    """
    return (
        '<section class="sources">\n'
        '<h2>このページの出どころ</h2>\n'
        '<ul>\n'
        '<li>事業所の情報: %s さまご本人からの回答(HORIZON SHIELD の自動ヒアリング)。'
        'こちらが確認できていないことは、書いていません。</li>\n'
        '<li>制度の要件: <a href="https://github.com/ogasurfproject-jpg/jhnrd">'
        'JHNRD 訪問看護 算定要件データベース</a>。'
        '要件ごとに、どの資料に基づくかと、まだ確認できていないものを公開しています。</li>\n'
        '<li>運営: The HORIZONs株式会社(法人番号 7021001075279)、'
        '監修 <a href="https://orcid.org/0009-0000-9180-903X">大賀俊勝</a></li>\n'
        '</ul>\n'
        '<p>加算や単位数の可否について、このページでは判断していません。'
        '判断すると、返戻になったときに責任の所在が壊れるためです。</p>\n'
        '</section>\n'
    ) % esc(profile.get("company") or "事業所")


def footer(profile, member_root):
    """バックリンク。建設のモール(/yakumo/)ではなく、この事業所の窓口へ。

    訪問看護は Yakumo の対象外なので、モールへ送ってはいけない。
    送れば、訪問看護を探している人が建設のモールに着く。
    """
    return (
        '<footer>\n'
        '<p><a href="%s">%s の窓口</a> ・ '
        '<a href="%s/">HORIZON SHIELD</a></p>\n'
        '<p>掲載の順序や表示は売り物ではありません。紹介手数料も受け取っていません。</p>\n'
        '<p>この内容に誤りがあれば、お知らせください。訂正は不具合として扱い、'
        '元の記述を消さずに直します。消すと、訂正が正しかったかどうかを'
        '後から確かめられなくなるためです。</p>\n'
        '<p>contact@the-horizons-innovation.com</p>\n'
        '</footer>\n</body>\n</html>\n'
    ) % (esc(member_root), esc(profile.get("company") or "事業所"), BASE)


# --------------------------------------------------------------------------
# ページ
# --------------------------------------------------------------------------
def member_slug(profile):
    """事業所の URL。

    日本語の社名はローマ字化できないので、既定ではハッシュになる。
    ハッシュの URL は読めないし、GEO の効きも落ちる。
    そこで profile.slug があればそれを使う。ここは事業所ごとに、
    人が決めて入れる欄である。自動で当てずっぽうのローマ字を作らない。
    (「あっぷす」を appusu と読むか apps と読むかは、こちらが決めることではない)
    """
    explicit = str(profile.get("slug") or "").strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9-]{1,38}[a-z0-9]", explicit or ""):
        return explicit
    return slugify(profile.get("company"), "member")


def member_root(profile):
    return BASE + "/" + ROOT + "/" + member_slug(profile) + "/"


def page_window(profile):
    """窓口。ケアマネさんが最初に着くところ。バックリンクの宛先でもある。"""
    company = profile.get("company") or "訪問看護事業所"
    canonical = member_root(profile)
    areas = [area_phrase(a) for a in (profile.get("areas_served") or []) if a]
    works = [w for w in (profile.get("works") or []) if w]
    title = "%s ・ 訪問看護の窓口" % company
    desc = "%s の対応エリアと、対応できる医療処置。ケアマネジャーの方が確認しやすい形でまとめています。" % company

    body = ['<main>\n<h1>%s</h1>\n' % esc(company)]
    if areas:
        body.append('<section><h2>訪問できるエリア</h2>\n<ul>\n')
        for a in (profile.get("areas_served") or []):
            name, q = split_area(a)
            if q and q != "全域":
                body.append('<li>%s <span class="cond">(%s)</span></li>\n' % (esc(name), esc(q)))
            else:
                body.append('<li>%s</li>\n' % esc(area_phrase(a)))
        body.append('</ul>\n<p>括弧の付いた地域は、ご相談のうえでの対応になります。'
                    'このページでは、その条件を省かずに書いています。</p>\n</section>\n')
    if works:
        body.append('<section><h2>対応できる医療処置</h2>\n<ul>\n')
        for w in works:
            body.append('<li>%s</li>\n' % esc(w))
        body.append('</ul>\n<p>ここに挙げているのは、事業所ご本人が挙げられたものだけです。'
                    'こちらで足したものはありません。</p>\n</section>\n')
    if profile.get("strengths"):
        body.append('<section><h2>この事業所について</h2>\n<p>%s</p>\n</section>\n'
                    % esc(no_dash(profile["strengths"])))
    if profile.get("contact"):
        body.append('<section><h2>連絡先</h2>\n<p>%s</p>\n</section>\n'
                    % esc(no_dash(profile["contact"])))
    body.append('</main>\n')
    return canonical, head(title, desc, canonical, profile) + "".join(body) + \
        source_block(profile) + footer(profile, canonical)


def page_geo(profile, work, area, n):
    """地域 × 医療処置。ケアマネさんが実際に探す形。"""
    company = profile.get("company") or "訪問看護事業所"
    ap = area_phrase(area)
    name, q = split_area(area)
    # 地名も処置名も日本語なのでハッシュになる。profile.area_slugs があれば使う。
    # 読めるURLは効くが、当てずっぽうのローマ字を機械が作ると、
    # 地名を読み違えたURLが恒久的に残る。人が入れたものだけ使う。
    aslug = (profile.get("area_slugs") or {}).get(name)
    wslug = (profile.get("work_slugs") or {}).get(work)
    if aslug and wslug:
        seg = re.sub(r"[^a-z0-9-]", "", (str(aslug) + "-" + str(wslug)).lower())[:48]
    else:
        seg = slugify(name + "-" + work, "geo")
    canonical = member_root(profile) + "area/" + seg + "/"
    title = "%s で %s に対応できる訪問看護 ・ %s" % (name, work, company)
    desc = "%s の %s 対応について、%s が対応できる範囲をまとめています。" % (name, work, company)
    cond = ""
    if q and q != "全域":
        cond = ('<p><strong>%s は、ご相談のうえでの対応になります。</strong>'
                'エリアに含めて書いていますが、必ず対応できるという意味ではありません。'
                'ご本人がそう説明されているので、そのまま書いています。</p>\n' % esc(name))
    # この処置について、事業所ご本人が書かれたことがあれば入れる。
    # 無ければ入れない。医療の中身をこちらで書いて、事業所の名前で出さない。
    note = (profile.get("work_notes") or {}).get(work) or ""
    note_html = ""
    if note:
        note_html = ('<section>\n<h2>%s について、この事業所から</h2>\n<p>%s</p>\n'
                     '<p>ここはご本人の言葉です。こちらで補ったものはありません。</p>\n'
                     '</section>\n') % (esc(work), esc(no_dash(note)))

    body = (
        '<main>\n<h1>%s で %s に対応できる訪問看護</h1>\n'
        '<section>\n<p>%s は %s を訪問エリアに挙げており、%s に対応できると回答しています。</p>\n'
        '%s'
        '<p>受け入れの可否は、その時々の状況で変わります。このページは、'
        '事業所が挙げた範囲を書いたものであって、いま空きがあることを示すものではありません。</p>\n'
        '</section>\n%s</main>\n'
    ) % (esc(name), esc(work), esc(company), esc(ap), esc(work), cond, note_html)
    return canonical, head(title, desc, canonical, profile) + body + \
        source_block(profile) + footer(profile, member_root(profile))


def page_aeo(profile, group, n):
    company = profile.get("company") or "訪問看護事業所"
    canonical = member_root(profile) + "faq/" + str(n) + "/"
    title = "%s ・ よくあるご質問 %d" % (company, n)
    desc = "%s に、ケアマネジャーやご家族からよく寄せられる質問と回答です。" % company
    ld = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": no_dash(q),
         "acceptedAnswer": {"@type": "Answer", "text": no_dash(a)}}
        for (q, a) in group]}
    body = ['<main>\n<h1>よくあるご質問</h1>\n']
    for (q, a) in group:
        body.append('<section><h2>%s</h2>\n<p>%s</p>\n</section>\n'
                    % (esc(no_dash(q)), esc(no_dash(a))))
    body.append('<p>ここに載せているのは、事業所ご本人の回答です。'
                'こちらで一般論に書き換えたものはありません。</p>\n</main>\n')
    return canonical, head(title, desc, canonical, profile, ld) + "".join(body) + \
        source_block(profile) + footer(profile, member_root(profile))


LLMO_TOPICS = {
    "choose": {
        "title": "ケアマネジャーが訪問看護を選ぶとき、何を見ているか",
        "desc": "対応エリア、できる医療処置、24時間の体制、受け入れの空き。順番と理由。",
        "paras": [
            "訪問看護の相談は、多くの場合、担当のケアマネジャーから始まります。"
            "そのとき先に確かめられるのは、たいてい四つです。訪問できるエリアに入っているか、"
            "必要な医療処置ができるか、夜間や緊急のときに動けるか、そしていま受け入れられるか。",
            "この四つのうち、前の二つは事業所ごとに決まっていて、あまり動きません。"
            "後の二つは、その週の状況で変わります。動かないものは書いておけますが、"
            "動くものを書いておくと、すぐ嘘になります。だからこのページ群では、"
            "前の二つだけを書き、後の二つは直接お尋ねくださいと書いています。",
            "エリアについて、条件つきの地域を条件なしで並べている一覧をときどき見かけます。"
            "探す側からすると、対応できると読めます。実際は相談してみないと分からない。"
            "ここでは、事業所が「要相談」と説明された地域は、その言葉ごと書いています。",
        ],
    },
    "verify": {
        "title": "この情報は、どこまで確かめられているか",
        "desc": "事業所ご本人の回答と、制度の要件。どちらがどこから来ているか。",
        "paras": [
            "このページに書かれている事業所の情報は、すべて事業所ご本人からの回答です。"
            "こちらで調べて足したものはありません。ご本人が挙げていない医療処置は書いていませんし、"
            "挙げた言葉を言い換えてもいません。",
            "制度の側、つまり訪問看護の加算や減算の要件については、"
            "JHNRD という公開のデータベースにまとめています。そこには、"
            "どの要件がどの資料に基づくのか、そして、まだ確認できていない要件はどれかが書いてあります。"
            "確認できていないものを、確認したかのようには書きません。",
            "算定の可否について、このページでは判断していません。"
            "こちらが可否を言い切った瞬間に、返戻になったときの責任の所在が壊れるからです。"
            "言えるのは、その要件が何であって、どこまで確かめられているか、までです。",
        ],
    },
}


def page_llmo(profile, key, n):
    company = profile.get("company") or "訪問看護事業所"
    t = LLMO_TOPICS[key]
    canonical = member_root(profile) + "about/" + key + "/"
    title = "%s ・ %s" % (t["title"], company)
    ld = {"@context": "https://schema.org", "@type": "Article",
          "headline": no_dash(t["title"]), "author": {"@id": BASE + "/#toshi"},
          "mainEntityOfPage": canonical}
    body = ['<main>\n<h1>%s</h1>\n' % esc(t["title"])]
    for p in t["paras"]:
        body.append("<p>%s</p>\n" % esc(no_dash(p)))
    body.append('</main>\n')
    return canonical, head(title, t["desc"], canonical, profile, ld) + "".join(body) + \
        source_block(profile) + footer(profile, member_root(profile))


def page_webmcp(profile):
    company = profile.get("company") or "訪問看護事業所"
    canonical = member_root(profile) + "mcp/"
    title = "%s ・ AIから問い合わせるための窓口" % company
    desc = "%s の対応エリアと医療処置を、AIが読み取れる形で公開しています。" % company
    ld = {"@context": "https://schema.org", "@type": "WebAPI",
          "name": company + " 情報エンドポイント",
          "documentation": canonical,
          "provider": {"@id": BASE + "/#org"}}
    body = (
        '<main>\n<h1>AI から問い合わせるための窓口</h1>\n'
        '<section>\n'
        '<p>ケアマネジャーやご家族が、AI に「この地域で %s に対応できる訪問看護は」と'
        '尋ねることが増えています。そのとき AI がこの事業所を知らなければ、'
        '答えに出てきません。</p>\n'
        '<p>このページ群は、その問いに答えられる形で書いてあります。'
        '対応エリアも医療処置も、事業所ご本人の言葉のまま、条件を落とさずに置いてあります。</p>\n'
        '<p>受け入れの空きや予約の可否は、ここには含めていません。'
        'その時々で変わるものを機械が読める形で置くと、古いまま答え続けるためです。</p>\n'
        '</section>\n</main>\n'
    ) % esc((profile.get("works") or ["在宅での医療処置"])[0])
    return canonical, head(title, desc, canonical, profile, ld) + body + \
        source_block(profile) + footer(profile, member_root(profile))


# --------------------------------------------------------------------------
# 本数を決める
# --------------------------------------------------------------------------
def counts_from_ratio(ratio, batch=BATCH):
    """比を本数に直す。数え方を埋め込まない。

    generate.py は 4:3:2:1 を for ループの上限として直に書いていた。
    比を変えたければコードを直すしかない。ここは受け取った比から計算する。
    """
    r = dict(DEFAULT_RATIO)
    if isinstance(ratio, dict):
        for k in DEFAULT_RATIO:
            v = ratio.get(k)
            if isinstance(v, (int, float)) and v >= 0:
                r[k] = v
    total = sum(r.values()) or 1
    out = {k: int(round(batch * v / total)) for k, v in r.items()}
    for k in out:
        if r[k] > 0 and out[k] < 1:
            out[k] = 1
    return out


def plan(profile, autopilot):
    ap = autopilot or {}
    n = counts_from_ratio(ap.get("golden_ratio"))
    works = [w for w in (profile.get("works") or []) if w]
    areas = [a for a in (profile.get("areas_served") or []) if a]
    faqs = profile.get("faqs") or []
    pages = [("window",) + page_window(profile)]

    # GEO: 地域 × 処置。両方をずらして進める。
    #
    # 地域を固定して処置だけ変えると、その地域のページばかりになる。
    # 処置を固定して地域だけ変えると、地名だけ違う同文のページになる。
    # 後者は、まさに generate.py が「ドアウェイを作らない」として避けている形。
    # 斜めに進めて、地域も処置も毎回変える。中身が本当に違うページになる。
    # 中身が本当に違うページだけ作る。
    #
    # 2026-08-23。地域と処置の名前だけを変えて4枚作ったところ、
    # 重複検出が3組を近似重複として弾いた。周りの文が同一だったからである。
    # それはドアウェイページであって、まさに避けるべき形だった。
    #
    # 数を合わせるために中身を水増しすることはしない。
    # 医療の内容をこちらで書いて、事業所の名前で公開することになるので。
    # 事業所ご本人がその処置について書かれたもの(work_notes)がある処置だけ、
    # 独立したページにする。無ければ窓口ページ1枚にまとめる。
    # 比は目標であって、埋めるべき枠ではない。
    # 中身の量に下限を置く。
    #
    # 経緯 (2026-08-23):
    #   処置ごとに違う説明を入れても、重複検出が3組を近似重複として弾いた。
    #   周りの定型文が多く、独自の部分が埋もれていたためである。門は正しかった。
    #   通るまで文面を調整するのは門を騙すことになるので、そうはしなかった。
    #   直したのは二つ。全ページ共通の節を GEO から外したこと、そして下限を置いたこと。
    #
    # 下限の数字を、推測で決めなかった:
    #   最初 160 字と置いたが、根拠が無かった。実際の回答は 147〜155 字で、
    #   軒並み下回っていた。そこで本物の文を切り詰めて測ったところ、
    #   定型節を外したあとは 90 字でも重複検出を通った。
    #   つまり下限は、重複を避けるためには要らない。
    #
    # では何のために置くのか:
    #   二文しかない独自内容のページを公開しないため。これは検査を通るかどうかとは別の話で、
    #   読む人にとって役に立つかどうかの話である。建設側が strengths に使っている
    #   120 字に揃える。数字の出どころを、ここに書いておく。
    MIN_NOTE = 120
    notes = profile.get("work_notes") or {}
    with_content = [w for w in works if len(str(notes.get(w) or "").strip()) >= MIN_NOTE]
    made, seen = 0, set()
    i = 0
    limit = len(areas) * len(with_content) + 4
    while made < n["geo"] and i < limit and areas and with_content:
        a = areas[i % len(areas)]
        w = with_content[i % len(with_content)]
        i += 1
        key = (slugify(split_area(a)[0], "a"), slugify(w, "w"))
        if key in seen:
            continue
        seen.add(key)
        made += 1
        pages.append(("geo",) + page_geo(profile, w, a, made))
    geo_note = None
    if made < n["geo"]:
        short = [w for w in works
                 if 0 < len(str(notes.get(w) or "").strip()) < MIN_NOTE]
        geo_note = ("黄金比は geo %d 枚を求めているが、独自の中身が %d 文字以上ある処置が "
                    "%d 件しかないので、その枚数にとどめた。数を合わせるために似たページは作らない。"
                    % (n["geo"], MIN_NOTE, made))
        if short:
            geo_note += " 説明はあるが短い処置: " + "、".join(short) + "。"

    # AEO: ご本人の回答した FAQ だけ。無ければ作らない。
    # 一般論の FAQ をこちらで書いて事業所の名前で出すことはしない。
    for i in range(n["aeo"]):
        chunk = [(f.get("q"), f.get("a")) for f in faqs[i * 3:(i + 1) * 3]
                 if f.get("q") and f.get("a")]
        if not chunk:
            break
        pages.append(("aeo",) + page_aeo(profile, chunk, i + 1))

    # LLMO
    for i, key in enumerate(list(LLMO_TOPICS)[:n["llmo"]], 1):
        pages.append(("llmo",) + page_llmo(profile, key, i))

    # WebMCP
    for _ in range(n["webmcp"]):
        pages.append(("webmcp",) + page_webmcp(profile))
    return pages, n, geo_note


# --------------------------------------------------------------------------
# 出力
# --------------------------------------------------------------------------
def canonical_to_path(canonical):
    rel = canonical.replace(BASE + "/", "")
    if not rel.endswith("/"):
        rel += "/"
    return rel + "index.html"


def self_check(pages):
    """書き出す前に、自分で見る。検証器に頼り切らない。"""
    errs = []
    for (kind, canonical, html) in pages:
        where = kind + " " + canonical
        for ch in FORBIDDEN_DASH:
            if ch in html:
                errs.append("%s: 禁止ダッシュ" % where)
        vis = re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S))
        m = MONEY_RE.search(vis)
        if m:
            errs.append("%s: 金額や単位数が出ている (%s)" % (where, m.group(0).strip()))
        # 断定の言い方を、本文に置かない。
        # 2026-08-23、この検査が自分の書いた文を弾いた。「こうは言わない」と
        # 説明するために、その言い方を本文に書いていたためである。
        # 検査を緩めず、文の方を書き直した。説明のための引用でも、
        # 抜き出されれば断定として読まれる。
        for w in ("算定できます", "算定可能", "減算されます", "問題ありません"):
            if w in vis:
                errs.append("%s: 断定「%s」" % (where, w))
        if '<link rel="canonical" href="%s">' % canonical not in html:
            errs.append("%s: canonical が本文と一致しない" % where)
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dispatch")
    ap.add_argument("--profile")
    ap.add_argument("--out-root", default=REPO_ROOT)
    ap.add_argument("--dry-run", action="store_true")
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

    ind = (autopilot.get("industry") or profile.get("industry") or "")
    if ind != "nursing":
        sys.stderr.write(
            "\nこの生成器は訪問看護専用です。\n"
            "  受け取った業種: %s\n"
            "  建設・リフォームは tools/yakumo/generate.py が扱います。\n\n" % (ind or "(無し)"))
        sys.exit(4)

    if not profile.get("company"):
        sys.stderr.write("\n事業所名がありません。名前の無いページは作りません。\n\n")
        sys.exit(5)

    pages, n, geo_note = plan(profile, autopilot)
    errs = self_check(pages)
    if errs:
        sys.stderr.write("\n書き出す前の自己点検で止まりました。\n")
        for e in errs:
            sys.stderr.write("  ・" + e + "\n")
        sys.stderr.write("\n")
        sys.exit(6)

    print("業種      : nursing")
    print("事業所    : %s" % profile.get("company"))
    print("黄金比    : geo %d / aeo %d / llmo %d / webmcp %d (合計 %d本の想定)"
          % (n["geo"], n["aeo"], n["llmo"], n["webmcp"], sum(n.values())))
    print("実際に作る: %d 枚" % len(pages))
    if geo_note:
        print("  ※ " + geo_note)
    written = []
    for (kind, canonical, html) in pages:
        rel = canonical_to_path(canonical)
        print("  %-8s %s" % (kind, rel))
        if a.dry_run:
            continue
        full = os.path.join(a.out_root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(html)
        written.append(rel)

    if not a.dry_run:
        man = os.path.join(a.out_root, "tools", "care", "last_manifest.json")
        os.makedirs(os.path.dirname(man), exist_ok=True)
        with open(man, "w", encoding="utf-8") as f:
            json.dump({"industry": "nursing", "company": profile.get("company"),
                       "paths": written, "ratio": n}, f, ensure_ascii=False, indent=2)
        print("\n書いた: %d 枚 / manifest: tools/care/last_manifest.json" % len(written))
        print("公開の前に validate.py を通してください。通らなければ公開しません。")


if __name__ == "__main__":
    main()
