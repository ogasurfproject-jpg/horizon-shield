# -*- coding: utf-8 -*-
"""
可視性の設問バンク(src/visibility.js)を、可視性要件データベースから生成する。

なぜ業種別ではなく共通か:
  所在をはっきりさせること、よく聞かれる問いに答えの形で答えること、
  20秒で説明できる要約を持つこと、AIが呼べる窓口を決めること。
  これは建設でも訪問看護でも同じだけ要る。業種で変わるのは中身であって、要否ではない。
  だから業種の外に置き、加盟店の全社に同じだけ届くようにする。

  業種ごとの要件DB(JCCDB / JHNRD / これから増えるもの)と直交する軸である。
  縦に業種、横に可視性。どの加盟店も、両方から質問を受ける。

  python3 tools/visibility/sync_questions.py --check
  python3 tools/visibility/sync_questions.py --write
"""

import io, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HS = os.path.abspath(os.path.join(HERE, "..", ".."))
DB = os.path.join(HS, "data", "visibility", "requirements.json")
OUT = os.path.join(HS, "workers", "hs-hearing", "src", "visibility.js")
STAMP = ".bak_pregen20260823"


def js(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def load():
    d = json.load(io.open(DB, encoding="utf-8"))
    qs = sorted(d.get("questions", []), key=lambda q: (int(q.get("order", 9999)), q["id"]))
    axes = {it["axis"]: it for it in d.get("items", [])}
    return d, qs, axes


def render(d, qs, axes):
    L = ["/* 生成物。手で編集しないこと。",
         " *   もと    : data/visibility/requirements.json",
         " *   作り直し: python3 tools/visibility/sync_questions.py --write",
         " *   検査    : python3 tools/visibility/sync_questions.py --check",
         " *",
         " * AIと検索から見つけてもらうための設問。業種を問わず、全加盟店に同じだけ届く。",
         " * 業種ごとの要件データベースと直交する軸である。",
         " *",
         " * この資料が他と違うところ: 効果が確かめられていないものを、確かめられていないと書く。",
         " * 仕様に書いてあること(spec)と、それがAIの推薦に効くか(effect)は別に持っている。",
         " * 現時点で effect が確認できた項目は %d / %d 件である。" % (
             sum(1 for it in d["items"] if it.get("effect", {}).get("confirmed")), len(d["items"])),
         " */",
         "",
         "export const VISIBILITY_VERSION = %s;" % js(d.get("version", "")),
         "export const GOLDEN_RATIO = %s;" % json.dumps(
             {k: v for k, v in d["golden_ratio"].items() if k != "basis"}),
         "",
         "export const VISIBILITY_BANK = {"]
    for q in qs:
        ax = q.get("axis", "")
        it = axes.get(ax)
        if it:
            L.append("  /* %s — %s */" % (ax, it["name"]))
        else:
            L.append("  /* %s */" % ax)
        L.append("  %s: {" % q["id"])
        L.append("    w: %d," % int(q["w"]))
        L.append("    axis: %s," % js(ax))
        L.append("    text: %s," % js(q["text"]))
        L.append("  },")
    L.append("};")
    L.append("")
    L.append("/* 可視性の設問の id。これも『データベースを熱くする』側に数える。 */")
    L.append("export function visibilityQids() { return Object.keys(VISIBILITY_BANK); }")
    L.append("export function visibilityQuestion(qid) { return VISIBILITY_BANK[qid] || null; }")
    return "\n".join(L) + "\n"


def parse(path):
    if not os.path.exists(path):
        return {}
    src = io.open(path, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"^\s*(q_ai_[a-z0-9_]+):\s*\{\s*\n\s*w:\s*(\d+),\s*\n\s*axis:\s*\"([^\"]*)\","
                         r"\s*\n\s*text:\s*\"((?:[^\"\\]|\\.)*)\",", src, re.M):
        out[m.group(1)] = {"w": int(m.group(2)), "axis": m.group(3),
                           "text": m.group(4).replace('\\"', '"').replace("\\\\", "\\")}
    return out


def main():
    write = "--write" in sys.argv
    d, qs, axes = load()
    want = {q["id"]: {"w": int(q["w"]), "axis": q.get("axis", ""), "text": q["text"]} for q in qs}
    cur = parse(OUT)
    print("可視性データベース 版 %s / 設問 %d 問" % (d.get("version"), len(qs)))
    for q in qs:
        print("  %-18s [%-7s] w=%d" % (q["id"], q.get("axis"), q["w"]))
    same = (cur == want)
    print("\nいまの visibility.js: %d 問 / %s" % (len(cur), "一致" if same else "ずれている"))
    if not same:
        for k in sorted(set(want) | set(cur)):
            if want.get(k) != cur.get(k):
                print("  差分: %s" % k)

    if write:
        body = render(d, qs, axes)
        if os.path.exists(OUT):
            shutil.copy2(OUT, OUT + STAMP)
        io.open(OUT, "w", encoding="utf-8").write(body)
        r = subprocess.run(["node", "--check", OUT], capture_output=True, text=True)
        if r.returncode != 0:
            if os.path.exists(OUT + STAMP):
                shutil.copy2(OUT + STAMP, OUT)
            print("\n書いた JavaScript が通りません。戻しました。", file=sys.stderr)
            print(r.stderr[:500], file=sys.stderr); sys.exit(3)
        again = parse(OUT)
        if again != want:
            print("\n書いた結果が生成物と一致しません。", file=sys.stderr); sys.exit(4)
        print("\nvisibility.js を作り直しました (%d 問)。node --check 通過。" % len(again))
        return
    if not same:
        sys.exit(3)


if __name__ == "__main__":
    main()
