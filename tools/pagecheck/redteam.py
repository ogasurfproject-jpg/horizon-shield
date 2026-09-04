# -*- coding: utf-8 -*-
"""
pagecheck レッドチーム ・ 門を敵として攻める(自己検証 harness) v2

目的:
  門(validate.py)が「難読化された悪いページ」を確実に弾くことを、
  門自身への攻撃で継続的に証明する。攻撃が1つでも門をすり抜けたら exit 1。
  門を弱めた変更は、ここで赤くなって止まる。

v2 (2026-08-30): 敵を「個別の13手」から「攻撃クラス」に上げた。
  攻撃 = 毒(何を) x 置き場所(どこに) x 符号化(どう隠すか) の組み合わせを機械生成する。
  門が個別対応でなくクラス単位で弾けているかを、組み合わせで確かめる。
    毒      : 金額 / MOAT語 / 禁止ダッシュ / robots・canonical・構造の偽装
    置き場所: 可視本文 / img alt / title属性 / aria-label / placeholder / data属性 / og:description /
              twitter:description / JSON-LD 文字列 / CSS content / style属性 / インラインJS /
              コメント / noscript / display:none / template
    符号化  : 素 / 10進エンティティ / 16進エンティティ / ゼロ幅分割 / タグ分割 / 全角(NFKC) /
              双方向制御で反転 / 同形異字(キリル) / JSON \\u / CSS \\XXXX / JS \\uXXXX
  第1回の13手はそのまま残す(回帰)。健全ページと正当な免除(過剰検出の監視)も増やした。

これは他社の模倣ではない。HORIZON SHIELD の思想を検証器自身に向けた形:
  - 落ちたものを隠さない(THROUGH-LIST)を、門の欠陥にも適用する
  - fail-closed(1つでも漏れたら不合格)
  - 決定論的(同じ入力 -> 同じ結果、誰でも再実行できる)

使い方:
  python3 tools/pagecheck/redteam.py            # 全攻撃
  python3 tools/pagecheck/redteam.py --list     # 攻撃名の一覧
  python3 tools/pagecheck/redteam.py --only NAME
"""
import sys, os, json, tempfile, shutil

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import validate

B = "https://shield.the-horizons-innovation.com"

def page(slug, robots="index,follow", body="", head_extra="", ns="yakumo", robots_tag=None):
    canon = "%s/%s/%s/" % (B, ns, slug)
    rt = robots_tag if robots_tag is not None else '<meta name="robots" content="%s">\n' % robots
    if ns == "yakumo":
        links = '<a href="%s/yakumo/">mall</a> <a href="%s/">home</a>' % (B, B)
    else:
        links = '<a href="%s/%s/%s/">window</a> <a href="%s/">home</a>' % (B, ns, slug.split("/")[0], B)
    return (
        '<!doctype html><html lang="ja"><head>\n'
        '<meta charset="utf-8"><title>redteam %s | HORIZON SHIELD</title>\n'
        '<meta name="description" content="redteam probe">\n'
        '%s'
        '<meta name="author" content="大賀俊勝 | HORIZON SHIELD">\n'
        '<link rel="canonical" href="%s">\n'
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"rt"}</script>\n'
        '%s'
        '</head><body>\n<h1>redteam</h1>\n<p>%s</p>\n'
        '%s\n'
        '</body></html>'
    ) % (slug.replace("/", "-"), rt, canon, head_extra, body, links)

# ---------------------------------------------------------------------------
# 第1回(2026-08-30 午前)の13手。回帰用にそのまま残す。
# (name, expect_block, expect_code, robots, body, slug)
ATTACKS_V1 = [
    ("clean_baseline",   False, None,     "index,follow",     "健全なページ本文",                     "rt-clean"),
    ("noindex_public",   True,  "ROBOTS", "noindex,nofollow", "",                                     "rt-noindex"),
    ("robots_none",      True,  "ROBOTS", "none",             "",                                     "rt-none"),
    ("kanji_money",      True,  "MONEY",  "index,follow",     "工事費は百二十三万円です",             "rt-kanji"),
    ("zenkaku_money",    True,  "MONEY",  "index,follow",     "工事費は１２３万円です",               "rt-zenkaku"),
    ("money_in_alt",     True,  "MONEY",  "index,follow",     '<img src="x.jpg" alt="総額123万円">',  "rt-alt"),
    ("fullwidth_dash",   True,  "DASH",   "index,follow",     "見積り－適正価格",                     "rt-fwdash"),
    ("figure_dash",      True,  "DASH",   "index,follow",     "区間 A‒B",                             "rt-figdash"),
    ("minus_dash",       True,  "DASH",   "index,follow",     "差 A−B",                               "rt-minus"),
    ("moat_lowercase",   True,  "MOAT",   "index,follow",     "内部の wpc を漏らす",                  "rt-moatlow"),
    ("moat_spaced",      True,  "MOAT",   "index,follow",     "W P C を分割で漏らす",                 "rt-moatsplit"),
    ("moat_raw",         True,  "MOAT",   "index,follow",     "係数は 32.5 である",                   "rt-moatraw"),
    ("noindex_admin_ok", False, None,     "noindex,nofollow", "",                                     "admin"),
]

