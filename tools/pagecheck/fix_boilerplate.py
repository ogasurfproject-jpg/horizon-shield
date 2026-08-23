# -*- coding: utf-8 -*-
"""
指紋から剥がす「共通の枠」のパターンが、当たっていなかったのを直す。

見つけたもの (2026-08-23):
  souba の3ページが互いに 76〜81% 一致していて、うち1組が重複判定に入っていた。
  中身を書き直す作業だと思っていたが、測ってみると原因は別だった。

  剥がすはずのパターンの1本が、0箇所にしか当たっていなかった。

    <div class="section"><h2>出典・データソース</h2>.*?</div></div>

  実際の HTML は <div class="section"> に包まれておらず、
  <h2>出典・データソース</h2><div class="source-block"> という形だった。
  つまりこの枠は一度も剥がれたことがない。
  さらに「Yakumoの検証で確認すること」も全ページ共通なのに、剥がす指定が無かった。

  合わせて 274 字。本文がもともと 1,300 字しかないので、
  全ページ共通の枠が本文の 2割を占め、そのぶん距離が縮んでいた。

直した結果:
  naiso vs yane の距離 3 → 12 (6以下が重複判定)
  つまりあの3ページは重複ではなかった。壊れた正規表現が重複に見せていた。

ここで気をつけたこと:
  枠として剥がしてよいのは、全ページに同じ文言で出るものだけである。
  「その数字は、誰の収益とつながっているか」の段落(engrXiv を引くもの)は
  20ページ中2ページにしか無い。これは枠ではなく、手で足された重複した中身である。
  これを枠として除外すれば、重複を隠すことになる。だから除外していない。
  重複判定が消えたのは、枠を正しく剥がしたからであって、
  中身の重複を見えなくしたからではない。

台帳について:
  このパターン変更で、既存20ページの指紋がすべて変わる。
  台帳に保存された古い指紋と照合できなくなるので、台帳を作り直す。
  作り直しは、全エントリを新しい計算で一斉に入れ替えることで整合を保つ。
  古い台帳は消さずに控えを残す。
"""

import io, json, os, re, shutil, sys


def find_repo(start):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isdir(os.path.join(d, ".git")) and \
           os.path.exists(os.path.join(d, "tools", "pagecheck", "fingerprint.py")):
            return d
        p = os.path.dirname(d)
        if p == d:
            break
        d = p
    return None


ROOT = os.environ.get("REPO")
ROOT = os.path.abspath(ROOT) if ROOT else find_repo(os.path.dirname(os.path.abspath(__file__)))
if not ROOT:
    sys.stderr.write("\nリポジトリの根が見つかりません。REPO=<パス> を付けてください。\n\n")
    sys.exit(1)

FP = os.path.join(ROOT, "tools", "pagecheck", "fingerprint.py")
STAMP = ".bak_preboiler20260823"

OLD = '''    re.compile(r'<div class="section"><h2>出典・データソース</h2>.*?</div></div>', re.S),'''
NEW = '''        # 2026-08-23。この1行は 0 箇所にしか当たっていなかった。
        # 実際の HTML は <div class="section"> に包まれていない。
        # 剥がれないまま、全ページ共通の 173 字が「中身」として数えられ、
        # souba の2ページを重複に見せていた。実物に合わせて書き直す。
        re.compile(r'<h2>出典・データソース</h2><div class="source-block">.*?</div>', re.S),
        # 全ページ共通の枠なのに、剥がす指定が無かった(101 字)。
        re.compile(r'<h2>Yakumoの検証で確認すること</h2><ul class="tip-list">.*?</ul>', re.S),'''


def main():
    src = io.open(FP, encoding="utf-8").read()
    if "source-block" in src:
        print("skip (already fixed)"); return
    if src.count(OLD) != 1:
        print("ANCHOR FAIL (%d hits)" % src.count(OLD), file=sys.stderr); sys.exit(2)
    shutil.copy2(FP, FP + STAMP)
    io.open(FP, "w", encoding="utf-8").write(src.replace(OLD, NEW, 1))
    print("パターンを直しました。バックアップ: tools/pagecheck/fingerprint.py%s" % STAMP)

    # 当たっているかを、その場で確かめる。直したと言って当たっていなければ意味が無い。
    sys.path.insert(0, os.path.join(ROOT, "tools", "pagecheck"))
    import importlib
    import fingerprint as F
    importlib.reload(F)
    sample = os.path.join(ROOT, "yakumo", "souba", "naiso-nagakute", "index.html")
    if os.path.exists(sample):
        h = io.open(sample, encoding="utf-8").read()
        print("\nパターンごとの一致箇所:")
        for i, r in enumerate(F.NS_BOILERPLATE["yakumo"]):
            print("  [%d] %-46s %d 箇所" % (i, r.pattern[:46], len(r.findall(h))))
        miss = [i for i, r in enumerate(F.NS_BOILERPLATE["yakumo"]) if not r.findall(h)]
        if miss:
            print("\n  当たっていないパターンがあります: %s" % miss, file=sys.stderr)
            print("  直したつもりで当たっていないのが、今回の原因でした。", file=sys.stderr)


if __name__ == "__main__":
    main()
