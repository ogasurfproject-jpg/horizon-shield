# HORIZON SHIELD 引き継ぎ 2026-09-06 未明 v36 (A2A Conduct Extension v1・扉 0.3.2・証人 walk)

**v35 の上に乗る。v35 の 1〜17 章は全部生きとる。矛盾する記述は本ファイルが正。**

作成: 2026 年 9 月 6 日 01:00 JST 頃
作成者: 番人(Cowork、Mac にリンク済み、~/horizon-shield と ~/mcp-conduct-register にアクセス済み)
引き継ぎ元: 「A2A から実装」チャット(2026-09-06 00:10〜)。TOshi の指示は「論文入った、Federico の返信待ち、A2A から実装、前のチャットの注意喚起(島になる危険)を踏まえて強烈に」。

---

## 0. 出所の申告

数字と sha は全部、番人が Mac のマウント越しに実ファイルを読み、Mac の VM(node 22 / python 3.10)で検査を走らせた結果。A2A 仕様は github.com/a2aproject/A2A の main(commit 98853be、2026-09-01)を clone して proto と docs を直接読んだ(要約器は使っとらん)。

**配備済み(2026-09-06 01:00〜01:40 JST、全部 TOshi の端末出力で確認)**: commit b810dbdc(拡張本体 13 ファイル)→ 42d8be73(walk client の UA / curl / 状態表示)→ c6810b52(台帳 /paths 並列)、全部 push 済。扉 deploy_gate.sh で GATE_COMMIT=b810dbdc3bdd(Version f375762d)、hs-mcp(c1ca3474)、hs-ledger(cb1ec963 → /paths 並列で 2d2fb620)、hs-jidec-mcp(ced1ef94)。register README c453ba2 push 済。本番: /health 0.3.2 + gate_commit b810dbdc3bdd、URI の markdown sha = 687c56e3…(リポと同じバイト)、KIRA の card に宣言、walk は mcp PASS 5/5(sha dff2d9ed…)と gate PASS 4/4(sha 63bee800…)、--live-own 全本想定どおり(jidec も verified に戻った)。**Federico への拡張 DM は 01:5x に送信済み**(sha 687c56e3… を書いた版)。