# ---------------------------------------------------------------------------
# v2: 毒 x 置き場所 x 符号化 の機械生成
#
# 符号化(文字列変換)。BLOCK の根拠として認める門のコードを併記する。
#   不可視文字で割った攻撃は、毒の検出でも不可視文字の検出でも「弾けた」と認める。
def enc_raw(s):      return s
def enc_ent_dec(s):  return "".join("&#%d;" % ord(c) for c in s)
def enc_ent_hex(s):  return "".join("&#x%x;" % ord(c) for c in s)
def enc_zw(s):       return "\u200b".join(s)
def enc_tag(s):      return "<i></i>".join(s)
def enc_bidi(s):     return "\u202e" + s[::-1] + "\u202c"
def enc_fw(s):
    out = []
    for c in s:
        o = ord(c)
        if 0x21 <= o <= 0x7e:
            out.append(chr(o + 0xFEE0))
        else:
            out.append(c)
    return "".join(out)
_CYR = {"A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т", "X": "Х",
        "a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у"}
def enc_cyr(s):      return "".join(_CYR.get(c, c) for c in s)
def enc_json_u(s):   return json.dumps(s, ensure_ascii=True)[1:-1]
def enc_css(s):      return "".join("\\%x " % ord(c) for c in s)
def enc_js(s):       return "".join("\\u%04x" % ord(c) if ord(c) < 0x10000 else c for c in s)

ENC = {
    "raw": enc_raw, "ent_dec": enc_ent_dec, "ent_hex": enc_ent_hex, "zw": enc_zw, "tag": enc_tag,
    "bidi": enc_bidi, "fw": enc_fw, "cyr": enc_cyr, "json_u": enc_json_u, "css": enc_css, "js": enc_js,
}
# 符号化ごとに「この符号化で弾けた」と認める門コード(毒のコードに加えて)
ENC_ALSO_OK = {"zw": ("INVISIBLE",), "bidi": ("BIDI",)}

# 置き場所。(body片, head片) を返す。
def ch_text(p):        return "<p>%s</p>" % p, ""
def ch_alt(p):         return '<img src="x.jpg" alt="%s">' % p, ""
def ch_title_attr(p):  return '<span title="%s">t</span>' % p, ""
def ch_aria(p):        return '<button aria-label="%s">b</button>' % p, ""
def ch_placeholder(p): return '<input placeholder="%s">' % p, ""
def ch_data(p):        return '<div data-note="%s">d</div>' % p, ""
def ch_meta_desc(p):   return "", '<meta property="og:description" content="%s">\n' % p
def ch_twitter(p):     return "", '<meta name="twitter:description" content="%s">\n' % p
def ch_jsonld(p):      return "", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","description":"%s"}</script>\n' % p
def ch_css(p):         return "", '<style>.x::after{content:"%s"}</style>\n' % p
def ch_style_attr(p):  return '<span style="--t:\'%s\'">s</span>' % p, ""
def ch_script(p):      return "", '<script>var s="%s";</script>\n' % p
def ch_comment(p):     return "<!-- %s -->" % p, ""
def ch_noscript(p):    return "<noscript>%s</noscript>" % p, ""
def ch_hidden(p):      return '<span style="display:none">%s</span>' % p, ""
def ch_template(p):    return "<template>%s</template>" % p, ""

CH = {
    "text": ch_text, "alt": ch_alt, "title_attr": ch_title_attr, "aria": ch_aria, "placeholder": ch_placeholder,
    "data": ch_data, "og_desc": ch_meta_desc, "tw_desc": ch_twitter, "jsonld": ch_jsonld, "css": ch_css,
    "style_attr": ch_style_attr, "script": ch_script, "comment": ch_comment, "noscript": ch_noscript,
    "hidden": ch_hidden, "template": ch_template,
}
# 置き場所ごとに意味のある符号化(JSON の中では HTML エンティティは復号されない、等)
CH_ENC = {
    "text":        ("raw", "ent_dec", "ent_hex", "zw", "tag", "bidi", "fw", "cyr"),
    "alt":         ("raw", "ent_dec", "ent_hex", "zw", "fw"),
    "title_attr":  ("raw", "ent_hex", "fw"),
    "aria":        ("raw", "ent_dec"),
    "placeholder": ("raw", "fw"),
    "data":        ("raw",),
    "og_desc":     ("raw", "ent_dec", "fw"),
    "tw_desc":     ("raw",),
    "jsonld":      ("raw", "json_u"),
    "css":         ("raw", "css"),
    "style_attr":  ("raw",),
    "script":      ("raw", "js"),
    "comment":     ("raw", "ent_dec"),
    "noscript":    ("raw",),
    "hidden":      ("raw", "zw"),
    "template":    ("raw",),
}

# 毒。クラス -> (門コード, 置き場所の集合, 毒の候補列)
def moat_variants():
    """MOAT語の変種。語そのものは validate 側の逆順リテラルから実行時に作る(ソースに平文を置かない)。"""
    out = []
    for w in validate.MOAT_FORBIDDEN:
        if any(c.isalpha() for c in w):
            core = w.replace("_", "")
            out += [w, w.lower(), w.upper(), ".".join(core), "-".join(core),
                    ("_".join(core) if "_" not in w else w.replace("_", " ")),
                    w.replace("_", "-"), w.replace("_", " ").title().replace(" ", "")]
        else:
            a, b = (w.split(".", 1) if "." in w else (w, ""))
            out += [w, w.replace(".", ","), enc_fw(w), a + " . " + b, a + "\u3000.\u3000" + b, "(" + w + ")"]
    seen, uniq = set(), []
    for v in out:
        if v not in seen:
            seen.add(v); uniq.append(v)
    return uniq

