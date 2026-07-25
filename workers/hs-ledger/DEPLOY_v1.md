# JIDEC 台帳 v1 デプロイ手順

## 何が変わったか

全先生の 2026-07-25 の指摘に応えて、台帳を v1 スキーマに拡張。
- `/reference/pin` : 参照データ束の内容SHA-256を事前に固定（POST）
- `/reference/{sha}` : pinned バンドルの公開取得（GET）
- `/verify/{n}` : v1 エントリの独立検証レシピをJSONで返す
- `/ledger/append` : v1 記録の必須フィールドを検証、参照バンドルが未pinのクレームは422で弾く
- 受領書HTML: schema v1 / v0 バッジと、v1エントリなら検証レシピへのリンクを表示

**v0（既存の entry #1）は互換のためそのまま読める。** 独立検証水準を満たすのは v1 エントリ以降。

## Mac でのデプロイ

```
cd ~/jidec/jidec-ledger    # (このzipを展開した場所)
npx wrangler deploy
```

TypeScript コンパイルなし、KV バインディング変更なし、シークレット変更なしなので、そのまま deploy で反映される。

## 反映確認

```
curl -s https://hs-ledger.oga-surf-project.workers.dev/health | jq
```
`claim_schema: "jidec-claim-v1"` と `spec: "SPEC_HASH_INDEPENDENCE_v1.md (entry #2)"` が出れば OK。

## entry #2 投入（SPEC v1 の Bitcoin 固定）

```
cd ~/jidec/jidec-ledger
curl -s -X POST https://hs-ledger.oga-surf-project.workers.dev/ledger/append \
  -H "X-Ledger-Key: umKnf7qGF8leSZwfJhFYzhkPCLYs" \
  -H "content-type: application/json" \
  --data @seed_entry_2.json | jq
```
`{"n": 2, "url": ".../ledger/2", "schema": "v0"}` が返る。

SPEC 自体は v0 スキーマの平文Markdown（policy commitment）として anchor する。次回の cron が回ると `ots stamp` されて Bitcoin に刻まれる。SPEC の SHA-256 は `020b7c82f2bd9bde351776f7976d1d6f15c6ed6dc522094411ebd5fa78bb9a77`。

## 次のステップ（hs-pdf-gen 側）

台帳 v1 が反映されたら、`hs-pdf-gen` 側の `hsHandleEstimateAudit` と `generatePDF` を v1 クレーム生成に切り替える。SPEC §3 の canonical record を組み立てて `/ledger/append` に投入するように差し替え。この差分は別途 patch にして渡す。

現状：
- 台帳側（今回）：v1 受理準備完了
- hs-pdf-gen 側（次回）：v1 生成へ差し替え
- 過去の #1 は v0 のまま保持
- 論文の該当箇所も v1 説明に書き換える

## テスト状況

`node --input-type=module` によるユニットテスト15件通過：
- ref pin / dedup / auth / missing meta
- v1 append valid / unpinned-ref-reject / missing-field-reject / bad-sha-reject
- v0 backward compat
- verify recipe for v1 / rejection for v0
- receipt HTML rendering for v1 (with verifier link) / v0 (with note)
