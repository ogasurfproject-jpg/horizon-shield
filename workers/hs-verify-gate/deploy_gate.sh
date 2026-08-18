#!/bin/bash
# deploy_gate.sh — 扉を、コミットの身元つきでデプロイする (2026-08-15)
#
# なぜこのスクリプトを通すのか:
#   判定の gate_commit は「どのバイト列のコードがこの判定を出したか」を
#   record_sha256 の中に固定するための値である。
#   未コミットの変更を含んだままデプロイすると、SHA はデプロイしたコードを
#   含まないコミットを指す。それはこの事業が狩っている種類の嘘なので、
#   このスクリプトはワーカーのソースが未コミットならデプロイを拒否する。
#
#   素の `npx wrangler deploy` でもデプロイ自体はできるが、その場合
#   GATE_COMMIT は注入されず、以後の全判定に
#   "unpinned: this deployment did not inject a commit" が載る。
#   黙って空になるのではなく、ピンされていないことが判定に見える。
#
# 使い方:  bash workers/hs-verify-gate/deploy_gate.sh

set -euo pipefail
cd "$(dirname "$0")"

DIRTY=$(git status --porcelain -- src/ wrangler.jsonc)
if [ -n "$DIRTY" ]; then
  echo "★ 拒否: このワーカーのソースに未コミットの変更がある。"
  echo "$DIRTY"
  echo "先にコミットしろ。SHA がデプロイするコードを含むコミットを指すためだ。"
  exit 1
fi

SHA=$(git rev-parse --short=12 HEAD)
echo "deploying with GATE_COMMIT=$SHA"
npx wrangler deploy --var GATE_COMMIT:"$SHA" --var OPENAI_APPS_CHALLENGE:"$OPENAI_APPS_CHALLENGE"
echo ""
echo "確認:"
echo "  curl -s https://gate.horizonshield.dev/health"
echo "  gate_commit が $SHA なら成功。"
