# -*- coding: utf-8 -*-
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
    sys.stderr.write("\n門の本体が見つかりません: %s\n"
                     "tools/pagecheck/validate.py が要ります。\n\n" % REAL)
    sys.exit(3)

runpy.run_path(REAL, run_name="__main__")