POISONS = {
    "MONEY": {
        "code": "MONEY",
        "channels": ("text", "alt", "title_attr", "aria", "placeholder", "data", "og_desc", "tw_desc", "jsonld",
                     "css", "style_attr", "script", "noscript", "hidden", "template"),
        "values": ["123万円", "百二十三万円", "１２３万円", "¥1,230,000", "￥1230000", "壱百弐拾参万円", "1,230,000 JPY",
                   "1230000 yen", "12.3万円", "123 万 円", "1.5億円", "3千円", "$12,300", "1,230 USD", "総額1,230,000円(税込)"],
    },
    "MOAT": {
        "code": "MOAT",
        "channels": ("text", "alt", "title_attr", "og_desc", "jsonld", "css", "script", "comment", "hidden", "template"),
        "values": moat_variants(),
    },
    "DASH": {
        "code": "DASH",
        "channels": ("text", "alt", "title_attr", "og_desc", "css", "script", "comment"),
        "values": ["A—B", "A–B", "A―B", "A－B", "A‒B", "A−B", "A⸺B", "A⸻B", "A﹘B", "A﹣B", "A⁓B",
                   "A─B", "A━B", "A⎯B", "A֊B", "A־B", "A᠆B", "A&mdash;B", "A&ndash;B", "A&horbar;B", "A&#8212;B", "A&#x2015;B"],
    },
}

def poison_encodings(cls, value, channel):
    encs = CH_ENC[channel]
    if cls == "DASH":
        if value.startswith("A&"):
            # 既にエンティティ表記。JSON / JS / CSS の中では HTML エンティティは復号されないので問わない
            return ("raw",) if channel not in ("jsonld", "script", "css") else ()
        return tuple(e for e in encs if e in ("raw", "ent_dec", "ent_hex", "css", "js"))
    if cls == "MOAT":
        return tuple(e for e in encs if e != "bidi")
    return encs

def gen_matrix():
    """毒 x 置き場所 x 符号化 を展開する。決定論的。"""
    atk = []
    for cls, spec in POISONS.items():
        for vi, val in enumerate(spec["values"]):
            for ch in spec["channels"]:
                for en in poison_encodings(cls, val, ch):
                    name = "%s[%02d]:%s:%s" % (cls, vi, ch, en)
                    body, head = CH[ch](ENC[en](val))
                    slug = "rt-" + name.lower().replace("[", "").replace("]", "").replace(":", "-").replace("_", "-")
                    atk.append((name, True, (spec["code"],) + ENC_ALSO_OK.get(en, ()), "index,follow", body, head, slug, "yakumo", None))
    return atk

