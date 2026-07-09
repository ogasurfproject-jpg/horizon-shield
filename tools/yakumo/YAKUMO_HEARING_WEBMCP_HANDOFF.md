# Yakumoモール完成 + 自動ヒアリング + WebMCP運用 引き継ぎ / 実行手順書 (2026-07-09)

> このセッションで作った物と、TOshi が手動で叩く手順を全部まとめた。値は実機確認済み or 設計値。
> 恒久ルール順守: Claude は本番を叩かない(コマンドを出すだけ) / 追加差分のみ / fail-closed / 会社名 The HORIZ音s / 金額は施主向け非表示 / em・en・bar dash 不使用。

---

## 0. 何を作ったか(TOshi の4つの依頼に対応)

1. **加盟店番号 No.001 発行** … リフォーム職人株式会社を honbu(¥29,800税抜)+ WebMCPオプション(¥12,000税抜)= **¥41,800税抜/月** で発行する手順とスクリプト。
2. **モールの完成形** … `/yakumo/`(店一覧)・`/yakumo/no001/`(店詳細)・`/yakumo/apply/`(加盟案内)。データ源 `data/yakumo-contractors.json` を読んで自動描画。金額非表示・スコア/ティアのみ・検証手続き中の店はゲート表示。
3. **自動ヒアリング → 生きたMCP → 新鮮な GEO/AEO/LLMO/WebMCP** … 新規ワーカー `hs-hearing` がヒアリングフォームを配信し、返信を自動で構造化KV保存。回答から GitHub Action が GEO/AEO/LLMO/WebMCP を **黄金比 4:3:2:1** で自動生成 → **fail-closed 検証** → 通過分だけ公開 → IndexNow 送信。検証済み加盟店は `hs-hearing` の **MCP面**(`list_verified_stores` / `get_contractor_profile`)から AI が発見できる。
4. **認知度拡大の仕掛け** … 生成する全ページがモールと HORIZON SHIELD へバックリンク。加盟店が自社サイトに貼る**検証バッジ**(`/badges/`)が被リンクを生む。`llms.txt` にYakumo節を追加(LLM がYakumoを引用)。`sitemap.xml` に登録。A2A エージェントカードで他エージェントも発見。

---

## 1. なぜ「絶対に Google/Bing にエラーを出さない」が守れるか(fail-closed の二重関所)

生成 → 公開の間に、機械の関所を2枚置いた。1枚でも落ちたら**公開しない**。

- **関所A(静的・公開前)** `tools/yakumo/validate.py`:
  JSON-LD が全て正当なJSONで @type/@context を持つ / canonical がパスと一致 / robots=index,follow / title・description・author 有り / 禁止語(MOAT: `32.5` `danger_threshold` `WPC`)なし / em・en・bar dash なし / **金額数字なし**(施主向け) / モール+HSへのバックリンク有り / 裸相対リンクなし。**1枚でもNGなら Action が失敗し commit されない。**
- **関所B(実弾・送信前)** `indexnow_submit.py`(既存・3関所):
  各URLを物理再チェックし 200 / MOAT漏れなし を満たすものだけ IndexNow へ。落ちたURLは送らない。GitHub Pages 未反映のURLは自動で除外される。

この設計なら、壊れたページや機密漏れページが検索エンジンに渡ることが構造的に起きない。

---

## 2. 自動ループの全体像

```
堤さん(リフォーム職人) がヒアリングフォームに回答
        │  POST /h/<token>   (hs-hearing Worker)
        ▼
hs-hearing が回答を正規化して KV 保存(見積もり例は監査用・金額は生成に渡さない)
        │  repository_dispatch: yakumo-hearing-completed  (GH_DISPATCH_TOKEN 設定時)
        ▼
GitHub Action (.github/workflows/yakumo-content.yml)
   generate.py  → GEO4 / AEO3 / LLMO2 / WebMCP1 を /yakumo/ 配下に生成
   validate.py  → 関所A(fail-closed)。1枚でも落ちたら中止(commit なし)
   commit+push  → main へ(Pages が自動配信)+ sitemap.xml 追記
        │  (Pages デプロイ待ち 150s)
        ▼
   indexnow_submit.py --send → 関所B を通ったURLだけ Bing/IndexNow へ
        ▼
   施主・検索・AI が新ページ経由で Yakumoモール と HORIZON SHIELD に到達(認知度)
```

