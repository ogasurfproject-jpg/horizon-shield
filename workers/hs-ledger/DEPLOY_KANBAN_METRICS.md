# 看板の実測（Analytics Engine）デプロイ手順 — 2026-07-26

## 何を足すのか

看板v1.1 は「見つけてもらう」ための層である。7月26日に立てた。
**立てたが、見つけてもらえたかどうかを一度も測っていない。**
測っていない看板は看板ではなく願望である。ここで足すのは、その一本だけである。

足すもの：

- `KANBAN_AE` という Analytics Engine バインディング（dataset `hs_ledger_kanban`）
- 応答を返す直前に**1リクエスト＝1点**書く `noteHit()`
- `/health` に `privacy` オブジェクト（何を記録し、何を記録しないかの自己申告）

足さないもの：

- **公開ルートは1本も増えない。** `/health` の `routes` は9本のままである。
- 読み出しルートも増えない。読むのは Cloudflare 側（下の §6）で行う。
  Worker に読み出しを持たせると、アカウント用の API トークンを Worker に
  置くことになる。公開台帳が持つべきでない秘密が1個増える。だから置かない。

## 1. 記録するもの／しないもの

記録する（すべて固定語彙・低カーディナリティ）:

| 列 | 中身 | 例 |
|---|---|---|
| index1 / blob1 | 正規化した入口名 | `health` `cite` `verify` `entry-raw` `api-catalog` `other` |
| blob2 | クライアントの種類 | `ai-crawler` `search-crawler` `curl` `python` `browser` `none` |
| blob3 | HTTP メソッド | `GET` `POST` |
| blob4 | Referer の**ホスト名だけ** | `www.google.com`（空なら記録なし） |
| double1 | 常に 1（件数） | `1` |
| double2 | 応答コード | `200` `404` `409` |

記録しない:

IP アドレス、`cf.*` の地理情報、クエリ文字列、User-Agent 全文、Referer のパス、
リクエスト本文、認証ヘッダ、エントリ番号、SHA-256。

**管理ルートは一切測らない。** `POST /ledger/append`・`POST /reference/pin`・
`GET /ledger/pending` は `AE_SKIP` に入っていて、1点も書かない。
トークンを持つ側の行動を測る理由が無いし、測れば漏れる面が増えるだけである。

これらは全部テストで固定してある（`test/ledger.test.mjs` の `AE:` で始まる12本）。
「クエリ文字列が絶対に出ない」「UA 全文が絶対に出ない」「Referer のパスが絶対に出ない」
の3本は、実際に秘密っぽい文字列を投げ込んで、書かれた点の中に出てこないことを見ている。

## 2. この変更の地雷

**(a) バインディング名を変えると、計測が黙って止まる。**
`wrangler.jsonc` の `KANBAN_AE` と `src/worker.js` の `env.KANBAN_AE` は同じ名前でなければ
ならない。外れても**何も壊れない**。`noteHit()` はバインディングが無ければ黙って return する
設計だからである。エラーも出ない。ログも出ない。ただ数字が増えなくなるだけである。
これは「静かに減る」壊れ方そのものなので、名前を変えるなら必ず両方変えること。

**(b) 古い v1.3 の zip は使うな。**
7月26日に一度作った `kanban_v1_3` 系の zip は、`/verify/{n}` の修正**より前**の
worker.js（`02c5e0e6…`）に載っていた。あれをデプロイすると `/verify/{n}` が
v1以外のエントリに対して 400 を返す状態に巻き戻る。すでに破棄した。
この zip（`ledger_sync/src/worker.js` = `5a0727d7…`）だけを使うこと。

**(c) `wrangler deploy` はバインディングを消す。**
`wrangler.jsonc` に書かれていないバインディングは deploy で消える。だからこのファイルには
KV（`LEDGER`）・サービス（`PDF_GEN`）・Analytics Engine（`KANBAN_AE`）の**3本すべて**が
書いてある。§4 の dry-run で 3本出ることを目で確認してから deploy すること。
`LEDGER_ADMIN_TOKEN` は secret なので deploy では消えない。

## 3. 作業前に置くもの

zip を展開する。展開先はこの手順の中で固定する（パスを自分で埋める箇所は無い）。

## 4. デプロイ前の確認（ここで止まったら deploy しない）

順に:

1. `node --check src/worker.js` が黙って通ること
2. `node test/ledger.test.mjs` が `hs-ledger: ALL PASS`（40本）
3. `node test/mcp.test.mjs` が `hs-jidec-mcp: ALL PASS`（18本）
4. `npx wrangler deploy --dry-run` の出力に **バインディングが3本**出ること:
   - `env.LEDGER (37f6ebec621e42e9b9d6362ef6114e78)` — KV Namespace
   - `env.PDF_GEN (hs-pdf-gen)` — Worker
   - `env.KANBAN_AE (hs_ledger_kanban)` — Analytics Engine Dataset

