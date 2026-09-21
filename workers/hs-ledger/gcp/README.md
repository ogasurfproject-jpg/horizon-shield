# hs-ledger on Google Cloud Run (JIDEC 台帳の GCP twin)

hs-ledger/src/worker.js を **無改変**で Cloud Run に載せる一式。Cloudflare 版
(ledger.horizonshield.dev / workers.dev)はそのまま生かす。これは追加であって移行やない。
Bitcoin に固定済みの JIDEC 記録は旧ホストを永久に指すので、Cloudflare 側は落とさん。

## 中身(番人が書いた、全部テスト済み)

- `kv_firestore.mjs`        Cloudflare KV(LEDGER)を Firestore で満たす adapter。**扉の twin と同一バイトの複製**
- `http_bridge.mjs`         Node http <-> Worker fetch の橋。/__scheduled 込み。**扉の twin と同一バイトの複製**
- `firestore_dedupe_do.mjs` **新規**。Durable Object AGREEMENT_DEDUPE_DO を Firestore transaction で満たす。
                            1 canonical_sha256 == 1 doc == 1 transaction。read-decide-write を 1 トランザクションに包み、
                            Cloudflare の blockConcurrencyWhile と同じ強整合(boundary 2.3)を作る。
                            AgreementDedupeDO クラスも decideDedupe 純関数も無改変で使う。
- `server.mjs`              Cloud Run 入口。Firestore + KV adapter + DO shim + service binding(passthrough) + worker を束ねる
- `Dockerfile`             node:22-slim。COPY は src / nenrin / gcp
- `package.json`           依存は @google-cloud/firestore だけ
- `firestore_dedupe_do.test.mjs`  DO shim の契約(claim/get/dup/独立)と read-before-write を採点

worker.js への変更: **ゼロ**。台帳側は扉と違い card 署名を持たんので、origin/name の override も要らん。

## service binding の扱い

- `GATE` / `PDF_GEN`  GCP では素の HTTPS fetch(passthrough)。Cloud Run は Cloudflare
  アカウントの外なので、公開 gate / pdf-gen を叩いても自ゾーン loopback(false drift)にならん。
- `KANBAN_AE`(Analytics Engine)  GCP に等価物なし。worker 側が `typeof ae.writeDataPoint === "function"`
  で守るので渡さない。計測が減るだけで検証能力は落ちん。

## デプロイ(TOshi の手。番人は deploy / secret / 課金をやらない)

前提: 扉の twin と同じ GCP プロジェクト(tsugi-marketplace)を流用可。REGION=asia-northeast1。

1. Firestore(native mode)は扉の twin で作成済みなら流用。KV と dedupe はコレクション名で分離
   (KV_COLLECTION=hs_ledger_kv、DEDUPE_COLLECTION=hs_ledger_agreement_dedupe)。同一 DB で衝突せん。

2. Secret Manager: 台帳が読む秘密(LEDGER_ADMIN_TOKEN 等)を入れる。CRON_TOKEN は新規の強いランダム値。
   値は自分の手だけ。番人は見ない。

3. ビルド + デプロイ(build context は hs-ledger/)
   cd workers/hs-ledger
   gcloud run deploy hs-ledger-twin --source . --region asia-northeast1 --project tsugi-marketplace \
     --no-cpu-throttling \
     --set-env-vars KV_COLLECTION=hs_ledger_kv,DEDUPE_COLLECTION=hs_ledger_agreement_dedupe \
     --set-secrets LEDGER_ADMIN_TOKEN=LEDGER_ADMIN_TOKEN:latest,CRON_TOKEN=CRON_TOKEN:latest

4. Cloud Scheduler で日次の証人束ね(Cloudflare の cron 30 0 * * * 相当、09:30 JST)
   gcloud scheduler jobs create http hs-ledger-twin-sweep \
     --schedule "30 0 * * *" --uri https://<service-url>/__scheduled --http-method POST \
     --headers "Authorization=Bearer <CRON_TOKEN>" --location asia-northeast1

## まだ残っとる(番人の次の手)

- 台帳の KV データ移送(Cloudflare KV -> Firestore)。twin を「空の新台帳」で立てるか、
  既存記録を写すかは別判断。写すなら seq / entry:N / hash: / ots:N の一括 export/import 手順を用意する。
