#!/usr/bin/env bash
# ============================================================
# Yakumo 一括デプロイ(TOshi の Mac で実行)
# 全ステップを順に「発火」させる。secrets は read -s でその場入力し、
# ファイル・履歴・remote設定に一切残さない。
#
# 使い方:
#   cd ~/Desktop/horizon-shield
#   bash tools/yakumo/deploy_all.sh
#
# 前提: このMacで git push が通る / wrangler ログイン済み(npx wrangler whoami で確認)。
# 各ステップは y/N で選べる。既に済んだ物は N でスキップして良い。
# ============================================================
set -uo pipefail   # -e は使わない(想定内の非致命失敗で止めないため)

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "リポジトリ内で実行してください"; exit 1; }
cd "$ROOT"
BRANCH="feat/yakumo-mall-hearing-webmcp"
ACCT="c15ff64aba400e541853dec1fbe5e76a"
HEAR="https://hs-hearing.oga-surf-project.workers.dev"
EST="https://hs-estimate.oga-surf-project.workers.dev"
ask() { local p="$1"; local a; read -r -p "$p [y/N] " a; [ "$a" = "y" ] || [ "$a" = "Y" ]; }

echo "============================================================"
echo " Yakumo 一括デプロイ  (branch: $BRANCH)"
echo "============================================================"

# ---- 0. コードをこのMacに取り込む ----
# 前提: Claude がサンドボックスから origin へ push 済み(PAT提供時)、
#       もしくは bundle を取り込み済み。ここでは origin から取得する。
if ask "STEP0: origin から $BRANCH を取り込む?(Claude が push 済みの場合)"; then
  git fetch origin "$BRANCH" && git checkout "$BRANCH" && git pull origin "$BRANCH" \
    || echo "  取得できず。まだ push されていないか、bundle を先に取り込む必要あり:"
  echo "    (bundle 取り込み例)  git fetch /path/to/yakumo-v4.bundle $BRANCH && git checkout $BRANCH"
fi

# ---- 1. (任意)自分で push する場合 ----
if ask "STEP1: このMacから origin へ push する?(Claude が押していない場合のみ)"; then
  n=0; until [ $n -ge 4 ]; do git push -u origin "$BRANCH" && break; n=$((n+1)); echo "retry $n"; sleep $((2**n)); done
fi

# ---- 2. main へ反映(Pages 配信を発火) ----
echo "STEP2: main へ反映(これで モール/各ページ/Action が本番配信)"
echo "  ブラウザPR: https://github.com/ogasurfproject-jpg/horizon-shield/pull/new/$BRANCH"
if ask "  いま main へ直接マージして push する?"; then
  git checkout main && git pull origin main \
    && git merge --no-ff "$BRANCH" -m "merge: Yakumo mall + hearing + webmcp" \
    && git push origin main \
    && git checkout "$BRANCH"
  echo "  -> Pages 反映まで最大1〜2分。 https://shield.the-horizons-innovation.com/yakumo/ を確認。"
fi

# ---- 3. hs-hearing ワーカー(自動ヒアリング+生きたMCP+メール安全網)をデプロイ ----
if ask "STEP3: hs-hearing ワーカーをデプロイする?"; then
  ( cd "$ROOT/workers/hs-hearing"
    if ask "  HS_HEARING_KV を新規作成する?(初回のみ)"; then
      CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler kv namespace create HS_HEARING_KV
      echo "  ↑ 出力の id を wrangler.jsonc の REPLACE_WITH_HS_HEARING_KV_ID に貼って保存し、Enter"
      read -r _
    fi
    ask "  secret HEARING_ADMIN_SECRET を設定?(必須・初回)" && CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler secret put HEARING_ADMIN_SECRET
    ask "  secret GH_DISPATCH_TOKEN を設定?(自動生成に必須)" && CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler secret put GH_DISPATCH_TOKEN
    ask "  secret RESEND_API_KEY を設定?(案内メール送信・任意)" && CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler secret put RESEND_API_KEY
    ask "  通知 secret(LINE/NTFY)を設定?(任意)" && {
      CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler secret put LINE_CHANNEL_TOKEN
      CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler secret put LINE_USER_ID
      CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler secret put NTFY_TOPIC_URL
    }
    node --check src/hearing.js && CLOUDFLARE_ACCOUNT_ID=$ACCT npx wrangler deploy
    echo "  確認:"; curl -s "$HEAR/health"; echo
  )
fi

# ---- 4. No.001 発行 + WebMCPオプション + ヒアリングリンク ----
if ask "STEP4: 加盟店 No.001(リフォーム職人)を発行してヒアリングリンクを取る?"; then
  read -r -s -p "  hs-estimate ADMIN_SECRET: " HS_ESTIMATE_ADMIN; echo
  read -r -s -p "  hs-hearing HEARING_ADMIN_SECRET: " HS_HEARING_ADMIN; echo
  read -r -p "  堤さんのメール(任意・Enterで空): " NO001_EMAIL
  export HS_ESTIMATE_ADMIN HS_HEARING_ADMIN NO001_EMAIL
  bash tools/yakumo/issue_no001.sh --run
  echo "  ↑ hearing_url と token を控える。"
fi

# ---- 5. ヒアリング案内メールを送る(任意・件名に ref トークンが入り、返信も自動照合) ----
if ask "STEP5: 堤さんへヒアリング案内メールを送る?(RESEND設定済みの時)"; then
  read -r -p "  token: " TOK
  read -r -p "  宛先メール: " TO
  read -r -s -p "  hs-hearing HEARING_ADMIN_SECRET: " HS_HEARING_ADMIN; echo
  curl -s -X POST "$HEAR/admin/send-hearing" -H "X-Admin-Key: $HS_HEARING_ADMIN" \
    -H "Content-Type: application/json" -d "{\"token\":\"$TOK\",\"to\":\"$TO\"}"; echo
fi

echo "============================================================"
echo " 完了。次: 堤さんが回答 or メール返信 -> 自動で生成->検証->公開が発火。"
echo " Email Routing(hearing@...)の設定は手順書 §9 を参照。"
echo "============================================================"
