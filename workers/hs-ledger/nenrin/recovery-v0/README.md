# recovery-v0: TSUGI (継、proof of recovery。v2.2 籤、python/node 双子、隔離だけを持つ手)

HORIZON SHIELD 第2の柱 TSUGI (継)。検証の次に置く、回復を証明する層。金継ぎの継: 破断を隠さず、継いだ跡を証明として残す。旧称 Proof-of-Recovery (2026-09-20 に短縮。記録の型名 nenrin-*-v1 と directory 名は動かさん。アンカー済みの bytes を変えんため)。

設計書 (Claude Docs「TSUGI (継) 設計書」) の v2.2。記録の型、それを採点する物、Class 1 の証人、Policy Gate (運営者署名による許可)、籤 (見知らぬ証人を再計算できる乱数で引く)、籤の研磨を塞ぐ錨打ち (commit-then-reveal)、そして隔離だけを持つ手 (executor)。診断と提案を書く側 (Shield エージェント) はこの公開ツリーには置かん (別 repo)。

## 何が在るか

| file | 名乗り | 中身 |
|---|---|---|
| recovery_schema.mjs | library | 5 記録の型 (drift / proposal / authorization / execution / verify) + 埋め込み観測 1 種 (witness-observation)、カタログ 5 プリミティブ、型検査 |
| recovery_verify.mjs | library | 1 記録と連鎖の検証器 (0.3.0)。canonical は agreement_canonical.canonicalUtf8 をそのまま使う。sha256 と Ed25519 は WebCrypto。v2: 籤の再計算と定足数。v2.2: 錨打ち (draw.commitment) の検査、requireCommitment / commitmentAnchor の方針 |
| witness_draw.mjs | library (CLI) | 籤。beacon (Bitcoin ブロック hash) + 池の hash + 対象記録の hash から、決定的な Fisher-Yates で k 人引く。誰でも再計算できる。v2.2: `--commit-seed` が subject を台帳に錨打ちする seed を出し、`--commit-height H` が錨の次のブロック H+1 を beacon に取って commitment を焼く |
| witness_request.mjs | library | 引いた証人への依頼 (目隠し: 期待値を渡さん) と、返った観測の受け入れ (conduct-v1.1 11.4 の規則そのまま) |
| witness_fixture_build.mjs | library | 今週の事故の再検証を籤で回した形の fixture を焼く。鍵は seed から (決定的)。beacon は Bitcoin やない、と記録が自分で言う |
| witness_fixture_20260920.json | 表 | 池 6 (証人 5 + 自分)、籤で 3 人、2 人が署名付きで答え 1 人は答えず。v2.2 で commitment 付き (錨は高さ 0、beacon は高さ 1、台帳 entry 0。Bitcoin やない、と記録が自分で言う)。手で触らん |
| witness_kuji_test.mjs | suite | 籤が再計算できる、fixture が byte 一致、変異 (drawn 改竄、別の池、別の beacon、引かれとらん証人、鍵違い、別の依頼、自分自身、commitment 無し、別の subject、beacon が錨の次やない、読む側の錨と違う) が全部落ちる、依頼と受け入れ |
| witness_pool.json | 表 | 本番の池。今は空。入る条件は下の「籤」を見る |
| incident_20260920_resign_chain.json | 表 | 実事件 2: 日次証人が見つけた card の署名切れ (version bump を 2 回、署名し直さず撒いた) を、R3 の提案 → 運営者鍵で署名した許可 → 再署名と deploy_gate.sh → 0 drift の再検証、の 12 記録に閉じた物。strict で通る。定足数を問えば正直に witness_quorum_short |
| incident_20260920_test.mjs | suite | 上の連鎖が今も再計算でき、鍵で閉じた許可として通り、籤を引いとらんことを正直に言うか |
| recovery_fixture_build.mjs | library | 今週の事故 (生 deploy → 署名不一致 + challenge 消失 → 外部証人 → 切り分け → redeploy_pinned → verify TRUE) を 7 記録に焼く |
| recovery_fixture_20260920.json | 表 | 上が書いた 7 記録。hash と prev はコードが計算した物。手で触らん |
| recovery_verify_test.mjs | suite | fixture が通る、rebuild が byte 一致、変異 24 件が全部落ちる |
| drift_witness.mjs | library (network) | Class 1 の 9 表面を測って drift-record を JSONL で書く (9 表面目 well-known.did は 0.4.12 で追加、DID の鍵集合の hash を前回と比べ did_changed / did_removed)。--baseline で前回と比べる (jwks_changed / key_changed / key_removed / public_value_changed)。measureSurfaces() を輸出 (反対側が使う)。fetch は no-store |
| witness_reply.mjs | library (CLI) | 籤の反対側 (conduct-v1.1 11.6 の参照実装)。頼まれたら測って署名して返す。answer (1 依頼) と serve (最小の A2A 面 + 鍵の口) |
| witness_pool_build.mjs | library (CLI, network) | 池を育てる口。register や候補の列から、条件 (conduct-v1 宣言、reciprocal、同 host の鍵、自分やない、--min-walked) を満たす card だけ池に入れる。落ちた候補は report に |
| witness_reply_test.mjs | suite | 両側を localhost で繋いで一周 (serve → 依頼 → 受け入れ → 検証器が数える)、池の審査を偽 fetch で、drift_witness の baseline |
| authorize.mjs | library (CLI, 鍵) | Policy Gate。人間が提案に Ed25519 で署名して authorization-v1 を作る。鍵は file、repo の外 |
| recovery_verify.py | library | 検証器の python 側 (0.3.0)。canonical は json.dumps(ensure_ascii=False, sort_keys=True, separators=(",",":"))。合意層と同じ作法。籤と commitment も同じ判定 |
| executor.mjs | library (CLI, network, token) | 手。カタログの auto プリミティブ 1 つ (quarantine_endpoint) と、その解除 (--lift) だけを持つ。扉の POST /register/quarantine を叩き、authorization / execution / verify の 3 記録を書く。人間承認の 4 つは持たん |
| executor_test.mjs | suite | 偽の扉で一周。auto の許可 (署名無し) が strict の検証器で通る、他のプリミティブは断る、token 違い、register に無い endpoint、解除 |
| recovery_twin_test.py | suite | 双子の採点。fixture の 7 記録が python と node で byte 一致、python 署名を node が検証 (cross-language)、python の籤が node と同じ k 人を出す |
| baseline_20260920.jsonl | 表 | 直った扉に対する証人の最初の走り。7 表面、0 drift。v1 の「前回」 |
| external_attestation.mjs | library (CLI, network) | 第三者の公開観測 (Agenstry の API など) の bytes を sha256 で JIDEC に錨打ちする seed を作る。相手はうちの型で署名せんので witness-observation にはせん (11.4 の witness_unsigned が正しい)。「この URL がこの時刻にこの bytes を配り、中の欄はこうやった」を運営者の hash として残す。定足数には数えん |
| run_all.mjs | runner | agreement-v0 と同じ物。名乗っとらん file が 1 つでも有れば断る。8 suite |

