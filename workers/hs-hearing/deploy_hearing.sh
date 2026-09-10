#!/bin/bash
# deploy_hearing.sh : 試験に通っていないコードを本番に出さない (2026-09-10)
#
# なぜこの台本を通すのか:
#   このワーカーは加盟店に文面を送り、回答を取り込み、ページ生成の合図を出す。
#   さらに cron (17 21 * * *) で、誰も見ていない時間に自分で動く。
#   壊れたまま出すと、壊れたことに気づくのが「送られた後」になる。
#
#   2026-09-10 の夜、この 8 本の suite を手で走らせてから deploy する約束で
#   二回出した。三回目に打たない日が来る。だから約束を道具の中に入れる。
#   同じ日に扉 (hs-verify-gate) の deploy_gate.sh へ同じ関所を足した。
#   そちらは 18:00Z ごとに書き換えられん記録を書くから理由が重い。
#   こちらの理由は別で、送った文面と取り込んだ回答は取り消せない、というものだ。
#
# 使い方:  bash workers/hs-hearing/deploy_hearing.sh

set -euo pipefail
cd "$(dirname "$0")"

# 1) 未コミットのソースを出さない。
#    扉と違い、ここは判定に commit を刻まない。それでも要る理由は再現性である。
#    本番で動いているコードが git に無ければ、後から誰も「何が動いていたか」を
#    言えない。加盟店に送った文面の出どころが分からんということになる。
DIRTY=$(git status --porcelain -- src/ wrangler.jsonc)
if [ -n "$DIRTY" ]; then
  echo "★ 拒否: このワーカーのソースに未コミットの変更がある。"
  echo "$DIRTY"
  echo "先にコミットしろ。本番で動いた物が git に残るためだ。"
  exit 1
fi

# 2) suite が全緑でなければ出さない。
#    run_all.mjs は一覧を持たず、この directory から拾う。新しく足した suite は
#    足した日から関所に入る。消された suite はここでは見つからん。git status が見つける。
echo "試験: node run_all.mjs (全 suite)"
if ! node run_all.mjs; then
  echo ""
  echo "★ 拒否: hs-hearing の suite が全緑やない。デプロイせん。"
  echo "   ここで止めるんは、このワーカーが送る物と取り込む物が"
  echo "   取り消せんからだ。送った後に気づいても遅い。"
  exit 1
fi
echo ""

SHA=$(git rev-parse --short=12 HEAD)
echo "deploying hs-hearing at $SHA"
npx wrangler deploy
echo ""
echo "確認:"
echo "  curl -s https://hs-hearing.oga-surf-project.workers.dev/activity.json | head -c 200"
echo "  activity.json が返れば生きとる。管理の口は鍵が要るので、ここでは叩かん。"
