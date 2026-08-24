#!/bin/sh
# 押す前に CI と同じ検査を通す仕掛けを、この手元に入れる。
#
# 2026-08-24: この道具は .git/hooks/pre-push に置いていた。
#   だがこのリポジトリは core.hooksPath=.githooks を使っている。
#   git は .git/hooks を見ない。置いた日から一度も呼ばれていなかった。
#   落ちない。例外も出ない。ただ、止まらない。
#   実際に、手元の検査が赤いまま push が通り、CI が赤くなった。
#
#   フックの中身は .githooks/pre-push に移した。あれは履歴に入るので配れる。
#   ここでやることは、この手元に core.hooksPath を設定することだけ。
#   設定は .git/config にあり、clone には付いてこない。だから手順は残す。
#
#   sh tools/install_ci_hook.sh
#
# 一回だけ通したいときは git push --no-verify。
set -e
root=$(git rev-parse --show-toplevel)
git config core.hooksPath .githooks
hook="$root/.githooks/pre-push"
if [ ! -x "$hook" ]; then
  echo "見つかりません: $hook" >&2
  echo "  .githooks/pre-push は履歴に入っています。取り直してください。" >&2
  exit 1
fi
echo "core.hooksPath = $(git config --get core.hooksPath)"
echo "git が見に行く先: $(git rev-parse --git-path hooks/pre-push)"
echo "使うフック: $hook"
echo "確かめる: python3 tools/ci_local.py"
