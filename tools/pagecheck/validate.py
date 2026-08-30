# -*- coding: utf-8 -*-
"""
公開前ページ検証 (fail-closed) ・ 業種に属さない共通の門

2026-08-23 に tools/yakumo/ からここへ移した。
合同会社あっぷす様(訪問看護)は Yakumo に加盟していないのに、
あっぷす様のページを公開できるかどうかを Yakumo の門が決めていたため。

検査の中身は移動前と一字一句同じである。Yakumo に属していたのは
名前と、モール(/yakumo/)へのバックリンク1件だけで、それは既に
置き場所で分岐するようにしてある。

目的: 「絶対に Google / Bing にエラーを出さない」ための静的関所。
1枚でも落ちたらバッチ全体を不適格(exit 1)にする。GitHub Action はこれが通った時だけ commit する。

チェック項目(各ページ):
  - HTML基本構造(<html> / <title> / </html>)
  - <script type="application/ld+json"> が全て正当なJSONで @context/@type を持つ
  - canonical が存在し、ファイルパスから導かれる正規URLと一致
  - 必須メタ(title / description / robots=index,follow / author)
  - 禁止語(MOAT語。下の MOAT_FORBIDDEN、逆順表記)が本文に無い
  - em/en/bar dash(U+2014/2013/2015) が無い
  - 金額数字(¥1,234 / 1,234円 / 12万円 等)が無い(施主向け加盟店面は金額非表示)。
    ただし採用ページ(/recruit/)は求人給与の表示が必要なため、可視テキストの金額チェックを免除する。
  - バックリンク(認知度導線)。置き場所で宛先が変わる:
      yakumo/ の下 -> モール(/yakumo/)へ。建設の加盟店モール。
      care/ の下   -> その事業所自身の窓口(/care/<slug>/)へ。
                      訪問看護は Yakumo の対象外なので、モールへ送らない。
      いずれも HORIZON SHIELD ルートへのバックリンクは必須。
  - 内部リンクが絶対URL(https://shield.the-horizons-innovation.com/...)で壊れていない形

使い方:
  python3 tools/yakumo/validate.py --manifest tools/yakumo/last_manifest.json
  python3 tools/yakumo/validate.py --paths yakumo/souba/xxx/index.html ...
"""
import argparse, json, sys, os, re
import html as _html
import unicodedata

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# 2026-08-24: 門が見る根を、外から変えられるようにした。
#   これまでは自分のファイル位置から決めた1箇所だけを見ていた。
#   そのため、リポジトリの外に書き出した束を門に通すことができず、
#   「生成 -> 門」の配線を、本物のリポジトリを汚さずに試す方法が無かった。
#   実際に試したとき、ファイルは在るのに5枚とも FILE_MISSING と出た。
#   在るものを「無い」と言ったのは、見る場所が違っていたからである。
#   計器の指す先を変えられないと、計器そのものを試せない。
def _set_root(path):
    global REPO_ROOT
    REPO_ROOT = os.path.abspath(path)


if os.environ.get("PAGECHECK_ROOT"):
    _set_root(os.environ["PAGECHECK_ROOT"])
BASE = "https://shield.the-horizons-innovation.com"
MOAT_FORBIDDEN = [s[::-1] for s in ["5.23", "dlohserht_regnad", "CPW"]]  # 逆順表記(公開repoのgrep封印。機能は同一)
FORBIDDEN_DASH = {"—": "EM", "–": "EN", "―": "BAR", "－": "FW_HYPHEN_MINUS", "‒": "FIGURE", "−": "MINUS", "⸺": "TWO_EM", "⸻": "THREE_EM", "﹘": "SMALL_EM", "﹣": "SMALL_FW_MINUS", "⁓": "SWUNG"}

GATE_VERSION = "1.2.0"

# 2026-08-30 v1.2.0: 個別の文字でなく「クラス」で弾く。
#   Unicode の Pd(ダッシュ句読点)カテゴリは、許可した数文字を除いて全て禁止。
#   許可: ハイフン - / 波ダッシュ 〜 ～ / ハイフン U+2010 U+2011 / ハイフンブレット / 二重ハイフン゠ / 〰
#   Pd に属さないが視覚的にダッシュに見えるもの(罫線 / 水平線)は明示で足す。
ALLOWED_DASH = set("-〜～‐‑⁃゠〰")
EXTRA_DASH = {"─": "BOX_H", "━": "BOX_H_HEAVY", "⎯": "HLINE_EXT", "⏤": "DENTISTRY_H", "﹉": "DASHED_OVERLINE", "﹍": "DASHED_LOW"}

