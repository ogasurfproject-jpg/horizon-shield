# -*- coding: utf-8 -*-
"""
ヒアリングの設問バンクを、データベースから生成する。

持ち主:
  ・算定要件を確かめる設問、DBの穴を埋める現場質問  jhnrd/data/rules_2024.json の questions[]
  ・業務・集客・採用の設問                          hs-docfix/data/nursing/questions_local.json
  industry.js の bank は、この2つから作られる。手で編集しないこと。

なぜ向きを変えたか (2026-08-23):
  以前は DB の要件に ask: "q_nv_bcp_plan" と書き、文面は industry.js に手で書いていた。
  2箇所に手で書き、対応表も手で保っていた。8項目のうちは持つ。加算が100件になったら持たない。
  必ず、聞いていない要件か、どの要件のためでもない設問が生まれる。
  そしてずれても落ちない。例外も出ない。
  ただ「その要件について、誰にも尋ねていない」状態が静かに残る。

  いまは、DB に要件を足して question を書けば、ヒアリングの設問が自動で増える。
  要件を消せば、設問も消える。手で合わせる作業が無い。

ずれを許さない:
  --check は、次のどれかがあれば非ゼロで終わる。
    ・生成した bank と、industry.js の bank が違う
    ・ask はあるのに文面が無い要件がある
    ・id が重複している
  CI と pre-commit に入れれば、ずれたまま進めなくなる。

並び順:
  order を保つ。nextQuestions は重みで並べ替えるが、同点のときは
  Object.keys の順、すなわちこのファイルに書いた順が効く。
  順序を変えれば、同じ重みの設問のうちどちらが先に届くかが変わる。

使い方:
  python3 tools/nursing/sync_questions.py --check
  python3 tools/nursing/sync_questions.py --write
  python3 tools/nursing/sync_questions.py --compare /tmp/bank_before.json
"""

import io, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from migrate_questions import find_repo, bank_span, parse_bank, HS, JHNRD, DB, DB_IS_COPY, LOCAL, IND  # noqa: E402

STAMP = ".bak_preqgen20260823"


def load_db():
    db = json.load(io.open(DB, encoding="utf-8"))
    asks = {}
    for it in db.get("items", []):
        for key in ("requirements", "rules", "watch"):
            for r in it.get(key, []):
                a = r.get("ask")
                if a:
                    asks.setdefault(a, []).append("%s/%s" % (it.get("id"), r.get("id")))
    return db, asks


def merged():
    """DB と手元のファイルを合わせ、order の順に並べる。"""
    db, asks = load_db()
    local = json.load(io.open(LOCAL, encoding="utf-8")).get("questions", [])
    qs = list(db.get("questions", [])) + list(local)

    seen, dup = {}, []
    for q in qs:
        if q["id"] in seen:
            dup.append(q["id"])
        seen[q["id"]] = q
    qs.sort(key=lambda q: (int(q.get("order", 9999)), q["id"]))

    # ask はあるのに文面が無い要件。黙って飛ばさない。
    silent = sorted(set(asks) - {q["id"] for q in qs})
    return qs, asks, dup, silent, db.get("version")


def js_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def render(qs, asks, pad):
    """bank: { ... } を丸ごと作る。"""
    L = []
    a = lambda s: L.append(pad + s)
    a("bank: {")
    a("  /* 生成物。手で編集しないこと。")
    a("     算定要件と現場質問 : jhnrd/data/rules_2024.json の questions[]")
    a("     業務・集客・採用   : data/nursing/questions_local.json")
    a("     作り直し           : python3 tools/nursing/sync_questions.py --write")
    a("     ずれの検査         : python3 tools/nursing/sync_questions.py --check")
    a("")
    a("     訊き方について。これは相手を試す質問ではない。揃っていないものを")
    a("     見つけるのがこちらの仕事なので、「できていますか」ではなく")
    a("     「いまどうなっていますか」と訊く。揃っていないと答えやすい形にする。")
    a("     設問文に要件の中身を書くときは、DB で confirmed:true のものだけにする。")
    a("     お客様に自社の遵守状況について断定を伝えるのは、いちばんやってはいけない。 */")
    last = None
    for q in qs:
        p = q.get("purpose") or "?"
        if p != last:
            a("")
            a("  /* --- %s --- */" % {
                "requirement": "算定要件を確かめる (JHNRD)",
                "field": "まだ条文を確認できていないことを、現場に尋ねる (JHNRD)。"
                         "答えは field_reports に入る。規則の出典にはしない",
                "ops": "業務の回り方 (弊社)",
                "outbound": "外向き・ケアマネさん向けの集客 (弊社)",
                "recruit": "外向き・看護師の採用 (弊社)",
            }.get(p, p))
            last = p
        if p == "requirement":
            a("  /* %s */" % "、".join(asks.get(q["id"], ["(要件との対応なし)"])))
        elif p == "field":
            a("  /* 埋めようとしている穴: %s */" % q.get("fills_gap", "?"))
        a("  %s: {" % q["id"])
        a("    w: %d," % int(q["w"]))
        a("    purpose: %s," % js_string(p))
        a("    text: %s," % js_string(q["text"]))
        a("  },")
    a("}")   # カンマを付けない。bank_span は } の直後で止まるので、
             # もとのファイルの "," がそのまま残る。両方が出すと "},," になる。
             # 2026-08-23、実際にそうなった。Python 側の読み直しは通ってしまい、
             # node に読ませて初めて分かった。だから node の検査を下に入れてある。
    return "\n".join(L)


