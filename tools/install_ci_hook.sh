#!/bin/sh
# 押す前に CI と同じ検査を通す仕掛けを、この手元に入れる。
#
# フックは git で配れない(.git/hooks は履歴に入らない)ので、
# 入れる手順のほうを履歴に残す。手元を作り直したら、これを一度走らせる。
#
#   sh tools/install_ci_hook.sh
#
# 外したいときは .git/hooks/pre-push を消す。
# 一回だけ通したいときは git push --no-verify。
set -e
root=$(git rev-parse --show-toplevel)
hook="$root/.git/hooks/pre-push"
cat > "$hook" <<'HOOKEOF'
#!/bin/sh
# tools/install_ci_hook.sh が置いた。手で書き足さないこと。
root=$(git rev-parse --show-toplevel)
exec python3 "$root/tools/ci_local.py" --quiet-on-pass
HOOKEOF
chmod +x "$hook"
echo "入れました: $hook"
echo "確かめる: python3 tools/ci_local.py"