**4本目が出ない、あるいは3本より少ないときは deploy しない。**
特に `PDF_GEN` が消えていたら、それは replay の再観測能力が落ちるということで、
台帳は「異常なし」と言い続けたまま検証能力だけが減る。最も質の悪い壊れ方である。

## 5. デプロイ後の確認

deploy 直後の `curl` は嘘をつくことがある（伝播待ちで旧版が返る）。
**1分待ってから** `bash verify_after_deploy.sh` を1回走らせること。
7月26日に3回これで足を取られた。

このスクリプトが見るもの:

1. `/health` の `routes` が **9本のまま**であること（増えていたら設計の失敗）
2. `/health` に `privacy.access_measurement` = `enabled` があること
3. `/health` の限界の自己申告（`NOT a conformant`）が消えていないこと
4. `/verify/7` が **200** を返すこと（400 なら巻き戻っている。即ロールバック）
5. 看板の入口6本がすべて 200 であること
6. `/paths/{sha}/replay` が `coverage: full` / `drift: false` であること
   （`partial` に落ちていたら `PDF_GEN` が消えている）

判定は**3値**である。`OK` / `NG` / `?（測れなかった）`。
`?` は NG に数えない。届かなかったことを「壊れている」と報告するのは、
検証ツールとしていちばんやってはいけない嘘だからである。
`?` が並んだら、まず回線と URL を疑うこと。

このスクリプト自体は、新しい worker.js をローカルに立てて実行し、
12項目すべてが `OK` になることを確認済みである（2026-07-26）。

## 6. 数字の読み方

Analytics Engine は**書き込み専用**である。Worker からは読めない。読むのは Cloudflare 側。

SQL API のエンドポイントは
`https://api.cloudflare.com/client/v4/accounts/c15ff64aba400e541853dec1fbe5e76a/analytics_engine/sql`
で、`Account Analytics: Read` を持つ API トークンが要る。

問い合わせの例（入口別の件数、直近7日）:

    SELECT blob1 AS route, blob2 AS ua_class, SUM(_sample_interval) AS hits
    FROM hs_ledger_kanban
    WHERE timestamp > NOW() - INTERVAL '7' DAY
    GROUP BY route, ua_class
    ORDER BY hits DESC

404 が出ている入口を探す（導線が間違っている場所が分かる）:

    SELECT blob1 AS route, double2 AS status, SUM(_sample_interval) AS hits
    FROM hs_ledger_kanban
    WHERE timestamp > NOW() - INTERVAL '7' DAY AND double2 >= 400
    GROUP BY route, status
    ORDER BY hits DESC

**確認していないことを書いておく。** 上の SQL は Analytics Engine の SQL API の
文法に沿って書いたものだが、**俺はこのアカウントで実行していない。**
トークンを持っていないからである。だから「この通りに動く」とは言えない。
列名（`blob1`〜`blob4`、`double1`、`double2`、`_sample_interval`、`timestamp`）が
書き込み側と一致していることだけが、俺が確かめたことである。
実行してエラーが出たら、それは文法の問題であってデータの問題ではない。

**もう一つ。数字は、アクセスがあってから出る。** deploy 直後は空である。
空であることは「計測が壊れている」の証拠ではないし、「誰も来ていない」の証拠でもない。
最初の数日は、自分で `curl` を1回叩いて、それが1点として出るかどうかだけを見ればいい。
それが出れば計測は生きている。出なければバインディングが外れている。

## 7. 戻し方

Cloudflare のダッシュボードで hs-ledger の Version を一つ前
（`637c2d9e-8051-42d0-bc25-866d7e5596ec`）に Rollback すれば元に戻る。
コード側で戻したいなら、`wrangler.jsonc` の `analytics_engine_datasets` を消して
deploy し直せば、計測だけが止まって他は動き続ける（`noteHit` が黙って return するため）。

## 8. ハッシュ

| ファイル | SHA-256 |
|---|---|
| `src/worker.js`（新） | `5a0727d7e0961fc52f110650cfd2940a01554b77206da25dc28aba3258f449ad` |
| `src/worker.js`（現本番 = 直前版） | `58ecb449dcd1055ef8e3560880af3d7409daaee715aa432a37c69eae9278450c` |
| `wrangler.jsonc` | `2cda36b9efdde620ed6f5f1d77ac2577e8c953e73e01781123629f9bec10f607` |
| `test/ledger.test.mjs` | 下の `SHA256SUMS.txt` を参照 |

現本番の Version ID は `637c2d9e-8051-42d0-bc25-866d7e5596ec` である。