# ---------------------------------------------------------------------------
# 構造・robots・canonical・置き場所の偽装(手書き。1手 = 1毒)
# (name, expect_block, codes, robots, body, head_extra, slug, ns, robots_tag)
STRUCT = [
    ("robots_second_uppercase",    True, ("ROBOTS",),      "index,follow", "", '<META NAME="ROBOTS" CONTENT="NOINDEX">\n', "rt-s1", "yakumo", None),
    ("robots_second_attr_swap",    True, ("ROBOTS",),      "index,follow", "", '<meta content="noindex" name="robots">\n', "rt-s2", "yakumo", None),
    ("robots_second_single_quote", True, ("ROBOTS",),      "index,follow", "", "<meta name='robots' content='noindex'>\n", "rt-s3", "yakumo", None),
    ("robots_second_whitespace",   True, ("ROBOTS",),      "index,follow", "", '<meta  name = "robots"  content = "noindex" >\n', "rt-s4", "yakumo", None),
    ("robots_entity_noindex",      True, ("ROBOTS",),      "index,follow", "", "", "rt-s5", "yakumo", '<meta name="robots" content="no&#105;ndex">\n'),
    ("robots_googlebot_noindex",   True, ("ROBOTS",),      "index,follow", "", '<meta name="googlebot" content="noindex">\n', "rt-s6", "yakumo", None),
    ("robots_bingbot_nofollow",    True, ("ROBOTS",),      "index,follow", "", '<meta name="bingbot" content="nofollow">\n', "rt-s7", "yakumo", None),
    ("robots_only_in_comment",     True, ("ROBOTS",),      "index,follow", "", "", "rt-s8", "yakumo", '<!-- <meta name="robots" content="index,follow"> -->\n'),
    ("robots_unquoted_noindex",    True, ("ROBOTS",),      "index,follow", "", "", "rt-s9", "yakumo", '<meta name=robots content=noindex>\n'),
    ("meta_refresh_redirect",      True, ("META_REFRESH",), "index,follow", "", '<meta http-equiv="refresh" content="0;url=https://example.com/">\n', "rt-s10", "yakumo", None),
    ("base_tag_hijack",            True, ("BASE_TAG",),    "index,follow", "", '<base href="https://example.com/">\n', "rt-s11", "yakumo", None),
    ("canonical_duplicate",        True, ("CANONICAL",),   "index,follow", "", '<link rel="canonical" href="https://example.com/">\n', "rt-s12", "yakumo", None),
    ("canonical_attr_swap_second", True, ("CANONICAL",),   "index,follow", "", '<link href="https://example.com/" rel="canonical">\n', "rt-s13", "yakumo", None),
    ("jsonld_second_malformed_sq", True, ("JSONLD",),      "index,follow", "", "<script type='application/ld+json'>{bad json</script>\n", "rt-s14", "yakumo", None),
    ("jsonld_second_malformed_uc", True, ("JSONLD",),      "index,follow", "", '<SCRIPT TYPE="APPLICATION/LD+JSON">{bad json</SCRIPT>\n', "rt-s15", "yakumo", None),
    ("jsonld_price_key",           True, ("MONEY",),       "index,follow", "", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"x","offers":{"@type":"Offer","price":"1230000","priceCurrency":"JPY"}}</script>\n', "rt-s16", "yakumo", None),
    ("attr_price_key",             True, ("MONEY",),       "index,follow", '<div data-price="1230000">p</div>', "", "rt-s17", "yakumo", None),
    ("bidi_reversed_money",        True, ("BIDI", "MONEY"), "index,follow", "\u202e円万321\u202c", "", "rt-s18", "yakumo", None),
    ("zero_width_in_text",         True, ("INVISIBLE",),   "index,follow", "健全\u200bに見える", "", "rt-s19", "yakumo", None),
    ("control_char_in_text",       True, ("CONTROL",),     "index,follow", "健全\x01に見える", "", "rt-s20", "yakumo", None),
    ("backlink_only_in_comment",   True, ("BACKLINK",),    "index,follow", "", "", "rt-s21", "yakumo", None),
    ("fake_admin_deep_noindex",    True, ("ROBOTS",),      "noindex,nofollow", "", "", "souba/admin", "yakumo", None),
    ("fake_recruit_deep_money",    True, ("MONEY",),       "index,follow", "月給25万円", "", "souba/x/recruit", "yakumo", None),
    ("empty_title",                True, ("TITLE",),       "index,follow", "", "", "rt-s24", "yakumo", None),
    ("whitespace_title",           True, ("TITLE",),       "index,follow", "", "", "rt-s25", "yakumo", None),
    ("double_title",               True, ("TITLE",),       "index,follow", "", "<title>second</title>\n", "rt-s26", "yakumo", None),
    ("empty_description",          True, ("DESCRIPTION",), "index,follow", "", "", "rt-s27", "yakumo", None),
    ("second_empty_description",   True, ("DESCRIPTION",), "index,follow", "", '<meta name="description" content="">\n', "rt-s28", "yakumo", None),
    ("non_utf8_bytes",             True, ("ENCODING",),    "index,follow", "", "", "rt-s29", "yakumo", None),
    ("zero_width_in_body_bom",     True, ("INVISIBLE",),   "index,follow", "\ufeffx", "", "rt-s30", "yakumo", None),
    ("js_document_write_money",    True, ("MONEY",),       "index,follow", "", "<script>document.write('\\u5408\\u8a08 123\\u4e07\\u5186');</script>\n", "rt-s31", "yakumo", None),
    ("css_escaped_em_dash",        True, ("DASH",),        "index,follow", "", '<style>.x::before{content:"\\2014"}</style>\n', "rt-s32", "yakumo", None),
    ("js_escaped_em_dash",         True, ("DASH",),        "index,follow", "", "<script>var d='\\u2014';</script>\n", "rt-s33", "yakumo", None),
    ("moat_cyrillic",              True, ("MOAT",),        "index,follow", enc_cyr(validate.MOAT_FORBIDDEN[2]), "", "rt-s34", "yakumo", None),
    ("moat_fullwidth",             True, ("MOAT",),        "index,follow", enc_fw(validate.MOAT_FORBIDDEN[2]), "", "rt-s35", "yakumo", None),
    ("moat_num_comma",             True, ("MOAT",),        "index,follow", "係数は " + validate.MOAT_FORBIDDEN[0].replace(".", ",") + " である", "", "rt-s36", "yakumo", None),
    ("moat_tag_split",             True, ("MOAT",),        "index,follow", enc_tag(validate.MOAT_FORBIDDEN[2]), "", "rt-s37", "yakumo", None),
    ("moat_num_tag_split",         True, ("MOAT",),        "index,follow", enc_tag(validate.MOAT_FORBIDDEN[0]), "", "rt-s38", "yakumo", None),
    ("moat_entity_in_comment",     True, ("MOAT",),        "index,follow", "<!-- " + enc_ent_dec(validate.MOAT_FORBIDDEN[2]) + " -->", "", "rt-s39", "yakumo", None),
    # 第2撃(v1.2.0 を敵として攻めて見つけた組): CDATA / 引用符内の > / 実行時注入 / unavailable_after / base64 / 通貨記号なし
    ("cdata_svg_money",            True, ("MONEY",),       "index,follow", "<svg><text><![CDATA[総額123万円]]></text></svg>", "", "rt-s40", "yakumo", None),
    ("attr_gt_inside_alt_money",   True, ("MONEY",),       "index,follow", '<img src="x.jpg" alt="総額123万円 > 相場">', "", "rt-s41", "yakumo", None),
    ("external_script_not_allowed",True, ("RUNTIME_SRC",), "index,follow", "", '<script src="https://cdn.example.com/inject.js"></script>\n', "rt-s42", "yakumo", None),
    ("external_iframe_not_allowed",True, ("RUNTIME_SRC",), "index,follow", '<iframe src="https://example.com/x"></iframe>', "", "rt-s43", "yakumo", None),
    ("relative_script_src",        True, ("RUNTIME_SRC",), "index,follow", "", '<script src="inject.js"></script>\n', "rt-s44", "yakumo", None),
    ("same_repo_script_money",     True, ("MONEY",),       "index,follow", "", '<script src="%s/yakumo/rt-s45/inject.js"></script>\n' % B, "rt-s45", "yakumo", None),
    ("same_repo_script_moat",      True, ("MOAT",),        "index,follow", "", '<script src="%s/yakumo/rt-s46/inject.js"></script>\n' % B, "rt-s46", "yakumo", None),
    ("same_repo_script_dash",      True, ("DASH",),        "index,follow", "", '<script src="%s/yakumo/rt-s47/inject.js"></script>\n' % B, "rt-s47", "yakumo", None),
    ("same_repo_script_missing",   True, ("RUNTIME_SRC",), "index,follow", "", '<script src="%s/yakumo/rt-s48/nothing.js"></script>\n' % B, "rt-s48", "yakumo", None),
    ("robots_unavailable_after",   True, ("ROBOTS",),      "unavailable_after: 2026-09-01", "", "", "rt-s49", "yakumo", None),
    ("x_robots_tag_http_equiv",    True, ("ROBOTS",),      "index,follow", "", '<meta http-equiv="X-Robots-Tag" content="noindex">\n', "rt-s50", "yakumo", None),
    ("base64_moat_in_data_attr",   True, ("MOAT",),        "index,follow", "", "", "rt-s51", "yakumo", None),  # 下で実行時に base64 を作る
    ("price_word_comma_number",    True, ("MONEY",),       "index,follow", "総額 1,230,000(税込)", "", "rt-s52", "yakumo", None),
    ("comma_number_then_tax",      True, ("MONEY",),       "index,follow", "1,230,000 税込", "", "rt-s53", "yakumo", None),
    ("moat_in_svg_cdata",          True, ("MOAT",),        "index,follow", "<svg><desc><![CDATA[" + validate.MOAT_FORBIDDEN[2] + "]]></desc></svg>", "", "rt-s54", "yakumo", None),
    ("noscript_robots_noindex",    True, ("ROBOTS",),      "index,follow", "", '<noscript><meta name="robots" content="noindex"></noscript>\n', "rt-s55", "yakumo", None),
    ("conditional_comment_noindex",True, ("ROBOTS",),      "index,follow", "", '<!--[if IE]><meta name="robots" content="noindex"><![endif]-->\n', "rt-s56", "yakumo", None),
]

