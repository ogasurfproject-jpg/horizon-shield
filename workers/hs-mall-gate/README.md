# hs-mall-gate

八雲モール 認証ゲート（新規Worker）。
役割は一つ。加盟店の pk_ キーを認証し、八雲が出した寸法データを本体の価格エンジンへ橋渡しする。それだけ。

## 絶対の境界（設計の核）

- このWorkerは価格ロジック（souba / WPC / zaisai）を一切持たない。
- 価格は本体（PRICE_ENGINE_URL、oga-surf-project）が決める。
- ゲートは「認証 ＋ 寸法と tier の受け渡し ＋ 結果の中継」だけ。
- よってこのコードが流出しても価格は漏れない。八雲だけでは金額は出ない。堀は本体サーバー内に残る。

```
八雲PWA(配布OK) -> 寸法 -> [hs-mall-gate: 認証/tier判定] -> 本体価格エンジン(出さない)
加盟店表示 <- 最終金額+KIRAバッジ だけ <- [hs-mall-gate] <- 本体
```

## KV スキーマ（HS_PARTNER_KV）

- key   : sha256hex(pk_xxxx)   生の pk は保存しない
- value : JSON
  - tier       : "honbu" | "external"
  - shop_name  : 文字列 | null
  - issued_at  : ISO日時
  - status     : "active" | "revoked"

## secret（wrangler secret put で手動投入、git に乗せない）

- ADMIN_TOKEN      : /admin/issue-key を守る管理トークン
- PRICE_ENGINE_URL : 本体の価格APIエンドポイント
- PRICE_ENGINE_KEY : 本体への認証キー

## エンドポイント

### GET /health
死活確認。`{ ok: true, service: "hs-mall-gate" }`

### POST /api/quote
加盟店アプリから。
- ヘッダ: `Authorization: Bearer pk_xxxx`
- ボディ: `{ "dimensions": {...}, "work": "任意" }`
- 流れ: 認証 -> sha256 で KV照合 -> tier 取得 -> 本体へ {tier, dimensions, work} を送る -> 本体が返す {最終金額 ＋ KIRAバッジ} を中継。
- ゲート側で価格計算は一切しない。

### POST /admin/issue-key
pk 発行（管理用）。本番では既存 /admin/hc-dashboard に追加差分で組み込む想定。これは雛形。
- ヘッダ: `X-Admin-Token: <ADMIN_TOKEN>`
- ボディ: `{ "tier": "honbu" | "external", "shop_name": "店名" }`
- 応答: `{ "pk": "pk_xxxx", ... }` 生 pk はこの応答でしか返らない。発行直後に保存すること。

## 課金との関係

- tier はゲートでは「下流（本体）へ伝えるだけ」。
- サブスク課金（本部系列 月額¥29,800 / 外部 月額¥59,800、PayPal、店単位）はこのゲートとは別系統で管理する。
- ゲートの tier と課金 tier を一致させる運用にすると整合が取れる。

## セットアップ（全て TOshi 手動。Claude はコマンドを出すだけ）

```
# 1. KV namespace 作成（出た id を wrangler.jsonc の REPLACE_WITH_KV_ID に入れる）
wrangler kv namespace create HS_PARTNER_KV

# 2. secret 投入（3本）
wrangler secret put ADMIN_TOKEN
wrangler secret put PRICE_ENGINE_URL
wrangler secret put PRICE_ENGINE_KEY

# 3. ローカル構文チェック
node --check src/index.js

# 4. デプロイ（wrangler.jsonc のあるディレクトリで実行）
wrangler deploy

# 5. 動作確認
curl -s https://hs-mall-gate.<account>.workers.dev/health

# 6. pk 発行テスト
curl -s -X POST https://hs-mall-gate.<account>.workers.dev/admin/issue-key \
  -H "X-Admin-Token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"tier":"external","shop_name":"テスト店"}'
```

## まだ無いもの（土台の次の段）

- 本体側 PRICE_ENGINE_URL の受け口（{tier, dimensions, work} を受けて {金額 ＋ KIRAバッジ} を返す内部API）。これは本体に追加差分で作る。
- /admin/hc-dashboard への pk 発行ボタン統合（この雛形を移植）。
- pk の revoke（status を "revoked" に更新する管理操作）。
- レート制限・監査ログ。