def main():
    argv = sys.argv[1:]
    write = "--write" in argv
    cmp_path = None
    if "--compare" in argv:
        cmp_path = argv[argv.index("--compare") + 1]

    qs, asks, dup, silent, ver = merged()
    src = io.open(IND, encoding="utf-8").read()
    cur = parse_bank(src)

    print("データベース 版 %s  (%s)" % (
        ver, "JHNRD の写し ※本物との一致は sync_db.py が見る" if DB_IS_COPY else "JHNRD 本体"))
    print("  生成する設問: %d 問 (%s)" % (
        len(qs), "、".join("%s %d" % (p, sum(1 for q in qs if q.get("purpose") == p))
                           for p in ("requirement", "field", "ops", "outbound", "recruit"))))
    print("  いまの bank : %d 問" % len(cur))

    bad = False
    if dup:
        print("\nid が重複しています: %s" % sorted(set(dup)), file=sys.stderr); bad = True
    if silent:
        print("\n要件が ask を出しているのに、文面がありません: %s" % silent, file=sys.stderr)
        print("  この要件については、誰にも尋ねていない状態です。", file=sys.stderr)
        print("  jhnrd/data/rules_2024.json の questions[] に足してください。", file=sys.stderr)
        bad = True

    want = [{"id": q["id"], "w": int(q["w"]), "text": q["text"]} for q in qs]
    same = (cur == want)

    if not same:
        ci = {q["id"]: q for q in cur}
        wi = {q["id"]: q for q in want}
        only_js = [k for k in ci if k not in wi]
        only_db = [k for k in wi if k not in ci]
        differ = [k for k in wi if k in ci and (ci[k]["text"] != wi[k]["text"] or ci[k]["w"] != wi[k]["w"])]
        order_only = (not only_js and not only_db and not differ)
        print("\nずれています。")
        if only_js: print("  bank にあって DB に無い: %s" % only_js)
        if only_db: print("  DB にあって bank に無い: %s" % only_db)
        if differ:  print("  文面か重みが違う       : %s" % differ)
        if order_only: print("  中身は同じですが、並び順が違います。")

    if cmp_path:
        before = json.load(io.open(cmp_path, encoding="utf-8"))
        b = [{"id": q["id"], "w": int(q["w"]), "text": q["text"]} for q in before]
        if b == want:
            print("\n照合: 移行前の bank と1字も違いません (%d 問)。" % len(b))
        else:
            print("\n照合: 移行前と違います。", file=sys.stderr)
            bi = {q["id"]: q for q in b}
            for k in sorted(set(bi) | set({q["id"]: q for q in want})):
                x, y = bi.get(k), {q["id"]: q for q in want}.get(k)
                if x != y:
                    print("  %s\n    前: %s\n    後: %s" % (k, x, y), file=sys.stderr)
            sys.exit(4)

    if write:
        if bad:
            print("\n先に上の問題を直してください。書いていません。", file=sys.stderr); sys.exit(3)
        s, i, j, pad = bank_span(src)
        block = render(qs, asks, pad)
        out = src[:s] + block + src[j:]
        shutil.copy2(IND, IND + STAMP)
        io.open(IND, "w", encoding="utf-8").write(out)
        # 書いたものを読み直して、狙いどおりかを確かめる。
        again = parse_bank(io.open(IND, encoding="utf-8").read())
        if again != want:
            print("\n書いた結果が生成物と一致しません。戻します。", file=sys.stderr)
            shutil.copy2(IND + STAMP, IND); sys.exit(5)
        # Python で読み直せても、JS として壊れていることがある。
        # 2026-08-23、"},," を書いて、Python の読み直しは通り、node で落ちた。
        # 生成物を出す道具は、出した言語の目で見なければ確かめたことにならない。
        import subprocess
        r = subprocess.run(["node", "--check", IND], capture_output=True, text=True)
        if r.returncode != 0:
            shutil.copy2(IND + STAMP, IND)
            print("\n書いた JavaScript が構文として通りません。戻しました。", file=sys.stderr)
            print(r.stderr.strip()[:600], file=sys.stderr)
            sys.exit(6)
        print("\nindustry.js の bank を作り直しました (%d 問)。node --check 通過。控え: *%s"
              % (len(again), STAMP))
        return

    if bad or not same:
        sys.exit(3)
    print("\nずれはありません。")


if __name__ == "__main__":
    main()
