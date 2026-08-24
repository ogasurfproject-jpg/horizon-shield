#!/bin/bash
# レジストリのサーバー状態を変える — 汎用スクリプト
#
# ─────────────────────────────────────────────────────────────────────────────
# 2026-08-24 全面改訂。旧版には2つの欠陥があった。消さずに書いておく。
#
# 【欠陥1】生存確認が GET だった。致命的。
#   旧版 STEP 0 はこう書いていた:
#     curl -s -o /dev/null -w "%{http_code}" https://.../mcp
#     echo "↑ 404 なら取り下げてよい。200 が返るなら止めて、ルート設定を直す話になる。"
#   ガードの考え方は正しい。「200なら止めろ」と書いてある。
#   だが -X POST が無い。MCPエンドポイントは POST 専用なので、GET は catch-all の
#   404 に落ちる。つまり構造上 200 が返りようがなく、安全弁は常に空振りしていた。
#   結果、2026-08-14 に hs-audit-app を「404だから死んでいる」と誤診して deprecated
#   にした。実際には生きており、POST tools/list は 200 を返していた。
#   その誤った理由が公開レジストリの statusMessage に10日間載り続けた。
#   → 本版は POST で叩く。さらに 404/200 の二択をやめ、410 も区別する。
#
# 【欠陥2】mcp-publisher status の存在に気づかず curl を手組みしていた。
#   旧版は login 後に find でトークンファイルを探し回り、見つからなければ画面に
#   手打ちさせていた。秘密を画面に出す必要はどこにも無かった。
#   mcp-publisher には status サブコマンドがある。トークンは道具の中で完結する。
#   → 本版は mcp-publisher status を使う。トークンは一度も変数に入らない。
#
# なお CI から回すなら .github/workflows/mcp-status.yml を使うこと。
# GitHub OIDC なのでトークンの保管も持ち出しも無い。手元認証はこの台本の役目。
# ─────────────────────────────────────────────────────────────────────────────
#
# 使い方:
#   bash run_hs-audit-app_deprecate.sh                       # 既定値で確認だけ
#   bash run_hs-audit-app_deprecate.sh <server-name> <version> <status> <message>
#
# 例:
#   bash run_hs-audit-app_deprecate.sh \
#     io.github.ogasurfproject-jpg/hs-audit-app 0.1.0 deprecated "理由をここに"

set -uo pipefail

SERVER="${1:-io.github.ogasurfproject-jpg/hs-audit-app}"
VERSION="${2:-0.1.0}"
NEW_STATUS="${3:-}"
MESSAGE="${4:-}"
REG="https://registry.modelcontextprotocol.io"

# 対象サーバーのエンドポイントを引数から機械的に決められないので、既知分だけ表を持つ。
# 表に無ければ生存確認は飛ばす。推測でURLを組み立てない。
case "$SERVER" in
  *hs-audit-app)   EP="https://hs-audit-app.oga-surf-project.workers.dev/mcp" ;;
  *horizon-shield) EP="https://mcp.horizonshield.dev/mcp" ;;
  *hs-verify-gate) EP="https://gate.horizonshield.dev/mcp" ;;
  *hs-hearing)     EP="https://hearing.horizonshield.dev/mcp" ;;
  *jidec)          EP="https://jidec.horizonshield.dev/mcp" ;;
  *webmcp)         EP="https://web.horizonshield.dev/mcp" ;;
  *)               EP="" ;;
esac

echo "対象   : $SERVER  $VERSION"
echo "変更先 : ${NEW_STATUS:-(未指定 — 確認のみ)}"
echo

