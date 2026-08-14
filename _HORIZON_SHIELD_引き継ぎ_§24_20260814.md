# §24 追記 — 2026-08-14 午後: 扉が自分に落ち、サーバーが 200 を配るのをやめた

§23 の続き。**この節に書いてあることは全部、審査基準に当てるために自分のサーバーを端から叩いた副産物である。** 基準そのものが要求していたのは10箇所のうち数点だけだった。

## 24.0 今日の本番反映（8コミット）

| コミット | Worker | 内容 |
|---|---|---|
| `0057ce3e` | — | verify-directory 書き直し・トップから初リンク |
| `877c67ed` | — | 測っていない条件を緑にしない（ページ側） |
| `7d6f1cf1` | `591df271` | hs-mcp 審査対策10箇所 |
| `6afb083c` | `016f038e` | **扉が自分の試験に落ちるようにした** ＋ 偽になる文3箇所 |
| `fa407062` | — | badge の英語社名 |
| `f474d00d` | — | hs-mcp の observability / preview_urls を明示 |
| `96ce87d3` | `e38d8ded` | **実装していない経路に 200 を返すのをやめた** |
| `0fb2ae45` | `290cba53` | **MCPエンドポイントへの GET を仕様どおり 405 に** |

---

## 24.1 ★扉が自分にだけ fail-open だった（修正済み・本番反映）

`workers/hs-verify-gate/src/worker.js` に、測れなかったときの扱いが2箇所あった。

```js
// 他人を測るとき (/check, 165行目付近)
if (!allowToolCall) {
  return { pass: false, measured: false, ... };   // fail-closed

// 自分を測るとき (/self, 793行目付近)
checks.mcp_endpoint = {
  pass: true,  measured: false, ... };            // fail-OPEN
```

4行下の `const passed = Object.values(checks).every(r => r.pass)` により、**この `pass: true` 一個で扉の総合判定が `verified` になっていた。**

**記録の文章は最初から正直だった。** `"it does not claim to have measured this"` と書いてあって、その隣で boolean だけが嘘をついていた。**人間が読むと気づかず、機械が読むと通る形。**

修正後の実測（本人の Mac から素の curl）:

```
status           : pending
mcp_endpoint.pass: False
measured         : False
determinism.pass : True    ← 実測して通ったものは通ったまま
```

**レジストリから緑が1つ残らず消えた。4件中0件合格。** ページ側の「唯一 verified なのは扉自身」系の記述3箇所を同じコミットで書き換えた（§14.4）。

---

## 24.2 ★実装していない経路に 200 を返していた（修正済み・本番反映）

**実測（2026-08-14）**

```
GET /sse                 -> 200 application/json  (server info)
GET /foo                 -> 200
GET /this-does-not-exist -> 200
GET /admin               -> 200
```

`fetch` ハンドラ末尾の GET catch-all が、**あらゆるパスに 200 + server info を返していた。**

そして `wrangler tail` で見つかった:

```
GET https://hs-mcp.oga-surf-project.workers.dev/sse — Ok @ 15:09:01
GET https://hs-mcp.oga-surf-project.workers.dev/sse — Ok @ 15:09:02
...（毎秒1回、延々と）
```

**SSE クライアントが 200 を受け取り、しかしストリームではないので即座に張り直す。** これを日に8万回。HTTP は成功、ログは `Ok`、エラー率にも 4xx にも出ない。**扉の `pass: true` と同じ構造。**

**修正内容**

| パス | 変更後 |
|---|---|
| `/` `/mcp` | 200 info（`sse: "not offered..."` を明記） |
| `/sse` `*/sse` | **405** + `Allow: POST` + 何が起きていたかの説明 |
| `/health` | 200。**実際に KV を読んで、測ったものだけを報告**（`checked` / `not_checked`） |
| その他 | **404** + 正しいエンドポイントと既知パス一覧 |
| **POST** | **一切触っていない。**全パスで JSON-RPC を受ける現状のまま |

**デプロイ後、毎秒の `/sse` は完全に止まった。** クライアントは壊れていなかった。405 を受け取ればちゃんと止まる、まともな実装だった。**ずっと 200 を返され続けていたから、止まる理由が一度も与えられなかっただけ。**

`/sse` のレスポンス本文にこう残してある: *"Until 2026-08-14 this path answered 200 with server metadata, which made SSE clients reconnect in a loop without ever surfacing an error. **That was our bug, not yours.**"*

---

## 24.3 hs-mcp の observability（修正済み）

§19.3 の対策が入っていた5本（`hs-followup` / `hs-hearing` / `hs-internal-mcp` / `hs-price-sync` / `hs-verify-gate`）に **`hs-mcp` は入っていなかった。**

```jsonc
"preview_urls": false,
"observability": { "enabled": true, "logs": { "enabled": true } },
```

を明示。**`wrangler tail` が即座にリクエスト行を出したので、効いていることは実測で確認済み。**

**`workers_dev` は触らなかった。** 設定ファイルに「mcpservers.org の掲載・Glamaのキャッシュ・利用者のブックマークが指している。落とせない」と推測で書いてあったが、**tail で毎秒1リクエストが実際に来ていたので、その推測は実測で裏付けられた。**

---

## 24.4 ★測定の対象を間違えた記録

私は「`hs-mcp.oga-surf-project.workers.dev` の参照は0ファイル」と報告し、`workers_dev: false` を検討した。あれは**リポジトリ内で誰がリンクしているか**を数えたもので、**誰が実際に叩いているか**ではなかった。

**リポジトリ参照数 ≠ 生きたトラフィック。** 落としていたら毎秒の呼び出しを全部切っていた。

