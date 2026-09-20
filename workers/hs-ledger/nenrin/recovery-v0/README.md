# recovery-v0: Proof-of-Recovery (v1)

設計書 (Claude Docs「Proof-of-Recovery 設計書」、2026-09-20) の v1。第2の柱の、記録の型、それを採点する物、Class 1 の証人、そして Policy Gate (運営者署名による許可)。診断と提案を書く側 (Shield エージェント) はこの公開ツリーには置かん (別 repo)。

## 何が在るか

| file | 名乗り | 中身 |
|---|---|---|
| recovery_schema.mjs | library | 5 記録の型 (drift / proposal / authorization / execution / verify)、カタログ 5 プリミティブ、型検査 |
| recovery_verify.mjs | library | 1 記録と連鎖の検証器。canonical は agreement_canonical.canonicalUtf8 をそのまま使う。sha256 と Ed25519 は WebCrypto |
| recovery_fixture_build.mjs | library | 今週の事故 (生 deploy → 署名不一致 + challenge 消失 → 外部証人 → 切り分け → redeploy_pinned → verify TRUE) を 7 記録に焼く |
| recovery_fixture_20260920.json | 表 | 上が書いた 7 記録。hash と prev はコードが計算した物。手で触らん |
| recovery_verify_test.mjs | suite | fixture が通る、rebuild が byte 一致、変異 24 件が全部落ちる |
| drift_witness.mjs | library (network) | Class 1 の 7 表面を測って drift-record を JSONL で書く。手で回す |
| authorize.mjs | library (CLI, 鍵) | Policy Gate。人間が提案に Ed25519 で署名して authorization-v1 を作る。鍵は file、repo の外 |
| baseline_20260920.jsonl | 表 | 直った扉に対する証人の最初の走り。7 表面、0 drift。v1 の「前回」 |
| run_all.mjs | runner | agreement-v0 と同じ物。名乗っとらん file が 1 つでも有れば断る |

## 回し方

    node run_all.mjs                                   # 採点
    node recovery_fixture_build.mjs                    # fixture を書き直す (中身を変えた時だけ。変えたら test が byte 一致で止める)
    node drift_witness.mjs https://gate.horizonshield.dev --expect-commit <sha> --expect-canonical <hex> --repo <repo> --out drift.jsonl

drift_witness は drift が 1 つでも有れば exit 1。cron に置く時はそれで人を呼ぶ。

## 診断と提案を書く側

記録を読んで切り分け、カタログから 1 つ提案する側 (Shield エージェント) は、この公開ツリーには置かん。ここに在るのは、誰でも再計算できる側だけや: 記録の型、検証器、証人、fixture、基準線。提案が出たら、それもこの検証器で採点され、連鎖に乗る。提案を書いた物が何であれ、記録は同じ規律で読まれる。

## Policy Gate (v1)

許可は文字列やない、署名や。`authorize.mjs` が運営者の Ed25519 鍵で提案の hash に署名して authorization-v1 を作る。検証器を `verifyChain(records, { operatorKeys: [運営者の公開鍵] })` で strict モードにすると、人間承認プリミティブ (redeploy_pinned / resign_agent_card / revert / rotate) の実行は、その許可が運営者鍵で署名され、鍵が信用集合に在り、期限内であることを要求する。署名の無い許可 (authorization_unsigned)、信用してない鍵 (authorization_untrusted_key)、期限切れ (authorization_expired) は弾く。隔離 (quarantine_endpoint、auto 承認) は署名を要さん。

鍵の作り方 (一度だけ、repo の外に):

    openssl genpkey -algorithm ed25519 -out ~/.hs_operator_key.pem && chmod 600 ~/.hs_operator_key.pem
    node authorize.mjs --pub ~/.hs_operator_key.pem      # 検証器に渡す信用アンカー (公開してよい)

運営者の秘密鍵はこの Worker にも repo にも無い。署名は手元でやる。card-sign と同じ掟や。

## v0 の約束

- 記録に JSON の数は入れん。数は文字列 ("43")。agreement_canonical.mjs の頭に書いてある int / float の継ぎ目を、v0 は踏まん。検証器は数が有れば number_in_record で断る。v1 で RFC 8785 か parseStrict を採る。
- hash は record_sha256 と署名 2 欄 (signature_ed25519_b64, public_key_ed25519_b64) を除いた canonical bytes に対して取る。署名の欄名は witness intake と同じ。
- drift は区間の頭で prev が null。proposal.prev は最後の drift、以降は直前。authorization.prev = proposal_sha256、execution.prev = authorization_sha256、verify.prev = execution_sha256。型検査と連鎖検査の両方で見る。
- 拒否されとる実行 (decision: refused の後の execution)、カタログ外のプリミティブ、提案と違うプリミティブの実行、許可の後で動いた expected_after、recovered:true なのに観測してへん表面、全部断る。

## まだ無い物 (v1)

- drift_witness を worker の cron に。今は Mac から手で回す物。
- 前回 witness した状態との比較 (鍵の変化、jwks の変化)。v0 の証人は毎回の観測を書くだけで、prior state を持たん。
- authorization を運営者の公開鍵で検証する口を gate に (/keys/operator.json)。今は信用アンカーを手で渡す。
- python の双子 (agreement-v0 と同じく、2 言語で byte 一致を取ってから「正しい」と言う)。
- 台帳 (hs-ledger) への intake と JIDEC への anchor。記録の型はそのために witness intake と同じ規律にしてある。
