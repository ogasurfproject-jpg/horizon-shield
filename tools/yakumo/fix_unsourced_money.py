# -*- coding: utf-8 -*-
"""
公開中の建設ページから、出典の無い金額を落とす。

2026-08-23 に見つかったもの。souba の2ページに、出典を示さないまま
「とされています」と書かれた金額があった。

  ・「2026年の業界調査では月額30万円から50万円が主流の価格帯とされています。
     実装まで含めると月100万円という集計もあります。」
  ・「業界側の解説では、1件あたり数千円から1万円前後の紹介料と、
     成約時の歩合が支払われ…とされています。」

どちらも、どの調査か、どの解説かが書かれていない。ページ内の外部リンクは
JCCDB の DOI と ORCID だけで、これらは建設費のデータであって、
AI可視化サービスの価格や一括見積もりサイトの紹介料の出典ではない。

「とされています」は、出典があるように読める。無いのに、そう読ませている。
これは、今夜ずっと直してきたものと同じ形である。

もう一つの問題:
  この2ページは validate.py の MONEY_ON_PAGE で落ちる。
  つまり門を通さずに公開されている。
  git log を見ると feat(yakumo): add per-page unique GEO layer to 3 souba pages
  というコミットで入っている。自動生成ではなく手で足されたものである。
  fail-closed の門は、手で回り込めば意味を失う。

直し方:
  数字を落とす。周りの主張(紹介料を受け取らない、データは公開され再計算できる)は
  出典があり、そのまま立つ。金額だけを外す。
  そして「確かめられた出典がないので金額は書かない」と、その場に書く。
  黙って消すと、なぜ消えたのかが誰にも分からなくなる。
"""

import io, os, shutil, sys

ROOT = os.path.abspath(os.environ.get(
    "REPO", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")))
STAMP = ".bak_unsourced20260823"

FIXES = [
    ("yakumo/souba/gaiheki-tosou-nagakute/index.html",
     "生成AIの回答に自社を載せるための外注サービスが国内でも売られており、"
     "2026年の業界調査では月額30万円から50万円が主流の価格帯とされています。"
     "実装まで含めると月100万円という集計もあります。",
     "生成AIの回答に自社を載せることを請け負う外注サービスが、国内でも売られています。"
     "その価格帯については、こちらで確かめられた出典がないため、金額は書きません。"),
    ("yakumo/souba/naiso-nagakute/index.html",
     "一括見積もりサイトが施主にとって無料なのは、業者側が費用を負担しているからです。"
     "業界側の解説では、1件あたり数千円から1万円前後の紹介料と、成約時の歩合が支払われ、"
     "その負担を見積もりに含める業者もあるとされています。",
     "一括見積もりサイトが施主にとって無料なのは、業者側が費用を負担しているからです。"
     "その負担がいくらかについては、こちらで確かめられた出典がないため、金額は書きません。"
     "費用を誰かが負担しているという構造の話として、お読みください。"),
]


def main():
    changed, missing = [], []
    for rel, old, new in FIXES:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            missing.append(rel); continue
        src = io.open(p, encoding="utf-8").read()
        if new in src:
            print("  skip (already fixed): " + rel); continue
        if old not in src:
            missing.append(rel + " (該当の文が見つからない)"); continue
        shutil.copy2(p, p + STAMP)
        io.open(p, "w", encoding="utf-8").write(src.replace(old, new, 1))
        changed.append(rel)
        print("  ok: " + rel)

    if missing:
        print("\n見つからなかったもの:", file=sys.stderr)
        for m in missing:
            print("  ・" + m, file=sys.stderr)
        if not changed:
            sys.exit(2)
    if changed:
        print("\n直しました。バックアップ: *%s" % STAMP)
        print("公開の前に validate.py を通してください:")
        print("  python3 tools/yakumo/validate.py --paths " + " ".join(c for c, _, _ in
              [(r, None, None) for r, _, _ in FIXES]))


if __name__ == "__main__":
    main()
