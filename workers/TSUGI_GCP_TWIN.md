# TSUGI GCP Twin (Marketplace 出品用の GCP 実コピー)

Cloudflare 版は捨てない。Marketplace に出す分だけ、GCP に本物が動く二台目を立てる。
Google Cloud Marketplace の必須要件「製品を主に Google Cloud でホストしていること」を、
見せかけでなく実体で満たすための設計。

対象は TSUGI の公開面 2 本だけ:
- hs-verify-gate (扉 / src/worker.js 5298 行)
- hs-ledger    (台帳 / src/worker.js 2168 行)

KIRA も他の 30 以上の worker も Cloudflare のまま。触らない。

## なぜ書き直しにならないか

状態はすべて `env.<KV>.get / put / list` 経由。暗号はすべて WebCrypto (Ed25519)。
どちらも Node 22 でそのまま動く。recovery-v0 は元から Node。
よって GCP 版は「同じ env インターフェースを Firestore で満たす adapter」と
「fetch(request, env, ctx) ハンドラを HTTP サーバとして起動する入口」を足すだけ。
worker.js 本体のロジックは基本そのまま。番人が確認した。

## Cloudflare 依存 → GCP 対応表

| 今 (Cloudflare) | 用途 | GCP 側 |
|---|---|---|
| KV HS_VERIFY_KV (扉, 約40 get/put/list) | 判定履歴・使用計数・sweep 記録・drift baseline・観測 | Firestore (native) 1 collection |
| KV LEDGER (台帳, 約70 op) | witness pending pool・batch・合意記録・resume | Firestore (native) 1 collection |
| Durable Object AgreementDedupeDO | 合意記録の重複排除 (強整合) | Firestore トランザクション (doc id で原子的に) |
| Analytics Engine KANBAN_AE | kanban メトリクス | BigQuery streaming か Cloud Logging (後回し可) |
| service binding GATE / PDF_GEN | worker 間呼び出し | Cloud Run サービス間 HTTPS (内部 URL + IAM) |
| cron triggers (扉 18:00 / 台帳 00:30 UTC) | 毎日の sweep・batch | Cloud Scheduler → Cloud Run (OIDC 認証) |
| wrangler secret (鍵・token) | Ed25519 鍵・各種 token | Secret Manager |
| crypto.subtle Ed25519 | 署名・検証 | Node 22 WebCrypto (無変更で動く) |
| RELAY_URL / RELAY_TOKEN | 同一アカウント subrequest 封じの迂回 | 不要。Cloud Run は外部へ自由に出る。削除 |
| custom_domain | gate/ledger.horizonshield.dev | Cloud Run ドメインマッピング (新サブドメイン) |
| 扉が Agent Card を配信 | /.well-known/agent-card.json | Cloud Run で配信 + GCS バケットにも置く (listing 必須) |

## GCP 構成 (立てる物)

1. GCP プロジェクト (例 tsugi-marketplace)。課金を有効化
   → フォームの Billing Account ID と Project ID がここで実在になる
2. Cloud Run: tsugi-gate (扉の Node コンテナ)
3. Cloud Run: tsugi-ledger (台帳の Node コンテナ)
4. Firestore (native mode): 両 KV と DO dedup を裏で持つ
5. Cloud Storage バケット: Agent Card JSON を置く (AI agent listing の必須要件)
6. Secret Manager: Ed25519 鍵と token 一式
7. Cloud Scheduler: 2 ジョブ (扉 sweep, 台帳 batch)
8. ドメイン: Cloud Run に新サブドメインをマッピング (下の注意点)

## 注意点 (番人が線を引く所)

- witness 鍵は domain-bound (conduct-v1.1 11.4: key_url の host = signed_domain)。
  Cloudflare 版は gate.horizonshield.dev で署名。GCP 版は別ドメインになる。
  よって GCP 版には GCP 版ドメイン専用の witness 鍵を新規生成し、そのドメインで
  Agent Card を再署名する。Cloudflare の鍵は共有しない (共有は規則違反)。
  = 「同じバイトのコピー」ではなく「同じコードの、独立に鍵を持つ二台目」。両方 valid。
- 秘密鍵 (WITNESS_PRIVKEY_B64 等) は Secret Manager にだけ置く。番人は値を見ない。
- RELAY は削除。Cloud Run では不要。扉の該当分岐を落とす (番人が diff を出す)。
- Analytics Engine は最初は Cloud Logging に逃がすか無効化。listing には無関係。

## ビルド手順 (番人が code、TOshi が deploy)

番人:
1. adapter 層 (Firestore で env.KV.get/put/list を満たす、DO dedup は Firestore tx)
2. Node サーバ入口 (fetch ハンドラを http サーバ化。扉・台帳それぞれ)
3. Dockerfile (Node 22 slim)
4. RELAY 分岐の除去 diff
5. 新ドメイン用 Agent Card 再署名スクリプト (鍵生成は TOshi、署名コードは番人)
6. 全部にテスト (既存の parity テストで CF 版と挙動一致を担保)

TOshi (deploy / secret / 課金。番人はやらない):
1. GCP プロジェクト作成 + 課金
2. Firestore / GCS バケット作成
3. Secret Manager に鍵投入 (値は TOshi の手だけ)
4. gcloud run deploy x2
5. Cloud Scheduler 設定
6. ドメインマッピング

## これで埋まるフォーム欄 (Section 8)

- GCP Billing Account ID → 実在
- Associated GCP Project ID → 実在 (tsugi-marketplace)
- Infrastructure Execution Location → Pattern 1 (All GCP) が真になる
- Pricing Calculator link → 実構成 (Cloud Run + Firestore + GCS) で見積もり
- Architecture diagram → 実構成を GCP 公式アイコンで
- Tenancy → Multi-tenant (一つの共有アプリ)
