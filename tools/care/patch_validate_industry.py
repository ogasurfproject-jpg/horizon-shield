# -*- coding: utf-8 -*-
"""
検証器のバックリンク検査を、置き場所で分ける。

validate.py は全ページに /yakumo/ (建設モール)へのバックリンクを求めている。
認知度の導線として正しい規則だが、無条件である。

訪問看護は Yakumo の対象外だと industry.js が既に決めている(mall: null)。
モールに送ってはいけない相手を、モールへのリンクが無いという理由で落とすと、
訪問看護のページは永久に公開されない。かといって検査を外すと、
建設のページからも導線が消える。

検証器を増やさない。門は1つのままにして、分岐を1箇所だけ入れる:
  yakumo/ の下  -> これまでどおりモールへのバックリンクを必須にする
  care/ の下    -> その事業所自身の窓口へのバックリンクを必須にする
  それ以外      -> どこにも属していないので落とす(名前空間の取り違えを見つける)

HORIZON SHIELD ルートへのバックリンクは、どちらも変わらず必須。
"""

import io, os, shutil, sys

P = os.path.abspath(os.environ.get(
    "VALIDATE_PY",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools", "yakumo", "validate.py")))
STAMP = ".bak_preindustry20260823"

OLD = '''    # バックリンク(認知度導線)
    if (BASE + "/yakumo/") not in html:
        errs.append("NO_MALL_BACKLINK")
    if ('href="' + BASE + '/"') not in html and ('href="' + BASE + '"') not in html:
        errs.append("NO_HS_ROOT_BACKLINK")'''

NEW = '''    # バックリンク(認知度導線)
    #
    # 2026-08-23。ここは長らく無条件に /yakumo/ (建設モール)へのリンクを求めていた。
    # 訪問看護は Yakumo の対象外なので(industry.js の mall: null)、
    # モールへ送ってはいけない。送れば、訪問看護を探している人が建設のモールに着く。
    # かといって検査を外すと、建設のページからも導線が消える。
    # 検証器を増やさず、ここだけで置き場所によって分ける。
    rel = "/" + relpath.replace("\\\\", "/")
    if rel.startswith("/yakumo/"):
        if (BASE + "/yakumo/") not in html:
            errs.append("NO_MALL_BACKLINK")
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
        errs.append("NO_HS_ROOT_BACKLINK")'''

# 冒頭の説明にも足す。規則を変えたことを、読む人が最初に見る場所に書く。
DOC_OLD = "  - モール(/yakumo/)とHORIZON SHIELDルートへのバックリンクが有る(認知度導線)"
DOC_NEW = ("  - バックリンク(認知度導線)。置き場所で宛先が変わる:\n"
           "      yakumo/ の下 -> モール(/yakumo/)へ。建設の加盟店モール。\n"
           "      care/ の下   -> その事業所自身の窓口(/care/<slug>/)へ。\n"
           "                      訪問看護は Yakumo の対象外なので、モールへ送らない。\n"
           "      いずれも HORIZON SHIELD ルートへのバックリンクは必須。")


def main():
    if not os.path.exists(P):
        print("not found: " + P, file=sys.stderr); sys.exit(1)
    src = io.open(P, encoding="utf-8").read()
    if "NO_MEMBER_WINDOW_BACKLINK" in src:
        print("skip (already applied)"); return
    ok = True
    if src.count(OLD) != 1:
        print("ANCHOR FAIL (%d hits): バックリンク検査" % src.count(OLD), file=sys.stderr); ok = False
    if src.count(DOC_OLD) != 1:
        print("ANCHOR FAIL (%d hits): 冒頭の説明" % src.count(DOC_OLD), file=sys.stderr); ok = False
    if not ok:
        print("\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)
    shutil.copy2(P, P + STAMP)
    io.open(P, "w", encoding="utf-8").write(
        src.replace(OLD, NEW, 1).replace(DOC_OLD, DOC_NEW, 1))
    print("バックリンク検査を置き場所で分けました。バックアップ: *%s" % STAMP)
    print("  yakumo/ -> モールへ (これまでどおり)")
    print("  care/   -> その事業所の窓口へ")
    print("  それ以外 -> UNKNOWN_NAMESPACE で落とす")


if __name__ == "__main__":
    main()
