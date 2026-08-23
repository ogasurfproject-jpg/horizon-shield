# -*- coding: utf-8 -*-
"""
名乗りの使い分け。

2026-08-23。自動応答が「担当の大賀が確認してご連絡します」と、届いた言葉すべてに
返していた。通知は飛ぶが、大賀が一通ずつ返すわけではない。名前を出した分だけ、
返事が来なかったときに嘘になる。

決めた原則: 名前は約束である。
  人が必ず動くところ  → 大賀(実名)。金額・契約・判断・謝罪・業種の引き取り。
                        要対応の通知が飛ぶことが条件。
  自動が答えるところ  → 運営事務局。受領確認・ヒアリングの質問・案内。
  手で書いた文        → そのまま名前を使う(コードの管轄外)。

このパッチは、自動応答が名前を借りている箇所だけを運営事務局に戻す。
人が必ず動く箇所の実名は、そのまま残す。
"""

import io, os, shutil, sys

SRC = os.path.abspath(os.environ.get(
    "HS_SRC",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "workers", "hs-hearing", "src")))
STAMP = ".bak_presign20260823"

H = os.path.join(SRC, "hearing.js")
I = os.path.join(SRC, "industry.js")

# --- industry.js: 名乗りの定数を置く ---------------------------------------
I_CONST_ANCHOR = "export const DEFAULT_INDUSTRY = \"construction\";"
I_CONST_NEW = '''/* ------------------------------------------------------------------
   名乗りの使い分け。

   名前は約束である。「担当の大賀が」と書いた瞬間、大賀が実際に読んで
   返すという約束になる。自動応答がその約束を勝手に出すと、返事が
   来なかったときに、こちらが嘘をついたことになる。

     SIGN_PERSON ... 人が必ず動くところ。金額、契約、判断、謝罪、
                     業種が判らないときの引き取り。
                     要対応の通知が飛ぶことが条件。
     SIGN_DESK   ... 自動が答えるところ。受領確認、ヒアリングの質問、案内。

   大賀さんが手で書いた文には、そのまま名前を使ってよい。
   書いた本人が動いているので、約束が嘘にならない。
   ------------------------------------------------------------------ */
export const SIGN_PERSON = "担当の大賀";
export const SIGN_DESK = "運営事務局";

export const DEFAULT_INDUSTRY = "construction";'''

# --- 自動応答が名前を借りている箇所 ----------------------------------------
PAIRS_I = [
    ("建設・リフォームの窓口として、ここからは自動ヒアリングで進めます(担当の大賀も内容をすべて確認します)。",
     "建設・リフォームの窓口として、ここからは自動でお伺いします(内容は運営事務局が必ず確認します)。",
     "industry: 建設の冒頭"),
    ("ここからは自動でお伺いします(担当の大賀も内容をすべて確認します)。",
     "ここからは自動でお伺いします(内容は運営事務局が必ず確認します)。",
     "industry: 訪問看護の冒頭"),
]

PAIRS_H = [
    ('return { ok: true, reply: smart || "受け取りました。ありがとうございます。担当の大賀が確認してご連絡します。" };',
     'return { ok: true, reply: smart || "受け取りました。ありがとうございます。内容は運営事務局で確認します。お急ぎのご用件でしたら、その旨をお書きください。" };',
     "hearing: 自動の受領確認"),
]


def apply(path, pairs, out, extra=None):
    src = io.open(path, encoding="utf-8").read()
    orig = src
    ok = True
    if extra:
        old, new, label = extra
        if "SIGN_PERSON" in src:
            out.append("  skip (already applied): " + label)
        elif src.count(old) != 1:
            out.append("  ANCHOR FAIL (%d hits): %s" % (src.count(old), label)); ok = False
        else:
            src = src.replace(old, new, 1); out.append("  ok: " + label)
    for old, new, label in pairs:
        # 「もう当ててある」の判定は、置換前の文が消えていることを条件にする。
        # new が src にあるかどうかだけで見ると、別の箇所を置換した結果が
        # 部分一致して、まだ直っていない箇所を直ったことにしてしまう。
        # (2026-08-23 実際にそうなり、訪問看護の冒頭だけ直らなかった)
        if old not in src and new in src:
            out.append("  skip (already applied): " + label); continue
        if src.count(old) != 1:
            out.append("  ANCHOR FAIL (%d hits): %s" % (src.count(old), label)); ok = False; continue
        src = src.replace(old, new, 1)
        out.append("  ok: " + label)
    return src, orig, ok


def main():
    out = []
    isrc, iorig, iok = apply(I, PAIRS_I, out, extra=(I_CONST_ANCHOR, I_CONST_NEW, "industry: 名乗りの定数"))
    print("industry.js:"); print("\n".join(out)); out = []
    hsrc, horig, hok = apply(H, PAIRS_H, out)
    print("hearing.js:"); print("\n".join(out))

    if not (iok and hok):
        print("\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)

    if isrc != iorig:
        shutil.copy2(I, I + STAMP); io.open(I, "w", encoding="utf-8").write(isrc)
    if hsrc != horig:
        shutil.copy2(H, H + STAMP); io.open(H, "w", encoding="utf-8").write(hsrc)

    # 残った実名を数えて、人が動く箇所だけであることを目で確かめられるようにする。
    print("\n実名が残っている箇所(ここは人が必ず動くところであること):")
    for p in (H, I):
        for n, line in enumerate(io.open(p, encoding="utf-8").read().split("\n"), 1):
            if "大賀" in line and not line.strip().startswith(("//", "*", "/*")):
                print("  %s:%d  %s" % (os.path.basename(p), n, line.strip()[:96]))
    print("\n書き換えました。バックアップ: *%s" % STAMP)


if __name__ == "__main__":
    main()