# 攻撃に付随して置く別ファイル(同一リポジトリ内の JS など)。name -> [(相対パス, 中身)]
EXTRA_FILES = {
    "same_repo_script_money": [("yakumo/rt-s45/inject.js", "document.body.insertAdjacentHTML('beforeend','<p>\\u7dcf\\u984d 123\\u4e07\\u5186</p>');")],
    "same_repo_script_moat":  [("yakumo/rt-s46/inject.js", "window.k='" + "\\u".join([""] + ["%04x" % ord(c) for c in validate.MOAT_FORBIDDEN[2]]) + "';")],
    "same_repo_script_dash":  [("yakumo/rt-s47/inject.js", "var t='A\\u2014B';")],
}

# 健全ページ / 正当な免除(門が過剰検出しないことの証明)。全部 PASS が要る。
CONTROLS = [
    ("ok_clean",                 False, None, "index,follow", "健全なページ本文。ハイフン-と波ダッシュ〜と長音ー、⇔、㎡、Ｑ＆Ａ、～、‐(U+2010)、‑(U+2011)。", "", "rt-c1", "yakumo", None),
    ("ok_admin_noindex",         False, None, "noindex,nofollow", "", "", "admin", "yakumo", None),
    ("ok_mypage_noindex",        False, None, "noindex", "", "", "mypage", "yakumo", None),
    ("ok_register_noindex",      False, None, "noindex,nofollow", "", "", "register", "yakumo", None),
    ("ok_recruit_salary",        False, None, "index,follow", "月給25万円〜。賞与年2回。", "", "recruit/carpenter", "yakumo", None),
    ("ok_store_recruit_salary",  False, None, "index,follow", "日給18,000円。", "", "no001/recruit", "yakumo", None),
    ("ok_entities",              False, None, "index,follow", "A &amp; B &lt;C&gt; &copy; 2026 &nbsp; &quot;x&quot;", "", "rt-c7", "yakumo", None),
    ("ok_english_tech",          False, None, "index,follow", "Windows PC, MCP, A2A, JCCDB, SHA-256, ORCID, no referral fee, verified stores only.", "", "rt-c8", "yakumo", None),
    ("ok_enkatsu_no_digit",      False, None, "index,follow", "工事は円滑に進みます。関東圏で対応。", "", "rt-c9", "yakumo", None),
    ("ok_svg_title_in_body",     False, None, "index,follow", '<svg viewBox="0 0 10 10"><title>icon</title><path d="M0 0h10v10z"/></svg>', "", "rt-c10", "yakumo", None),
    ("ok_js_yen_no_digit",       False, None, "index,follow", "", "<script>var s = n + ' 円'; var y = '¥';</script>\n", "rt-c11", "yakumo", None),
    ("ok_og_title",              False, None, "index,follow", "", '<meta property="og:title" content="Yakumo ｜ 検証済み加盟店">\n', "rt-c12", "yakumo", None),
    ("ok_percent_date_tel",      False, None, "index,follow", "12.5% / 2026-08-30 / TEL 0463-74-5917 / 10:00〜18:00 / 3.5ヶ月 / 120㎡", "", "rt-c13", "yakumo", None),
    ("ok_care_namespace",        False, None, "index,follow", "訪問看護の窓口。", "", "apps-nursing/faq/1", "care", None),
    ("ok_hidden_clean",          False, None, "index,follow", '<span style="display:none">補足</span>', "", "rt-c15", "yakumo", None),
    ("ok_css_pseudo",            False, None, "index,follow", "", '<style>.q::before{content:"Q. "}.a::before{content:"A. "}</style>\n', "rt-c16", "yakumo", None),
    ("ok_data_attr_id",          False, None, "index,follow", '<div data-store="hs-partner-001" data-rank="A">x</div>', "", "rt-c17", "yakumo", None),
    ("ok_katakana_prolonged",    False, None, "index,follow", "リフォーム・メーカー・ユーザー・ｽﾋﾟｰﾄﾞ", "", "rt-c18", "yakumo", None),
]