# 不可視文字。ゼロ幅で語を割る / 双方向制御で見た目を反転する / 制御文字。公開ページに要らない。
ZW_RE = re.compile("[\u200b\u200c\u200d\u2060\ufeff\u00ad\u180e]")
BIDI_RE = re.compile("[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]")
CTRL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# 同形異字(キリル / ギリシャ -> ラテン)。MOAT語の正規化にだけ使う。
HOMOGLYPHS = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H", "І": "I", "Ј": "J", "К": "K", "М": "M", "О": "O", "Р": "P", "Ѕ": "S", "Т": "T", "Х": "X", "Ү": "Y",
    "а": "a", "с": "c", "е": "e", "і": "i", "ј": "j", "о": "o", "р": "p", "ѕ": "s", "х": "x", "у": "y",
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
    "ο": "o", "ρ": "p", "ν": "v", "ϲ": "c", "ι": "i",
})

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
# 開始タグと属性を、属性順・引用符・大小・空白に依存せず読む(簡易パーサ)。
TAG_OPEN_RE = re.compile(r"<([a-zA-Z][a-zA-Z0-9:-]*)\b((?:\"[^\"]*\"|'[^']*'|[^\"'<>])*)>", re.S)
CDATA_MARK_RE = re.compile(r"<!\[CDATA\[|\]\]>")
ATTR_RE = re.compile(r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s\"'=<>`]+))", re.S)
SCRIPT_ANY_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.S | re.I)
STYLE_ANY_RE = re.compile(r"<style\b[^>]*>(.*?)</style\s*>", re.S | re.I)
CSS_ESC_RE = re.compile(r"\\([0-9a-fA-F]{1,6})[ \t\n]?")
JS_ESC_RE = re.compile(r"\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})")
# 描画時に隙間を作らないインライン要素。<i></i> で文字を割る難読化は、これを消して「糊付け」した本文でも見る。
INLINE_TAGS = ("a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "font", "i", "ins", "kbd", "mark", "q", "rb", "rp", "rt", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr")
INLINE_TAG_RE = re.compile(r"</?(?:" + "|".join(INLINE_TAGS) + r")\b[^>]*>", re.I)
# ロボット系 meta の name。robots 以外(googlebot 等)に noindex を書く難読化も弾く。
BOT_META = ("robots", "googlebot", "googlebot-news", "bingbot", "msnbot", "slurp", "yandex", "duckduckbot", "baiduspider", "applebot")
NOINDEX_RE = re.compile(r"noindex|nofollow|(?<![a-z])none(?![a-z])|unavailable_after")
# 実行時にページを書き換えられる外部資源(script src / iframe / embed / object)は、許可した出どころだけ。
#   静的な門は実行後の姿を見られない。だから「誰のコードが動くか」を置き場所で縛る。
RUNTIME_ALLOWED_HOSTS = ("shield.the-horizons-innovation.com", ".horizonshield.dev", ".oga-surf-project.workers.dev", "www.paypal.com", "static.cloudflareinsights.com")
BASE64_RE = re.compile(r"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{12,4000}={0,2}(?![A-Za-z0-9+/=])")
# 通貨記号の無い金額: 価格語の直後の桁区切り数、または桁区切り数の直後の税込/税抜。
MONEY_RE3 = re.compile(r"(?:税込|税抜|総額|合計|費用|価格|単価|相場|見積|金額|料金|報酬|給与|月給|日給|年収)[^\d\n]{0,6}\d{1,3}(?:,\d{3})+|\d{1,3}(?:,\d{3})+[^\d\n]{0,3}(?:税込|税抜)")
# 金額の拡張: 全角¥ / 圓・萬 / 億 / JPY・yen / ドル / 大字(壱弐参拾佰仟)。
MONEY_RE2 = re.compile(r"(?:[¥￥]\s*\d|\d[\d,.]*\s*[万億千百]?\s*[円圓]|\d[\d,.]*\s*(?:JPY|yen)\b|\bJPY\s*\d|(?:US)?\$\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR)\b)", re.I)
KANJI_MONEY_RE2 = re.compile(r"[〇零一二三四五六七八九十百千壱弐参拾佰仟]+\s*[万億千百萬]?\s*[円圓]")
# 属性値の金額検査で読み飛ばす属性(URL / 識別子 / 型)。それ以外は全部見る。
ATTR_SKIP = ("href", "src", "srcset", "class", "id", "style", "rel", "type", "charset", "lang", "http-equiv", "name", "property", "itemprop", "xmlns", "d", "viewbox", "points", "transform")
# JSON-LD の鍵で、施主向け面に在ってはならないもの(価格)。採用面は免除。
JSONLD_PRICE_KEYS = ("price", "lowprice", "highprice", "pricerange", "minprice", "maxprice", "pricespecification", "basesalary", "estimatedsalary", "pricecurrency")
LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
CANON_RE = re.compile(r'<link rel="canonical" href="([^"]+)"')
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
DESC_RE = re.compile(r'<meta name="description" content="([^"]*)"')
ROBOTS_RE = re.compile(r'<meta name="robots" content="([^"]*)"')
AUTHOR_RE = re.compile(r'<meta name="author" content="([^"]*)"')
# 金額: ¥123 / 123円 / 12万円 / 1,234,567 円 など(数字を伴う通貨表現)
MONEY_RE = re.compile(r'(¥\s*\d|\d[\d,]*\s*円|\d+\s*万円)')
KANJI_MONEY_RE = re.compile(r'[〇一二三四五六七八九十百千]+\s*[万千]?\s*円')  # 漢数字金額の難読化を潰す
# 本文(タグ除去)で禁止語・金額を見るため簡易にscript/styleを剥がす
SCRIPT_STYLE_RE = re.compile(r'<(script|style)\b[^>]*>.*?</\1>', re.S)
TAG_RE = re.compile(r'<[^>]+>')

