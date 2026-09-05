# A2A Conduct Extension v1 の実装(2026-09-06 未明)。TOshi の手順書

番人が書いたのはファイルとローカル検証だけ。commit / push / deploy / DM は全部 TOshi の手。
順番どおりに。コードブロックはコマンドだけ、1 回に 1 つ。

## 0. 何を作ったか(1 分で)

A2A 1.0 の正規の拡張として **conduct-v1** を定義した。URI = 識別子 = `https://gate.horizonshield.dev/ext/conduct/v1`(扉が仕様を配る)。

card の `capabilities.extensions[]` に 1 本置く。中身は「誰が払うか(compensation、扉の条件 3 と同じ 5 鍵)」「測られとる endpoint」「第三者が書いた行儀の記録の URL(扉の /history)」「繋いだ相手が自分の観測を出す口(台帳の /witness)」。点数も判定も無い。

要求に `A2A-Extensions: <URI>` が付いとれば、応答ヘッダで echo して Message / Task の metadata に指し先 3 つを載せる。

繋いだ client が証人になる道 = `a2a_conduct_walk.py`。card を 2 回読んでバイト一致を見て、拡張と compensation の形を確かめ、測られとる endpoint に 1 発投げて、jidec-path-v1 の記録を作って `/witness` に出す。make_ring.py がその endpoint の輪に数える(自己検証で確認済)。

扉は 0.3.2 で条件 3 を **両方の場所** から読む(top-level と extension。両方あれば 5 鍵一致必須、食い違えば落ちる)。判定の他の規則は 0.3.0 のまま。

## 1. 番人が勝手に決めた 5 点(気に入らんなら今言うてくれ、push 前なら全部戻せる)

1. **URI は gate.horizonshield.dev**。扉が読む物やから扉が配る。w3id.org の永続 ID は後で「ここへ転送する便宜」として足せる(識別子は増やさん)。
2. **両方あれば厳密一致**(省略した鍵は null、0 とは一致せん)。二つの申告を持つ card は、旧読者と新読者に別の顔を見せられる。それを潰す。
3. **walk の verdict は `ok` と `outcome` の両方を持つ**。make_ring.py は `ok`/`result` を読み、JIDEC_PATH_SPEC_v1 は `outcome` と書いとる。どっちか片方だけの記録は二つの読者に別々に読まれる(縫い目、7 章)。
4. **拡張は required: false 固定**。A2A の指針(data-only は required にしない)どおり。required: true の宣言は walk が落とす。
5. **自社の walk は出さん**。輪は `witness.name` の異なりで数えるだけで、独立性は測れん。運営者が自分の endpoint を歩いて出すと「証人 1 人」の但し書きが消えるが、独立した 2 人目ではない。最初に出すのは Federico。

## 2. ローカル検証(番人が回した結果。TOshi が回し直すなら)

```
cd ~/horizon-shield/workers/hs-verify-gate && node test/redteam_gate.mjs
```

期待: 74 / 74(0.3.1 は 63 本。今日 11 本足した。0.3.1 に当てると 8 本噛む = 66 / 74)。

```
cd ~/horizon-shield/workers/hs-verify-gate && node test/redteam_instant.mjs
```

期待: 26 / 26。

```
cd ~/horizon-shield/workers/hs-verify-gate && node test/watch_decline.mjs
```

期待: 29 / 29。

```
cd ~/horizon-shield/workers/hs-ledger && node test/ledger.test.mjs
```

期待: ALL PASS(PASS 行 53、今日 7 本足した)。

```
cd ~/horizon-shield/workers/hs-ledger && node test/mcp.test.mjs
```

期待: ALL PASS(PASS 行 20、今日 2 本足した)。

```
cd ~/horizon-shield/workers/hs-mcp && node test/work_match.test.mjs
```

期待: ALL PASS。

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/a2a-conduct-walk && python3 walk_selftest.py
```

期待: 17 / 17(正直な agent だけ PASS、崩れた agent は落ちる assertion を名指し、台帳の受理規則と make_ring の数え方に合う)。

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/ring-v1 && python3 ring_redteam.py
```

期待: 25 / 25(触っとらん。変わっとらんことの確認)。

## 3. commit(TOshi)

変えた・作ったファイル(sha256 先頭 16 桁は番人が Mac で取った値):

