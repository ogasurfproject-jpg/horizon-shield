#!/usr/bin/env bash
# 加盟店番号 No.002 発行 + WebMCPオプション + ヒアリングリンク生成
# ミネオトーヨー株式会社 / 導入費 1,500,000(税抜・一括) ＋ 月額 41,800(税抜) = honbu 29,800 + WebMCP 12,000
#
# 使い方(TOshi 手動):
#   export HS_ESTIMATE_ADMIN='＜hs-estimate の ADMIN_SECRET＞'
#   export HS_HEARING_ADMIN='＜hs-hearing の HEARING_ADMIN_SECRET＞'
#   export NO002_EMAIL='＜ミネオトーヨーの連絡先メール(任意)＞'
#   bash tools/yakumo/issue_no002.sh          # 表示のみ(dry-run)
#   bash tools/yakumo/issue_no002.sh --run    # 実行
#
# 鉄則: トークン/シークレットはファイル・コミットに残さない。env で渡す。
set -euo pipefail

EST="https://hs-estimate.oga-surf-project.workers.dev"
HEAR="https://hs-hearing.oga-surf-project.workers.dev"
RUN="${1:-}"

: "${HS_ESTIMATE_ADMIN:?export HS_ESTIMATE_ADMIN が必要}"
: "${HS_HEARING_ADMIN:?export HS_HEARING_ADMIN が必要}"
EMAIL="${NO002_EMAIL:-}"

echo "== STEP 1: hs-estimate で honbu キーを発行 =="
ISSUE_BODY=$(cat <<JSON
{"tier":"honbu","companyName":"ミネオトーヨー株式会社","email":"${EMAIL}"}
JSON
)
echo "POST ${EST}/admin/issue-key"
echo "  body: ${ISSUE_BODY}"

echo ""
echo "== STEP 2: hs-hearing で WebMCPオプション有効化 + ヒアリングリンク発行 =="
# works は本人(たかし)がヒアリングで確定する前提の安全なプレースホルダ(["リフォーム"])。
# 対応エリアは 平塚市/茅ヶ崎市/藤沢市。採用=あり(採用の詳細もヒアリングで収集し /yakumo/no002/recruit/ を生成)。
PROVISION_BODY=$(cat <<'JSON'
{"member_no":"No.002","store_id":"hs-partner-002","company":"ミネオトーヨー株式会社","tier":"honbu","base_fee_ex_tax":29800,"webmcp_addon_ex_tax":12000,"webmcp_option":true,"areas":["平塚市","茅ヶ崎市","藤沢市"],"works":["リフォーム"]}
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
echo "  -> 上の hearing_url を ミネオトーヨー(たかしさん) に送る。回答が来ると自動でページ生成が走る。"