def build_html(name, robots, body, head_extra, slug, ns, robots_tag):
    html = page(slug, robots, body, head_extra, ns, robots_tag)
    if name == "backlink_only_in_comment":
        html = html.replace('<a href="%s/yakumo/">mall</a>' % B, '<!-- <a href="%s/yakumo/">mall</a> --> <span>%s/yakumo/</span>' % (B, B))
    if name == "empty_title":
        html = html.replace("<title>redteam rt-s24 | HORIZON SHIELD</title>", "<title></title>")
    if name == "whitespace_title":
        html = html.replace("<title>redteam rt-s25 | HORIZON SHIELD</title>", "<title> \n </title>")
    if name == "empty_description":
        html = html.replace('<meta name="description" content="redteam probe">', '<meta name="description" content="">')
    if name == "base64_moat_in_data_attr":
        import base64
        b64 = base64.b64encode(("moat=" + validate.MOAT_FORBIDDEN[0] + ";").encode("utf-8")).decode("ascii")
        html = html.replace("<h1>redteam</h1>", '<h1>redteam</h1><div data-blob="%s">b</div>' % b64)
    return html

# v1.3.0 (2026-09-04): content 名前空間(qa/ aeo/)の手。記事の面は金額と出典が中身なので、
#   門は「出典のない金額」「壊れた内部リンク」「canonical の形」の3点だけ読み替える。
#   ここでは (a) 読み替えが正しく効くこと、(b) 読み替えが member(yakumo/care)に漏れていないこと、
#   (c) それ以外の毒(MOAT / ダッシュ / robots / 不可視 / 名前空間)は content にも同じ強さで効くこと、を攻める。
#   content のページは tmp/<ns>/<slug>.html に置く(ファイルが URL)。
CONTENT_LINKS = '<a href="/">home</a> <a href="/souba/">相場DB</a>'
CONTENT_FILES = [("index.html", "<html><title>root</title></html>"), ("souba/index.html", "<html><title>souba</title></html>"),
                 ("qa/rt-claim.txt", "claim bytes")]

def content_page(slug, ns="qa", body="", head_extra="", robots='<meta name="robots" content="index,follow">\n', canonical=None, links=CONTENT_LINKS):
    canon = "%s/%s/%s.html" % (B, ns, slug) if canonical is None else canonical
    canon_line = ('<link rel="canonical" href="%s">\n' % canon) if canon else ""   # canonical="" で canonical 無しのページ
    return (
        '<!doctype html><html lang="ja"><head>\n'
        '<meta charset="utf-8"><title>redteam content %s | HORIZON SHIELD</title>\n'
        '<meta name="description" content="redteam content probe">\n'
        '%s'
        '<meta name="author" content="大賀俊勝">\n'
        '%s'
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"rt"}</script>\n'
        '%s'
        '</head><body>\n<h1>redteam content</h1>\n<p>%s</p>\n%s\n</body></html>'
    ) % (slug, robots, canon_line, head_extra, body, links)

def _STUB(target, canonical=None, body="移転しました。", extra="", noindex=True, refresh=True):
    """v1.3.1: 移転スタブの部品。三つ揃い(refresh + noindex + canonical=移転先)が既定。片方を欠かすと普通のページとして裁かれる。"""
    abs_t = target if target.startswith("http") else (B + target)
    head = ('<meta http-equiv="refresh" content="0;url=%s">\n' % target if refresh else "") + extra
    return dict(body=body, head_extra=head,
                robots=('<meta name="robots" content="noindex">\n' if noindex else '<meta name="robots" content="index,follow">\n'),
                canonical=(abs_t if canonical is None else canonical), links="")