# ─── 0. 生存確認（POSTで叩く。ここが旧版の壊れていた場所）────────────────────
if [ -n "$EP" ]; then
  echo "=== 0. エンドポイントは生きているか（POST tools/list）==="
  echo "  $EP"
  BODY=$(mktemp)
  CODE=$(curl -s -o "$BODY" -w "%{http_code}" --max-time 20 -X POST "$EP" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
  GETCODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$EP")
  echo "  POST tools/list -> $CODE"
  echo "  GET             -> $GETCODE  （POST専用なら404や405が正常。死亡の証拠にはならない）"
  case "$CODE" in
    200)
      echo "  ★ 生きている。ツールを返している。"
      echo "    引退させるなら『落ちているから』ではない理由が要る。"
      echo "    理由を statusMessage に書けないなら、ここで止めること。"
      ;;
    410)
      echo "  → 既に墓標になっている（410 Gone）。引退処理は済んでいる可能性が高い。"
      ;;
    404|000)
      echo "  → POSTでも届かない。ルート未設定か本当に消えている。"
      ;;
    *)
      echo "  → 想定外の応答。中身を見てから判断すること:"
      head -c 300 "$BODY"; echo
      ;;
  esac
  rm -f "$BODY"
  echo
fi

# ─── 1. 現在のレジストリ掲載内容 ─────────────────────────────────────────────
echo "=== 1. レジストリの現状 ==="
curl -s "$REG/v0/servers?search=$(basename "$SERVER")&version=latest" \
| SERVER="$SERVER" python3 -c '
import sys, json, os
want = os.environ["SERVER"]
d = json.load(sys.stdin)
for s in (d.get("servers") or d.get("data") or []):
    m = s.get("server", s)
    if m.get("name") != want: continue
    o = (s.get("_meta", {}) or {}).get("io.modelcontextprotocol.registry/official", {}) or {}
    print("  version :", m.get("version"))
    print("  status  :", o.get("status"))
    print("  updated :", o.get("updatedAt"))
    print("  remote  :", (m.get("remotes") or [{}])[0].get("url"))
    msg = o.get("statusMessage")
    if msg:
        print("  statusMessage:")
        for line in [msg[i:i+92] for i in range(0, len(msg), 92)]:
            print("   ", line)
'
echo

[ -n "$NEW_STATUS" ] || { echo "status 未指定のため確認のみで終了。"; exit 0; }

# ─── 2. statusMessage は500文字上限 ─────────────────────────────────────────
if [ -n "$MESSAGE" ]; then
  LEN=$(MESSAGE="$MESSAGE" python3 -c 'import os;print(len(os.environ["MESSAGE"]))')
  echo "=== 2. statusMessage の長さ: $LEN / 500 ==="
  if [ "$LEN" -gt 500 ]; then
    echo "  ★ 上限超過。レジストリに弾かれる。短くしてから出直すこと。中止。"
    exit 1
  fi
  echo
fi

# ─── 3. 反映（トークンは mcp-publisher の中で完結する）──────────────────────
echo "=== 3. 反映 ==="
command -v mcp-publisher >/dev/null || { echo "★ mcp-publisher が無い。中止。"; exit 1; }
echo "  ログインしていなければ先に: mcp-publisher login github"
echo "  （承認するアカウントは ogasurfproject-jpg。別アカウントでは名前空間が通らない）"
echo

if [ -n "$MESSAGE" ]; then
  mcp-publisher status --status "$NEW_STATUS" --message "$MESSAGE" "$SERVER" "$VERSION" || exit 1
else
  mcp-publisher status --status "$NEW_STATUS" "$SERVER" "$VERSION" || exit 1
fi
echo

# ─── 4. 確認（レジストリの実物を読み直す）───────────────────────────────────
echo "=== 4. 反映後の実物 ==="
sleep 2
curl -s "$REG/v0/servers?search=$(basename "$SERVER")&version=latest" \
| SERVER="$SERVER" python3 -c '
import sys, json, os
want = os.environ["SERVER"]
d = json.load(sys.stdin)
for s in (d.get("servers") or d.get("data") or []):
    m = s.get("server", s)
    if m.get("name") != want: continue
    o = (s.get("_meta", {}) or {}).get("io.modelcontextprotocol.registry/official", {}) or {}
    print("  status  :", o.get("status"))
    print("  updated :", o.get("updatedAt"))
    print("  statusMessage:")
    msg = o.get("statusMessage") or ""
    for line in [msg[i:i+92] for i in range(0, len(msg), 92)]:
        print("   ", line)
'
echo
echo "updated が今日になっていれば反映済み。"
echo "終わったら手元にトークンを残さないこと: mcp-publisher logout"