## 回し方

    node run_all.mjs                                   # 採点 (node と python の suite を両方回す)
    node recovery_fixture_build.mjs                    # fixture を書き直す (中身を変えた時だけ。変えたら test が byte 一致で止める)
    node drift_witness.mjs https://gate.horizonshield.dev --expect-commit <sha> --expect-canonical <hex> --repo <repo> --out drift.jsonl
    node witness_draw.mjs --commit-seed <execution の record_sha256> > seed.json                 # v2.2 (1) subject を台帳に錨打ちする seed
    zsh ../../append_witness.sh seed.json                                                   # (2) JIDEC に append (entry n)。OTS がブロック H に付くのを待つ (毎時)
    node witness_draw.mjs --pool witness_pool.json --subject <同じ hash> --k 3 --commit-height H --commit-hash <H の hash> --ledger-entry n --exclude-host gate.horizonshield.dev   # (3) beacon = H+1
    node witness_draw.mjs --pool witness_pool.json --subject <execution の record_sha256> --k 3 --after 2026-09-20T08:02:00Z --exclude-host gate.horizonshield.dev   # v2.1 の形 (錨無し。方針が requireCommitment なら draw_uncommitted)
    node executor.mjs proposal.json --endpoint https://x.example/mcp --drifts drift.jsonl         # 隔離 (auto)。--lift で解除。token は ~/.hs_sweep_token
    node ../sdk/tsugi_verify.mjs chain.json --fetch-operator-key --pool witness_pool.json --q 2 --k 3 --beacon <H+1 の hash> --require-commitment --anchor-height H --anchor-hash <H の hash>
    node witness_pool_build.mjs --register --report pool_report.json          # 扉の register の endpoint を候補に池を書き直す
    node witness_reply.mjs serve --key ~/.hs_witness_key.pem --domain <自分の host> --key-url https://<自分の host>/keys/witness.json --port 8787
    bash ../../../../ops/run_drift_witness_daily.sh                             # 日次証人 (launchd: ops/com.horizonshield.driftwitness.plist)

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
- 依頼は目隠し: 「この origin のこの 9 表面を測って署名して返せ」だけ。期待値は渡さん。依頼の hash を記録に焼く。
- 受け取るのは観測だけ (nenrin-witness-observation-v1)。指示の欄は無い。証人が何を書いても Shield は動かん。観測は verify.external[].record に丸ごと埋め込まれ、検証器が署名 (証人の domain 鍵)、引かれとるか、池の鍵か、同じ依頼か、自分自身やないか、を見て、expected_after を observed が含む証人を一 domain 一票で数える。
- 定足数: `verifyChain(records, { witnessQuorum: { q, pool, beaconHash } })`。recovered:true に q 人の一致を要求する。足りんかったら witness_quorum_short。食い違う証人は両方残る (disagreeing に出る)。答えん証人は answered:false で残る (数えん、隠さん)。
- 籤が消すもの: 「運営者が証人を選んだ」「証人が事前に買収されとった」。消さんもの: 署名した嘘つき (11.10 と同じ)、池を domain で埋める Sybil (加入は ring に walked_as_witness の実績が要る、期間は ADR)。籤が作るのは「誰が呼ばれたかを Shield が決めてへん」だけ。
- 籤の研磨、塞いだ (v2.2、commit-then-reveal): 種の 3 入力のうち subject (execution の record_sha256) は運営者が書く記録や。v2.1 までは、beacon のブロックが出た後に execution を少し変えて seal し直せば種が変わって引き直せた (研磨)。v2.2 は順序を固定する。(1) execution を seal したら、その record_sha256 を固定文 (commitmentClaimText。`--commit-seed` が seed を出す) で先に台帳 (JIDEC) に append し、OTS が Bitcoin ブロック H に錨を打つ。(2) beacon は「H の次のブロック H+1 の hash」と定める (`--commit-height H --commit-hash <hash> --ledger-entry n`。beacon は高さで取る)。(3) verify.draw.commitment に {subject_sha256, ledger_entry, ledger_url, claim_sha256, anchor{kind, height, hash}} を焼く。検証器は、commitment の subject が draw の subject か (draw_subject_mismatch)、claim_sha256 が固定文の hash か (commitment_claim_mismatch)、beacon.height が anchor.height + 1 か (beacon_not_next_block) を見る。方針で `requireCommitment: true` にすると commitment の無い籤は draw_uncommitted。読む側が台帳 entry の .ots を自分で確かめて得た {height, hash} を `commitmentAnchor` に渡すと、記録の錨と違えば commitment_mismatch。H+1 が出た時点で subject はもう変えられん (変えたら台帳の claim と合わん)。残る研磨の余地は H が出るまでの間に何度も append して都合のいい錨を選ぶ事やが、台帳の entry は全部公開で、飛んだ番号は見える。検証器が見んもの: OTS 証明そのもの (読む側の仕事。だから anchor を渡す形にしてある)。

