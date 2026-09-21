# tsugi-gate on Google Cloud Run (Marketplace 出品用の実コピー)

hs-verify-gate/src/worker.js を **無改変**(card origin の 1 行 override を除く)で Cloud Run に載せる一式。
Cloudflare 版はそのまま生かす。これは Marketplace 出品用の GCP 実体(billing account / project ID が本物になる)。

## 中身(番人が書いた、全部テスト済み)

- `kv_firestore.mjs`  Cloudflare KV(get/put/list/delete)を Firestore で満たす adapter。依存注入
- `http_bridge.mjs`   Node http(req,res) <-> Worker fetch(request,env,ctx) の橋。firestore 非依存
- `server.mjs`        Cloud Run 入口。Firestore + adapter + bridge + worker を束ねて listen
- `Dockerfile`        node:22-slim
- `package.json`      依存は @google-cloud/firestore だけ
- `kv_firestore.test.mjs`  採点 18/18(KV 意味論 + 無改変 worker が Node で 200/204 を返す往復)

worker.js の唯一の変更: `CARD_CANONICAL_ORIGIN` を `globalThis.CARD_ORIGIN_OVERRIDE || 定数` に。
Cloudflare では override が undefined なので byte 同一(card_signature / witness_parity で担保済み)。

## デプロイ(TOshi の手。番人は deploy / secret / 課金をやらない)

前提: gcloud CLI、GCP プロジェクト(課金有効)。以下 PROJECT / REGION / DOMAIN は自分の値に。

1. API 有効化
   gcloud services enable run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com

2. Firestore(native mode)を 1 リージョンで作成
   gcloud firestore databases create --location=REGION

3. 証人鍵は GCP 版専用に新規生成(domain-bound。Cloudflare の鍵は流用しない)
   openssl genpkey -algorithm ed25519 -out tsugi-gcp-witness.pem
   # priv(pkcs8 DER の base64)と pub(raw 32B の base64)を取り出す手順は Cloudflare 側と同じ

4. Secret Manager に投入(値は自分の手だけ。番人は見ない)
   printf %s "<priv b64>"  | gcloud secrets create WITNESS_PRIVKEY_B64 --data-file=-
   printf %s "<pub b64>"   | gcloud secrets create WITNESS_PUBKEY_B64  --data-file=-
   # 既存の OPERATOR_PUBKEY_B64 / AGREEMENT_PUBKEY_B64 / SWEEP_TOKEN / OPENAI_APPS_CHALLENGE も同様
   # CRON_TOKEN は新規に強いランダム値を作って入れる

5. ビルド + デプロイ(build context は hs-verify-gate/)
   gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/tsugi/gate -f gcp/Dockerfile .
   gcloud run deploy tsugi-gate \
     --image REGION-docker.pkg.dev/PROJECT/tsugi/gate \
     --region REGION --allow-unauthenticated \
     --no-cpu-throttling \
     --set-env-vars KV_COLLECTION=hs_verify_kv,CARD_ORIGIN=https://DOMAIN \
     --set-secrets WITNESS_PRIVKEY_B64=WITNESS_PRIVKEY_B64:latest,WITNESS_PUBKEY_B64=WITNESS_PUBKEY_B64:latest,OPERATOR_PUBKEY_B64=OPERATOR_PUBKEY_B64:latest,AGREEMENT_PUBKEY_B64=AGREEMENT_PUBKEY_B64:latest,SWEEP_TOKEN=SWEEP_TOKEN:latest,OPENAI_APPS_CHALLENGE=OPENAI_APPS_CHALLENGE:latest,CRON_TOKEN=CRON_TOKEN:latest
   # --no-cpu-throttling = CPU always allocated。cron sweep と waitUntil の後始末のため
   # RELAY_URL / RELAY_TOKEN は渡さない(Cloud Run は自ゾーン迂回が不要)

6. ドメイン(新サブドメイン DOMAIN 例 tsugi.horizonshield.dev)を Cloud Run にマッピング
   gcloud run domain-mappings create --service tsugi-gate --domain DOMAIN --region REGION

7. Cloud Scheduler で毎日 sweep(Cloudflare の cron 相当)
   gcloud scheduler jobs create http tsugi-gate-sweep \
     --schedule "0 18 * * *" --uri https://DOMAIN/__scheduled --http-method POST \
     --headers "Authorization=Bearer <CRON_TOKEN>" --location REGION

8. Agent Card を GCP ドメインで再署名(AI agent listing の必須要件)
   - card の canonical origin が DOMAIN に変わるので、card 署名鍵(Mac、Worker には無い)で再署名する
   - 再署名スクリプトは番人が用意する(DOMAIN が決まったら)。署名済み card JSON を
     Cloud Storage バケットに置く(Producer Portal がここを validate する)

## これで埋まる Marketplace フォーム(Section 8)

- GCP Billing Account ID / Project ID  -> 手順 1 の実プロジェクト
- Infrastructure Execution Location    -> Pattern 1 (All GCP)
- Pricing Calculator                   -> Cloud Run + Firestore + Cloud Storage で見積もり
- Architecture diagram                 -> 上の構成を GCP 公式アイコンで
- Tenancy                              -> Multi-tenant

## まだ残っとる(番人の次の手)

- Agent Card 再署名スクリプト(DOMAIN 確定後)
- 台帳(hs-ledger)の GCP twin。同じ adapter + bridge に、DO 重複排除を Firestore トランザクションで足す