- `workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md`(新規、687c56e32e80e308、11,363 bytes。扉が同じ文を配る)
- `workers/hs-verify-gate/src/worker.js`(0.3.2、e7df07d5f482a2d1)
- `workers/hs-verify-gate/test/redteam_gate.mjs`(74 本、5296b2534142cc91)
- `workers/hs-mcp/src/mcp.js`(card 宣言 + echo + metadata + SendMessage 別名、9ad25fbacaac0312)
- `workers/hs-ledger/src/worker.js`(card 宣言 + /a2a echo + metadata + SendMessage 別名、d89e509c5f34eb30)
- `workers/hs-jidec-mcp/src/worker.js`(card 宣言、6a2640e08ab5c67a)
- `workers/hs-ledger/test/ledger.test.mjs`(185d277bd9a93d7f)、`workers/hs-ledger/test/mcp.test.mjs`(805c7378eef1bc41)
- `workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py`(新規、f95fdcddda3e6558)、`walk_selftest.py`(新規、d0afe84c4b2da1b7)
- `llms.txt`(A2A 節に 1 行、538cea7910d45bae)
- `ops/a2a_conduct_ext_20260906.md`(この手順書)、`ops/fed_dm_conduct_ext_20260906.txt`(DM 文)
- 別リポ `~/mcp-conduct-register/README.md`(Get listed の下に 1 節、2d4356fa55e6d02b)

commit されん物(意図): `*.20260906-a2a.bak`(gitignore の `*.bak`)、root の `patch_a2a_conduct_*.py` 3 本(root 直下 *.py は gitignore)、`__pycache__`。

**番人が触っとらん変更が作業ツリーにある**: `ops/fed_reply_adapter_20260906.txt`(M、00:41 JST、別セッションの Federico 返信下書き。semantic-abi の slot の件)。下の add には入れとらん。そっちのセッションで扱うこと。git log には bc0ec786 / f8a3f719(00:38〜00:39 JST、Federico の 4.2 節・6 節の merge と house style)が既に入っとる = v35 の 17 章の質問 (a) の半分は答えが出とる。

```
cd ~/horizon-shield && git add workers/hs-verify-gate/ext/CONDUCT_EXT_v1.md workers/hs-verify-gate/src/worker.js workers/hs-verify-gate/test/redteam_gate.mjs workers/hs-mcp/src/mcp.js workers/hs-ledger/src/worker.js workers/hs-jidec-mcp/src/worker.js workers/hs-ledger/test/ledger.test.mjs workers/hs-ledger/test/mcp.test.mjs workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py workers/hs-ledger/nenrin/a2a-conduct-walk/walk_selftest.py llms.txt ops/a2a_conduct_ext_20260906.md ops/fed_dm_conduct_ext_20260906.txt
```

```
cd ~/horizon-shield && git commit -m "A2A Conduct Extension v1: gate 0.3.2 reads compensation from capabilities.extensions too, serves the spec at the URI; KIRA, JIDEC ledger and jidec-mcp cards declare it, echo A2A-Extensions and carry conduct pointers in metadata; a2a_conduct_walk.py witness client with offline red team 17/17; gate red team 74/74"
```

pagecheck は走らん(paths に workers/ と llms.txt は無い)。push は TOshi の手。

register 側:

```
cd ~/mcp-conduct-register && git add README.md && git commit -m "README: point your agent card at your row (A2A Conduct Extension v1)"
```

## 4. deploy(TOshi、この順)

扉が先。card が指す URI が先に生きとる方が筋が通る。旧扉でも新 card は通る(top-level の compensation は残しとる)から、順が前後しても壊れはせん。

```
cd ~/horizon-shield && bash workers/hs-verify-gate/deploy_gate.sh
```

(未 commit やと拒否される設計。commit してから。)

```
cd ~/horizon-shield/workers/hs-verify-gate && node test/redteam_gate.mjs --live-own
```

期待: 自社 7 本が想定どおり(同意済み = verified / p001 = pending)。compensation_disclosure の detail.location は当面 `top_level`(hearing / web / p001 / p002 / femtech はまだ拡張を宣言しとらん)、mcp と jidec は配備後 `both`。

```
cd ~/horizon-shield/workers/hs-mcp && npx wrangler deploy
```

```
cd ~/horizon-shield/workers/hs-ledger && npx wrangler deploy
```

```
cd ~/horizon-shield/workers/hs-jidec-mcp && npx wrangler deploy
```

## 5. 配備後の確認(TOshi の端末。URL は ?cb= 付き)

```
curl -s "https://gate.horizonshield.dev/health?cb=$(date +%s)"
```

期待: gate_version 0.3.2。

```
curl -s -H "Accept: text/markdown" "https://gate.horizonshield.dev/ext/conduct/v1?cb=$(date +%s)" | shasum -a 256
```

期待: `687c56e32e80e308b2641d1e7b4c151810325fac98f5178e58a3931ddfdcc775`(リポの CONDUCT_EXT_v1.md と同じバイト)。