「検証通過なら公開まで全自動」= 関所A・Bを全通過したものだけ、人手なしで公開まで進む。

---

## 3. 実行手順(TOshi 手動・この順で)

### STEP A. 静的コンテンツをマージ(ブラウザPR)
ブランチ `feat/yakumo-mall-hearing-webmcp` を main へ。含まれる物:
`yakumo/`(モール一式)/ `badges/`(バッジ)/ `data/yakumo-contractors.json` / `tools/yakumo/`(生成器・検証器・スクリプト)/ `.github/workflows/yakumo-content.yml` / `llms.txt`(追記)/ `sitemap.xml`(追記)。
- PR作成: `https://github.com/ogasurfproject-jpg/horizon-shield/pull/new/feat/yakumo-mall-hearing-webmcp`
- マージ後、ブラウザで確認: `https://shield.the-horizons-innovation.com/yakumo/` が表示される / `https://shield.the-horizons-innovation.com/data/yakumo-contractors.json` が開ける。

### STEP B. hs-hearing ワーカーをデプロイ
```bash
cd "$(git rev-parse --show-toplevel)/workers/hs-hearing"
# 1) KV を作って wrangler.jsonc の id を差し替える
CLOUDFLARE_ACCOUNT_ID=c15ff64aba400e541853dec1fbe5e76a npx wrangler kv namespace create HS_HEARING_KV
#   → 出た id を workers/hs-hearing/wrangler.jsonc の "REPLACE_WITH_HS_HEARING_KV_ID" に貼る
# 2) シークレット
CLOUDFLARE_ACCOUNT_ID=c15ff64aba400e541853dec1fbe5e76a npx wrangler secret put HEARING_ADMIN_SECRET   # openssl rand -hex 24 等
CLOUDFLARE_ACCOUNT_ID=c15ff64aba400e541853dec1fbe5e76a npx wrangler secret put GH_DISPATCH_TOKEN       # GitHub PAT(repo:dispatch可)。未設定なら生成は起動しない(fail-closed)
# 3) デプロイ
node --check src/hearing.js && CLOUDFLARE_ACCOUNT_ID=c15ff64aba400e541853dec1fbe5e76a npx wrangler deploy
# 確認
curl -s https://hs-hearing.oga-surf-project.workers.dev/health
curl -s https://hs-hearing.oga-surf-project.workers.dev/.well-known/agent-card.json | head -c 200
```

### STEP C. GitHub Secrets(自動公開の燃料)
リポジトリ Settings → Secrets and variables → Actions:
- `INDEXNOW_KEY` … IndexNow鍵(既存の `_KEYS_DO_NOT_COMMIT.txt` の値)。未設定でも生成・公開は動く(IndexNow送信だけ skip=fail-safe)。
ワークフローはマージ時に自動で有効化。手動テストは Actions → yakumo-content-autopublish → Run workflow(既定の profile_json でお試し可)。

### STEP D. No.001 発行 + ヒアリングリンク生成
```bash
export HS_ESTIMATE_ADMIN='＜hs-estimate の ADMIN_SECRET＞'
export HS_HEARING_ADMIN='＜STEP B で設定した HEARING_ADMIN_SECRET＞'
export NO001_EMAIL='＜リフォーム職人の連絡先メール(任意)＞'
bash tools/yakumo/issue_no001.sh            # まず表示だけ
bash tools/yakumo/issue_no001.sh --run      # 実行(honbuキー発行 + provision + hearing_url 取得)
```
- STEP1 の戻りに `subscriptionId` と `apiKey`(hse_)。apiKey は平文保存しない。
- STEP2 の戻りの `hearing_url` を **堤さんに送る**。

