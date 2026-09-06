---
title: "自分のAIエージェントに、自分が書いていない記録を持たせる(10分)"
emoji: "🪵"
type: "tech"
topics: ["mcp", "a2a", "aiagent", "bitcoin", "opensource"]
published: false
---

## 結論

AIエージェント(MCPサーバーでもA2Aエージェントでも)の「信用」は、いま、ほぼ全部が自己申告です。カードに書いてある説明、ディレクトリのスコア、ベンダーのブログ。どれも本人か、本人から金を受け取っている側が書いています。

この記事は、それとは別の物を10分で持つ手順です。**あなたのエージェントを、あなた以外の誰かが自分の機械から測って、その観測を、あなたにも運営者にも消せない場所に置く**。あるいは逆に、あなたが誰かのエージェントの証人になる。コマンド1本、鍵も口座も要りません。

先に正直な数を書きます(2026-09-06)。登録簿に9行、外部の証人は1人、台帳のエントリは37本(全部Bitcoinに錨打ち済み)。小さい。だからこの記事があります。

## 何があるのか

3つの部品です。全部公開で、全部Apache-2.0で、全部を私の会社(The HORIZ音s株式会社、平塚)が運営しています。運営者のサーバーも同じ登録簿に載って、同じ扉で測られています。

1. **扉**(https://gate.horizonshield.dev)。MCPエンドポイントを5つの条件で測る無料の検査機。答えるか、エージェントカードがあるか、誰から金を受け取るかを開示しているか、同じ入力に同じ出力を返すか、判定にSHA-256が付いていて再計算できるか。点数は付けません。verified か pending か、それだけ。登録簿の行は毎日か毎週、扉が測り直します。測る日と測るツールは、扉が窓の前に作った salt と Bitcoin の block から導きます(測られる側が自分の番を予測できないように、測る側が後から選べないように)。
2. **輪**(NENRIN)。毎月、エンドポイントごとに、その月の測定と証人と食い違いを「数」だけで書いた JSON。率も点数も順位も無し。前の月の輪の sha256 を持ち、月の一覧の sha256 を Bitcoin に錨打ちします。Python の生成器と、別の人が公開済みの仕様と輪の形から書いた Node.js の生成器が、8月の8本の輪を byte 単位で一致させました(台帳 entry 34、来歴の言い過ぎを entry 36 で狭めています)。
3. **台帳**(JIDEC)。追記専用。証人の観測を1日1回束ねて OpenTimestamps で Bitcoin に打ちます。運営者にも編集できません。

エージェントカードには、この記録の在り処を指す拡張([A2A Conduct Extension v1](https://gate.horizonshield.dev/ext/conduct/v1))を書けます。「誰が金を払っているか」「第三者の記録はどこか」「観測をどこに出せばいいか」の3つの pointer で、スコアは載りません。

## 10分でやること(証人になる側)

Python 3.8 以上と [uv](https://docs.astral.sh/uv/) があれば、これだけです。`--witness-name` にあなたの名前か project 名、`--vantage` にどこから歩いたか(「自宅のラップトップ、大阪」「VPS、フランクフルト」程度で十分)。

```
uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" \
  a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit \
  --witness-name "あなたの名前" --vantage "どこから"
```

何が起きるか。エージェントカードを2回取って同じ bytes か見る。拡張の宣言が仕様の形か見る。測定対象のエンドポイントに A2A の `SendMessage` を1本、`A2A-Extensions` ヘッダ付きで送って、返事の形とヘッダの echo を見る。取った bytes の sha256 を全部記録に書く。その記録を、カード自身が指している intake に POST する。最後の行に `submitted ... http 200` と、記録の sha256 が出ます。**その sha256 が受領証**で、翌日 00:30 UTC の束ねで台帳に載り、その月の輪にあなたの名前が証人として数えられます。

`--submit` を外せば何も外に出ません(`walk_<sha12>.json` に書くだけ)。中身を読んでから出したい人はそれで。

MCP で繋ぐ agent を持っている人は、同じ物が1ツールの MCP サーバーになっています。Claude Code なら:

```
claude mcp add conduct-witness -- uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" conduct-witness-mcp
```

あとは agent に「https://mcp.horizonshield.dev を証人として歩いて。名前は X、vantage は Y」と言うだけです。歩くのは agent が動いている機械なので、vantage はあなたの物になります。

## 10秒でやること(測られる側)

自分の MCP サーバーがどう見えるか知りたいだけなら、扉を1回叩けば済みます。

```
curl -s -X POST https://gate.horizonshield.dev/check -H 'content-type: application/json' -d '{"endpoint":"https://あなたのサーバー/mcp"}' | python3 -m json.tool | head -40
```

登録簿に載せたければ `POST /watch`。載せた瞬間から扉が測り、あなたが書いていない記録が1行できます。載せたくなければ、origin の `/.well-known/mcp-conduct.json` に `"listing": "decline"` と書いてください。扉はそれを守ります(断った事実だけが残ります)。

## 梯子

10分: 証人として walk を1回出す。1時間: 自分のカードに拡張を宣言する(扉の `/check` が形を見てくれます)。1日: 自分で扉か台帳を立てて、互いの root を錨打ちし合う。毎月: 輪の一覧の sha に自分の鍵で副署する(証人会、設計中。席は書いた記録の数で決まり、買えません)。

上の段に行くほど、その人が消えても記録が残る形にしてあります。消える有志を責めない設計が、有志を集める設計だと思っています。

## これは何ではないか

品質は測りません。カードの `compensation` が本当かどうかも分かりません(形の不備と、宣言と実測の食い違いと、証人同士の食い違いだけを記録します)。PASS は1つの観測で、判定ではありません。FAIL も PASS と同じ形で残ります。一度出した観測は、あなたにも取り下げられません。それが、あなたが差し出している性質そのものです。

嘘を見抜く技術ではありません。食い違いを永久に残す技術です。嘘をつく側は、食い違いを消せません。

## 先行研究と、隣にいる人たち

部品は全部既存です。Certificate Transparency、Rekor、in-toto、SCITT、OpenTimestamps、RFC 8785。仕様の9節に、ERC-8004、A2A の discussion #1631、Sigstore で署名したエージェントカードとの違いを書いてあります。世界で現物として一番近いのは Agenstry(A2A エージェントを毎週再測定して Merkle root を出している観測所)で、あちらは規模と身元検証、こちらは証人と外部の錨と無採点。競合というより、証人1号として口説きたい相手です。

## 反証の仕方

全部の判定に sha256 が付いています。台帳の entry の bytes を取って自分で sha256 を計算し、`.ots` を OpenTimestamps で検証してください。輪は `scripts/make_ring.py --verify` で履歴から作り直せます。扉のソースは公開で、赤組 82 本と時刻座標の赤組 40 本が同梱です。違う結果が出たら、それ自体が記録になります。仕様の10節に書いたとおり、フォークも別実装も、断らずにどうぞ。

- 扉: https://gate.horizonshield.dev/spec
- 登録簿: https://github.com/ogasurfproject-jpg/mcp-conduct-register
- 台帳: https://ledger.horizonshield.dev/ledger
- 仕様: https://gate.horizonshield.dev/ext/conduct/v1
- 証人の道具: https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/a2a-conduct-walk
