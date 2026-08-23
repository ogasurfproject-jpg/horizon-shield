# -*- coding: utf-8 -*-
"""
訪問看護のヒアリングを、算定要件データベースと1対1で結ぶ。

いまの q_nv_genzan は「減算になる要件の状況を教えてください。1) BCPは策定済みですか。
2) 虐待防止の委員会・指針・研修・担当者は揃っていますか」と、6つの要件を一問に詰めていた。
これでは答えが一塊で返ってきて、どの要件が満たされていてどれが未確認なのかを、
データベース側の要件 id と突き合わせられない。突き合わせられない答えは、
集めても「聞いた」だけで、使えない。

data/nursing/rules_2024.json の requirements[].ask が求めている設問に分ける。
分けたぶん質問は増えるが、一問ずつは一語で答えられる。まとめて答えていただく必要はない。

言い方について。減算の要件を尋ねるのは、相手を試すことではない。
揃っていないものを見つけるのがこちらの仕事なので、揃っていないと答えやすい形にする。
「できていますか」ではなく「いまどうなっていますか」と訊く。
"""

import io, os, shutil, sys

SRC = os.path.abspath(os.environ.get(
    "HS_SRC",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workers", "hs-hearing", "src")))
STAMP = ".bak_prenursingq20260823"
I = os.path.join(SRC, "industry.js")

OLD = '''      q_nv_genzan: {
        w: 12,
        text: "減算になる要件の状況を教えてください。1) BCP(業務継続計画)は策定済みですか。2) 高齢者虐待防止の委員会・指針・研修・担当者は揃っていますか。揃っていないものがあれば、そのまま教えてください。",
      },'''

NEW = '''      /* 減算の要件。data/nursing/rules_2024.json の requirements[].ask と
         1対1で対応する。一問に詰めると、どの要件が満たされていて
         どれが未確認なのかを、データベース側と突き合わせられない。

         訊き方について。これは相手を試す質問ではない。揃っていないものを
         見つけるのがこちらの仕事なので、「できていますか」ではなく
         「いまどうなっていますか」と訊く。揃っていないと答えやすい形にする。 */

      /* --- 業務継続計画未策定減算 (所定単位数の100分の1。訪問看護の経過措置は
             2025年3月31日で終了しており、2026年8月現在は適用される) --- */
      q_nv_bcp_plan: {
        w: 6,
        text: "業務継続計画(BCP)は、いまどうなっていますか。「策定済み」「作成中」「これから」のどれかで構いません。感染症と自然災害の両方を想定した計画が要る、というのが2024年度改定の中身です。",
      },
      q_nv_bcp_train: {
        w: 5,
        text: "その計画に基づく研修と訓練は、直近1年で実施しましたか。「した」「していない」「覚えていない」で構いません。計画があっても訓練が無いと要件から外れる、というのがこの減算の厄介なところです。",
      },
      q_nv_bcp_stock: {
        w: 4,
        text: "感染症・災害用の備蓄品は、どなたが管理していますか。決まっていなければ「決まっていない」で構いません。",
      },

      /* --- 高齢者虐待防止措置未実施減算 (所定単位数の100分の1。2024年6月1日から。
             4要件のうち一つでも未実施なら対象になる) --- */
      q_nv_gy_committee: {
        w: 6,
        text: "高齢者虐待防止のための委員会は、直近1年で何回開かれましたか。0回でも構いません。回数をそのまま教えてください。",
      },
      q_nv_gy_policy: {
        w: 5,
        text: "高齢者虐待防止のための指針は、いまどうなっていますか。「整備済み」「作りかけ」「まだ」のどれかで構いません。",
      },
      q_nv_gy_training: {
        w: 6,
        text: "高齢者虐待防止の研修は、直近1年で実施しましたか。訪問看護は年1回以上が要件です。実施した回数か、していないなら「していない」と教えてください。",
      },
      q_nv_gy_officer: {
        w: 5,
        text: "高齢者虐待防止措置の担当者は決まっていますか。お名前は要りません。決まっているかどうかだけで構いません。",
      },'''

NOTE_ANCHOR = '''    /* 生成の配分。ご指示の黄金比。 */'''
NOTE_NEW = '''    /* 算定要件データベース。建設における JCCDB と同じ位置に立つ外部の物差し。
       これが無ければ「取りこぼしがある」「減算の危険がある」は我々の感想にすぎない。
       上の q_nv_* は、このデータベースの requirements[].ask と1対1で結ぶ。
       結べない設問は、集めても突き合わせられない。 */
    rules_db: "data/nursing/rules_2024.json",

    /* 生成の配分。ご指示の黄金比。 */'''


def main():
    if not os.path.exists(I):
        print("not found: " + I, file=sys.stderr); sys.exit(1)
    src = io.open(I, encoding="utf-8").read()
    orig = src
    ok = True

    if "q_nv_bcp_plan" in src:
        print("  skip (already applied): 減算の設問を分ける")
    elif src.count(OLD) != 1:
        print("  ANCHOR FAIL (%d hits): 減算の設問" % src.count(OLD), file=sys.stderr); ok = False
    else:
        src = src.replace(OLD, NEW, 1)
        print("  ok: q_nv_genzan を7問に分けた(要件と1対1)")

    if "rules_db" in src:
        print("  skip (already applied): データベースへの参照")
    elif src.count(NOTE_ANCHOR) != 1:
        print("  ANCHOR FAIL (%d hits): データベース参照" % src.count(NOTE_ANCHOR), file=sys.stderr); ok = False
    else:
        src = src.replace(NOTE_ANCHOR, NOTE_NEW, 1)
        print("  ok: 算定要件データベースへの参照を書いた")

    if not ok:
        print("\nアンカーが合わないので、何も書かずに終わります。", file=sys.stderr)
        sys.exit(2)
    if src != orig:
        shutil.copy2(I, I + STAMP)
        io.open(I, "w", encoding="utf-8").write(src)
        print("\n書き換えました。バックアップ: *%s" % STAMP)


if __name__ == "__main__":
    main()
