# -*- coding: utf-8 -*-
"""
現場でしか分からないことを聞く設問を足す。

JHNRD には、条文が取れずに未確認のままの項目がある。そのうち2件は、
訪問看護の事業所が毎月扱っているので、運用としてなら聞ける。

  ・訪問看護指示書を、何か月で回しているか
  ・特別訪問看護指示書を、何日で運用しているか

大事なところ:
  聞けるのは「実際どう回っているか」であって、「何日と定められているか」ではない。
  答えは JHNRD の field_reports に入る。条文側の confirmed は false のままにする。
  混ぜると、事業所が言ったことが、制度が定めたことにすり替わる。

  だから設問文でも、制度を尋ねない。「何日と決まっていますか」とは訊かない。
  「御社では何日で回していますか」と訊く。答えを制度の証拠として使わないので、
  そう訊くのが正しい。

  そして、こちらが確認できていないことを、隠さずに伝える。
  「こちらはまだ条文を確認できていません」と書く。事業所に対して、
  我々の方が制度を知っていると装わない。
"""

import io, os, shutil, sys

SRC = os.path.abspath(os.environ.get(
    "HS_SRC",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workers", "hs-hearing", "src")))
STAMP = ".bak_prepractice20260823"
I = os.path.join(SRC, "industry.js")

ANCHOR = """      /* --- 外向き(ケアマネさん向けの集客) ------------------------- */"""

NEW = '''      /* --- 現場でしか分からないこと -------------------------------
         これらの答えは JHNRD の field_reports に入る。規則の出典にはしない。
         聞いているのは「実際どう回っているか」であって、
         「何日と定められているか」ではない。
         こちらが条文を確認できていないことを、隠さずに書いてある。 */
      q_nv_shiji_period: {
        w: 6,
        text: "訪問看護指示書は、御社では何か月ごとに更新していますか。制度としてどうかではなく、"
              + "実際の回し方を教えてください。こちらはまだ条文を確認できていないので、"
              + "現場でどうされているかを先に伺っています。",
      },
      q_nv_tokubetsu_days: {
        w: 5,
        text: "特別訪問看護指示書を受けたことはありますか。あれば、御社では何日ぶんとして"
              + "運用していますか。交付が月2回になった例があれば、その状況も教えてください。"
              + "こちらで条文を確認できたら、御社の運用とずれがないかをお知らせします。",
      },

      /* --- 外向き(ケアマネさん向けの集客) ------------------------- */'''

# 処置ごとの説明。GEO ページの中身になる。無ければページを作らない。
WORK_ANCHOR = """      q_nv_capacity: {"""

WORK_NEW = '''      /* 処置ごとの説明。ここが空だと、地域×処置のページは作られない。
         中身の無いページを枚数合わせで作ると、地名と処置名だけが違う
         同文のページになる。それはドアウェイであって、
         2026-08-23 に実際に重複検出で弾かれた。
         医療の内容をこちらで書いて事業所の名前で公開することはしないので、
         ご本人の言葉が来るまでページは増えない。 */
      q_nv_work_notes: {
        w: 12,
        text: "対応できる医療処置のうち、いちばん多いものを1つ選んで、"
              + "その方のご家族やケアマネさんに、いつもお伝えしていることを教えてください。"
              + "気をつけて見ている点、ご家族にお願いしていること、困りやすいところなど。"
              + "教科書に書いてあることではなく、御社が実際にやっていることをそのまま。"
              + "これは、その処置を探している方に届くページの中身になります。",
      },

      q_nv_capacity: {'''


def main():
    if not os.path.exists(I):
        print("not found: " + I, file=sys.stderr); sys.exit(1)
    src = io.open(I, encoding="utf-8").read()
    orig = src
    ok = True
    for old, new, label in ((ANCHOR, NEW, "現場でしか分からないことを聞く2問"),
                            (WORK_ANCHOR, WORK_NEW, "処置ごとの説明を聞く1問")):
        if new.strip().split("\n")[0] in src or ("q_nv_shiji_period" in src and label.startswith("現場")) \
                or ("q_nv_work_notes" in src and label.startswith("処置")):
            print("  skip (already applied): " + label); continue
        if src.count(old) != 1:
            print("  ANCHOR FAIL (%d hits): %s" % (src.count(old), label), file=sys.stderr)
            ok = False; continue
        src = src.replace(old, new, 1)
        print("  ok: " + label)
    if not ok:
        print("\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)
    if src != orig:
        shutil.copy2(I, I + STAMP)
        io.open(I, "w", encoding="utf-8").write(src)
        print("\n書き換えました。バックアップ: *%s" % STAMP)


if __name__ == "__main__":
    main()