```
curl -s "https://gate.horizonshield.dev/ext/conduct/v1?cb=$(date +%s)" | python3 -c "import json,sys; j=json.load(sys.stdin); print(j['uri'], j['spec_markdown_sha256'], j['gate_version'])"
```

```
curl -s "https://mcp.horizonshield.dev/.well-known/agent-card.json?cb=$(date +%s)" | python3 -c "import json,sys; j=json.load(sys.stdin); e=j['capabilities']['extensions'][0]; print(e['uri'], e['params']['measured_endpoints'], e['params']['conduct_record'])"
```

最初の実地 walk(出さん。見るだけ):

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/a2a-conduct-walk && python3 a2a_conduct_walk.py --origin https://mcp.horizonshield.dev --mode a2a --witness-name "operator self-check, not a witness" --vantage "hiratsuka" --out /tmp/walk_mcp.json
```

期待: PASS 5/5(card_bytes_stable / conduct_ext_declared / compensation_well_formed / measured_endpoint_answered / extension_echoed)。`--submit` は付けん(1 章の 5)。gate と ledger も同じ形で:

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/a2a-conduct-walk && python3 a2a_conduct_walk.py --origin https://gate.horizonshield.dev --mode mcp --witness-name "operator self-check, not a witness" --vantage "hiratsuka" --out /tmp/walk_gate.json
```

期待: PASS 4/4、extension_echoed は n/a(MCP initialize には echo の義務が無い)。

```
cd ~/horizon-shield/workers/hs-ledger/nenrin/a2a-conduct-walk && python3 a2a_conduct_walk.py --origin https://ledger.horizonshield.dev --endpoint https://ledger.horizonshield.dev/a2a --mode a2a --witness-name "operator self-check, not a witness" --vantage "hiratsuka" --out /tmp/walk_ledger.json
```

期待: PASS 5/5(ledger の A2A は /a2a。measured_endpoints は jidec.horizonshield.dev/mcp を指しとるので --endpoint で /a2a を名指し)。

## 6. Federico への DM(配備後。`ops/fed_dm_conduct_ext_20260906.txt`、英語、ダッシュ無し)

頼むこと 3 つ: (1) 彼の VPS から walk を回して出す(9 月の mcp の輪の証人 2 人目、entry 34 の時と同じ「まず bytes」)、(2) invinoveritas の card に拡張を宣言する(公式レジストリ上の最初の外部の宣言。彼の card には pricing 欄が既にある)、(3) 「二つの申告は一致必須」と echo の規則を攻める。

## 7. 今日見つけた縫い目(直しとらん。記録だけ)

1. `make_ring.py` の discrepancy 判定は `verdict.ok` / `verdict.result` を読み、`JIDEC_PATH_SPEC_v1.md` の例は `verdict.outcome` を書いとる。`outcome: "FAIL"` だけの記録は輪で discrepancy に数えられん。walk は両方持たせて回避。直すなら make_ring.py と make_ring.js の両方(9 月の blind 再実行の後に。途中で builder を変えると事前登録が濁る)。
2. 輪の `witnesses` は `witness.name` の異なりで数える。名前が違う = 独立ではない。運営者の自己 walk を出せば「証人 1 人」の但し書きが消えるが嘘になる。1 章の 5 の理由。
3. `workers/hs-jidec-mcp/src/worker.js` の card の `provider.organization` は "The HORIZONs株式会社"(日本語文脈にローマ字)。hs-patrol の掟で番人は触らん。直すなら TOshi の決め。
4. 扉の自分の card は `protocolVersion: "0.2.0"` のまま(ledger は 1.0.1 の形、mcp は 0.3.0)。拡張は 3 つの形どれでも `capabilities.extensions[]` で通る。card の形を揃えるのは別の決め。
5. hearing / web / p001 / p002 / femtech の 5 card はまだ拡張を宣言しとらん。宣言する型は mcp.js の `conductExtension()` をそのまま(measured_endpoints と conduct_record だけ自分の URL に)。

## 8. 次(番人案、16 章の順のまま)

1. Federico の行を登録簿に(DM 1 通、6 章)。
2. Smithery への 1 通(ops/doujin_20260904.md の A-2)。「一覧の横に conduct の欄を並べる」やなく「card に拡張があれば conduct_record へのリンクを出す」と頼む。向こうのコード変更が最小。
3. SCITT / in-toto 写像(設計 1 週間)。仕様 6 節は「方向であって納品ではない」と書いた。嘘にならんうちに着手。
4. w3id.org の永続 ID(PR 1 本、TOshi の GitHub)。
5. 仕様の錨打ち(JIDEC entry)。TOshi と Federico が読んで直してから。錨打ちした後は直せん。
