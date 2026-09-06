# HORIZON SHIELD 引き継ぎ 2026-09-06 v37 追記(A2A 第二波: 公式 SDK に通る)

v36 の末尾に貼る。v36 本文は触らん。

## 結論

09:00 頃 JST、TOshi「A2A さらに強烈にしろ」。番人は「もっと足す」やなく「本当に繋がるか」を先に測った。公式 SDK 2 本(@a2a-js/sdk 1.1.0、a2a-sdk 1.1.2)を、本物の worker のコードに、ネットワーク無しで当てた。

結果、**うちの A2A の面は公式 SDK から半分見えとらんかった。**

- JS SDK の既定設定は KIRA の card(0.3 形)から client を作れん(No compatible transport found)。
- legacyCompat を明示した JS client は繋がるが、`X-A2A-Extensions` を送る。うちは `A2A-Extensions` しか読んどらんので、拡張の有効化を黙って落とし、echo が出ん(= うちの仕様で言えば「非適合」の振る舞いを自分がしとった)。
- Python SDK は互換路で両綴りを送るので echo は出とったが、1.0 の interface は見えず。
- hs-ledger の card の `supportedInterfaces[0].transport` は 1.0 の鍵名(`protocolBinding`)やなく、公式 SDK は interface を選べん。/a2a は 1.0 形の part(`kind` 無し)を invalid params で弾く。
- hs-jidec-mcp と扉の card の `url` は A2A を喋らん場所を指しとった。

第一波(昨夜)は「宣言と echo」を入れた。第二波は「公式 SDK で両線が通る」まで持って行った。数で言うと JS 18 項目中 14 落ち → 0、Python 4 落ち → 0、4 worker 全部。

## 変えた物(patch 1 本、15 ファイル、判定規則は不変)

`ops/a2a_wave2_20260906.patch`(sha256 8131895c96bcb20984e759741cd52aa4a6598cd2518564f49cc88e49a496b9d0)。素の main に `git apply --check` が通ることを番人の側で確認済。

1. **拡張ヘッダの両綴り**: `A2A-Extensions`(1.0)と `X-A2A-Extensions`(0.3)を両方読む。echo は常に `A2A-Extensions`、要求が X- 綴りならその綴りでも返す(0.3 client は自分が送った綴りしか読まん)。
2. **線の版は method 名**: `SendMessage` = 1.0、`message/send` = 0.3、決まらんときは `A2A-Version`、それも無ければ 0.3。1.0 の result は `{task}` か `{message}`、`TASK_STATE_*` / `ROLE_*`、part は `kind` 無し(鍵名で判別)。0.3 は従来の形のまま。中身は 0.3 形で組んで出口で写す(handleA2A は無改造)。
3. **`Message.extensions`**: 拡張が有効なら metadata の 3 鍵に加え、A2A 本体の欄 `extensions` に URI を入れる(Task なら status.message に)。
4. **card の同居**: `supportedInterfaces: [1.0, 0.3]`(`protocolBinding: "JSONRPC"`)を先頭に、0.3 の `url` / `preferredTransport` / `protocolVersion: "0.3.0"` も残す。公式 SDK 2 本とも supportedInterfaces があればそれを 1.0 として読み、0.3 鍵を無視する(実測)。0.3 だけの読者は url を読む。4 card(mcp / gate / ledger / jidec)全部。
5. **hs-jidec-mcp に `/a2a`**: text part の引用を jidec_cite に渡して Message で返す。引用が無ければ使い方の Message(エラーにせん)。card の url を /a2a に。
6. **扉に `/a2a`(0.3.3)**: text の https URL の register の読み(GET /is-verified と同じ bytes)を Message で返す。URL 無しは使い方、KV 無しは -32000「NOT 'not verified'」。扉自身の card も同居形、defaultInputModes を媒体型に。CONFIG.version 0.3.3。
7. **仕様**: 3 節に「二つの綴り、二つの線」、4 節に walk の wire、状態行に SDK 相互運用の記述、**10 節 License and governance**(Apache 2.0、a2aproject の governance が意図した道、URI は v1 として据え置き)。`ext/LICENSE`(Apache 2.0 本文)。sha **3aa5a50d8ac323c63951bdf4b73d6fa1de6a45aa0d0a41dced4792d5f6dfafd8**(2,404 語)。扉の埋め込み定数も同じ bytes。
8. **walk client `--wire 1.0|0.3`**: 0.3 walk は `message/send` + `X-A2A-Extensions` だけを送る(0.3 client と同じ)。`measured_endpoint_answered` は線の形まで見る。`conduct_ext.wire` を記録。selftest 17 → 22(server が綴りを片方しか返さん / 形を取り違える攻め 5 手)。
9. **テスト**: `workers/hs-mcp/test/a2a_wire.test.mjs`(17)、`workers/hs-verify-gate/test/a2a_face.test.mjs`(21)、ledger.test.mjs を線の契約に書き直し(60)、**公式 SDK 相互運用 harness** `workers/hs-mcp/test/sdk_js_interop.mjs` / `sdk_py_interop.py` / `local_env.mjs` / `serve_local.mjs`(本物の worker を node:http で包み、公式 client で 1.0 / 0.3 / 有効化なしの 3 通り。module と path を引数にすれば 4 worker どれにも当たる)。