# (name, expect_block, codes, builder kwargs). ns は kwargs の ns、既定 qa。
CONTENT_CASES = [
    ("content_ok_money_with_souba_source",   False, None, dict(body="標準取付は1台あたり15,000〜30,000円が相場。")),
    ("content_ok_money_with_ledger_source",  False, None, dict(body="単価 8,500円/㎡。", links='<a href="/">home</a> <a href="https://ledger.horizonshield.dev/ledger/24">JIDEC</a>')),
    ("content_ok_money_with_doi_source",     False, None, dict(body="相場は120万円。", links='<a href="/">home</a> <a href="https://doi.org/10.5281/zenodo.1">JCCDB</a>')),
    ("content_ok_absolute_root_backlink",    False, None, dict(body="本文。", links='<a href="%s/">home</a> <a href="/souba/">相場DB</a>' % B)),
    ("content_ok_aeo_namespace",             False, None, dict(ns="aeo", body="適正価格は 5〜8万円。")),
    ("content_ok_index_html_dir_canonical",  False, None, dict(slug="index", canonical="%s/qa/" % B, body="一覧。")),
    ("content_money_without_source",         True, ("MONEY_WITHOUT_SOURCE",), dict(body="標準取付は1台あたり15,000〜30,000円が相場。", links='<a href="/">home</a>')),
    ("content_source_word_is_not_a_source",  True, ("MONEY_WITHOUT_SOURCE",), dict(body="出典: 当社調べ。相場は15,000円。", links='<a href="/">home</a>')),
    ("content_source_only_in_comment",       True, ("MONEY_WITHOUT_SOURCE",), dict(body="相場は15,000円。<!-- <a href=\"/souba/\">x</a> -->", links='<a href="/">home</a>')),
    ("content_broken_root_relative_link",    True, ("INTERNAL_LINK_BROKEN",), dict(body="本文。", links=CONTENT_LINKS + ' <a href="/nope/">x</a>')),
    ("content_broken_absolute_internal",     True, ("INTERNAL_LINK_BROKEN",), dict(body="本文。", links=CONTENT_LINKS + ' <a href="%s/qa/missing.html">x</a>' % B)),
    ("content_bare_relative_link",           True, ("SUSPECT_RELATIVE_LINK",), dict(body="本文。", links=CONTENT_LINKS + ' <a href="other.html">x</a>')),
    ("content_ok_bare_relative_existing",    False, None, dict(body="領収。", links=CONTENT_LINKS + ' <a href="rt-claim.txt">claim</a> <a href="../">up</a>')),
    ("content_ok_js_href_concat_not_a_link", False, None, dict(body="本文。", head_extra="<script>var a='<a href=\"'+REVERSE+'\">x</a>';</script>\n")),
    ("content_bare_relative_escapes_repo",   True, ("SUSPECT_RELATIVE_LINK",), dict(body="本文。", links=CONTENT_LINKS + ' <a href="../../etc/passwd">x</a>')),
    ("content_canonical_dir_form",           True, ("CANONICAL_MISMATCH",), dict(body="本文。", canonical="%s/qa/rt-cc.html/" % B, slug="rt-cc")),
    ("content_no_root_backlink",             True, ("NO_HS_ROOT_BACKLINK",), dict(body="本文。", links='<a href="/souba/">相場DB</a>')),
    ("content_no_robots",                    True, ("ROBOTS_TAG_COUNT",), dict(body="本文。", robots="")),
    ("content_noindex",                      True, ("ROBOTS",), dict(body="本文。", robots='<meta name="robots" content="noindex">\n')),
    ("content_moat_word",                    True, ("MOAT",), dict(body="本文 " + validate.MOAT_FORBIDDEN[0] + " 。")),
    ("content_em_dash",                      True, ("FORBIDDEN_DASH",), dict(body="本文\u2014本文。")),
    ("content_zero_width",                   True, ("INVISIBLE",), dict(body="本\u200b文。")),
    ("content_unknown_namespace_zzz",        True, ("UNKNOWN_NAMESPACE",), dict(ns="zzz", body="本文。")),
    ("member_money_with_souba_source_still_blocked", True, ("MONEY_ON_PAGE",), None),
    # v1.3.1: faq / blog / souba も content
    ("content_ok_faq_namespace",             False, None, dict(ns="faq", body="よくある質問。")),
    ("content_ok_blog_namespace",            False, None, dict(ns="blog", body="記事本文。")),
    ("content_ok_souba_namespace",           False, None, dict(ns="souba", body="相場の解説。")),
    # v1.3.1: 移転スタブ(meta refresh + noindex + canonical が移転先)は記事の面でだけ正当
    ("stub_ok_blog_to_existing",             False, None, dict(ns="blog", **_STUB("/souba/"))),
    ("stub_ok_souba_to_existing",            False, None, dict(ns="souba", **_STUB("/souba/"))),
    ("stub_ok_absolute_target",              False, None, dict(ns="blog", **_STUB(B + "/souba/"))),
    ("stub_target_broken",                   True, ("REDIRECT_TARGET_BROKEN",), dict(ns="blog", **_STUB("/gone/"))),
    ("stub_target_external",                 True, ("REDIRECT_TARGET_NOT_INTERNAL",), dict(ns="blog", **_STUB("https://example.com/"))),
    ("stub_canonical_mismatch",              True, ("REDIRECT_CANONICAL_MISMATCH",), dict(ns="blog", **_STUB("/souba/", canonical=B + "/qa/other.html"))),
    ("stub_to_self",                         True, ("REDIRECT_TO_SELF",), dict(ns="blog", slug="rt-self", **_STUB("/blog/rt-self.html", canonical=B + "/blog/rt-self.html"))),
    ("stub_with_moat",                       True, ("MOAT",), dict(ns="blog", **_STUB("/souba/", body="移転 " + validate.MOAT_FORBIDDEN[0]))),
    ("stub_with_em_dash",                    True, ("FORBIDDEN_DASH",), dict(ns="blog", **_STUB("/souba/", body="移転—先へ"))),
    ("stub_with_base_tag",                   True, ("BASE_TAG_FORBIDDEN",), dict(ns="blog", **_STUB("/souba/", extra='<base href="https://evil.example/">\n'))),
    ("stub_no_canonical",                    True, ("REDIRECT_NO_CANONICAL",), dict(ns="souba", **_STUB("/souba/", canonical=""))),
    ("stub_two_canonicals",                  True, ("CANONICAL_TAG_COUNT",), dict(ns="blog", **_STUB("/souba/", extra='<link rel="canonical" href="%s/souba/">\n' % B))),
    ("stub_refresh_without_noindex",         True, ("META_REFRESH_FORBIDDEN",), dict(ns="blog", **_STUB("/souba/", noindex=False))),
    ("stub_noindex_without_refresh",         True, ("ROBOTS",), dict(ns="blog", **_STUB("/souba/", refresh=False))),
    ("member_redirect_stub_still_forbidden", True, ("META_REFRESH_FORBIDDEN",), "member_stub"),
]

def all_attacks():
    allatk = [(n, b, ((c,) if c else (None,)), r, body, "", s, "yakumo", None) for (n, b, c, r, body, s) in ATTACKS_V1]
    content = [(n, b, (c if c else (None,)), None, None, None, None, "__content__", kw) for (n, b, c, kw) in CONTENT_CASES]
    return allatk + gen_matrix() + STRUCT + CONTROLS + content


