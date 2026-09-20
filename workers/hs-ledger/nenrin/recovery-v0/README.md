# recovery-v0: TSUGI (継、proof of recovery。v2 籤、python/node 双子)

HORIZON SHIELD 第2の柱 TSUGI (継)。検証の次に置く、回復を証明する層。金継ぎの継: 破断を隠さず、継いだ跡を証明として残す。旧称 Proof-of-Recovery (2026-09-20 に短縮。記録の型名 nenrin-*-v1 と directory 名は動かさん。アンカー済みの bytes を変えんため)。

設計書 (Claude Docs「TSUGI (継) 設計書」) の v2。記録の型、それを採点する物、Class 1 の証人、Policy Gate (運営者署名による許可)、そして籤 (見知らぬ証人を再計算できる乱数で引く)。診断と提案を書く側 (Shield エージェント) はこの公開ツリーには置かん (別 repo)。

## 何が在るか

| file | 名乗り | 中身 |
|---|---|---|
| recovery_schema.mjs | library | 5 記録の型 (drift / proposal / authorization / execution / verify) + 埋め込み観測 1 種 (witness-observation)、カタログ 5 プリミティブ、型検査 |
| recovery_verify.mjs | library | 1 記録と連鎖の検証器 (0.3.0)。canonical は agreement_canonical.canonicalUtf8 をそのまま使う。sha256 と Ed25519 は WebCrypto。v2: 籤の再計算と定足数 |
| witness_draw.mjs | library (CLI) | 籤。beacon (Bitcoin ブロック hash) + 池の hash + 対象記録の hash から、決定的な Fisher-Yates で k 人引く。誰でも再計算できる |
| witness_request.mjs | library | 引いた証人への依頼 (目隠し: 期待値を渡さん) と、返った観測の受け入れ (conduct-v1.1 11.4 の規則そのまま) |
| witness_fixture_build.mjs | library | 今週の事故の再検証を籤で回した形の fixture を焼く。鍵は seed から (決定的)。beacon は Bitcoin やない、と記録が自分で言う |
| witness_fixture_20260920.json | 表 | 池 6 (証人 5 + 自分)、籤で 3 人、2 人が署名付きで答え 1 人は答えず。手で触らん |
| witness_kuji_test.mjs | suite | 籤が再計算できる、fixture が byte 一致、変異 (drawn 改竄、別の池、別の beacon、引かれとらん証人、鍵違い、別の依頼、自分自身) が全部落ちる、依頼と受け入れ |
| witness_pool.json | 表 | 本番の池。今は空。入る条件は下の「籤」を見る |
| recovery_fixture_build.mjs | library | 今週の事故 (生 deploy → 署名不一致 + challenge 消失 → 外部証人 → 切り分け → redeploy_pinned → verify TRUE) を 7 記録に焼く |
| recovery_fixture_20260920.json | 表 | 上が書いた 7 記録。hash と prev はコードが計算した物。手で触らん |
| recovery_verify_test.mjs | suite | fixture が通る、rebuild が byte 一致、変異 24 件が全部落ちる |
| drift_witness.mjs | library (network) | Class 1 の 7 表面を測って drift-record を JSONL で書く。手で回す |
| authorize.mjs | library (CLI, 鍵) | Policy Gate。人間が提案に Ed25519 で署名して authorization-v1 を作る。鍵は file、repo の外 |
| recovery_verify.py | library | 検証器の python 側。canonical は json.dumps(ensure_ascii=False, sort_keys=True, separators=(",",":"))。合意層と同じ作法 |
| recovery_twin_test.py | suite | 双子の採点。fixture の 7 記録が python と node で byte 一致、python 署名を node が検証 (cross-language)、python の籤が node と同じ k 人を出す |
| baseline_20260920.jsonl | 表 | 直った扉に対する証人の最初の走り。7 表面、0 drift。v1 の「前回」 |
| run_all.mjs | runner | agreement-v0 と同じ物。名乗っとらん file が 1 つでも有れば断る |

## 回し方

    node run_all.mjs                                   # 採点 (node と python の suite を両方回す)
    node recovery_fixture_build.mjs                    # fixture を書き直す (中身を変えた時だけ。変えたら test が byte 一致で止める)
    node drift_witness.mjs https://gate.horizonshield.dev --expect-commit <sha> --expect-canonical <hex> --repo <repo> --out drift.jsonl
    node witness_draw.mjs --pool witness_pool.json --subject <execution の record_sha256> --k 3 --after 2026-09-20T08:02:00Z --exclude-host gate.horizonshield.dev

drift_witness は drift が 1 つでも有れば exit 1。cron に置く時はそれで人を呼ぶ。witness_draw は --after で「その時刻以後に最初に採掘された Bitcoin ブロック」を beacon に取る (mempool.space、予備 blockstream.info)。手元で beacon を持っとるなら --beacon <hash> --height N。

## 診断と提案を書く側

記録を読んで切り分け、カタログから 1 つ提案する側 (Shield エージェント) は、この公開ツリーには置かん。ここに在るのは、誰でも再計算できる側だけや: 記録の型、検証器、証人、fixture、基準線。提案が出たら、それもこの検証器で採点され、連鎖に乗る。提案を書いた物が何であれ、記録は同じ規律で読まれる。

## Policy Gate (v1)

許可は文字列やない、署名や。`authorize.mjs` が運営者の Ed25519 鍵で提案の hash に署名して authorization-v1 を作る。検証器を `verifyChain(records, { operatorKeys: [運営者の公開鍵] })` で strict モードにすると、人間承認プリミティブ (redeploy_pinned / resign_agent_card / revert / rotate) の実行は、その許可が運営者鍵で署名され、鍵が信用集合に在り、期限内であることを要求する。署名の無い許可 (authorization_unsigned)、信用してない鍵 (authorization_untrusted_key)、期限切れ (authorization_expired) は弾く。隔離 (quarantine_endpoint、auto 承認) は署名を要さん。