### STEP E. 回答が来たら自動で走る
堤さんが回答 → hs-hearing が dispatch → Action が生成・検証・公開・IndexNow。Actions のログで結果確認。

---

## 4. 「検証済みスコア」を出す時(唯一の手動ステップ・意図的)

生成ページとモールは、最初は正直に「検証手続き中」を表示する(スコアはまだ出さない=fail-closed)。
KIRA が堤さんの見積もり例を `audit_estimate` で診断し、赤旗数と適正度が出たら、`data/yakumo-contractors.json` の No.001 を更新して verified に切り替える:
```json
"verification": "verified",
"fairness_score": 97,          // audit_estimate の実結果
"integrity_tier": "A",
"red_flags_detected": 0,
"claim_sha256": "＜verify_fair_price の署名レシート＞",
"verified_at": "2026-07-1x"
```
main へ commit すれば、モール・店詳細・MCP面が自動で「検証済み+スコア」に切り替わる(HTMLは触らない。JSONだけ)。
※ ここだけ手動なのは意図的。スコアは第三者監査の結果であり、自己申告で自動発行しない(誠実さが唯一の武器)。

---

## 5. 継続運用(初回バッチの後)

- 新しい加盟店が来たら STEP D の provision を会社情報で叩く(`member_no`/`store_id`/`company`/`tier`/`areas`/`works`)→ hearing_url を渡す。以降は同じ自動ループ。
- 同じ店の情報が変わったら、同じトークンで再回答してもらえば再生成される(`/yakumo/` 自ネームスペースなので既存の souba/faq を汚さない)。
- IndexNow は1日100件上限。1店=10ページなので余裕。複数店を同日に処理する時だけ注意。
- 生成は `/yakumo/souba|faq|llmo|webmcp/` 配下のみに書く。**本体の `/souba/` `/faq/` 等には一切書かない**(重複ゼロ設計)。

---

## 6. 検証済み(このセッションで実機/ローカル確認した事)

- `hs-hearing` ルーティング/MCP(initialize・tools/list・tools/call)/agent-card/admin をローカル実行で確認。`list_verified_stores` は検証済みだけ `stores` に、未検証は `pending_stores` に分離。金額は返さない。`get_contractor_profile No.001` は pending でスコア null(fail-closed)。provision は plan.total_ex_tax=41800 を計算し hearing_url を返す。
- 生成器: サンプルプロフィールで 10ページ(GEO4/AEO3/LLMO2/WebMCP1)生成 → 検証器で 0エラー。
- 検証器の fail-closed: MOAT語・金額・壊れ相対リンクを注入したら exit 1 で全体を止めることを確認。
- 全新規ファイル: node --check / py_compile / bash -n / JSON parse / HTML parse すべて通過。禁止ダッシュは新規追記分にゼロ(llms.txt 106行目の em-dash は**既存**・今回対象外)。

---

## 7. 値・URL リファレンス(新規)

| 種別 | 値 |
|---|---|
| ブランチ | `feat/yakumo-mall-hearing-webmcp` |
| モール | `https://shield.the-horizons-innovation.com/yakumo/` |
| 店詳細 No.001 | `https://shield.the-horizons-innovation.com/yakumo/no001/` |
| 加盟案内 | `https://shield.the-horizons-innovation.com/yakumo/apply/` |
| バッジ配布 | `https://shield.the-horizons-innovation.com/badges/` |
| データ源 | `data/yakumo-contractors.json` |
| ヒアリング/MCP ワーカー | `https://hs-hearing.oga-surf-project.workers.dev` |
| MCP エンドポイント | `.../mcp`(tools: list_verified_stores, get_contractor_profile) |
| A2A カード | `.../.well-known/agent-card.json` |
| KV(新規) | `HS_HEARING_KV`(STEP B で作成) |
| Cloudflare account | `c15ff64aba400e541853dec1fbe5e76a` |
| No.001 会社 | リフォーム職人株式会社(愛知県長久手市 / 外壁塗装・屋根・内装) |
| No.001 料金(税抜) | honbu ¥29,800 + WebMCP ¥12,000 = **¥41,800/月**(税込 x1.1 = ¥45,980) |
| GitHub Action | `.github/workflows/yakumo-content.yml`(dispatch: `yakumo-hearing-completed`) |

