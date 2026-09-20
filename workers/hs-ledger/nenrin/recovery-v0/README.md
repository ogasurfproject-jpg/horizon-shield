# recovery-v0: Proof-of-Recovery の最初の一枚

設計書 (Claude Docs「Proof-of-Recovery 設計書」、2026-09-20) の v0。第2の柱の、記録の型、それを採点する物、Class 1 の証人、そして Shield エージェント (診断と提案)。

## 何が在るか

| file | 名乗り | 中身 |
|---|---|---|
| recovery_schema.mjs | library | 5 記録の型 (drift / proposal / authorization / execution / verify)、カタログ 5 プリミティブ、型検査 |
| recovery_verify.mjs | library | 1 記録と連鎖の検証器。canonical は agreement_canonical.canonicalUtf8 をそのまま使う。sha256 と Ed25519 は WebCrypto |
| recovery_fixture_build.mjs | library | 今週の事故 (生 deploy → 署名不一致 + challenge 消失 → 外部証人 → 切り分け → redeploy_pinned → verify TRUE) を 7 記録に焼く |
| recovery_fixture_20260920.json | 表 | 上が書いた 7 記録。hash と prev はコードが計算した物。手で触らん |
| recovery_verify_test.mjs | suite | fixture が通る、rebuild が byte 一致、変異 24 件が全部落ちる |
| drift_witness.mjs | library (network) | Class 1 の 7 表面を測って drift-record を JSONL で書く。手で回す |
| baseline_20260920.jsonl | 表 | 直った扉に対する証人の最初の走り。7 表面、0 drift。v1 の「前回」 |
| shield_agent.mjs | library (CLI) | Shield エージェント = Recovery Agent 本体。drift を読んで、切り分けて、カタログから 1 つ提案する。実行せん |
| shield_agent_test.mjs | suite | 今週の事故に何を言うか、規則 7 本が意図した所で当たり、迷う所で止まるか |
| shield_llm.mjs | library (network, 鍵) | 規則に無い組み合わせに、LLM で仮説を書かせる側。受け入れ検査で縛る |
| shield_llm_test.mjs | suite | モデルは呼ばん。受け入れ検査が何を通し何を捨てるか、規則が先で LLM が後か |
| run_all.mjs | runner | agreement-v0 と同じ物。名乗っとらん file が 1 つでも有れば断る |

## 回し方

    node run_all.mjs                                   # 採点 (3 suite)
    node recovery_fixture_build.mjs                    # fixture を書き直す (中身を変えた時だけ。変えたら test が byte 一致で止める)
    node drift_witness.mjs https://gate.horizonshield.dev --expect-commit <sha> --expect-canonical <hex> --repo <repo> --out drift.jsonl
    node shield_agent.mjs drift.jsonl --baseline baseline_20260920.jsonl [--source-verifies true|false]
    node shield_agent.mjs drift.jsonl --baseline baseline_20260920.jsonl --llm [--llm-second-opinion] [--context notes.txt]

drift_witness は drift が 1 つでも有れば exit 1。shield_agent は提案が出れば 0、人が要れば 2。

## Shield エージェントの頭は二段

1. **規則の表が先** (shield_agent.mjs の RULES、7 本)。決定可能な Class 1 の組み合わせは規則が答える。同じ入力で同じ答え、無料、幻覚無し、誰でも再計算できる。今週の事故 (unpinned + 署名不一致 + challenge 消失) は R1 が当たり、resign_agent_card を却下して redeploy_pinned を出す。外部証人の「署名し直せ」より一段深い所で答える。
2. **規則に無い組み合わせだけ LLM** (shield_llm.mjs)。呼び方は IASF と同じ Anthropic Messages API、鍵は `ANTHROPIC_API_KEY` を env で、model は `SHIELD_LLM_MODEL` (既定 claude-haiku-4-5-20251001)、temperature 0。`--llm-second-opinion` を付けると規則が答えた時もモデルに聞き、同じ物を選んだかを横に書く。規則の答えは動かさん。違ったら人が読む。
3. **LLM の出力は信用せん**。カタログ外なら捨てる。証拠 hash が入力に無ければ捨てる。数が混じれば捨てる。JSON やなければ捨てる。通った物だけ seal して提案にする。witness は shield-agent-llm、model と prompt_sha256 (何を見て言うたか) を記録に焼く。LLM の提案は必ず人間ゲート、隔離であっても自動承認せん。does_not_establish に「言語モデルが書いた仮説であって所見やない」を必ず足す。

つまり LLM も、KIRA と同じ箱に入っとる。判断 (LLM) と権限 (人間) と証拠 (記録) と実行 (Executor) を分ける、設計書 2 節そのままや。

## v0 の約束

- 記録に JSON の数は入れん。数は文字列 ("43")。agreement_canonical.mjs の頭に書いてある int / float の継ぎ目を、v0 は踏まん。検証器は数が有れば number_in_record で断る。v1 で RFC 8785 か parseStrict を採る。
- hash は record_sha256 と署名 2 欄 (signature_ed25519_b64, public_key_ed25519_b64) を除いた canonical bytes に対して取る。署名の欄名は witness intake と同じ。
- drift は区間の頭で prev が null。proposal.prev は最後の drift、以降は直前。authorization.prev = proposal_sha256、execution.prev = authorization_sha256、verify.prev = execution_sha256。型検査と連鎖検査の両方で見る。
- 拒否されとる実行 (decision: refused の後の execution)、カタログ外のプリミティブ、提案と違うプリミティブの実行、許可の後で動いた expected_after、recovered:true なのに観測してへん表面、全部断る。

## まだ無い物 (v1)

- drift_witness を worker の cron に。今は Mac から手で回す物。
- 前回 witness した状態との比較は shield_agent の compareBaseline に在る (鍵の変化、jwks の変化、challenge の変化を所見にする)。証人自身が prior state を持つのは v1。
- authorization を人の署名 (Ed25519) で取る口。今は記録の型だけ。
- python の双子 (agreement-v0 と同じく、2 言語で byte 一致を取ってから「正しい」と言う)。
- 台帳 (hs-ledger) への intake と JIDEC への anchor。記録の型はそのために witness intake と同じ規律にしてある。