## 番人の結果(cloud、node 22.22.2、python 3.11)

red team 74/74(0.3.3)、redteam_instant 26/26、watch_decline 29/29、a2a_face 21/21、ledger 60 PASS、jidec mcp.test 20 PASS、hs-mcp a2a_wire 17/17、walk_selftest 22/22(make_ring 互換込み)、SDK JS × 4 worker ALL PASS、SDK Python × 4 worker ALL PASS。同じ harness を配備中の main に当てると JS 14 落ち / Python 4 落ち(= 直す前の実態)。work_match.test.mjs は data/souba-db.json が無くて番人側で回せん(TOshi の Mac で)。em/en/bar dash は全ファイル増えとらん。

## 配備完了(2026-09-06 昼、TOshi の端末出力で確認)

- 番人が device bridge で working tree に patch を適用(git apply、HEAD 686a7182 の上)、Mac 側でも全 suite 緑(work_match 含む、SDK JS × 4 / Python × 4 も Mac で ALL PASS)。VM の git は `.git/index.lock` を消せず残す → TOshi が rm。
- commit **45f28deb**(18 ファイル、1,678 行)push。deploy_gate.sh で GATE_COMMIT=45f28deb9ed2(Version 70b5249a)。hs-mcp(ab88e97a)/ hs-ledger(ce0ae1f4)/ hs-jidec-mcp(b612dc8f)deploy。
- 本番: 仕様 sha 3aa5a50d 一致。4 card(mcp / gate / ledger / jidec)に supportedInterfaces [1.0, 0.3] と url。
- walk --mode a2a --wire 0.3 → PASS 5/5、echo は X-A2A-Extensions(walk sha e667f3b3…)。--wire 1.0 → PASS 5/5、echo は A2A-Extensions(97b7e488…)。どっちも submit せず(自社 walk は出さん掟)。
- mcp に SendMessage(1.0)→ `['task'] TASK_STATE_COMPLETED ROLE_AGENT [uri] 3`。gate /a2a に mcp の URL → `verified True 9b98137c…`。jidec /a2a に jidec:entry:5 → `ROLE_AGENT [['text'], ['data']]`。
- --live-own 全本想定どおり(mcp / hearing / web / jidec / p002 / femtech verified、p001 pending)。
- 番人の VM から horizonshield.dev へは proxy 403(npm / pypi は通る)。本番の curl は TOshi の端末のみ。

## 貼り物 3 本、完了(2026-09-06 11:41〜11:52 JST、スクショで確認)

- **a2aproject/A2A issue #2211** "[Feat]: Extension proposal: Conduct (conduct-v1), a data-only disclosure and client-as-witness extension"(Feature、4 欄 + AI 支援の開示行、番人が本文を fetch で確認)。governance の Proposal Phase に正式に入った。次は maintainer の sponsor 待ち(反応が遅いのが常態、2 週間無反応なら Discord)。
- **#1631**: 昨夜の v1 返信(sha 910d4701、↑1)は既に載っとった(番人の fetch は 6 月までしか見えず「未貼り」と誤認、番人の間違い)。今日貼った v2 は重複になるので、短い update 文(ops/a2a_1631_update_20260906.txt: sha 3aa5a50d、9/10 節、ledger の card、公式 SDK で見つけた X- 綴りの穴、#2211 への導線)に編集で差し替え済(edited、↑1)。
- **Federico**: sha 訂正 v2 を 11:41 に LinkedIn DM で送信済(旧訂正 910d4701 はスレッドに見えん = 未送信やった。v2 は「これより前の sha は全部無視」の書き方なのでどっちでも成立)。

## TOshi の手(残り)

1. ops の新規・変更(fed v2 の差し替え版、1631 v2、1631 update、issue_conduct/ 5 本)と、引き継ぎ v36 の未 commit 分、この追記を commit + push。
2. Smithery Discord の投稿は済んだか未確認(pbcopy はしとった)。
3. #2211 と #1631 の反応を見る(週 1 で十分)。Federico の walk --submit が来たら 9 月 mcp 輪の証人 2。

## 触らんかった物(第三波の候補)

- hs-femtech-mcp(別 repo)の card: MCP だけなのに url が root。/a2a を足すか url を消すか。
- card 署名(A2A 1.0 `signatures`: JWS ES256、RFC 8785)。Workers の WebCrypto で ES256 は出来る。鍵の生成と `wrangler secret put` は TOshi の手。未知の top-level 鍵(compensation 等)を proto 経由の検証者が落とすかどうかの曖昧さがあるので、設計書を先に出す。
- SCITT / in-toto の写像(6 節は「方向であって納品ではない」のまま)。
- w3id の永続 ID、仕様の錨打ち(10 節まで読んで直してから。錨打ち後は直せん)。

## 今日の教訓(1 行)

「実装した」と「相手の道具から見える」は別。第一波は前者、第二波で後者。次に何かを「載せた」と言う前に、相手側の公式 client を本物のコードに当てる harness をまず書く。