---

## 8. 触っていない物(安全のため)

- **hs-mcp / hs-estimate のコードは一切変更していない**(審査キュー保護 + 動いてる本番を触らない)。Yakumoの生きたMCPは独立ワーカー `hs-hearing` に置いた。
- 将来 hs-mcp の審査が全部通ったら、hs-mcp 側に `list_verified_stores` を追加してもよい(その時は追加差分・要再提出覚悟で)。今はやらない。

---

## 9. メール返信の安全網(Cloudflare Email Routing → 自動吸い取り)

Webフォームが一次導線。ただし堤さんのような職人さんは、フォームでなく**メールで普通に返信**しがち。その取りこぼしを拾うのがこの層(TOshi指示・「返信を自動で吸い取る」の完成)。

### 流れ
```
弊社が hearing@the-horizons-innovation.com からヒアリング案内を送る(件名に ref:<token>)
        │  堤さんが「そのまま返信」(プローズでOK)
        ▼
Cloudflare Email Routing が hs-hearing ワーカーの email() に配送
        │  1) 件名の ref:<token> か 送信元アドレス で店に自動照合
        │  2) 生返信を KV に保存(監査用)
        │  3) LLM(Workers AI)がヒアリングschemaに構造化
        │  4) 入口の関所: 社名・所在地・工種が揃わなければ自動公開せず通知(fail-closed)
        ▼
揃えば hearing 保存 → repository_dispatch → STEP の生成→検証→公開ループへ(関所Aは同じ)
照合できない / 構造化できない / 必須不足 → LINE・ntfy で TOshi に通知して止まる
```

### セットアップ(Cloudflareダッシュボード + secret)
1. `the-horizons-innovation.com` の **Email Routing を有効化**(MXレコードが自動追加される)。
2. ルール追加: `hearing@the-horizons-innovation.com` → **Send to a Worker** → `hs-hearing`。
3. hs-hearing に secret を追加(任意だが推奨):
   - `RESEND_API_KEY`(案内メール送信。hs-estimate と同じ鍵で可)+ RESEND側で hearing@ の送信ドメインを検証(SPF/DKIM)。
   - `LINE_CHANNEL_TOKEN` / `LINE_USER_ID` / `NTFY_TOPIC_URL`(通知。hs-estimate と同じ値で可)。
   - LLMは既定で **Workers AI**(`ai` バインド・外部キー不要)。別のLLMを使うなら `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL`。
4. 案内メールを送る(件名に ref トークンが自動で入る):
   ```
   curl -s -X POST https://hs-hearing.oga-surf-project.workers.dev/admin/send-hearing \
     -H "X-Admin-Key: $HS_HEARING_ADMIN" -H "Content-Type: application/json" \
     -d '{"token":"＜provisionで出たtoken＞","to":"＜堤さんのメール＞"}'
   ```
   これで堤さんは、フォームを開いても・そのまま返信しても、どちらでも自動で吸い取られる。

### 堤さんのメールについて
- 発行・provision には必須ではない(hearing_url は LINE 等でも送れる)。
- ただし取得推奨: (a) 案内メールを自動送信できる (b) メール返信を**送信元アドレスで店に自動照合**できる(`email2store` 逆引き。provision の `email` で自動登録)。
- メールが無くても、案内メールを送れば件名の `ref:<token>` で照合するので動く。

### 追加した値・secret(hs-hearing)
| 種別 | 値 |
|---|---|
| メール受信アドレス | `hearing@the-horizons-innovation.com`(Email Routing → hs-hearing) |
| 送信元(var) | `HEARING_FROM`(既定 `Yakumo <hearing@the-horizons-innovation.com>`) |
| 構造化エンジン | Workers AI(`ai` バインド)／外部LLMは `LLM_API_URL`等 |
| 案内送信 | `POST /admin/send-hearing {token,to}`(RESEND) |
| 通知 | LINE(`LINE_CHANNEL_TOKEN`+`LINE_USER_ID`)／`NTFY_TOPIC_URL` |
| KV逆引き | `email2store:<email>` → store_id / 生返信 `emailreply:<store_id>:<ts>` |