**02:10〜02:20 JST 追記(TOshi の端末出力で確認)**: 仕様に 9 節「Prior art, named before anyone else has to」を追加(ERC-8004 Trustless Agents / A2A discussion #1631 の評判拡張(点数型、逆方向)/ Sigstore 署名 card / Agent Certificates(arXiv 2603.14332)を名指し、「部品は新しくない、組み合わせは 09-06 時点で見つからんかった、先例が出たらこの節に書く」)。仕様 sha は **910d47019f36fa4c08584e448fa6f2b2867b1f832923586cab56ccd2535d7741**(1,969 語、14,090 bytes)、commit 5b320eb2 push 済、扉再配備 GATE_COMMIT=5b320eb27777(Version 3dd4d510)、本番 URI の markdown sha 一致確認済。red team 74/74 変わらず。**注意: Federico に送った DM の sha(687c56e3)は 9 節を足す前の物 = commit b810dbdc のファイル。次の DM で 1 行訂正する(`ops/fed_dm_sha_correction_20260906.txt`)。** Glama への 2 行は `ops/glama_reply_20260906.txt`。Smithery の送り口: contact@smithery.ai か Discord(discord.gg/sKd9uycgH9)。Smithery は Invariant Labs の mcp-scan(安全性走査)を一覧に並べた前例があり、「第三者の信号を横に置く」は向こうの型に合う。一昨日の「[mcp-conduct] Run failed: test」は 09-04 23:03 の 0.1.0 push(Node 18 に global crypto が無い)で、23:13 の commit 6bf56d2 で直しとる(手元で `node --no-experimental-global-webcrypto --test` 17/17 で再現確認)。以後の run が緑かは TOshi の画面。 貼る物(TOshi の手、未): #1631 への返信 `ops/a2a_1631_reply_20260906.txt`(348 語)、Smithery `ops/smithery_a2_20260906.txt`(279 語、A-2 に拡張の 1 行を足した版)、Glama(Frank Fiegel)への 2 行は任意。同夜、別件で Resend の鍵失効と回転あり(詳細は記憶 hs-secrets と鍵マネージャ、本文には書かん)。

## 1. 番人が守ること(v35 の 1 章に足す)

- **worker.js の改修は root 直下の使い捨て patch(python、名指しの完全一致置換、アンカーが 1 回でなければ止まる)で当てる。** 今日の型: `patch_a2a_conduct_gate.py` / `_mcp.py` / `_ledger.py`(root *.py は gitignore)。backup は `<file>.20260906-a2a.bak`(gitignore)。
- **禁則文字の検査は「増えたか」で見る。** 既存の worker には過去のダッシュが残っとる(mcp.js 146、ledger 41、jidec-mcp 8)。番人の変更で 1 つも増やさん。新規ファイルは 0。
- **Mac の VM に node 22 がある。** 扉・ledger・mcp の harness は VM で回る(ネット無しの mock)。本番 URL には届かん。
- **自社の walk は /witness に出さん**(2 章の 5)。

## 2. 今日の結論だけ

1. **A2A Conduct Extension v1(conduct-v1)を定義・実装した。** URI = 識別子 = `https://gate.horizonshield.dev/ext/conduct/v1`。A2A 1.0 の `AgentCapabilities.extensions[]`(`AgentExtension {uri, description, required, params}`、proto で確認)に置く data-only 拡張 + 任意の要求時 echo(`A2A-Extensions` ヘッダ、1.0 で X- が取れた)。仕様本文 `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md`(11,363 bytes、sha256 687c56e32e80e308b2641d1e7b4c151810325fac98f5178e58a3931ddfdcc775)、扉が同じバイトを URI で配る(JSON 既定、`Accept: text/markdown` で本文、JSON に `spec_markdown_sha256`)。
2. **扉 0.3.2**: 条件 3 を top-level `compensation` と `capabilities.extensions[uri=...].params.compensation` の両方から読む。両方あれば 5 鍵完全一致(省略 = null、0 と不一致)、食い違えば落ちる。他の規則は 0.3.0 のまま。扉自身の card も宣言(/self は location: both で pass)。red team 63 → **74 / 74**(0.3.1 に当てると 66 / 74 = 8 本噛む)。instant 26/26、watch_decline 29/29 変わらず。
3. **hs-mcp / hs-ledger / hs-jidec-mcp の card が宣言**。hs-mcp と hs-ledger は `A2A-Extensions` を echo し、Message / Task の `metadata` に `<uri>/endpoint` `<uri>/conduct_record` `<uri>/witness_intake` の 3 つだけ載せる(時刻も点数も無し)。`SendMessage`(1.0 の名)を `message/send` の別名に。ledger.test 53 PASS(+7)、mcp.test 20 PASS(+2)、work_match ALL PASS。
4. **証人 walk の参照実装** `workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py`(stdlib のみ): card 2 回 GET → バイト一致、拡張の所在と params の形、測られとる endpoint に 1 発(MCP initialize か A2A SendMessage、`A2A-Extensions` 付き)、echo。jidec-path-v1 + witness で `--submit`。`walk_selftest.py` **17 / 17**(mock 15 手 + 決定論 + make_ring が数える/discrepancy/他人の endpoint には数えん)。ring_redteam 25/25 変わらず。
5. llms.txt に 1 行(A2A 節)、register README に 1 節(Get listed の下)。
6. 手順書 `ops/a2a_conduct_ext_20260906.md`、Federico への DM `ops/fed_dm_conduct_ext_20260906.txt`(205 語、ASCII、ダッシュ無し)。
7. **島にならん設計**: 仕様 6 節に in-toto Statement v1 / SCITT への写像を「方向であって納品ではない」と明記。単位は輪のファイル(sha256 = 識別)。正準形は NENRIN v1 の縫い目(言語ランタイム参照)を継承、次版で RFC 8785 と書いた。

## 3. 番人が決めた 5 点(TOshi が蹴れる。手順書 1 章と同じ)

URI は扉のドメイン / 両方あれば厳密一致 / walk の verdict は `ok` と `outcome` の両持ち / required: false 固定 / 自社 walk は出さん。

## 4. 縫い目(見つけたが直しとらん)

1. make_ring.py の discrepancy 判定は `verdict.ok`/`result`、JIDEC_PATH_SPEC_v1 の例は `verdict.outcome`。片方だけの記録は輪で読み違う。**9 月の blind 再実行の後**に make_ring.py と make_ring.js を両方直す(途中で builder を変えると論文 8 節の事前登録が濁る)。
2. 輪の witnesses は名前の異なり。独立性は測っとらん。
3. hs-jidec-mcp の card `provider.organization` が日本語文脈でローマ字。hs-patrol の掟で番人は触らん。
4. card の形が 3 種(扉 0.2.0 / mcp 0.3.0 / ledger 1.0.1)。拡張はどれでも通る。揃えるのは別の決め。
5. hearing / web / p001 / p002 の 4 card(horizon-shield)と femtech(別リポ ~/hs-femtech-mcp)の card に **02:30 JST 宣言を入れた(未 commit / 未 deploy、TOshi の手)**。型は `conductExtension(measuredEndpoint, compensation)`、top-level の compensation は同じ定数を参照。hearing の 6 テスト・femtech harness 34 green・4 card を walk client の locate_extension で検証 problems none。これで 9 本全部が宣言済みになる(配備後)。femtech リポは .gitignore に *.bak が無いので `src/worker.js.20260906-a2a.bak` を add せんこと。
6. ledger の A2A 面(ledger.horizonshield.dev/a2a)を歩いた walk は jidec.horizonshield.dev/mcp の輪には数えられん(host が違う。make_ring の witness_covers は origin 一致)。仕様どおりの挙動、但し書きだけ。
7. **直した古い穴(今日の変更とは別)**: 台帳 `/paths` が entry を seq 本(35)直列に KV get しとって 10 秒に届き、扉の determinism 計測(jidec_cite / jidec_replay は空引数で error = 測定にならん、3 本目 jidec_list_paths が timeout)で登録簿の jidec 行が **09-04 から pending** やった。並列読み(天井 400、読む範囲は同じ)に変えて旧版と mock KV でバイト一致確認、本番 /paths 1.2 秒、--live-own で jidec verified。登録簿の行は 18:00Z の掃引で緑に戻る(README は 18:40Z の Rebuild)。
8. walk client の落ち度: Python urllib の既定 UA を Cloudflare が 403 で弾き、最初の実地 walk は 0/5 やった(本番は正常)。名乗る UA を付けたら通った。`--transport curl` も足した。

## 5. 未確認(v35 の 17 章の 3 問はそのまま)

(a) の半分は git log が答えとる: **Federico の 4.2 節・6 節・Table 3 は merge 済み**(18862488 = 彼の branch nenrin-paper-sections-4.2-6、bc0ec786 merge、f8a3f719 house style、2026-09-06 00:38〜00:39 JST)。別セッションの下書き `ops/fed_reply_adapter_20260906.txt`(作業ツリーで M、番人は触っとらん)の 1 行目は「Email received, and it goes to SSRN and nowhere else」= SSRN 用メールも届いた模様(下書きの記述であって TOshi の確認ではない)。同じ下書きに semantic-abi の「slot / protected relation」の話がある = 並行して別の糸が動いとる。**このチャットの番人はそこに触らん。** 残る未確認: LinkedIn 投稿を出したか、(b) pagecheck 642464c1 / 39c06320 のメールは緑か、(c) entry 35 は 09:30 JST に入ったか。**それ以外の「送ったか」は聞かん。** 今日の分は「commit / push / deploy をしたか」だけを 1 回聞く。

## 6. 新しいチャットで最初にやること

1. v35 の 1 章と本ファイルの 1 章を守ると声に出す。
2. 5 章の 3 問。配備は済んどる(0 章)、聞き直さん。
3. 登録簿の jidec 行が 18:00Z の掃引で verified に戻ったか(gate.horizonshield.dev/register か README の Rebuild 後)。
4. 論文の糸は別チャット(v35 の 9.1 と 5 章)。拡張の DM(ops/fed_dm_conduct_ext_20260906.txt)は URI が生きとるので出せる。出すかは TOshi の判断、未送信。
5. 次の手: 貼る物 3 本(#1631 / Smithery / Glama)の結果を受ける → Federico の行(invinoveritas の card 宣言 + walk 提出)→ SCITT 写像の設計 → w3id → 仕様の錨打ち(9 節込みで読んで直してから。錨打ち後は直せん)。

## 7. 今日作った・変えたファイル(sha256 先頭 16 桁、Mac で取得)

horizon-shield(commit 済 b810dbdc / 42d8be73 / c6810b52): `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md` 687c56e32e80e308 / `workers/hs-verify-gate/src/worker.js` e7df07d5f482a2d1 / `workers/hs-verify-gate/test/redteam_gate.mjs` 5296b2534142cc91 / `workers/hs-mcp/src/mcp.js` 9ad25fbacaac0312 / `workers/hs-ledger/src/worker.js` d89e509c5f34eb30 / `workers/hs-jidec-mcp/src/worker.js` 6a2640e08ab5c67a / `workers/hs-ledger/test/ledger.test.mjs` 185d277bd9a93d7f / `workers/hs-ledger/test/mcp.test.mjs` 805c7378eef1bc41 / `workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py` f95fdcddda3e6558 / `walk_selftest.py` d0afe84c4b2da1b7 / `llms.txt` 538cea7910d45bae / `ops/a2a_conduct_ext_20260906.md` / `ops/fed_dm_conduct_ext_20260906.txt` / 本ファイル。
mcp-conduct-register(commit 済 c453ba2): `README.md` 2d4356fa55e6d02b。追加: `workers/hs-ledger/src/worker.js` は /paths 並列で 204c70e09ab80e1e(c6810b52)、`a2a_conduct_walk.py` は ab2bde754f4afe88(42d8be73)。backup `src/worker.js.20260906-paths.bak` も gitignore。
gitignore で消えとる物(意図): `*.20260906-a2a.bak` 4 本、root の `patch_a2a_conduct_{gate,mcp,ledger}.py`、`__pycache__`。

## 8. 用語(v35 の 15 章に足す)

- **conduct-v1 / 拡張**: A2A Conduct Extension v1。card の `capabilities.extensions[]` の 1 本。URI が識別子。
- **echo**: 要求ヘッダ `A2A-Extensions` に URI があれば、応答ヘッダに同じ URI を返し、metadata に指し先 3 つを載せること。
- **walk / a2a-conduct-walk-v1**: 仕様 4 節の証人 walk。jidec-path-v1 の記録、`purpose` が `a2a-conduct-walk-v1: <endpoint>`。
- **location**: 扉 0.3.2 の条件 3 detail。`top_level` / `extension` / `both`。
- **AgentExtension**: A2A 1.0 proto の `{uri, description, required, params}`。`metadata` やない(要約器はそう言うた、proto は params)。