**教訓: 「使われているか」を測るとき、コードを grep するのは代理指標でしかない。本物はログにある。**

---

## 24.5 `GET /` を 405 にした（判断済み・本番反映）

MCP の Streamable HTTP 仕様は、SSE ストリームを提供しないサーバーは**MCPエンドポイントへの GET に 405 を返さなければならない (MUST)** としている。このサーバーはルートがエンドポイントで SSE を提供しないので、200 は**仕様違反だった**。適合性を測る道具を売っている側が MUST を破っているのは筋が通らないので直した。

**トレードオフではなかった、というのが要点。** 本文は従来とまったく同じ info を保ち、`Allow: POST` を付け、ステータスだけ 405 にした。開けばサーバー名・トランスポート・14ツールの一覧が今までどおり読める。**減ったのは情報ではなく番号だけ。** さらに `spec_note` で「なぜ 405 なのか」を機械可読で書き、クローラーが「死んでいる」と誤解する余地を潰した。

実測: `HTTP/2 405` / `allow: POST` / `spec_note` あり / `tools` 14本。**戻すなら `status: 405` と `Allow` を消すだけの1行。**

---

## 24.6 残タスク

| # | 項目 | 状態 |
|---|---|---|
| 1 | ~~`hs-audit-app` を `deprecated` に~~ | **完了。§24.8** |
| 2 | ~~Bing の最終クロール日時~~ | **完了。§24.9** |
| 3 | Anthropic の返事 | 8/14 に2通送信済み（質問5つ）。**毎週木曜 09:00 の追撃タスクが拾う。初回 8/20** |
| 4 | 投稿5媒体 | `~/Desktop/posts_EN_launch-pack_v2.md`。**ネットワーク外の1人に `curl POST /check` を叩いてもらうだけ残り** |
| 5 | classic PAT 7本 | §17 のまま。順序厳守 |
| 6 | `jidec 1.1.0` を公開するか | 正本に定義があるのに未公開。判断だけ |

---

## 24.8 `hs-audit-app` を deprecated にした（完了）

`io.github.ogasurfproject-jpg/hs-audit-app` 0.1.0 が公開レジストリに `active` で載り、エンドポイント `hs-audit-app.oga-surf-project.workers.dev/mcp` は 404 を返していた。正本に `server.json` は無い。

**`publishedAt` は 2026-07-31。2週間、404 を返す看板が active で立っていた**（当初「2ヶ月」と見積もったのは誤り。訂正済み）。

PATCH の応答で description が判明した: **「建設・リフォーム見積もりの誠実性を適正レンジで監査する MCP App(UI付き・出典検証込み)」**。思いつきの残骸ではなく、UI付きの MCP App として公開されたもの。**どのコードから publish したのかは正本に残っていない。**

**`deleted` ではなく `deprecated` を選んだ。** §1.3「取り下げたように見えて実際は取り消せていない状態は、この事業の原則と噛み合わない」／verify-directory「a record that can be deleted on request is not a record」。**自分の死んだ看板だけ黙って消すのは、その原則と噛み合わない。** いま公開レジストリにこの文が載っている:

> Retired. … Left visible rather than deleted, because a record that can be erased on request is not a record.

**★手順（公式ドキュメントに書かれていない情報）**

```
PATCH https://registry.modelcontextprotocol.io/v0.1/servers/{URLエンコードした名前}/status
  Authorization: Bearer <token>
  {"status":"deprecated","statusMessage":"..."}   # active|deprecated|deleted、message は500字まで
```

- **読み取りは `/v0/`、status 更新は `/v0.1/`。** 版が違う
- **トークンの保存先は `~/.config/mcp-publisher/token.json`。** 公式ドキュメントに記載が無い。`mcp-publisher login github` の後に生成される
- 状態の確認は `_meta["io.modelcontextprotocol.registry/official"].status`。**トップレベルには無い**
- `deprecated` は一覧から消えない（仕様どおり。「visible with a warning message」）

---

## 24.9 Bing の12件は決着（完了）

Bing Webmaster Tools の **URL 検査**で `/movement/` を見た結果:

```
✓ 正常にインデックスが付きました  — URL は Bing に表示できます
✓ SEO/GEO に関する問題は見つかりませんでした
```

**同じ Bing が、SEOレポートでは `/movement/` を「エラーがあるページ」に並べ、URL検査では「問題なし」と言っている。** §23.1 の「レポートは前回スキャン時点のスナップショット」という仮説が、**Bing 自身の別経路で裏付けられた。**

**結論: 12件は直す必要がない。直すものが存在しない。** 7/12 以降に7回やった修正は、1回目以降すべて空振りだった。レポートの一覧は次のサイトスキャンが走るまで消えない。

**教訓の再確認: 同じ指摘が3週間消えないときは、指摘の中身ではなく、指摘が更新されているかを疑う。** そして**同じ相手が持っている別の窓口を探す。** レポートと URL 検査は同じ Bing の別の面で、片方だけが古かった（§16.5「ディレクトリは1サービスにつき1面とは限らない」と同型）。

---

## 24.10 ★今日いちばん残すべき一文

**3件とも「HTTP は成功、ログは Ok、エラー率にも出ない」形をしていた。**

- `get_jccdb_dataset_info` が「Zenodo にデータセットは無い」と2日以上（8/12以降）言い続けていた
- 扉が他人には fail-closed、自分にだけ fail-open だった
- 実装していない `/sse` に 200 を返し、クライアントを毎秒の無限ループに閉じ込めていた

**どれも、探しに行かなければ永久に見つからなかった。** そして3件とも、§3 で「地雷だから触らない」と決めて避けた `workers/` の中にあった。

**避けた場所は、避けたぶんだけ腐る。**
