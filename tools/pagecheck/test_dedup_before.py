# -*- coding: utf-8 -*-
"""
重複関所 v1.3.2 (--before) の検査。redteam.py は check_page しか攻めないので、check_duplicates はここで攻める。

  python3 tools/pagecheck/test_dedup_before.py     # 4 手。1 手でも落ちたら exit 1

手:
  1. before 無し: 近似重複 2 枚 → 弾く (v1.3.1 と同じ)
  2. 2 枚とも文面不変 (前の本文は href だけ違う): 数えない → 通す
  3. 片方が新規 (前の本文が無い): 新規 vs 文面不変 → 弾く (穴を開けない)
  4. 片方の文面が変わった (近似のまま): 変わった vs 文面不変 → 弾く
"""
import os, sys, tempfile, shutil, io

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import validate

BODY = ("<p>外壁塗装の足場工事の単価は、面積と高さで決まります。相場の幅は公開データで確かめられます。"
        "見積書の一式表記は内訳を求めてください。諸経費の比率も確認します。塗料のグレードで単価は変わります。</p>") * 6

def page(title, body, href="/mitsumori-ai-shindan.html"):
    return ("<!DOCTYPE html><html lang=\"ja\"><head><meta charset=\"utf-8\"><title>%s</title>"
            "<meta name=\"robots\" content=\"index,follow\"></head><body><main>%s</main>"
            "<footer><a href=\"%s\">見積書AI診断</a></footer></body></html>" % (title, body, href))

def main():
    tmp = tempfile.mkdtemp(prefix="pagecheck_dedup_")
    fails = []
    try:
        validate._set_root(tmp)
        os.makedirs(os.path.join(tmp, "qa"), exist_ok=True)
        a = "qa/test-a.html"; b = "qa/test-b.html"
        html_a = page("足場工事の単価", BODY)
        html_b = page("シロアリ駆除の費用", BODY.replace("足場", "床下", 2))
        io.open(os.path.join(tmp, a), "w", encoding="utf-8").write(html_a)
        io.open(os.path.join(tmp, b), "w", encoding="utf-8").write(html_b)

        e1 = validate.check_duplicates([a, b])
        ok1 = any("DUPLICATE_IN_BATCH" in e for e in e1)
        print("  %s 1 before 無し: 近似重複を弾く  errs=%s" % ("green" if ok1 else "RED", e1[:1]))
        if not ok1: fails.append("1: 近似重複が弾かれない(検査の前提が崩れている)")

        old = {a: page("足場工事の単価", BODY, href="/kantei/"), b: page("シロアリ駆除の費用", BODY.replace("足場", "床下", 2), href="/kantei/")}
        e2 = validate.check_duplicates([a, b], before_lookup=lambda p: old.get(p))
        ok2 = not e2
        print("  %s 2 文面不変同士(href だけ違う): 数えない  errs=%s" % ("green" if ok2 else "RED", e2[:1]))
        if not ok2: fails.append("2: 文面不変同士を弾いた(誤検出)")

        e3 = validate.check_duplicates([a, b], before_lookup=lambda p: old.get(p) if p == a else None)
        ok3 = any("DUPLICATE_IN_BATCH" in e for e in e3)
        print("  %s 3 新規 vs 文面不変: 弾く  errs=%s" % ("green" if ok3 else "RED", e3[:1]))
        if not ok3: fails.append("3: 新規ページの重複がすり抜けた(穴)")

        old4 = dict(old); old4[b] = page("シロアリ駆除の費用", BODY.replace("足場", "床下", 2) + "<p>追記の一文。</p>")
        e4 = validate.check_duplicates([a, b], before_lookup=lambda p: old4.get(p))
        ok4 = any("DUPLICATE_IN_BATCH" in e for e in e4)
        print("  %s 4 文面が変わった vs 文面不変: 弾く  errs=%s" % ("green" if ok4 else "RED", e4[:1]))
        if not ok4: fails.append("4: 文面が変わった近似重複がすり抜けた(穴)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    n = 4 - len(fails)
    print("=== %d / 4 合格 (門 v%s) ===" % (n, validate.GATE_VERSION))
    if fails:
        for f in fails: print("  - " + f)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