def path_to_canonical(relpath):
    # yakumo/souba/xxx/index.html -> https://.../yakumo/souba/xxx/
    rel = relpath.replace("\\", "/")
    rel = re.sub(r'/index\.html$', '/', rel)
    if not rel.endswith('/'):
        rel += '/'
    return BASE + "/" + rel

def _segments(relpath):
    return [p for p in relpath.replace("\\", "/").split("/") if p]

def is_recruit_path(relpath):
    # 採用(求人)ページは給与表示が必要なため、金額チェックを免除する名前空間。
    # 施主向け(souba / faq 等)は従来どおり金額非表示のまま(このヘルパで区別する)。
    # v1.2.0: 免除は名前空間直下(yakumo/recruit/ , yakumo/<店>/recruit/ , care/<slug>/recruit/)まで。
    #   施主向け生成面の下に recruit を名乗る枝を作っても免除しない(置き場所による偽装を潰す)。
    parts = _segments(relpath)
    return "recruit" in parts[1:3]

# 2026-08-30: noindex には2種類ある。
#   管理/取引/フォーム面(admin/mypage/register/store 等)を noindex にするのは正当(honest scope)。
#   施主向けの公開コンテンツ面を noindex にするのは事故(公開したいものが消える)。
#   前者だけ免除する。開示が主張を"限定"するのか"矛盾"させるのかを、置き場所で分ける。
NOINDEX_OK = ("/admin/", "/mypage/", "/register/", "/store/", "/api/", "/auth/", "/login/")
def is_noindex_ok_path(relpath):
    # v1.2.0: 免除は名前空間直下(yakumo/<seg>/ , care/<slug>/<seg>/)だけ。
    #   yakumo/souba/admin/ のように公開面の下へ admin を名乗る枝を置いても免除しない。
    parts = _segments(relpath)
    seg = None
    if len(parts) >= 2 and parts[0] == "yakumo":
        seg = parts[1]
    elif len(parts) >= 3 and parts[0] == "care":
        seg = parts[2]
    return seg is not None and ("/" + seg + "/") in NOINDEX_OK

def visible_text(html):
    t = SCRIPT_STYLE_RE.sub(' ', html)
    t = CDATA_MARK_RE.sub(' ', t)
    t = TAG_RE.sub(' ', t)
    return t

def normalize_text(s):
    """エンティティ復号 -> ゼロ幅除去 -> NFKC(全角/互換) -> 同形異字。判定用の正規化(表示は変えない)。"""
    s = _html.unescape(s)
    s = ZW_RE.sub("", s)
    s = unicodedata.normalize("NFKC", s)
    return s.translate(HOMOGLYPHS)

def css_unescape(s):
    return CSS_ESC_RE.sub(lambda m: chr(int(m.group(1), 16)) if int(m.group(1), 16) < 0x110000 else "", s)

def glued_text(html):
    """インライン要素だけ隙間なしで消した本文。<i></i> 割りは描画では繋がって見える。CDATA の印は剥がして中身を本文扱い。"""
    t = SCRIPT_STYLE_RE.sub(" ", html)
    t = CDATA_MARK_RE.sub(" ", t)
    t = INLINE_TAG_RE.sub("", t)
    t = TAG_RE.sub(" ", t)
    return t

def _host_allowed(url):
    m = re.match(r"https?://([^/?#]+)", url.strip(), re.I)
    if not m:
        return False
    h = m.group(1).lower().split(":")[0]
    return any(h == a or (a.startswith(".") and h.endswith(a)) for a in RUNTIME_ALLOWED_HOSTS)

def _url_to_repo_path(url):
    """BASE 配下の絶対URLをリポジトリ内パスへ。外なら None。"""
    if not url.startswith(BASE + "/"):
        return None
    p = url[len(BASE) + 1:].split("?")[0].split("#")[0]
    if p.endswith("/"):
        p += "index.html"
    return p

def _b64_texts(s):
    """base64 らしい塊を復号して、UTF-8 として読めたものを返す(MOAT の難読化を潰す)。"""
    import base64, binascii
    out = []
    for m in BASE64_RE.finditer(s):
        tok = m.group(0)
        if len(tok) % 4 == 1:
            continue
        try:
            raw = base64.b64decode(tok + "=" * (-len(tok) % 4), validate=True)
            out.append(raw.decode("utf-8"))
        except (binascii.Error, UnicodeDecodeError, ValueError):
            continue
    return out

