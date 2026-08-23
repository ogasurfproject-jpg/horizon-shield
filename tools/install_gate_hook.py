# -*- coding: utf-8 -*-
"""
門を、手で回り込めないようにする。

2026-08-23 に見つかったこと:
  yakumo/souba の2ページに、出典を示さないまま「とされています」と書かれた金額があった。
  この2ページは validate.py の MONEY_ON_PAGE で必ず落ちる。
  つまり門を通っていない。git log を見ると自動生成ではなく手で足されたものだった。

  GitHub Action の fail-closed は、生成器が出したものにしか掛かっていない。
  人が直接ページを書いて commit すれば、門はどこにも登場しない。
  「門を作った」ことと「門を通っている」ことは別である。

塞ぎ方は二段:
  1. 手元の pre-commit フック
     yakumo/ か care/ の下の HTML を stage したら、その分だけ門に通す。
     落ちたら commit させない。速いので邪魔にならない。
  2. GitHub Action (これは別途、手で入れていただく)
     push されたものを見る。手元のフックは --no-verify で外せるが、
     こちらは外せない。

変更されたページだけを見る:
  全ページを一度に通すと、既知の問題(souba の3ページが互いに 76〜81% 一致)で
  毎回落ちる。それでは誰も見なくなり、フックごと外される。
  門が見るのは「いま持ち込もうとしているもの」だけにする。
"""

import io, os, stat, subprocess, sys


def find_repo(start):
    d = os.path.abspath(start)
    for _ in range(6):
        if os.path.isdir(os.path.join(d, ".git")) and \
           os.path.exists(os.path.join(d, "tools", "pagecheck", "validate.py")):
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

HOOKDIR = os.path.join(ROOT, ".githooks")
HOOK = os.path.join(HOOKDIR, "pre-commit")

HOOK_SRC = '''#!/bin/sh
#
# 公開ページの門。手で書いたページも、必ずここを通す。
#
# 2026-08-23。出典のない金額を含む2ページが、門を通らずに公開されていた。
# GitHub Action の fail-closed は生成器の出力にしか掛かっておらず、
# 人が直接ページを書いて commit すれば、門はどこにも登場しなかった。
#
# 見るのは、いま stage されている yakumo/ と care/ の HTML だけ。
# 全ページを毎回通すと、既知の問題で毎回落ちて、フックごと外される。
#
# どうしても通したいときは git commit --no-verify で外せる。
# 外せること自体は残しておく。外せない門は、いずれ別の抜け道を作られる。
# ただし外したことは、この行を読んだ人に分かる。

set -e

STAGED=$(git diff --cached --name-only --diff-filter=ACM \\
         | grep -E '^(yakumo|care)/.*\\.html$' || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

echo "公開ページの門: $(echo "$STAGED" | wc -l | tr -d ' ') 枚を検査します"

if ! python3 tools/pagecheck/validate.py --paths $STAGED; then
  echo ""
  echo "門で止まりました。commit していません。"
  echo ""
  echo "  出典のない数字、金額、禁止ダッシュ、壊れたリンク、重複などが"
  echo "  見つかっています。上の行に何が引っかかったかが出ています。"
  echo ""
  echo "  直してから、もう一度 commit してください。"
  echo "  どうしても今すぐ通したい場合のみ: git commit --no-verify"
  echo "  (その場合、通っていないページが公開されます)"
  echo ""
  exit 1
fi
'''

WORKFLOW = '''name: pagecheck

# 手元のフックは --no-verify で外せる。こちらは外せない。
# 2026-08-23、出典のない金額を含む2ページが門を通らずに公開されていたため。
#
# 見るのは、その push で変わった yakumo/ と care/ のページだけ。
# 全ページを毎回見ると、既知の問題(souba の3ページが互いに 76〜81% 一致)で
# 毎回赤になり、誰も見なくなる。

on:
  push:
    branches: [main]
    paths:
      - "yakumo/**/*.html"
      - "care/**/*.html"
  pull_request:
    paths:
      - "yakumo/**/*.html"
      - "care/**/*.html"
  workflow_dispatch:

jobs:
  pagecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: 変わったページだけを門に通す
        run: |
          CHANGED=$(git diff --name-only --diff-filter=ACM HEAD^ HEAD \\
                    | grep -E '^(yakumo|care)/.*\\.html$' || true)
          if [ -z "$CHANGED" ]; then
            echo "対象のページはありません。"
            exit 0
          fi
          echo "$CHANGED"
          python3 tools/pagecheck/validate.py --paths $CHANGED
'''


def main():
    os.makedirs(HOOKDIR, exist_ok=True)
    io.open(HOOK, "w", encoding="utf-8", newline="\n").write(HOOK_SRC)
    os.chmod(HOOK, os.stat(HOOK).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print("フックを置きました: .githooks/pre-commit")

    r = subprocess.run(["git", "-C", ROOT, "config", "core.hooksPath", ".githooks"],
                       capture_output=True, text=True)
    if r.returncode == 0:
        print("git の hooksPath を .githooks に向けました")
    else:
        print("git config に失敗しました。手で実行してください:", file=sys.stderr)
        print("  git config core.hooksPath .githooks", file=sys.stderr)

    wf = os.path.join(ROOT, ".github", "workflows", "pagecheck.yml")
    out = os.path.join(ROOT, "tools", "pagecheck", "pagecheck.yml.txt")
    io.open(out, "w", encoding="utf-8").write(WORKFLOW)
    print("\nGitHub Action の中身を書き出しました: tools/pagecheck/pagecheck.yml.txt")
    print("これを %s に置いてください。" % os.path.relpath(wf, ROOT))
    print("(CI のファイルは、こちらから直接書けないため)")
    print("\n手元のフックは --no-verify で外せます。外せること自体は残してあります。")
    print("外せない門は、いずれ別の抜け道を作られるので。")
    print("外せない側は GitHub Action が担います。")


if __name__ == "__main__":
    main()