7 月の OpenAI / Hugging Face の事件で根本原因に挙がった「他エージェントの指示を検証せずに受け入れる」への手当は、この形そのもの: 見知らぬエージェントから受け取るのは署名付きの観測だけで、その中身は hash を比べる以外に使わん。Shield エージェントの LLM の prompt には外部証人の文字列を一文字も入れん (buildPrompt が拒否する)。

今日の池は空や。空なら籤は引けず、定足数は does_not_establish (witness_quorum_short) になる。それでええ。仕組みは池が育っても変わらん。v0 の fixture (今週の実事故) を定足数付きで回すと witness_quorum_short になる = 今週の再検証は籤を引いとらん、を記録が自分で言う。

## 手 (v2.2): 隔離だけを持つ executor

`executor.mjs` は proposal を読んで動く手や。持つのはカタログの auto プリミティブ 1 つ、quarantine_endpoint (と --lift の解除、可逆) だけ。人間承認の 4 つ (redeploy_pinned / resign_agent_card / revert_to_last_witnessed_good / rotate_credential) は持たん。人の手と署名でやる (authorize.mjs と deploy_gate.sh)。扉の `POST /register/quarantine` (0.4.10、x-sweep-token) を叩き、authorization (policy:auto、期限 1 時間、署名無し。カタログが auto と言うとるので strict でも通る) → execution (before / after は register の status、steps、outcome ok / failed) → verify (recovered、external は空。籤は別の手順) の 3 記録を drift_runs/ に書く。token は --token-file (既定 ~/.hs_sweep_token) から読み、記録には書かん。隔離は「止める」であって「判定」やない、と扉の応答が自分で言う (establishes / does_not_establish)。隔離された endpoint は sweep から外れ (skipped、理由付き)、/register と lookup に quarantined が出る。解除は quarantine_lifted として残る (消さん)。

