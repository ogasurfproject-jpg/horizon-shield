# 検証の扉への登録を、手動から自動へ

2026-09-11

## TOshi の指摘

> ベリファクションゲートの登録も促さないといけないな！！てえ言うか、なんで手動なんだ？？
> 自動でやる設計にしてるはずだが！！

正しい。**設計は自動でできている。配線が繋がっていなかっただけ。**

## 扉の器は全部そろっていた(ソースで確認)

workers/hs-verify-gate/src/worker.js:

- `POST /watch` = 誰でも endpoint を掃引の列(watch:registry KV)に足せる。
  掃引は cron 0 18 * * * で毎日回る。watchlist() は DEFAULT_WATCHLIST + 旧 watch:endpoints + watch:registry を束ねる。
- `resolveConsent(endpoint)` = 同意の解決。順に (1)ソースの TOOL_CALL_CONSENT、(2)origin の
  `/.well-known/mcp-conduct.json` の `allow_tool_call:true`、(3)無し。
  **(2)があれば TOOL_CALL_CONSENT にハードコードしなくても determinism まで測って verified まで行ける。**
  そのファイルを置けるのは origin の所有者だけ = 申告ではなく証明。

## 繋がっていなかった2箇所(手動の正体)

1. 加盟店MCP(hs-partner-001-mcp / hs-partner-002-mcp)が
   `/.well-known/mcp-conduct.json` を出していなかった。agent-card は出していた。
   結果、扉のソースの TOOL_CALL_CONSENT に店の URL を手で足すしか測る道が無かった。
   さらに **p001 は TOOL_CALL_CONSENT にも無く**、同意ファイルも無かったので、
   watchlist には載っていても determinism を測る道が一本も無かった(p002 は operator_list にあり verified)。

2. 店を公開しても誰も `/watch` を叩いていなかった。DEFAULT_WATCHLIST に p001/p002 を
   手でベタ書きしているだけ。新しい店 = ソース書き換え + 扉 deploy。

## 直したこと

### 加盟店MCP(p001 / p002)が同意を証明する

各 worker が `GET /.well-known/mcp-conduct.json` を出す:

    { "allow_tool_call": true,
      "endpoints": ["https://pNNN.horizonshield.dev/mcp"],
      "operator": { "name": "The HORIZONs Co., Ltd. (HORIZON SHIELD)", "for": "Yakumo WebMCP Partner" },
      "note": "..." }

- origin から動的に導く(conductConsent(url.origin))ので、p001 も p002 も、これから増える pNNN も同じコードで正しい。
- endpoints は自分の /mcp に絞る(他の口への同意を勝手に広げない)。
- 英語文脈なので社名に 音 は使わない(The HORIZONs Co., Ltd.)。
- **これで扉のソースの TOOL_CALL_CONSENT を新しい店のたびに書き換える必要がなくなる。**
- p001 は今この瞬間、扉で determinism を測る道が無い(pending 固定)。この同意ファイルでその道ができる。

### CI が公開済み roster から加盟店を自動登録する

新規 .github/workflows/gate-register-partners.yml:

- 引き金: data/yakumo-contractors.json への push(公開で roster が更新された瞬間)+ 週次 + 手動。
- 公開済み roster を読み、webmcp の店の member_no から endpoint(https://pNNN.horizonshield.dev/mcp)を導いて、
  一つずつ `POST /watch` に流す。
- **GitHub の runner から回る = 外部。同一Cloudflareアカウントの worker 間で起きる 1104(エッジ弾き)を踏まない。**
  扉自身も加盟店MCPも触らない。roster(自社の公開データ)を読むのは runner であって扉ではない
  (扉が自社データに触れない設計の芯は壊さない)。
- **これで DEFAULT_WATCHLIST を新しい店のたびに書き換える必要がなくなる。**

### 扉(hs-verify-gate)は1行も触っていない

器は全部あった。p001/p002 の DEFAULT_WATCHLIST/TOOL_CALL_CONSENT のベタ書きは belt-and-suspenders として残す
(消すと同意ファイル deploy や /watch 登録が回る前に p001/p002 が一瞬落ちる恐れがあるため)。
新しい店はもうそこに触れなくても自動で乗る。

### consent_test.mjs(新規、workers/hs-partner-001-mcp/)

実物どうしで確かめる:
- 加盟店MCPの fetch を実際に呼び、同意ファイルの形(allow_tool_call boolean / endpoints は自分の /mcp のみ /
  listing は decline でない / 英語に 音 なし)を検査。
- 扉のソースから写した受け入れ規則に、その同意ファイルを通し、自分の /mcp では consent が立ち、
  他所の口には広がらないことを確認。
- ワークフローの python(実物を YAML から抜いて実行)に実測寄りの roster を食わせ、
  webmcp の2店だけが p001/p002 として出て、webmcp でない店・3桁超・番号無しを弾くことを確認。
- 本番 roster でも python が落ちず p001 が出ることを確認。

## 出す手順(番人は設計と検証。deploy と push は TOshi の手)

扉は触らない。順番の縛りは無いが、加盟店MCP を先に deploy してから登録を回すと、
登録時に扉が同意ファイルを読んで owner_file_at_request:"consent" を記録できる。

    cd ~/horizon-shield/workers/hs-partner-001-mcp && npx wrangler deploy
    cd ~/horizon-shield/workers/hs-partner-002-mcp && npx wrangler deploy

deploy できたら、置けたことと扉が読めることを自分で確かめる:

    curl -s https://p001.horizonshield.dev/.well-known/mcp-conduct.json
    curl -s -X POST https://gate.horizonshield.dev/watch -H 'content-type: application/json' --data '{"endpoint":"https://p001.horizonshield.dev/mcp"}'

2本目の返りの owner_file_at_request が "consent" なら、扉が同意ファイルを読めている。
(determinism まで測って verified になるのは次の掃引 06:17 JST 起点ではなく扉の cron 03:00 JST。急ぐなら
 /check に {"endpoint":"https://p001.horizonshield.dev/mcp","allow_tool_call":true} を投げれば その場で測れる)

commit と push:

    cd ~/horizon-shield && git add \
      workers/hs-partner-001-mcp/src/worker.js \
      workers/hs-partner-002-mcp/src/worker.js \
      workers/hs-partner-001-mcp/consent_test.mjs \
      .github/workflows/gate-register-partners.yml \
      FIX_20260911_gate_auto_register.md \
      && git commit -m "gate: 加盟店MCPの自動登録を配線する(同意ファイル + CI /watch)" \
      && git push

push すると gate-register-partners.yml は roster に触れていないので発火しない。
初回だけ手で回して p001/p002 を登録簿に載せる(Actions タブ > Gate register partners > Run workflow)、
または上の curl を p002 にも打つ。以後は店を公開した時点で自動で回る。

## これで自動になる範囲と、まだ手が要る所

- 自動になった: 公開 → roster 更新 → CI が /watch → 掃引が測る → verified。ソース書き換えも扉 deploy も不要。
- まだ手が要る: 加盟店MCP worker(hs-partner-NNN-mcp)そのものの deploy。これは worker を建てる行為なので、
  性質上あんたの手。ただし建てさえすれば、同意も登録も worker 側とCIが自動でやる。
  「ある程度の段階で」= 加盟店MCP を建てた段階。そこから先が自動になった。