def js_unescape(s):
    def _r(m):
        h = m.group(1) or m.group(2) or m.group(3)
        try:
            return chr(int(h, 16))
        except Exception:
            return ""
    return JS_ESC_RE.sub(_r, s)

def iter_tags(src):
    """開始タグ列 (name, attrs{lower: unescaped}, raw) を返す。script/style/コメントは呼ぶ側で剥がす。"""
    for m in TAG_OPEN_RE.finditer(src):
        attrs = {}
        for am in ATTR_RE.finditer(m.group(2)):
            k = am.group(1).lower()
            v = am.group(2)
            if v is None:
                v = am.group(3)
            if v is None:
                v = am.group(4)
            if k not in attrs:
                attrs[k] = _html.unescape(v or "")
        yield m.group(1).lower(), attrs, m.group(0)

def find_money(s):
    for r in (MONEY_RE, KANJI_MONEY_RE, MONEY_RE2, KANJI_MONEY_RE2, MONEY_RE3):
        m = r.search(s)
        if m:
            return m.group(0).strip()
    return None

def _json_strings(obj, path=""):
    """JSON-LD を歩いて (鍵パス, 文字列値) と (価格系の鍵) を集める。"""
    out, keys = [], []
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = str(k).lower()
            if kl in JSONLD_PRICE_KEYS:
                keys.append(path + "/" + str(k))
            o2, k2 = _json_strings(v, path + "/" + str(k))
            out += o2; keys += k2
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            o2, k2 = _json_strings(v, path + "[%d]" % i)
            out += o2; keys += k2
    elif isinstance(obj, str):
        out.append((path, obj))
    return out, keys