## 一枚の検証器 (nenrin-verify 0.2.0)

`../sdk/build_tsugi.mjs` が agreement_canonical + recovery_schema + witness_draw + recovery_verify を一枚 `../sdk/tsugi_verify.mjs` に焼く (import を剥ぎ、CLI 節を落とし、同じ const を一本化する)。`npx tsugi-verify chain.json [--operator-key <b64> | --fetch-operator-key] [--pool ... --q --k --beacon --require-commitment --anchor-height --anchor-hash]`。`../sdk/tsugi_verify.test.mjs` が、焼き直しが byte 一致、事件 2 の連鎖の判定がモジュール版と byte 一致、fixture の定足数と commitment、変異 5 件の refusal コードが同じ、CLI の exit code、を見る。生成物や、手で触らん。

## v0 の約束

- 記録に JSON の数は入れん。数は文字列 ("43")。agreement_canonical.mjs の頭に書いてある int / float の継ぎ目を、v0 は踏まん。検証器は数が有れば number_in_record で断る。v1 で RFC 8785 か parseStrict を採る。
- hash は record_sha256 と署名 2 欄 (signature_ed25519_b64, public_key_ed25519_b64) を除いた canonical bytes に対して取る。署名の欄名は witness intake と同じ。
- drift は区間の頭で prev が null。proposal.prev は最後の drift、以降は直前。authorization.prev = proposal_sha256、execution.prev = authorization_sha256、verify.prev = execution_sha256。型検査と連鎖検査の両方で見る。
- 拒否されとる実行 (decision: refused の後の execution)、カタログ外のプリミティブ、提案と違うプリミティブの実行、許可の後で動いた expected_after、recovered:true なのに観測してへん表面、全部断る。

## 反対側と池 (v2.1)

呼ぶだけで呼ばれん者は池に入れてもらえん。こっちが呼ばれた時の側が `witness_reply.mjs` や: 依頼 (nenrin-witness-request-v1) を受け、自分自身なら self_witness で断り、drift_witness の 9 表面を測って、署名付きの観測 1 記録で返す。依頼の中の文字列は測る対象 (origin と表面名) にしか使わん。依頼に「指示」が混じっとっても測った物を書くだけ (試験に入れてある)。serve は最小の A2A 面で、本番の証人はこれを自分の A2A 面に組み込む。証人の鍵は運営者鍵と別に作る (役が違う): `openssl genpkey -algorithm ed25519 -out ~/.hs_witness_key.pem`。

池は `witness_pool_build.mjs` が書く。条件は README 上の「籤」の節そのまま。`--min-walked N` は 14.6 の Sybil 手当 (扉の /register/lookup の last_ring.walked_as_witness を見る)。既定 0 = ADR で決めるまで見ん。落ちた候補は池に書かず report に理由付きで残す。

日次の証人は `ops/run_drift_witness_daily.sh` (launchd `ops/com.horizonshield.driftwitness.plist`、毎日 09:00)。deploy_gate.sh が撒いた commit を `~/.config/hs/last_gate_commit.txt` に残し、証人はそれを --expect-commit に、前回の走りを --baseline にする。drift が有れば ALERT file と macOS の通知。記録は drift_runs/ (git には入れん)。

## まだ無い物 (v2.2)

- 池の中身。道具は在る (witness_pool_build)。条件を満たす card がまだ無い。うち自身も、扉の A2A 面が witness_request に答えるまでは他所の池に入れん (consent の witness_policy.reciprocal は答えられるようになってから true にする。先に宣言せん)。
- 証人を Worker の cron に (公式 SDK の card 検証を Worker の中でやる必要が有る)。今は Mac の launchd。
- 台帳 (hs-ledger) への intake と JIDEC への anchor。記録の型はそのために witness intake と同じ規律にしてある。
- beacon の予備 (drand)。今は mempool.space と blockstream.info。
- OTS 証明の検証は検証器の中に無い。読む側が台帳 entry の .ots を ots で確かめ、得た錨の高さと hash を commitmentAnchor に渡す。検証器は記録の中の整合 (subject、固定文、H+1) までを見る。
- 手は隔離しか持たん。他の 4 つを自動にする予定は無い (設計判断。人の署名が要る物は人が動かす)。