---

---

## 10. LINE での加盟店ヒアリング + 段階式メール(2026-07-09 追加)

TOshi方針: 初回メールは「あいさつ」、本格ヒアリングは翌週。加えて、加盟店がLINEでも登録・回答でき、回答が来ればメールと同じく自動で構造化->fail-closed関所->GEO/AEO/LLMO/WebMCP生成が走る。`hs-hearing` に追加済み(要 再デプロイ)。

### 追加エンドポイント(hs-hearing)
- `POST /line/webhook` : LINE Messaging API の Webhook 宛先。署名検証(LINE_CHANNEL_SECRET)->イベント処理。
  - 未登録ユーザー: メッセージ内の登録コード(`ht_...`=provisionのtoken)で store に紐づけ(`line2store:<userId>`)。コード無しは案内のみ。
  - 登録済み: プローズ回答を LLM 構造化 -> 必須項目(社名/地域/工種)が揃えば hearing 保存 + 生成トリガー、揃わねば聞き返し(fail-closed)。
- `POST /admin/send-greeting {to, company?}` : 初回あいさつメール(RESEND)。フォームリンクは載せない。
- `POST /admin/link-line {store_id, line_user_id}` : LINE userId を店に手動紐づけ(自己登録コードを使わない予備)。

### LINE 設定(LINE Developers)
1. Messaging API チャネルの Webhook URL = `https://hs-hearing.oga-surf-project.workers.dev/line/webhook`(Use webhook を ON)。
2. secret を hs-hearing に:
   - `wrangler secret put LINE_CHANNEL_SECRET`(チャネルシークレット。署名検証)
   - `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN`(長期のチャネルアクセストークン。自動返信)
3. 加盟店に「登録コード(ht_...)」を伝える -> 公式アカウント友だち追加 -> コード送信で紐づく -> 以降そのトークに工種・エリア・強みを送れば自動生成。

### 段階式メール(初回あいさつ -> 翌週ヒアリング)
- 今週(あいさつ): `POST /admin/send-greeting {to:"info@cdream-designers.jp","company":"リフォーム職人株式会社"}`
- 来週(本格ヒアリング): `POST /admin/send-hearing {token:"ht_0e25f1dd9e25b469133b301957cdff9b","to":"info@cdream-designers.jp"}`(件名に ref トークンが入り、メール返信も自動照合)
- どちらも `X-Admin-Key: <HEARING_ADMIN_SECRET>` 必須。RESEND_API_KEY と送信ドメイン検証が前提。

### 再デプロイ(この追加を本番へ)
```
git fetch origin feat/yakumo-line-intake
git checkout main && git merge --no-ff feat/yakumo-line-intake -m "merge: Yakumo LINE intake + greeting mail" && git push origin main
cd workers/hs-hearing && CLOUDFLARE_ACCOUNT_ID=c15ff64aba400e541853dec1fbe5e76a npx wrangler deploy
```

### No.001 の現状(2026-07-09 実機)
- hs-hearing provision 成功。hearing_url = `https://hs-hearing.oga-surf-project.workers.dev/h/ht_0e25f1dd9e25b469133b301957cdff9b` / token `ht_0e25f1dd9e25b469133b301957cdff9b` / email `info@cdream-designers.jp` / plan ¥41,800税抜。
- hs-estimate の honbuキー発行は `Forbidden`(ADMIN_SECRET不一致)で未完。正しい hs-estimate ADMIN_SECRET で `bash tools/yakumo/issue_no001.sh --run` を撃ち直せば hse_ キーが出る。
- hs-hearing 本番 Version: `10eabaa1-87d0-4274-8e30-7d68d286f5b1` / KV `HS_HEARING_KV` id `cae22b3bf47b46bebdfcdfd6a724f8ab`。

---

*作成 2026-07-09 / 次セッションはこの手順書を起点に。*
