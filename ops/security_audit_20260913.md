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

### 低: horizon-shield-kira /scan(退役候補・門は付けない)
- 無認証で scanAndNotify(Claude ループ + LINE)を起動できる。だが wrangler.jsonc の実測コメント(2026-08-09)が「scheduled ハンドラはあるが cron が 1 本も無い=定期実行は一度も起きていない」= 休眠した旧プロトタイプ。本番の巡回は hs-monitor、本番の KIRA は hs-kira-proxy/hs-kira-line に置き換わっとる。
- 判断(番人が決めた): 死んだ worker に新しい secret を作らせるのは筋が悪い。/scan は cron が無いから自動では動かず、手で叩いても 1 回スキャンするだけ(金の垂れ流しやない)。門は付けず、退役候補として記録するだけ。退役(worker 削除)は TOshi の手の作業。

## 誤報だったもの(スキャナが fetch 冒頭の門を見落とし、番人が本番で否定した)
scanner は「ルート関数の中の認証」しか見んため、dispatcher の頭でまとめて弾く門を見落とす。以下は当てる前に読み直し、本番で 401 を実測して守れとると確定した:
- hs-genka-ingest /approve /reject /ingest = fetch の 11 行目 `if (!authorized(request, env)) return 401`(x-ingest-secret == INGEST_SECRET)が全ルートの前。本番実測: /approve {} → 401、/reject {} → 401、/ingest {} → 401。
- hs-monitor /scan /reset-seen /prospects /update-db = fetch の頭で CONTROL_PATHS を CONTROL_TOKEN(Authorization: Bearer か X-Control-Token、/update-db だけ LINE の OTP も可)で弾く `if (!authorized) return 401`。本番実測: 4 本とも無認証で 401(/reset-seen も 401 で削除は走らん)。

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