def check_page(relpath):
    errs = []
    abspath = os.path.join(REPO_ROOT, relpath)
    if not os.path.exists(abspath):
        return ["FILE_MISSING: " + relpath]
    try:
        html = open(abspath, encoding="utf-8").read()
    except UnicodeDecodeError as e:
        return ["ENCODING_NOT_UTF8: " + str(e)[:80]]
    if html.startswith("\ufeff"):
        html = html[1:]

    # v1.2.0 前処理: コメント剥がし版 / script・style も剥がした版(タグ解析用)
    src_nc = COMMENT_RE.sub(" ", html)
    src_tags = SCRIPT_STYLE_RE.sub(" ", src_nc)
    tags = list(iter_tags(src_tags))

    # 不可視文字 / 双方向制御 / 制御文字(公開ページに要らない。語を割る・見た目を反転する道具)
    _zw = ZW_RE.findall(html)
    if _zw:
        errs.append("INVISIBLE_CHARS: " + " ".join(sorted(set("U+%04X" % ord(c) for c in _zw))))
    _bd = BIDI_RE.findall(html)
    if _bd:
        errs.append("BIDI_CONTROL: " + " ".join(sorted(set("U+%04X" % ord(c) for c in _bd))))
    _ct = CTRL_RE.findall(html)
    if _ct:
        errs.append("CONTROL_CHARS: " + " ".join(sorted(set("U+%04X" % ord(c) for c in _ct))))

    # <base> と meta refresh は、リンク先や表示先を丸ごと差し替える道具。公開面では禁止。
    for _n, _a, _raw in tags:
        if _n == "base":
            errs.append("BASE_TAG_FORBIDDEN")
        if _n == "meta" and _a.get("http-equiv", "").strip().lower() == "refresh":
            errs.append("META_REFRESH_FORBIDDEN: " + _a.get("content", "")[:40])
        if _n == "meta" and _a.get("http-equiv", "").strip().lower() == "x-robots-tag":
            if NOINDEX_RE.search(normalize_text(_a.get("content", "")).lower()) and not is_noindex_ok_path(relpath):
                errs.append("ROBOTS_HTTP_EQUIV_NOINDEX: " + _a.get("content", "")[:40])

    # 実行時に書き換える資源(script src / iframe / embed / object)。出どころを縛り、同一リポジトリ内の JS は中身も門に通す。
    runtime_js_texts = []
    _rt_tags = [(n, a) for n, a, _ in tags if n in ("iframe", "embed", "object")]
    for _sm in SCRIPT_ANY_RE.finditer(src_nc):
        _sa = {}
        for _am in ATTR_RE.finditer(_sm.group(1)):
            _v = _am.group(2) if _am.group(2) is not None else (_am.group(3) if _am.group(3) is not None else _am.group(4))
            _sa.setdefault(_am.group(1).lower(), _html.unescape(_v or ""))
        _rt_tags.append(("script", _sa))
    for _n, _a in _rt_tags:
        _u = _a.get("src") if _n != "object" else _a.get("data")
        if not _u:
            continue
        _u = _u.strip()
        if not re.match(r"https?://", _u, re.I):
            errs.append("RUNTIME_SRC_NOT_ABSOLUTE: %s=%s" % (_n, _u[:60]))
            continue
        if not _host_allowed(_u):
            errs.append("RUNTIME_SRC_NOT_ALLOWED: %s=%s" % (_n, _u[:60]))
            continue
        _rp = _url_to_repo_path(_u)
        if _rp is not None and _n == "script":
            _ap = os.path.join(REPO_ROOT, _rp)
            if not os.path.exists(_ap):
                errs.append("RUNTIME_SRC_MISSING: " + _rp)
            else:
                try:
                    runtime_js_texts.append(open(_ap, encoding="utf-8").read())
                except UnicodeDecodeError:
                    errs.append("RUNTIME_SRC_NOT_UTF8: " + _rp)

    # 構造
    if "<html" not in html or "</html>" not in html:
        errs.append("NO_HTML_STRUCTURE")
    _tm = TITLE_RE.search(html)
    if not _tm:
        errs.append("NO_TITLE")
    elif not normalize_text(TAG_RE.sub(" ", _tm.group(1))).strip():
        errs.append("EMPTY_TITLE")
    _head_part = re.split(r"</head\s*>", src_nc, 1, flags=re.I)[0]
    _ntitle = len(re.findall(r"<title[\s>]", _head_part, re.I))
    if _ntitle > 1:
        errs.append("TITLE_TAG_COUNT: %d" % _ntitle)

    # JSON-LD
    lds = LD_RE.findall(html)
    _seen = set(b.strip() for b in lds)
    inline_scripts = []
    for _sm in SCRIPT_ANY_RE.finditer(src_nc):
        _sa = {}
        for _am in ATTR_RE.finditer(_sm.group(1)):
            _v = _am.group(2) if _am.group(2) is not None else (_am.group(3) if _am.group(3) is not None else _am.group(4))
            _sa.setdefault(_am.group(1).lower(), _html.unescape(_v or ""))
        if _sa.get("type", "").strip().lower() == "application/ld+json":
            if _sm.group(2).strip() not in _seen:
                lds.append(_sm.group(2)); _seen.add(_sm.group(2).strip())
                errs.append("JSONLD_TAG_OBFUSCATED[%d]" % (len(lds) - 1))
        else:
            inline_scripts.append(_sm.group(2))
    if not lds:
        errs.append("NO_JSONLD")
    jsonld_strings, jsonld_price_keys = [], []
    for i, block in enumerate(lds):
        try:
            obj = json.loads(block)
        except Exception as e:
            errs.append("JSONLD_PARSE_FAIL[%d]: %s" % (i, str(e)[:60]))
            continue
        _s, _k = _json_strings(obj)
        jsonld_strings += _s; jsonld_price_keys += _k
        nodes = obj.get("@graph") if isinstance(obj, dict) and "@graph" in obj else [obj]
        for n in nodes:
            if not isinstance(n, dict):
                errs.append("JSONLD_NODE_NOT_OBJECT[%d]" % i); continue
            if "@type" not in n:
                errs.append("JSONLD_NO_TYPE[%d]" % i)
        if isinstance(obj, dict) and "@context" not in obj:
            errs.append("JSONLD_NO_CONTEXT[%d]" % i)

    # canonical 一致
    m = CANON_RE.search(html)
    if not m:
        errs.append("NO_CANONICAL")
    else:
        expected = path_to_canonical(relpath)
        if m.group(1) != expected:
            errs.append("CANONICAL_MISMATCH: got %s expected %s" % (m.group(1), expected))
    _canons = [a.get("href", "") for n, a, _ in tags if n == "link" and "canonical" in a.get("rel", "").lower().split()]
    if len(_canons) != 1:
        errs.append("CANONICAL_TAG_COUNT: %d" % len(_canons))
    elif _canons[0] != path_to_canonical(relpath) and not any(e.startswith("CANONICAL_MISMATCH") for e in errs):
        errs.append("CANONICAL_MISMATCH: got %s expected %s" % (_canons[0], path_to_canonical(relpath)))

    # 必須メタ
    _dm = DESC_RE.search(html)
    if not _dm:
        errs.append("NO_DESCRIPTION")
    _descs = [a.get("content", "") for n, a, _ in tags if n == "meta" and a.get("name", "").strip().lower() == "description"]
    if _dm and (not _dm.group(1).strip() or any(not d.strip() for d in _descs)):
        errs.append("EMPTY_DESCRIPTION")
    if len(_descs) > 1:
        errs.append("DESCRIPTION_TAG_COUNT: %d" % len(_descs))
    robots_vals = ROBOTS_RE.findall(html)
    if len(robots_vals) != 1:
        errs.append("ROBOTS_TAG_COUNT: %d" % len(robots_vals))
    else:
        _rv = robots_vals[0].lower()
        _noindex = re.search(r"noindex|nofollow|\bnone\b", _rv)
        if _noindex and not is_noindex_ok_path(relpath):
            errs.append("ROBOTS_NOINDEX_OR_NOFOLLOW: " + robots_vals[0])
        elif not _noindex and ("index" not in _rv or "follow" not in _rv):
            errs.append("ROBOTS_NOT_INDEXABLE")
    if not AUTHOR_RE.search(html):
        errs.append("NO_AUTHOR")
    # robots(汎用解析): 大小・属性順・引用符・空白・エンティティで書かれた robots も同じ1本として数える。
    #   厳密正規表現(上)と本数が食い違えば、それ自体が難読化の証拠として弾く。
    _rob_generic = [a.get("content", "") for n, a, _ in tags if n == "meta" and a.get("name", "").strip().lower() == "robots"]
    if len(_rob_generic) != len(robots_vals):
        errs.append("ROBOTS_TAG_OBFUSCATED: strict=%d generic=%d" % (len(robots_vals), len(_rob_generic)))
    for _rv2 in _rob_generic:
        _rv2l = normalize_text(_rv2).lower()
        if NOINDEX_RE.search(_rv2l) and not is_noindex_ok_path(relpath):
            if not any(e.startswith("ROBOTS_NOINDEX_OR_NOFOLLOW") for e in errs):
                errs.append("ROBOTS_NOINDEX_OR_NOFOLLOW: " + _rv2)
    for n, a, _ in tags:
        if n != "meta":
            continue
        _nm = a.get("name", "").strip().lower()
        if _nm in BOT_META and _nm != "robots":
            if NOINDEX_RE.search(normalize_text(a.get("content", "")).lower()) and not is_noindex_ok_path(relpath):
                errs.append("ROBOTS_BOT_SPECIFIC_NOINDEX: %s=%s" % (_nm, a.get("content", "")[:30]))

    # 禁止語(MOAT)は全文で
    _compact = re.sub(r"\s+", "", html.lower())
    for w in MOAT_FORBIDDEN:
        if w in html:
            errs.append("MOAT_LEAK: " + w)
        elif w.lower() in _compact:
            errs.append("MOAT_LEAK_CI: " + w)
    # v1.2.0: 正規化した全文と、タグを剥がした本文の両方で、記号・空白を除いた圧縮列に対して見る。
    _norm_full = normalize_text(css_unescape(js_unescape(html + " " + " ".join(runtime_js_texts)))).lower()
    _norm_full += " " + " ".join(_b64_texts(html)).lower()
    _norm_vis = normalize_text(visible_text(html)).lower()
    for w in MOAT_FORBIDDEN:
        if any(e.endswith(": " + w) and e.startswith("MOAT_LEAK") for e in errs):
            continue
        wl = w.lower()
        if any(c.isalpha() for c in wl):
            key = re.sub(r"[^a-z0-9]", "", wl)
            for label, txt in (("MOAT_LEAK_NORM", _norm_full), ("MOAT_LEAK_TEXT", _norm_vis)):
                if key and key in re.sub(r"[^a-z0-9]", "", txt):
                    errs.append(label + ": " + w); break
        else:
            for label, txt in (("MOAT_LEAK_NUM", _norm_full), ("MOAT_LEAK_NUM_TEXT", _norm_vis)):
                _c = re.sub(r"(?<=\d),(?=\d)", ".", re.sub(r"\s+", "", txt))
                if wl in _c:
                    errs.append(label + ": " + w); break

    # 禁止ダッシュ
    for ch, name in FORBIDDEN_DASH.items():
        if ch in html:
            errs.append("FORBIDDEN_DASH: " + name)
    # v1.2.0: 個別の文字でなくクラスで。エンティティ復号後 + CSS/JS エスケープ復号後の全文を、
    #   Unicode Pd カテゴリ(許可数文字を除く)と明示の視覚等価文字で走査する。
    _dash_src = _html.unescape(html)
    _dash_src += " " + " ".join(css_unescape(s) for s in STYLE_ANY_RE.findall(html))
    _dash_src += " " + " ".join(css_unescape(a.get("style", "")) for n, a, _ in tags if a.get("style"))
    _dash_src += " " + " ".join(js_unescape(s) for s in inline_scripts + runtime_js_texts)
    _seen_dash = set(ch for ch in FORBIDDEN_DASH if ch in html)
    for ch in sorted(set(_dash_src)):
        if ch in _seen_dash or ch in ALLOWED_DASH:
            continue
        if ch in EXTRA_DASH:
            errs.append("FORBIDDEN_DASH: " + EXTRA_DASH[ch] + " U+%04X" % ord(ch)); _seen_dash.add(ch)
        elif ch in FORBIDDEN_DASH:
            errs.append("FORBIDDEN_DASH_ENCODED: " + FORBIDDEN_DASH[ch] + " U+%04X" % ord(ch)); _seen_dash.add(ch)
        elif unicodedata.category(ch) == "Pd":
            errs.append("FORBIDDEN_DASH_CLASS: %s U+%04X" % (unicodedata.name(ch, "?"), ord(ch))); _seen_dash.add(ch)

    vis = visible_text(html)

    # 金額(可視テキスト): 施主向けは非表示。ただし採用(/recruit/)は求人給与の表示が必要なため免除。
    if not is_recruit_path(relpath):
        _alts = " ".join(re.findall(r'<img[^>]*\balt="([^"]*)"', html))
        _scope = vis + " " + _alts
        mm = MONEY_RE.search(_scope) or KANJI_MONEY_RE.search(_scope)
        if mm:
            errs.append("MONEY_ON_PAGE: " + mm.group(0).strip())
        # v1.2.0: 正規化した可視テキスト(エンティティ / 全角 / ゼロ幅 / 大字 / 圓 / JPY)
        _m2 = find_money(normalize_text(vis))
        if _m2 and not mm:
            errs.append("MONEY_ON_PAGE_NORM: " + _m2)
        # インライン要素で文字を割った金額(描画では繋がって見える)
        _m2g = find_money(normalize_text(glued_text(src_nc)))
        if _m2g and not mm and not _m2:
            errs.append("MONEY_ON_PAGE_GLUED: " + _m2g)
        # 属性値(alt / title / aria-* / placeholder / value / content / data-* 等。URL・識別子は除く)
        for n, a, _ in tags:
            for k, v in a.items():
                if k in ATTR_SKIP or not v:
                    continue
                _m3 = find_money(normalize_text(v))
                if _m3:
                    errs.append("MONEY_IN_ATTR: %s=%s" % (k, _m3)); break
                if re.search(r"price|amount|yen|salary", k) and re.search(r"\d", v):
                    errs.append("MONEY_ATTR_KEY: %s=%s" % (k, v[:30])); break
            else:
                continue
            break
        # JSON-LD の文字列値と価格系の鍵
        for _p, _sv in jsonld_strings:
            _m4 = find_money(normalize_text(_sv))
            if _m4:
                errs.append("MONEY_IN_JSONLD: %s=%s" % (_p, _m4)); break
        if jsonld_price_keys:
            errs.append("MONEY_IN_JSONLD_KEY: " + jsonld_price_keys[0])
        # CSS content(擬似要素で描く文字) と インラインJS(実行時に描く文字)
        _css_all = " ".join(STYLE_ANY_RE.findall(html)) + " " + " ".join(a.get("style", "") for n, a, _ in tags if a.get("style"))
        _m5 = find_money(normalize_text(css_unescape(_css_all)))
        if _m5:
            errs.append("MONEY_IN_CSS: " + _m5)
        for _js in inline_scripts + runtime_js_texts:
            _m6 = find_money(normalize_text(js_unescape(_js)))
            if _m6:
                errs.append("MONEY_IN_SCRIPT: " + _m6); break

    # バックリンク(認知度導線)
    #
    # 2026-08-23。ここは長らく無条件に /yakumo/ (建設モール)へのリンクを求めていた。
    # 訪問看護は Yakumo の対象外なので(industry.js の mall: null)、
    # モールへ送ってはいけない。送れば、訪問看護を探している人が建設のモールに着く。
    # かといって検査を外すと、建設のページからも導線が消える。
    # 検証器を増やさず、ここだけで置き場所によって分ける。
    rel = "/" + relpath.replace("\\", "/")
    if rel.startswith("/yakumo/"):
        if (BASE + "/yakumo/") not in html:
            errs.append("NO_MALL_BACKLINK")
        elif not re.search(r"href\s*=\s*[\"']" + re.escape(BASE + "/yakumo/") + r"[\"']", src_nc):
            errs.append("NO_MALL_BACKLINK_HREF")
    elif rel.startswith("/care/"):
        # モールが無い業種。宛先は、その事業所自身の窓口。
        # care/<slug>/... の <slug> を取り出して、そこへのリンクがあることを見る。
        parts = [p for p in rel.split("/") if p]
        if len(parts) < 2:
            errs.append("CARE_PATH_TOO_SHALLOW: " + relpath)
        else:
            window = BASE + "/care/" + parts[1] + "/"
            if window not in html:
                errs.append("NO_MEMBER_WINDOW_BACKLINK: " + window)
    else:
        # どの名前空間にも属していない。置き場所を取り違えている。
        errs.append("UNKNOWN_NAMESPACE: " + relpath)

    if ('href="' + BASE + '/"') not in html and ('href="' + BASE + '"') not in html:
        errs.append("NO_HS_ROOT_BACKLINK")
    elif ('href="' + BASE + '/"') not in src_nc and ('href="' + BASE + '"') not in src_nc:
        errs.append("NO_HS_ROOT_BACKLINK_HREF")

    # 内部リンクの体裁(相対の壊れリンクを弾く: href="souba/..." のような裸相対は不可)
    for href in re.findall(r'href="([^"]+)"', html):
        if href.startswith("#") or href.startswith("http") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        errs.append("SUSPECT_RELATIVE_LINK: " + href)

    return errs