def write_content_case(tmp, name, kw):
    """content の手をディスクに置き、門に渡す相対パスを返す。member の漏れ検査(kw None)は yakumo に置く。"""
    for _rp, _content in CONTENT_FILES:
        _ap = os.path.join(tmp, _rp)
        os.makedirs(os.path.dirname(_ap), exist_ok=True)
        with open(_ap, "w", encoding="utf-8") as f:
            f.write(_content)
    if kw is None:
        slug = "rt-member-source-leak"
        html = page(slug, body="相場は15,000円。", ns="yakumo")
        html = html.replace("</body>", '<a href="/souba/">相場DB</a>\n</body>')
        d = os.path.join(tmp, "yakumo", slug); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(html)
        return "yakumo/%s/index.html" % slug
    if kw == "member_stub":
        # 加盟店の面に三つ揃いの移転スタブを置いても、meta refresh は今までどおり禁止(content の緩さが漏れていない)
        slug = "rt-member-stub"
        html = page(slug, robots="noindex", body="移転しました。", ns="yakumo",
                    head_extra='<meta http-equiv="refresh" content="0;url=%s/yakumo/">\n' % B)
        html = html.replace('<link rel="canonical" href="%s/yakumo/%s/">' % (B, slug), '<link rel="canonical" href="%s/yakumo/">' % B)
        d = os.path.join(tmp, "yakumo", slug); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(html)
        return "yakumo/%s/index.html" % slug
    kw = dict(kw)
    ns = kw.pop("ns", "qa")
    slug = kw.pop("slug", "rt-" + name.replace("_", "-"))
    html = content_page(slug, ns=ns, **kw)
    d = os.path.join(tmp, ns); os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, slug + ".html"), "w", encoding="utf-8") as f:
        f.write(html)
    return "%s/%s.html" % (ns, slug)

def run(only=None, list_only=False):
    allatk = all_attacks()
    if list_only:
        for a in allatk:
            print(a[0])
        print("total:", len(allatk))
        return 0
    if only:
        allatk = [a for a in allatk if only in a[0]]
    tmp = tempfile.mkdtemp(prefix="pagecheck_redteam_")
    try:
        validate._set_root(tmp)
        passed = 0
        failures = []
        by_class = {}
        print("=== pagecheck レッドチーム v2 (門を敵として攻める: 毒 x 置き場所 x 符号化) ===")
        for name, expect_block, codes, robots, body, head_extra, slug, ns, robots_tag in allatk:
            if ns == "__content__":
                relp = write_content_case(tmp, name, robots_tag)
            else:
                d = os.path.join(tmp, ns, slug)
                os.makedirs(d, exist_ok=True)
                fpath = os.path.join(d, "index.html")
                html = build_html(name, robots, body, head_extra, slug, ns, robots_tag)
                for _rp, _content in EXTRA_FILES.get(name, []):
                    _ap = os.path.join(tmp, _rp)
                    os.makedirs(os.path.dirname(_ap), exist_ok=True)
                    with open(_ap, "w", encoding="utf-8") as f:
                        f.write(_content)
                if name == "non_utf8_bytes":
                    with open(fpath, "wb") as f:
                        f.write(html.encode("utf-8").replace("redteam".encode("utf-8"), b"redte\xff\xfeam", 1))
                else:
                    with open(fpath, "w", encoding="utf-8") as f:
                        f.write(html)
                relp = "%s/%s/index.html" % (ns, slug)
            try:
                errs = validate.check_page(relp)
            except Exception as _ex:
                # 門が例外で落ちるのも「止まった」ではあるが、判定ではない。攻撃名を残して次へ進む。
                errs = ["GATE_EXCEPTION: %s: %s" % (type(_ex).__name__, str(_ex)[:60])]
            if "[" in name:
                cls = name.split("[")[0]
            else:
                cls = "content" if ns == "__content__" else ("struct" if expect_block else "control")
            by_class.setdefault(cls, [0, 0])
            by_class[cls][1] += 1
            if expect_block:
                hit = bool(errs) and (codes == (None,) or any(any((c in e) for c in codes if c) for e in errs))
                if hit:
                    passed += 1; by_class[cls][0] += 1
                    if only or "[" not in name:
                        print("  green  BLOCK  %-30s (%s)" % (name, errs[0][:70]))
                else:
                    failures.append("%s: すり抜けた(穴) errs=%s" % (name, errs[:3]))
                    print("  RED    LEAK   %-30s << 門をすり抜けた errs=%s" % (name, errs[:2]))
            else:
                if not errs:
                    passed += 1; by_class[cls][0] += 1
                    print("  green  PASS   %-30s (正しく通した)" % name)
                else:
                    failures.append("%s: 誤検出 errs=%s" % (name, errs))
                    print("  RED    FALSE+ %-30s << 健全を誤って弾いた: %s" % (name, errs[:2]))
        print("\n--- クラス別 ---")
        for k in sorted(by_class):
            print("  %-10s %4d / %4d" % (k, by_class[k][0], by_class[k][1]))
        print("\n=== %d / %d 合格 (門 v%s) ===" % (passed, len(allatk), getattr(validate, "GATE_VERSION", "1.1.0?")))
        if failures:
            print("不適格。門に穴か誤検出がある(fail-closed):")
            for f in failures:
                print("  - " + f)
            return 1
        print("全攻撃を正しく弾き、健全ページと正当な免除は通した。門は健在。")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    sys.exit(run(only=only, list_only=("--list" in sys.argv)))
