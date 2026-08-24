# サルベージ記録: hs-audit-app

- この `index.js` は、2026-08-24 に Cloudflare Worker `hs-audit-app` の **デプロイ済みコード**から取得したものです。
- **オリジナルの作成元ソースではありません。** ビルド成果物（バンドル）です。
- esbuild の出力です。ファイル内のモジュール境界コメントから、元のソースは以下の3ファイル構成だったことが分かります。
  - `src/provenance.js`
  - `src/ui.js`
  - `src/index.js`
- 非ASCII文字（日本語など）は esbuild によって `\uXXXX` 形式にエスケープされています。
  元のソースでは、ほぼ確実に日本語がそのままリテラルで書かれていたはずです。
  （例外として、24行目のコメントだけは文字列リテラル外のため日本語のまま残っています。）
- 取得したバイト列は一切加工していません。整形・エスケープ解除・字下げ変更・誤字修正のいずれも行っていません。

## 位置づけ

これは**復旧・履歴保全のため**にコミットするものであり、**正典（canonical）のソースではありません。**
今後の編集は、可能な限り元の `src/*.js` を復元・再構成した上で行ってください。
このバンドルを直接編集して運用ソースとして扱うことは避けてください。

## 同一性の確認

| | |
|---|---|
| 行数 | 431 |
| バイト数 | 20,069 |
| sha256 | `b21c11d0b5fa23d4dbc5e7039a9169f243a2b126c1e53fa13e6939c47709e739` |
| 取得日 | 2026-08-24 |
| 取得元 | Cloudflare Worker `hs-audit-app`（id tag `4a075820e88b41e88fd21fe43e026423`） |
| Worker 作成 | 2026-07-31T02:51:08Z |
| Worker 最終更新 | 2026-07-31T02:59:17Z（作成の8分後。以後1か月無変更） |

`node --check` は通過します。

## なぜサルベージが必要だったか

2026-08-24 時点で、このWorkerの**ソースは正本リポジトリにも本人のMacにも存在しませんでした。**

- `~/Desktop/hs-docfix/workers/` 配下38件に `hs-audit-app` は無し
- Desktop 全体を `*.js *.mjs *.ts *.toml *.json` で検索してもヒット0件
- `hs-audit-app` を名指す `wrangler.toml` / `wrangler.jsonc` もゼロ件
- `server.json` は5件のみ（horizon-shield / jidec / horizon-shield-webmcp / hs-verify-gate / hs-hearing）

**本番で稼働しているのに版管理外だった**ため、まず実体を git に入れることを優先しました。

## このWorkerが必要とするバインディング（コードが参照しているもの。値は不明）

コード上の参照のみを列挙します。**実際の設定値は確認していません。**

- `env.HS_MCP` — サービスバインディング。`typeof env.HS_MCP.fetch === "function"` で最初に判定され、**URLより優先**される
- `env.HS_MCP_URL` — 上記が無いときのフォールバックURL
- `env.HS_MCP_KEY` — 上流へ `Authorization: Bearer` として付与されるシークレット

KV / D1 / R2 バインディング、`scheduled` ハンドラは**いずれも存在しません**。

## 既知の不具合（2026-08-24 時点。このバンドル内の行番号）

コミット時点では**未修正**です。直す場合は元ソースを復元してから。

| 行 | 内容 |
|---|---|
| L10 / L11 | `agent_card_url` / `verification_contract` が旧ドメイン `hs-mcp.oga-surf-project.workers.dev` を向いたまま（現行は `mcp.horizonshield.dev`）。`_provenance` として全クライアントに配布される |
| L18 | `doi: "10.5281/zenodo.20019572"` は**解説論文**のDOI。データセット本体は `10.5281/zenodo.21898745`（v3.1） |
| L20 | `items: 65729`。JCCDB v3.1 の実数は 65,520（verified 13,207 + extended 52,313）。65729 は v2 時点の値である可能性が高い（要確認） |
| L297 | 上流URLが旧ドメイン。ただし L299 のバインディング分岐が先に効くため、経路上は不使用（見た目の負債） |
| L365 | `withProvenance(audit, {})` により `opts.signed` が常に undefined → `signed` は常に `null`。`claim_sha256` / `verify_url` / 改ざん検証リンクは**すべて到達しないコード** |
| （全体） | `callUpstreamAudit` の `{_error: ...}` が検出されず、**上流失敗が `_provenance` と DOI 付きの「監査結果」として返る** |
| L38 | `attribution` が価格の根拠を JCCDB に帰しているが、上流自身が「JCCDB に価格情報は含まない」と明言（価格は souba-db） |
| L419 | `/mcp` への GET が catch-all の 404 に落ちる。405 も `Allow:` も存在しない。CORS は `GET,POST,OPTIONS` と GET を広告している |
| — | `/mcp` は無認証で公開されている一方、上流へは自身の `HS_MCP_KEY` を付与する |

## 生死（実測）

2026-08-24 実測。`GET /mcp → 404`、`POST tools/list → 200`（正常なツール定義を返す）。
**レジストリの deprecated 注記にある「returns 404」は、GETだけを見た誤診です。エンドポイントは生きています。**