鍵の作り方 (一度だけ、repo の外に):

    openssl genpkey -algorithm ed25519 -out ~/.hs_operator_key.pem && chmod 600 ~/.hs_operator_key.pem
    node authorize.mjs --pub ~/.hs_operator_key.pem      # 検証器に渡す信用アンカー (公開してよい)

運営者の秘密鍵はこの Worker にも repo にも無い。署名は手元でやる。card-sign と同じ掟や。

信用アンカーの配り方 (扉 0.4.8): `GET https://gate.horizonshield.dev/keys/operator.json` が運営者の公開鍵を返す (agreement.json / witness.json と同じ規律、未設定は 404)。読む側は `fetchOperatorKeys(origin)` (node) / `fetch_operator_keys(origin)` (python) で取って strict モードに渡す。証人も `keys.operator` を 8 表面目として測る。

## 籤 (v2): 見知らぬ証人をランダムに呼ぶ、を再計算できる形で

Shield は再検証の証人を自分で選ばん。公開の池 (witness_pool.json) から、公開の乱数で引く。

- 池に入る条件 (conduct-v1.1 の 11.4 と 11.6 そのまま、新しい規則は無い): agent card が conduct-v1 を宣言し、key_url で domain-bound の Ed25519 鍵を配り、witness_policy.reciprocal: true を宣言し、自分の origin と host が違う。条件を満たす card は全部入る。運営者が選り好みせん。池の hash (pool_sha256) を記録に焼くので、後から入れ替えたら見える。
- 籤: seed = sha256(beacon_hash | pool_sha256 | subject_sha256)。beacon は対象記録より後に最初に採掘された Bitcoin ブロックの hash (JIDEC が既に Bitcoin にアンカーしとるので新しい依存やない)。subject は籤が仕える記録 (再検証なら execution) の record_sha256。池を鍵の順に並べ、seed から決定的な Fisher-Yates で k 人。誰でも同じ 3 入力から同じ k 人を出せる。出せんかったら検証器が draw_mismatch で断る。
- 依頼は目隠し: 「この origin のこの 8 表面を測って署名して返せ」だけ。期待値は渡さん。依頼の hash を記録に焼く。
- 受け取るのは観測だけ (nenrin-witness-observation-v1)。指示の欄は無い。証人が何を書いても Shield は動かん。観測は verify.external[].record に丸ごと埋め込まれ、検証器が署名 (証人の domain 鍵)、引かれとるか、池の鍵か、同じ依頼か、自分自身やないか、を見て、expected_after を observed が含む証人を一 domain 一票で数える。
- 定足数: `verifyChain(records, { witnessQuorum: { q, pool, beaconHash } })`。recovered:true に q 人の一致を要求する。足りんかったら witness_quorum_short。食い違う証人は両方残る (disagreeing に出る)。答えん証人は answered:false で残る (数えん、隠さん)。
- 籤が消すもの: 「運営者が証人を選んだ」「証人が事前に買収されとった」。消さんもの: 署名した嘘つき (11.10 と同じ)、池を domain で埋める Sybil (加入は ring に walked_as_witness の実績が要る、期間は ADR)。籤が作るのは「誰が呼ばれたかを Shield が決めてへん」だけ。

7 月の OpenAI / Hugging Face の事件で根本原因に挙がった「他エージェントの指示を検証せずに受け入れる」への手当は、この形そのもの: 見知らぬエージェントから受け取るのは署名付きの観測だけで、その中身は hash を比べる以外に使わん。Shield エージェントの LLM の prompt には外部証人の文字列を一文字も入れん (buildPrompt が拒否する)。

今日の池は空や。空なら籤は引けず、定足数は does_not_establish (witness_quorum_short) になる。それでええ。仕組みは池が育っても変わらん。v0 の fixture (今週の実事故) を定足数付きで回すと witness_quorum_short になる = 今週の再検証は籤を引いとらん、を記録が自分で言う。

## v0 の約束

- 記録に JSON の数は入れん。数は文字列 ("43")。agreement_canonical.mjs の頭に書いてある int / float の継ぎ目を、v0 は踏まん。検証器は数が有れば number_in_record で断る。v1 で RFC 8785 か parseStrict を採る。
- hash は record_sha256 と署名 2 欄 (signature_ed25519_b64, public_key_ed25519_b64) を除いた canonical bytes に対して取る。署名の欄名は witness intake と同じ。
- drift は区間の頭で prev が null。proposal.prev は最後の drift、以降は直前。authorization.prev = proposal_sha256、execution.prev = authorization_sha256、verify.prev = execution_sha256。型検査と連鎖検査の両方で見る。
- 拒否されとる実行 (decision: refused の後の execution)、カタログ外のプリミティブ、提案と違うプリミティブの実行、許可の後で動いた expected_after、recovered:true なのに観測してへん表面、全部断る。

## まだ無い物 (v2)

- 池の中身。条件を満たす card を集める口 (register から、A2A の公開 directory から) と、こっちが呼ばれた時に測って返す側 (conduct-v1.1 11.6 reciprocal walk の参照実装)。呼ぶだけで呼ばれん者は池に入れてもらえん。
- drift_witness を worker の cron に。今は Mac から手で回す物。
- 前回 witness した状態との比較 (鍵の変化、jwks の変化)。v0 の証人は毎回の観測を書くだけで、prior state を持たん。
- 台帳 (hs-ledger) への intake と JIDEC への anchor。記録の型はそのために witness intake と同じ規律にしてある。
