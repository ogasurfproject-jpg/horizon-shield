# hs-gateway デプロイ手順(TOshiの手で実行)

番人(Claude)は設計と検証だけ。以下のコマンドは全部TOshiが自分の手で叩く。
急がない。本番の既存workerは1ミリも触らない。hs-gateway は新規・独立。

前提の確認(毎回):
- アカウント取り違えの罠。実行前に必ず `npx wrangler whoami` で
  c15ff64a(oga.surf.project@gmail.com)側にいることを確認する。
  YAKUMO PWA の 9ca0f61a と混同しない。

---

## 0. ファイル一式(このフォルダ)

```
hs-gateway/
  wrangler.jsonc          設定(binding/KV/secret宣言)
  src/index.js            本体(業種判定→課金ゲート→取り次ぎ→レシート)
  src/registry.js         業種レジストリ(業種を足す=ここに1エントリ)
  src/router.js           業種横断ルーティング(決定的)
  src/adapter.js          binding/http統一呼び出し + 台帳レシート
  src/tickets.js          チケット残高・減算・前払式残高モニタリング
  test/harness.mjs        ローカル検証(27件。node test/harness.mjs で緑を確認済み)
```

## 1. TICKETS_KV を作る

```
npx wrangler kv namespace create TICKETS_KV
```

出力の id を wrangler.jsonc の "REPLACE_WITH_TICKETS_KV_ID" に貼り替える。

## 2. secret を入れる(実行系。番人は触らない)

台帳に刻むためのトークン(未投入なら台帳追記はスキップされ、レシートは生成だけされる):
```
printf %s 'ここに hs-ledger の LEDGER_ADMIN_TOKEN と同じ値' | npx wrangler secret put LEDGER_ADMIN_TOKEN
```
運営が前払式残高を見るためのキー(任意の強い文字列):
```
printf %s 'ここに任意の管理キー' | npx wrangler secret put ADMIN_KEY
```
注: secret put はパイプでOK(kv put はパイプ不可、という既知の罠とは別)。

## 3. デプロイ

```
npx wrangler deploy
```

## 4. 動作確認(スモークテスト)

サービス記述子(業種一覧と前払式モニタの水準が返る):
```
curl -s 'https://hs-gateway.oga-surf-project.workers.dev/health'
```

MCP initialize:
```
curl -s -X POST 'https://hs-gateway.oga-surf-project.workers.dev/mcp' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

業種判定して建設(hs-webmcp)へ取り次ぐ。store付きで課金ゲートも通す(チャージ前は残高不足で弾かれるのが正常):
```
curl -s -X POST 'https://hs-gateway.oga-surf-project.workers.dev/mcp?store=hs-partner-002' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"gateway_ask","arguments":{"ask":"外壁塗装80万は高いですか","work":"外壁塗装","amount":800000}}}'
```
? を含むURLはシングルクォートで囲む(zshの no matches found を避ける)。

前払式残高の運営確認(要 ADMIN_KEY):
```
curl -s 'https://hs-gateway.oga-surf-project.workers.dev/admin/prepaid?key=入れたADMIN_KEY'
```

## 5. チケットを手で1枚チャージして課金経路を通す(任意・確認用)

実決済はまだ繋いでいない。確認用に手でKVに残高を置ける:
```
npx wrangler kv key put --namespace-id <TICKETS_KVのid> --remote 'bal:hs-partner-002' '3'
```
その後 4 の gateway_ask を叩くと、1枚消費されてレシートに balance_before/after が入る。
台帳トークンを入れていれば receipt.anchored が true になり entry 番号が返る。

---

## 番人からの申し送り(重要・盛らない)

- これは設計ドラフトの実装。**業種は現状「建設(construction)」1本だけ live**。提携業種は
  registry.js のコメント雛形を、実データ(提携先URL・検証主体)が確定してから有効化する。
  器だけ先に量産しない(hs-webmcpと同じ「器だけ先に作らない」設計)。
- チケット従量は「器」であって事業判断ではない。実際に課金を始める前に、設計図第7章の
  資金決済チェックリストを専門家に通すこと。前払式残高モニタは技術で先回りする部分として
  入れてあるが、届出・供託の要否判断は弁護士/決済代行の領分。番人は法的助言をしない。
- hs-webmcp / hs-ledger / hs-billing / hs-mcp は本番稼働中(hs-mcpは審査中)。hs-gateway は
  それらを呼ぶだけで改変しない。特に hs-mcp には binding も依存もしていない(設計図第6章)。
- 1枚=100円(YEN_PER_TICKET)と1処理=1枚(既定)は仮値。確定額は事業判断。
