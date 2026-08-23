# -*- coding: utf-8 -*-
"""
公開の門を、どの業種にも属さない場所へ移す。

なぜ:
  合同会社あっぷす様(訪問看護)は Yakumo に加盟していない。それなのに、
  あっぷす様のページが公開できるかどうかを tools/yakumo/validate.py が決めていた。
  Yakumo 側を直すたびに、関係のない事業所のページが道連れになる形である。

  検査の中身を見ると、Yakumo のものだったのは名前と、モールへのバックリンク1件だけだった。
  HTML の構造、JSON-LD の妥当性、canonical、必須メタ、金額の非表示、禁止ダッシュ、
  内部リンクの体裁、重複。どれも業種と関係がない。
  つまり、ずっと汎用の門が、たまたま Yakumo の下に置かれていた。

やること:
  中身は一切変えない。場所と名前だけ動かす。
    tools/pagecheck/validate.py   これが本体になる
    tools/yakumo/validate.py      これまでの呼び出しが壊れないよう、そのまま委譲する

  同じページを両方に通して、出力が一字一句同じであることを確かめてから入れ替える。
  「たぶん同じ」で live のパイプラインを触らない。

残る結合(隠さずに書く):
  重複検出は tools/yakumo/generate.py の指紋関数(fingerprint / ledger_load / simhash)を
  import している。これも本来は業種に属さないので pagecheck に来るべきだが、
  動かすと建設の生成器そのものに触ることになる。今夜はそこまでやらない。
  代わりに、pagecheck 側が tools/yakumo を明示的に読みに行く形にして、
  「まだここが残っている」ことをコードに書いておく。

  台帳(ledger)を共有していること自体は、むしろ正しい。
  建設のページと訪問看護のページが互いに重複していたら、それは見つけるべきものである。
"""

import io, os, shutil, sys

def find_repo(start):
    """リポジトリの根を、階層を数えずに探す。

    2026-08-23、この日だけで2回、".." をいくつ重ねるかを間違えた。
    tools/ に置くか tools/nursing/ に置くかで数が変わるので、数えると必ず間違える。
    目印(.git と tools/yakumo/generate.py)を上に向かって探す。
    """
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isdir(os.path.join(d, ".git")) and \
           os.path.exists(os.path.join(d, "tools", "yakumo", "generate.py")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


ROOT = os.environ.get("REPO")
if ROOT:
    ROOT = os.path.abspath(ROOT)
else:
    ROOT = find_repo(os.path.dirname(os.path.abspath(__file__)))
    if not ROOT:
        sys.stderr.write("\nリポジトリの根が見つかりません。"
                         ".git と tools/yakumo/generate.py がある場所を探しています。\n"
                         "REPO=<パス> を付けて実行してください。\n\n")
        sys.exit(1)
OLD = os.path.join(ROOT, "tools", "yakumo", "validate.py")
NEWDIR = os.path.join(ROOT, "tools", "pagecheck")
NEW = os.path.join(NEWDIR, "validate.py")

HEADER_OLD = """# -*- coding: utf-8 -*-
\"\"\"
八雲 生成コンテンツ プリフライト検証 (fail-closed)"""

HEADER_NEW = """# -*- coding: utf-8 -*-
\"\"\"
公開前ページ検証 (fail-closed) ・ 業種に属さない共通の門

2026-08-23 に tools/yakumo/ からここへ移した。
合同会社あっぷす様(訪問看護)は Yakumo に加盟していないのに、
あっぷす様のページを公開できるかどうかを Yakumo の門が決めていたため。

検査の中身は移動前と一字一句同じである。Yakumo に属していたのは
名前と、モール(/yakumo/)へのバックリンク1件だけで、それは既に
置き場所で分岐するようにしてある。"""

DEDUP_OLD = """    try:
        import generate as G  # 同ディレクトリ(tools/yakumo)
    except Exception as e:
        return ["DEDUP_MODULE_LOAD_FAIL: " + str(e)[:80]]"""

DEDUP_NEW = """    # 残っている結合(2026-08-23):
    #   指紋の計算(fingerprint / simhash / ledger)は tools/yakumo/generate.py にある。
    #   これも本来は業種に属さないので、いずれここへ来るべきである。
    #   ただし動かすと建設の生成器そのものに触るので、今夜はやらない。
    #   明示的に読みに行き、残っていることをここに書いておく。
    #
    #   台帳を共有していること自体は正しい。建設のページと訪問看護のページが
    #   互いに重複していたら、それは見つけるべきものである。
    _yak = os.path.join(REPO_ROOT, "tools", "yakumo")
    if _yak not in sys.path:
        sys.path.insert(0, _yak)
    try:
        import generate as G
    except Exception as e:
        return ["DEDUP_MODULE_LOAD_FAIL: " + str(e)[:80]]"""

SHIM = '''# -*- coding: utf-8 -*-
"""
これは委譲だけの薄い層である。中身は tools/pagecheck/validate.py にある。

2026-08-23 に門を業種に属さない場所へ移した。
合同会社あっぷす様(訪問看護)は Yakumo に加盟していないのに、
あっぷす様のページの公開可否を Yakumo の門が決めていたため。

これまでの呼び出し(GitHub Action や手元のコマンド)を壊さないために、
この名前を残してある。新しく書くものは tools/pagecheck/validate.py を直接呼ぶこと。
"""
import os, runpy, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.join(HERE, "..", "pagecheck", "validate.py")
REAL = os.path.abspath(REAL)

if not os.path.exists(REAL):
    sys.stderr.write("\\n門の本体が見つかりません: %s\\n"
                     "tools/pagecheck/validate.py が要ります。\\n\\n" % REAL)
    sys.exit(3)

runpy.run_path(REAL, run_name="__main__")
'''


def main():
    if not os.path.exists(OLD):
        print("not found: " + OLD, file=sys.stderr); sys.exit(1)
    src = io.open(OLD, encoding="utf-8").read()
    if "runpy.run_path" in src:
        print("skip (already moved)"); return
    if src.count(HEADER_OLD) != 1:
        print("ANCHOR FAIL: 見出し", file=sys.stderr); sys.exit(2)
    if src.count(DEDUP_OLD) != 1:
        print("ANCHOR FAIL: dedup の import", file=sys.stderr); sys.exit(2)

    body = src.replace(HEADER_OLD, HEADER_NEW, 1).replace(DEDUP_OLD, DEDUP_NEW, 1)
    # REPO_ROOT は「自分の2つ上」で計算されている。tools/pagecheck/ でも2つ上で同じ。
    os.makedirs(NEWDIR, exist_ok=True)
    io.open(NEW, "w", encoding="utf-8").write(body)
    shutil.copy2(OLD, OLD + ".bak_premove20260823")
    io.open(OLD, "w", encoding="utf-8").write(SHIM)
    print("移しました。")
    print("  本体  : tools/pagecheck/validate.py")
    print("  委譲  : tools/yakumo/validate.py (これまでの呼び出しは壊れません)")
    print("  控え  : tools/yakumo/validate.py.bak_premove20260823")
    print("\n入れ替える前に、同じページを両方に通して出力が一致することを確かめてください。")


if __name__ == "__main__":
    main()
