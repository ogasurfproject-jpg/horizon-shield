# worker 総点検(2026-09-13) まどかさんの ChatGPT 指摘を全 worker に広げた

範囲: workers/ の deploy 対象 41 本。まどかさんが hs-kira-proxy で見つけた「認証なしで金を使う/データを書く/消す、管理画面、XSS」を同じ物差しで機械+目視で当てた。
方法: (1)金を使う呼び出し(Anthropic/Gemini/OpenAI/Apify/Resend)を全 file から grep→到達ルートと認証を目視。(2)破壊的削除/管理ルートを scanner で拾い、呼び出し先関数の認証を目視。(3)本番は金の出ない空 body で到達だけ確認(金と LINE 通知を発生させない)。
番人は deploy しない。適用・deploy は TOshi。

## 確定した素通し(認証なし)

### 高: hs-gyosha-check /check(番人が直済み、要 deploy)
- POST /check {company} が Claude を無認証で回す。rate limit 無し、CORS *。しかも叩くたび TOshi の LINE に通知が飛ぶ。
- 本番実測: POST /check {} -> 400「業者名を入力してください」(門なし。あれば 401)。空 body なので金も LINE も出さず到達だけ確認。
- 悪用: 誰でもループで Claude 課金を消費 + TOshi の LINE を埋める。site の /check/(業者チェッカー)がこの口を叩く公開機能。
- 直し(適用済み・.bak あり): wrangler.jsonc に純正 rate limit GYOSHA_RL(8回/60秒/IP、hs-gemini-audit と同方式)、/check 冒頭で 8/分超は 429。正規利用は 8/分を超えないので影響なし。

### 高: hs-gyosha-check /inspect(番人が直済み、要 deploy)
- POST /inspect {images} が Claude vision を無認証で回す。vision は更に高い。rate limit 無し。
- 本番実測: POST /inspect {} -> 400「画像を選択してください」。
- 直し(適用済み): 同じ GYOSHA_RL で 8/分。

### 中: hs-genka-ingest /approve /reject(未適用・TOshi 決裁)
- /ingest と /dashboard は INGEST_SECRET で守れとるのに、/approve /reject は無認証。原価レビューの承認/却下を誰でも書ける = KIRA の原価データを汚せる。
- 直し案: handleApprove/handleReject の頭で /ingest と同じ x-ingest-secret を必須化。

### 中: hs-monitor /reset-seen(未適用・TOshi 決裁)
- /update-db は CONTROL_TOKEN で守れとるが、/reset-seen(seen: を全削除)/scan /fetch-material-news /prospects は無認証。/reset-seen を叩くと既読状態が消え、次の巡回が全部を再通知(LINE 大量スパム)。dev 自身が 8-19 のコメントで「制御ルートは CONTROL_TOKEN 必須にしたい」と書いて未完のまま。
- 直し案: これらに既存の CONTROL_TOKEN(Authorization: Bearer か X-Control-Token)を必須化。ただし TOshi のブックマークが素の URL なら効かなくなる(9/11 の管理画面回帰と同種)。だから決裁を待つ。

### 中/低: horizon-shield-kira /scan(未適用・要確認)
- 無認証で scanAndNotify(Claude ループ + LINE)を起動できる。ただしこれは旧プロトタイプに見える(本番の巡回は hs-monitor、本番の KIRA は hs-kira-proxy/hs-kira-line)。
- 判断: まだ使っとるなら /scan を CONTROL_TOKEN で門にする。使っとらんなら退役(追跡 file を消すのは決定であって掃除やない=TOshi の決め)。

## 守れとるのを確認したもの(誤報を出さんために明記)
- hs-kira-proxy の /hacker/comment-approve /comment-reject /publish /delete = 全部 kiraAdminOk。今日の管理 API 修正 + 既存で門あり。
- ai-council /council = ADMIN_PASSWORD 必須 + 月額コスト上限。
- hs-gemini-audit POST = 純正 rate limit 15/分/IP。
- hs-webmcp /stats /mypage = STATS_KEY 由来トークン照合。
- hs-ledger /ledger/append 他 admin = X-Ledger-Key(LEDGER_ADMIN_TOKEN)。
- hs-hearing = X-Admin-Key(HEARING_ADMIN_SECRET)、MCP は X-Bridge-Key。
- hs-outreach admin = ADMIN_TOKEN(Bearer)、webhook = WEBHOOK_SECRET、unsub = HMAC。
- hs-estimate /webhook/paypal = PayPal 署名検証。
- hs-gateway = 店別 HMAC トークン(/report /balance)。

## まだ全行は追い切れていない(1 回では無理。同じ門の型を推奨、サンプルは見た)
hs-pdf-gen(20,526行。金の口は HS_AUDIT_TOKEN 必須=既存)、hs-verify-gate(4,865)、hs-mcp(2,092)、hs-kira-line(1,605、LINE 署名 webhook)、hs-souba-pipeline(1,154)、hs-internal-mcp(801)、hs-nursing-mcp、hs-jidec-mcp、hs-partner-001/002-mcp、hs-subscribe、hs-billing、hs-apps-jimu、hs-followup(X-Followup-Token=既存)、hs-price-sync、hs-ehn-verify、hs-real-cases-proxy、hs-og、hs-rss-feed、hs-blog-post、hs-verify-relay、hs-watchtower(?key= 既知)、hs-design、hs-reference-gateway、hs-mcp-observatory。
これらは次のセッションで、金の口とデータ書き込み/削除の口だけを同じ物差しで潰す。

## 横断メモ
- CORS `Access-Control-Allow-Origin: *` は多数にあるが、それ自体は穴やない。問題は「* + 金を使う口 + rate limit 無し」の組み合わせ。gyosha がそれやった。

## deploy(TOshi の手)
高の 2 件を閉じる:
  cd ~/horizon-shield/workers/hs-gyosha-check
  node --check src/worker.js
  npx wrangler deploy
deploy 後、番人が本番で /check {} と /inspect {} を叩いて 400(到達)を再確認、正規 8/分・9回目 429 を確認する。
中の 3 件(genka approve/reject、monitor 制御ルート、kira /scan)は TOshi の決裁後に番人が同型で直す。
