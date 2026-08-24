#!/bin/bash
# hs-audit-app を deprecated にする — 一気通貫スクリプト (2026-08-14)
#
# 現状(実測): io.github.ogasurfproject-jpg/hs-audit-app 0.1.0 が公開レジストリに
#             active で載っていて、エンドポイントは 404。正本に server.json は無い。
#
# deleted ではなく deprecated を選ぶ理由:
#   §1.3「取り下げたように見えて実際は取り消せていない状態は、この事業の原則と噛み合わない」
#   verify-directory「a record that can be deleted on request is not a record」
#   自分の死んだ看板だけ黙って消すのは、その原則と噛み合わない。残して理由を書く。
#
# 使い方: bash run_hs-audit-app_deprecate.sh

set -u
NAME="io.github.ogasurfproject-jpg%2Fhs-audit-app"
REG="https://registry.modelcontextprotocol.io"
MSG='Retired. The endpoint hs-audit-app.oga-surf-project.workers.dev/mcp returns 404 and this entry is no longer maintained. Current servers: io.github.ogasurfproject-jpg/horizon-shield (mcp.horizonshield.dev) and io.github.ogasurfproject-jpg/hs-verify-gate (gate.horizonshield.dev/mcp). Left visible rather than deleted, because a record that can be erased on request is not a record.'

echo "=== 0. その Worker が本当に無いか ==="
curl -s -o /dev/null -w "  hs-audit-app endpoint: %{http_code}\n" --max-time 15 \
  https://hs-audit-app.oga-surf-project.workers.dev/mcp
echo "  ↑ 404 なら取り下げてよい。200 が返るなら止めて、ルート設定を直す話になる。"
echo

echo "=== 1. レジストリへログイン (デバイスコード方式・ブラウザで承認) ==="
echo "  アカウントは ogasurfproject-jpg でなければ io.github.ogasurfproject-jpg/* は通らない。"
BEFORE=$(mktemp)
find "$HOME" -maxdepth 4 -type f -newermt '-1 second' 2>/dev/null > "$BEFORE" || true
mcp-publisher login github || { echo "★ ログイン失敗。中止。"; exit 1; }
echo

echo "=== 2. トークンの保存先を特定（推測せず、更新されたファイルで探す）==="
CAND=""
for f in "$HOME/.mcp_publisher_token" "$HOME/.mcpregistry_token" \
         "$HOME/.config/mcp-publisher/token" "$HOME/.mcp-publisher/token"; do
  [ -f "$f" ] && CAND="$f" && break
done
if [ -z "$CAND" ]; then
  echo "  既知の候補に無い。直近2分で更新されたファイルを探す:"
  find "$HOME" -maxdepth 4 -type f -newermt '-2 minutes' 2>/dev/null \
    | grep -iv -e '/Library/' -e '/\.Trash' -e '/Downloads' -e '/\.git/' -e '/\.npm/' | head -20
  printf '  上の一覧からトークンファイルのパスを入力 (空Enterで手入力に切替): '
  read -r CAND
fi

T=""
if [ -n "$CAND" ] && [ -f "$CAND" ]; then
  echo "  使うファイル: $CAND"
  # JSON なら token フィールド、素のテキストならそのまま
  T=$(python3 - "$CAND" <<'PY'
import sys,json,io
p=sys.argv[1]; s=io.open(p,encoding='utf-8',errors='replace').read().strip()
try:
    d=json.loads(s)
    for k in ("token","access_token","jwt","registry_token"):
        if isinstance(d,dict) and d.get(k): print(d[k]); break
    else: print("")
except Exception:
    print(s if len(s)<4096 else "")
PY
)
fi

if [ -z "$T" ]; then
  stty -echo; printf '  registry token を貼り付け: '; read -r T; stty echo; echo
fi
[ -n "$T" ] || { echo "★ トークンが空。中止。"; exit 1; }

echo
echo "=== 3. deprecated にする ==="
for V in v0.1 v0; do
  echo "--- $REG/$V/servers/$NAME/status"
  CODE=$(curl -s -o /tmp/_dep.out -w "%{http_code}" -X PATCH \
    "$REG/$V/servers/$NAME/status" \
    -H "Authorization: Bearer $T" \
    -H 'content-type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"status":"deprecated","statusMessage":sys.argv[1]}))' "$MSG")")
  echo "    HTTP $CODE"
  head -c 400 /tmp/_dep.out; echo
  [ "$CODE" = "200" ] || [ "$CODE" = "204" ] && { echo "    → 成功"; break; }
  echo "    → この版では通らなかった。次を試す。"
done
unset T
rm -f /tmp/_dep.out "$BEFORE"

echo
echo "=== 4. 確認 ==="
curl -s "$REG/v0/servers?search=ogasurfproject-jpg&version=latest" \
| python3 -c "
import sys,json
d=json.load(sys.stdin); srv=d.get('servers') or d.get('data') or []
print('total:',len(srv))
for s in srv:
    m=s.get('server',s)
    st=s.get('status') or m.get('status') or (s.get('_meta',{}) or {}).get('status') or '-'
    print(f\"  {m.get('name','?'):55} {str(m.get('version','?')):8} {st}\")
"
echo
echo "hs-audit-app が deprecated になっていれば完了。"
