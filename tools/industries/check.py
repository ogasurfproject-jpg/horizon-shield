# -*- coding: utf-8 -*-
"""
業種レジストリと、実際に動いている industry.js が食い違っていないかを見る。

なぜ要るか (2026-08-23):
  レジストリを作ってすぐ分かったことがある。
  建設には JCCDB があるのに、industry.js には rules_db も golden_ratio も書かれていなかった。
  訪問看護だけが物差しに繋がっている状態だった。

  加盟店には、それぞれの思惑と特性と業種がある。だが仕組みは同じでなければならない。
  片方の業種にしか物差しが繋がっていなければ、片方の生成物だけが濃くなる。

  この検査は、次のときに落ちる。
    ・レジストリにある業種が industry.js に無い(逆も)
    ・物差し(rules_db)を宣言していない業種がある
    ・黄金比を宣言していない業種がある
    ・レジストリと industry.js で黄金比が違う
    ・現場質問が0問なのに、その理由が書かれていない
  黙って片方だけ濃くなるのを防ぐ。

  python3 tools/industries/check.py
"""

import io, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HS = os.path.abspath(os.path.join(HERE, "..", ".."))
REG = os.path.join(HS, "data", "industries", "registry.json")
IND = os.path.join(HS, "workers", "hs-hearing", "src", "industry.js")


def from_js():
    """industry.js を node に読ませて実際の定義を取る。正規表現で読まない。"""
    code = ("import * as I from %s;"
            "const o={};for(const k of Object.keys(I.INDUSTRIES)){const e=I.INDUSTRIES[k];"
            "o[k]={label:e.label,mall:e.mall,rules_db:e.rules_db||null,"
            "golden_ratio:e.golden_ratio||null,"
            "bank:Object.keys(e.bank||{}).length,"
            "field:(I.dbBuildingQids?I.dbBuildingQids(k):[]).length};}"
            "console.log(JSON.stringify(o));" % json.dumps("file://" + IND))
    r = subprocess.run(["node", "--input-type=module", "-e", code],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-800:]); sys.exit(2)
    return json.loads([l for l in r.stdout.splitlines() if l.startswith("{")][0])


def main():
    reg = json.load(io.open(REG, encoding="utf-8"))["industries"]
    js = from_js()
    errs, warns = [], []
    print("レジストリ: %d 業種 / industry.js: %d 業種\n" % (len(reg), len(js)))
    for k in sorted(set(reg) | set(js)):
        r, j = reg.get(k), js.get(k)
        if not r:
            errs.append("%s が industry.js にあるのに、レジストリに無い" % k); continue
        if not j:
            errs.append("%s がレジストリにあるのに、industry.js に無い" % k); continue
        db = r.get("rules_db")
        if not db:
            errs.append("%s が物差し(rules_db)を宣言していない" % k)
        if not r.get("golden_ratio"):
            errs.append("%s が黄金比を宣言していない" % k)
        if j.get("golden_ratio") and r.get("golden_ratio") and j["golden_ratio"] != r["golden_ratio"]:
            errs.append("%s の黄金比が、レジストリと industry.js で違う" % k)
        if not j.get("rules_db"):
            warns.append("%s は industry.js 側に rules_db が無い(レジストリには %s と書いてある)"
                         % (k, (db or {}).get("name")))
        if not j.get("golden_ratio"):
            warns.append("%s は industry.js 側に golden_ratio が無い" % k)
        fq = (r.get("field_questions") or {})
        gapnote = ""
        if not j.get("field"):
            gapnote = "   ← 物差しを厚くする問いが 0 問"
            if not fq.get("gap"):
                errs.append("%s は現場質問が0問なのに、理由(field_questions.gap)が無い" % k)
        print("  %-13s %-12s 物差し=%-7s 設問=%-3d 現場質問=%d%s"
              % (k, r.get("label"), (db or {}).get("name", "無"),
                 j.get("bank", 0), j.get("field", 0), gapnote))
        if fq.get("gap"):
            print("       穴: %s" % fq["gap"])
    if warns:
        print("\n注意:")
        for w in warns:
            print("  ・" + w)
    if errs:
        print("\n落ちました:", file=sys.stderr)
        for e in errs:
            print("  ・" + e, file=sys.stderr)
        sys.exit(3)
    print("\n食い違いはありません。")


if __name__ == "__main__":
    main()
