# -*- coding: utf-8 -*-
"""建設の現場質問を、industry.js の bank に生成する。

なぜ要るか (2026-08-24):
  訪問看護には JHNRD があり、その穴を埋める現場質問が8問ある。
  建設には JCCDB があるのに、その穴を埋める問いが1問も無かった。
  業種レジストリが毎回それを名指ししていた。

  同じ仕組みが入っていない業種があるなら、それは「どの業種でも同じ仕組み」ではない。

なぜ生成にするか:
  同じ設問文を data/ と industry.js の二箇所に置けば、いつか片方だけ直る。
  落ちない。例外も出ない。ただ、届く文と手元の記録がずれる。

  python3 tools/construction/sync_questions.py --check   ずれているかを見るだけ
  python3 tools/construction/sync_questions.py --write   作り直す
"""
import argparse
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "data", "construction", "field_questions.json")
IND = os.path.join(ROOT, "workers", "hs-hearing", "src", "industry.js")

BEGIN = "/* CONSTRUCTION_BANK_BEGIN 生成物。手で編集しないこと。 */"
END = "/* CONSTRUCTION_BANK_END */"
FIRST = "    bank: null,"


def render(qs):
    """bank の中身を作る。訪問看護側と同じ形にする。"""
    out = []
    a = out.append
    a("    /* 建設だけの現場質問。JCCDB(建設費のデータベース)の穴を埋めるための問い。")
    a("       ここへの答えは相場そのものではない。加盟店が現に扱っている事実である。")
    a("       JCCDB に入れるのは、複数店の答えが揃い、出所を書けるようになってから。")
    a("       1店の答えを相場として出した瞬間に、その店の値付けが『相場』になる。 */")
    a("    bank: {")
    a("      " + BEGIN)
    a("      /*   元       : data/construction/field_questions.json")
    a("           作り直し : python3 tools/construction/sync_questions.py --write")
    a("           検査     : python3 tools/construction/sync_questions.py --check */")
    for q in qs:
        a("      %s: {" % q["id"])
        a("        w: %d," % int(q["w"]))
        a("        purpose: \"field\",")
        a("        fills_gap: %s," % json.dumps(q.get("fills_gap") or "", ensure_ascii=False))
        a("        gives: %s," % json.dumps(q.get("gives") or "", ensure_ascii=False))
        a("        text:")
        a("          %s," % json.dumps(q["text"], ensure_ascii=False))
        a("      },")
    a("      " + END)
    a("    },")
    return "\n".join(out)


def span(src):
    """いまの bank ブロックの位置。まだ無ければ bank: null の位置。"""
    b = src.find(BEGIN)
    if b < 0:
        i = src.find(FIRST)
        if i < 0:
            return None
        return (i, i + len(FIRST), False)
    e = src.find(END, b)
    if e < 0:
        return None
    # ブロック全体(直前の /* 建設だけの… から },  まで)を差し替える。
    head = src.rfind("    /* 建設だけの現場質問", 0, b)
    if head < 0:
        return None
    tail = src.find("\n    },", e)
    if tail < 0:
        return None
    return (head, tail + len("\n    },"), True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    data = json.load(io.open(SRC, encoding="utf-8"))
    qs = data["questions"]
    src = io.open(IND, encoding="utf-8").read()

    print("元     : %s (%d 問)" % (os.path.relpath(SRC, ROOT), len(qs)))
    sp = span(src)
    if not sp:
        sys.stderr.write("\nindustry.js の建設の bank が見つかりません。\n"
                         "  目印(%s)も、'%s' も見当たりません。\n\n" % (BEGIN, FIRST.strip()))
        return 3
    i, j, existed = sp
    print("いまの状態: %s" % ("生成済み" if existed else "まだ bank: null"))

    want = render(qs)
    have = src[i:j]
    if have == want:
        print("\nずれはありません。")
        return 0

    if not a.write:
        print("\nずれています。")
        print("  いま %d 文字 -> 作ると %d 文字" % (len(have), len(want)))
        if not existed:
            print("  建設の bank はまだ空(null)です。%d 問を入れます。" % len(qs))
        print("\n作り直すには --write を付けてください。")
        return 1

    out = src[:i] + want + src[j:]
    io.open(IND, "w", encoding="utf-8").write(out)
    # 出したものが JavaScript として通るかを、JavaScript の目で見る。
    # 2026-08-23、Python の読み直しは通り node で落ちる生成物を実際に作った。
    r = subprocess.run(["node", "--check", IND], capture_output=True, text=True)
    if r.returncode != 0:
        io.open(IND, "w", encoding="utf-8").write(src)
        sys.stderr.write("\nnode --check が落ちたので、元に戻しました。\n" + r.stderr + "\n")
        return 2
    print("\n書きました。%d 問。node --check 通過。" % len(qs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
