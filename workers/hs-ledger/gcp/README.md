# hs-ledger on Google Cloud Run (JIDEC 台帳の GCP twin)

hs-ledger/src/worker.js を **無改変**で Cloud Run に載せる一式。Cloudflare 版
(ledger.horizonshield.dev / workers.dev)はそのまま生かす。これは追加であって移行やない。
Bitcoin に固定済みの JIDEC 記録は旧ホストを永久に指すので、Cloudflare 側は落とさん。

## 中身(全部テスト済み)

- `kv_firestore.mjs`        Cloudflare KV(LEDGER)を Firestore で満たす adapter。**扉の twin と同一バイトの複製**
- `http_bridge.mjs`         Node http <-> Worker fetch の橋。/__scheduled 込み。**扉の twin と同一バイトの複製**
- `firestore_dedupe_do.mjs` **新規**。Durable Object AGREEMENT_DEDUPE_DO を Firestore transaction で満たす。
                            1 canonical_sha256 == 1 doc == 1 transaction。read-decide-write を 1 トランザクションに包み、
                            Cloudflare の blockConcurrencyWhile と同じ強整合(boundary 2.3)を作る。
                            AgreementDedupeDO クラスも decideDedupe 純関数も無改変で使う。
                            2026-10-13 (concurrency audit L1r): 台帳の entry 番号付け(/ledger-append)もここで受ける。
                            KV コレクションの seq / hash:<h> を transaction で読み、entry:n / hash:h / seq を同じ
                            transaction で書く(書く中身は src/ledger_append.mjs の appendEntryKv そのまま)。
                            2 件が同時でも n と n+1 になる。transaction が失敗したら 503 で、呼び出し側は何も書かない。
                            server.mjs は KV_COLLECTION をこの shim にも渡す(同じ doc を読み書きするため)。
- `server.mjs`              Cloud Run 入口。Firestore + KV adapter + DO shim + service binding(passthrough) + worker を束ねる
- `Dockerfile`             node:22-slim。COPY は src / nenrin / gcp
- `package.json`           依存は @google-cloud/firestore だけ
- `firestore_dedupe_do.test.mjs`  DO shim の契約(claim/get/dup/独立)と read-before-write、/ledger-append の
                            同時 2 件(n と n+1)・保存バイト・dedup・transaction 失敗時の fail closed を採点

worker.js への変更: **ゼロ**。台帳側は扉と違い card 署名を持たんので、origin/name の override も要らん。

## service binding の扱い

- `GATE` / `PDF_GEN`  GCP では素の HTTPS fetch(passthrough)。Cloud Run は Cloudflare
  アカウントの外なので、公開 gate / pdf-gen を叩いても自ゾーン loopback(false drift)にならん。
- `AGREEMENT_INTAKE`(2026-11-03)  結の受け口(agreement.horizonshield.dev)。Résumé の agreements[] が受け口の契約と合意の bytes を sha で引く。
  GCP では GATE と同じ素の HTTPS fetch。束ねは `bindings.mjs` に置き、`test/resume_twin_parity.test.mjs` が Cloudflare と同じ agreements[] と not_counted になる事を照らす。
- `KANBAN_AE`(Analytics Engine)  GCP に等価物なし。worker 側が `typeof ae.writeDataPoint === "function"`
  で守るので渡さない。計測が減るだけで検証能力は落ちん。

## デプロイ(運用者の手で行う)

前提: 扉の twin と同じ GCP プロジェクト(tsugi-marketplace)を流用可。REGION=asia-northeast1。

1. Firestore(native mode)は扉の twin で作成済みなら流用。KV と dedupe はコレクション名で分離
   (KV_COLLECTION=hs_ledger_kv、DEDUPE_COLLECTION=hs_ledger_agreement_dedupe)。同一 DB で衝突せん。

2. Secret Manager: 台帳が読む秘密(LEDGER_ADMIN_TOKEN 等)を入れる。CRON_TOKEN は新規の強いランダム値。
   値は運用者の手だけで入れる。

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

## まだ残っとる(次の手)

- 台帳の KV データ移送(Cloudflare KV -> Firestore)。twin を「空の新台帳」で立てるか、
  既存記録を写すかは別判断。写すなら seq / entry:N / hash: / ots:N の一括 export/import 手順を用意する。