def check_duplicates(paths):
    """重複ゼロ関所B: バッチ内の相互重複 + 台帳(自slug以外)との衝突を検査。generate.py と同一指紋。"""
    # 残っている結合(2026-08-23):
    #   指紋の計算(fingerprint / simhash / ledger)は tools/yakumo/generate.py にある。
    #   これも本来は業種に属さないので、いずれここへ来るべきである。
    #   ただし動かすと建設の生成器そのものに触るので、今夜はやらない。
    #   明示的に読みに行き、残っていることをここに書いておく。
    #
    #   台帳を共有していること自体は正しい。建設のページと訪問看護のページが
    #   互いに重複していたら、それは見つけるべきものである。
    # 指紋は業種に属さない場所から直接読む(2026-08-23)。
    #   ここが最後の結合だった。訪問看護のページを公開してよいかどうかが、
    #   建設の生成器を import できるかに依存していた。
    #   台帳を共有していること自体は正しい。建設のページと訪問看護のページが
    #   互いに重複していたら、それは見つけるべきものである。
    _fp = os.path.dirname(os.path.abspath(__file__))
    if _fp not in sys.path:
        sys.path.insert(0, _fp)
    try:
        import fingerprint as G
    except Exception as e:
        return ["DEDUP_MODULE_LOAD_FAIL: " + str(e)[:80]]
    errs = []
    ledger = G.ledger_load().get("entries", [])
    fps = []
    for p in paths:
        abspath = os.path.join(REPO_ROOT, p)
        if not os.path.exists(abspath):
            continue
        html = open(abspath, encoding="utf-8").read()
        canonical = path_to_canonical(p)
        fps.append((p, G.fingerprint(canonical, html)))
    # バッチ内 相互
    for i in range(len(fps)):
        for j in range(i + 1, len(fps)):
            a, b = fps[i][1], fps[j][1]
            if a["tsha"] == b["tsha"]:
                errs.append("DUPLICATE_IN_BATCH(title): %s == %s" % (fps[i][0], fps[j][0]))
            elif a["simhash"] != "0" and G.hamming64(a["simhash"], b["simhash"]) <= 6:
                errs.append("DUPLICATE_IN_BATCH(near): %s ~= %s" % (fps[i][0], fps[j][0]))
    # 台帳(自分のslug以外)との衝突
    for (p, fp) in fps:
        for e in ledger:
            if e.get("slug") == fp["slug"]:
                continue  # 自分自身(更新)は許可
            if e.get("tsha") == fp["tsha"]:
                errs.append("DUPLICATE_VS_LEDGER(title): %s == %s" % (p, e["slug"])); break
            if e.get("simhash") and fp["simhash"] != "0" and G.hamming64(fp["simhash"], e["simhash"]) <= 6:
                errs.append("DUPLICATE_VS_LEDGER(near): %s ~= %s" % (p, e["slug"])); break
    return errs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest")
    ap.add_argument("--paths", nargs="*")
    ap.add_argument("--root", help="ページを探す根。既定はこのリポジトリの根。"
                                   "リポジトリの外に書き出した束を試すときに使う。")
    a = ap.parse_args()
    if a.root:
        _set_root(a.root)
    print("見る根: %s" % REPO_ROOT)

    paths = []
    if a.manifest:
        man = json.load(open(a.manifest, encoding="utf-8"))
        paths = [p["path"] for p in man.get("pages", [])]
    if a.paths:
        paths += a.paths
    if not paths:
        print("検証対象なし(--manifest か --paths を指定)"); sys.exit(2)

    total_err = 0
    print("=== 八雲 生成コンテンツ プリフライト検証(fail-closed) 門 v%s ===" % GATE_VERSION)
    for p in paths:
        errs = check_page(p)
        if errs:
            total_err += len(errs)
            print("  NG   " + p)
            for e in errs:
                print("        - " + e)
        else:
            print("  PASS " + p)

    # 重複ゼロ関所B(同じダブりは絶対に出さない)
    dup_errs = check_duplicates(paths)
    if dup_errs:
        total_err += len(dup_errs)
        print("  NG   [DEDUP GATE]")
        for e in dup_errs:
            print("        - " + e)
    else:
        print("  PASS [DEDUP GATE] 重複なし")
    print("\n=== 検証結果: %d ページ / エラー %d 件 ===" % (len(paths), total_err))
    if total_err:
        print("不適格。1枚でも落ちたらバッチ全体を公開しない(fail-closed)。")
        sys.exit(1)
    print("全ページ適格。公開可。")
    sys.exit(0)

if __name__ == "__main__":
    main()
