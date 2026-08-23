# -*- coding: utf-8 -*-
"""
生成器に、業種の安全弁を入れる。

2026-08-23。hs-hearing は industry を dispatch に載せるようになったが、
generate.py はそれを一度も読んでいない。訪問看護の事業所の完成度が基準に達すると、
この生成器は建設のページを作りにいく:

  ・「対応できる工種」の相場ページを、医療処置に対して作る
  ・全ページに建設費相場データベース(JCCDB)を出典として貼る
  ・全ページに「加盟No.001 リフォーム職人株式会社」への固定リンクを貼る
  ・求人ページに「先輩職人が段階的に技術を伝えます」と書く
  ・/yakumo/ (建設モール)の下に置く

そのうえで validate.py がモールへのバックリンクを必須にしているので、
結局どこにも公開されない。ただし、公開されない前に、他社の事業所について
建設業として書かれたページが一度は生成される。

分からない業種のページを作るくらいなら、作らない方がよい。
知っている業種(construction)以外は、理由を書いて止める。

この安全弁は、訪問看護の生成器ができるまでの措置ではない。
できたあとも残す。次に新しい業種が増えたとき、また同じことが起きるので。
"""

import io, os, shutil, sys

P = os.path.abspath(os.environ.get(
    "GEN_PY",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools", "yakumo", "generate.py")))
STAMP = ".bak_preindustrygate20260823"

ANCHOR = """def plan_pages(profile, autopilot=None):"""

NEW = '''# ---------------------------------------------------------------------------
# 業種の安全弁 (2026-08-23)
#
# この生成器は建設・リフォーム専用である。工種、相場、JCCDB、建設業許可、
# 「先輩職人が」という言い回し、モール(/yakumo/)への必須バックリンク。
# どれも建設の前提の上に立っている。
#
# hs-hearing は industry を dispatch に載せてくるが、ここは長らくそれを
# 読んでいなかった。訪問看護の事業所が基準に達すれば、この生成器は
# 医療処置について「工種の相場ページ」を作り、建設費データベースを出典に貼り、
# 建設会社への固定リンクを付けたページを、他社の名前で作ることになる。
#
# 分からない業種のページを作るくらいなら、作らない方がよい。
# 知っている業種以外は、理由を書いて止める。
# 新しい業種の生成器ができたら、その業種をここに足す。ここを空にはしない。
# ---------------------------------------------------------------------------
KNOWN_INDUSTRIES = ("construction",)
DEFAULT_INDUSTRY = "construction"


def industry_of(profile, autopilot):
    """業種を決める。どこにも書かれていなければ建設として扱う(既存レコードの後方互換)。"""
    ap = autopilot or {}
    return (ap.get("industry")
            or (profile or {}).get("industry")
            or DEFAULT_INDUSTRY)


def assert_industry_supported(profile, autopilot):
    ind = industry_of(profile, autopilot)
    if ind in KNOWN_INDUSTRIES:
        return ind
    name = (profile or {}).get("company") or "(社名なし)"
    sys.stderr.write(
        "\\n生成を中止しました。\\n"
        "  業種       : %s\\n"
        "  事業所     : %s\\n"
        "  理由       : この生成器は建設・リフォーム専用です。工種・相場・JCCDB・\\n"
        "               建設業許可・モールへのバックリンクが、すべて建設の前提の上に\\n"
        "               立っています。この業種のページをこの生成器で作ると、\\n"
        "               他社の事業所について建設業として書かれたページができます。\\n"
        "  やること   : この業種の生成器を用意し、KNOWN_INDUSTRIES に足してください。\\n"
        "               業種を取り違えているだけの場合は、hs-hearing 側の\\n"
        "               store.industry を直してください。\\n\\n" % (ind, name))
    sys.exit(4)


def plan_pages(profile, autopilot=None):
    assert_industry_supported(profile, autopilot)'''


def main():
    if not os.path.exists(P):
        print("not found: " + P, file=sys.stderr); sys.exit(1)
    src = io.open(P, encoding="utf-8").read()
    if "KNOWN_INDUSTRIES" in src:
        print("skip (already applied)"); return
    if src.count(ANCHOR) != 1:
        print("ANCHOR FAIL (%d hits)" % src.count(ANCHOR), file=sys.stderr); sys.exit(2)
    # sys は "import argparse, json, sys, os, ..." のように並びで書かれていることがある。
    # "import sys" という並びだけを探すと、入っているのに無いと判定する(2026-08-23 実際にそうなった)。
    import re as _re
    if not _re.search(r"^\s*(?:import|from)\s.*\bsys\b", src, _re.M):
        print("generate.py が sys を import していません。手当てが要ります。", file=sys.stderr); sys.exit(3)
    shutil.copy2(P, P + STAMP)
    io.open(P, "w", encoding="utf-8").write(src.replace(ANCHOR, NEW, 1))
    print("業種の安全弁を入れました。バックアップ: *%s" % STAMP)
    print("  既知の業種: construction のみ")
    print("  それ以外が来たら、理由を書いて exit 4 で止まります。")


if __name__ == "__main__":
    main()
