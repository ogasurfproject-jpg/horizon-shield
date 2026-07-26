# test/ — 看板v1.1 の回帰テスト

```
node test/ledger.test.mjs    # hs-ledger      23 アサーション
node test/mcp.test.mjs       # hs-jidec-mcp   18 アサーション
```

依存パッケージは無い。Node 18 以降であれば `npm install` も要らない。
`test/load.mjs` が **本番のソースそのもの**（`src/worker.js` と
`hs-jidec-mcp/src/worker.js`）を読み込むので、テスト用の写しは存在しない。
写しを置いた瞬間、テストは本番と静かにズレて嘘をつき始めるからである。

## このテストが本当に守っているもの

機能の動作確認は副産物である。守っているのは次の4つ。

**`/health` の `routes` がちょうど9本であること。** 引き継ぎ書がこの9本を文字単位
で固定し、番人v4 の点検⑩ がこれを数えている。看板を7本足しても `routes` は動かさ
ない設計にした（看板は `discovery` キーの下に置いた）。ここが10本になったら、それ
はテストの失敗ではなく設計の失敗である。

**台帳が自分の限界を公言し続けること。** `transparency.conformance` の
`"NOT a conformant SCITT Transparency Service"` と、引用カードの `limits` を検査して
いる。ここが消えるのは機能の劣化よりも重い事故である。JIDEC の存在理由は
「HORIZON SHIELD を信じなくても第三者が再検証できる」ことであって、
検証できる範囲を大きく見せた瞬間にその理由が消える。

**看板が本当に仕様に合っていること。** A2A v1.0 の必須8フィールド、
`protocolVersion` がルートではなく各 `AgentInterface` にあること、RFC 9727 の
`linkset` 形状、RFC 9116 の `Contact`/`Expires`、そして `Vary: Accept`。
とくに `Vary: Accept` が無いと、Markdown を受け取ったキャッシュが JSON クライアント
に Markdown を返す。静かに壊れる種類の事故なので必ず検査する。

**MCP が前に進んだままであること。** ツール4本・`protocolVersion` が `2025-11-25`・
`initialize` 無しで `tools/call` が通ること。4本→3本、`2025-11-25`→`2024-11-05` は
どちらも「古いソースを上書きデプロイした」ことの証拠である。

## HTTP は一切出て行かない

`test/mcp.test.mjs` は統合テストで、MCP Worker の `LEDGER_SVC` バインディングに
**本物の hs-ledger モジュールを直接束ねている**。公開ホスト名は叩かない。

同一アカウントの `workers.dev` を fetch すると自分に戻ってくる。過去にこれで
FALSE DRIFT を出した（第二の掟）。テストで公開ホスト名を叩けば同じ罠をテストの中に
持ち込むことになるし、そもそもこの環境からは `workers.dev` への curl がプロキシに
403 で弾かれる。サービスバインディングを模すのは、逃げではなく本番の正しい姿を
模すということでもある。

## デプロイ前に必ず両方通すこと

`wrangler deploy` の前に 41 本すべて通す。落ちたテストがあるなら、それは
デプロイしてはいけないという意味である。テストを直して通すのではなく、
なぜ落ちたのかを先に説明できるようにする。
