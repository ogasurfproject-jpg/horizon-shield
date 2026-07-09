#!/usr/bin/env bash
# 加盟店番号 No.001 発行 + WebMCPオプション + ヒアリングリンク生成
# リフォーム職人株式会社 / honbu ¥29,800(税抜) + WebMCP ¥12,000(税抜) = ¥41,800(税抜)/月
#
# 使い方(TOshi 手動):
#   export HS_ESTIMATE_ADMIN='＜hs-estimate の ADMIN_SECRET＞'
#   export HS_HEARING_ADMIN='＜hs-hearing の HEARING_ADMIN_SECRET＞'
#   export NO001_EMAIL='＜リフォーム職人の連絡先メール(任意)＞'
#   bash tools/yakumo/issue_no001.sh          # 表示のみ(dry-run)
#   bash tools/yakumo/issue_no001.sh --run    # 実行
#
# 鉄則: トークン/シークレットはファイル・コミットに残さない。env で渡す。
set -euo pipefail

EST="https://hs-estimate.oga-surf-project.workers.dev"
HEAR="https://hs-hearing.oga-surf-project.workers.dev"
RUN="${1:-}"

: "${HS_ESTIMATE_ADMIN:?export HS_ESTIMATE_ADMIN が必要}"
: "${HS_HEARING_ADMIN:?export HS_HEARING_ADMIN が必要}"
EMAIL="${NO001_EMAIL:-}"

echo "== STEP 1: hs-estimate で honbu キーを発行 =="
ISSUE_BODY=$(cat <<JSON
{"tier":"honbu","companyName":"リフォーム職人株式会社","email":"${EMAIL}"}
JSON
)
echo "POST ${EST}/admin/issue-key"
echo "  body: ${ISSUE_BODY}"

echo ""
echo "== STEP 2: hs-hearing で WebMCPオプション有効化 + ヒアリングリンク発行 =="
PROVISION_BODY=$(cat <<'JSON'
{"member_no":"No.001","store_id":"hs-partner-001","company":"リフォーム職人株式会社","tier":"honbu","base_fee_ex_tax":29800,"webmcp_addon_ex_tax":12000,"webmcp_option":true,"areas":["長久手市","名古屋市","日進市","尾張旭市","瀬戸市"],"works":["外壁塗装","屋根","内装"]}
JSON
)
echo "POST ${HEAR}/admin/provision"
echo "  body: ${PROVISION_BODY}"

if [ "${RUN}" != "--run" ]; then
  echo ""
  echo "[dry-run] 実行するには --run を付けろ。"
  exit 0
fi

echo ""
echo "== 実行 STEP 1 =="
RESP1=$(curl -s -X POST "${EST}/admin/issue-key" \
  -H "X-Admin-Key: ${HS_ESTIMATE_ADMIN}" -H "Content-Type: application/json" \
  -d "${ISSUE_BODY}")
echo "${RESP1}"
echo "  -> subscriptionId / apiKey(hse_) を控えておく(apiKeyは平文保存しない)"

echo ""
echo "== 実行 STEP 2 =="
RESP2=$(curl -s -X POST "${HEAR}/admin/provision" \
  -H "X-Admin-Key: ${HS_HEARING_ADMIN}" -H "Content-Type: application/json" \
  -d "${PROVISION_BODY}")
echo "${RESP2}"
echo ""
echo "  -> 上の hearing_url を リフォーム職人(堤さん) に送る。回答が来ると自動でページ生成が走る。"
