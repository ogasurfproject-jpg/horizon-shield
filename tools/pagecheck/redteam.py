# -*- coding: utf-8 -*-
"""
pagecheck レッドチーム ・ 門を敵として攻める(自己検証 harness)

目的:
  門(validate.py)が「難読化された悪いページ」を確実に弾くことを、
  門自身への攻撃で継続的に証明する。攻撃が1つでも門をすり抜けたら exit 1。
  門を弱めた変更は、ここで赤くなって止まる。

これは他社の模倣ではない。HORIZON SHIELD の思想を検証器自身に向けた形:
  - 落ちたものを隠さない(THROUGH-LIST)を、門の欠陥にも適用する
  - fail-closed(1つでも漏れたら不合格)
  - 決定論的(同じ入力 -> 同じ結果、誰でも再実行できる)

各攻撃は「他の全条件を満たした完璧なページ」に毒を1つだけ仕込む。
門が見逃せば、それは難読化(laundering)による通り抜け = 本物の穴。
免除ケース(正当な noindex 等)も入れ、門が過剰検出しないことも同時に証明する。

使い方: python3 tools/pagecheck/redteam.py
"""
import sys, os, tempfile, shutil

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import validate

B = "https://shield.the-horizons-innovation.com"

def page(slug, robots="index,follow", body=""):
    canon = "%s/yakumo/%s/" % (B, slug)
    return (
        '<!doctype html><html lang="ja"><head>\n'
        '<meta charset="utf-8"><title>redteam %s | HORIZON SHIELD</title>\n'
        '<meta name="description" content="redteam probe">\n'
        '<meta name="robots" content="%s">\n'
        '<meta name="author" content="大賀俊勝 | HORIZON SHIELD">\n'
        '<link rel="canonical" href="%s">\n'
        '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"rt"}</script>\n'
        '</head><body>\n<h1>redteam</h1>\n<p>%s</p>\n'
        '<a href="%s/yakumo/">mall</a> <a href="%s/">home</a>\n'
        '</body></html>'
    ) % (slug, robots, canon, body, B, B)

# (name, expect_block, expect_code, robots, body, slug)
#   expect_block True  : 門が弾くべき攻撃(毒入り)
#   expect_block False : 門が通すべき健全 or 正当な免除ページ
ATTACKS = [
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

def run():
    tmp = tempfile.mkdtemp(prefix="pagecheck_redteam_")
    try:
        validate._set_root(tmp)
        passed = 0
        failures = []
        print("=== pagecheck レッドチーム (門を敵として攻める) ===")
        for name, expect_block, code, robots, body, slug in ATTACKS:
            d = os.path.join(tmp, "yakumo", slug)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
                f.write(page(slug, robots, body))
            errs = validate.check_page("yakumo/%s/index.html" % slug)
            if expect_block:
                hit = bool(errs) and (code is None or any(code in e for e in errs))
                if hit:
                    passed += 1
                    print("  green  BLOCK  %-18s (%s)" % (name, errs[0]))
                else:
                    failures.append("%s: すり抜けた(穴) errs=%s" % (name, errs))
                    print("  RED    LEAK   %-18s << 門をすり抜けた" % name)
            else:
                if not errs:
                    passed += 1
                    print("  green  PASS   %-18s (正しく通した)" % name)
                else:
                    failures.append("%s: 誤検出 errs=%s" % (name, errs))
                    print("  RED    FALSE+ %-18s << 健全を誤って弾いた: %s" % (name, errs[:2]))
        print("\n=== %d / %d 合格 ===" % (passed, len(ATTACKS)))
        if failures:
            print("不適格。門に穴か誤検出がある(fail-closed):")
            for f in failures:
                print("  - " + f)
            return 1
        print("全攻撃を正しく弾き、健全ページは通した。門は健在。")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    sys.exit(run())
