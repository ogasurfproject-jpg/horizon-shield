# NENRIN Résumé v1 〜 可搬・第三者検算可能なエージェント行動履歴

Status: DRAFT (番人設計、TOshi 決裁待ち)。commit/deploy は TOshi の手。
Anchor target: 決裁後、本ドキュメントの SHA-256 を JIDEC 台帳に刻む。

## 0. 一行の定義

履歴書は新しい主張を一切しない。既存の JIDEC 録を 1 つの perma-id の下に集約して「指す」だけの読み取り面である。行の中身は全部、検証者が測って証人が錨打った測定に由来する。エージェントは自分の履歴書に一行も書けない。

## 1. 何を解くか

README の問題設定「Discovery is solved. Choice is not.」への直接の答え。
「このエージェントは過去どう振る舞ったか」を、可搬・改ざん不能・第三者検算可能な 1 枚にする。判定(ALLOW/BLOCK)は使い捨てだが、履歴書は積み上がる。積み上がりが堀になる。

## 2. キーと口

- キー: perma-id (https://w3id.org/horizonshield/conduct namespace、perma-id/w3id.org#6653) + measured endpoint。
- 口: GET /resume/<id>。JSON 既定。Accept: text/markdown で人間可読。
- 検算: GET /resume/<id>/verify は独立検証レシピを返す(JIDEC v1 の verifier recipe と同型)。
- 実装: 既存の /paths/query と /ledger を endpoint で絞って集約するだけ。新規の信頼計算はゼロ = 薄い worker。

## 3. 中身(既存録の集約のみ)

- identity: perma_id, agent_card_url, measured_endpoint
- measurements[]: 各 { measured_at, record_sha256, outcome (verified|held|pending), consent_source, tool, witness[]{name, vantage, key_url?}, anchor{ots, bitcoin_block}, source_ledger_n }
- discrepancies[]: 隠さず全部 { record_sha256, first_instant, disc, signed }
- rings[]: 月次集約 { month, endpoint, counts (copied not recomputed), determinism, derived, digest, ledger_n }
- freshness: { last_measured, current_now (fail-closed), period, oldest_measurement }
- agreements[]: 当事者の合意録 { record_sha256, ledger_n }
- self_description: 無し。存在しないフィールド。

## 4. ソフトに付ける 5 つの堀(不変条件、構造で強制)

コードを秘密にする堀は MIT で死ぬ。ここで付ける堀は「出力を自己認証にし、中立を外部から検算可能にする」ことで、同じコードを fork しても錨・証人・敵対検証の実体が無ければ出力が目に見えて弱くなる、という種類の堀である。

M1 自己認証する出力: 各行は record_sha256 + OTS/Bitcoin anchor を内包する。/record/<sha> でバイトを取得し第三者が再計算する。postdating(未来時刻詐称)は prover 非所有の Bitcoin anchor で構造的に refuse。fork はコードを持てても、錨の無い行は信用ゼロで、錨は実時間でしか積めない。

M2 中立の外部検算可能性: 座標は prover 非所有の源から導出する(join/census/freshness の規律を継承)。全フィールド名を公開する。閉じた競合は「中立です」を検算可能な形で主張できない。open であること自体が堀になる(field-names-published-on-purpose)。

M3 証人の多様性を露出する: 各行の witness{name, vantage} を表に出し、header に witness-diversity のカウントを出す。自己証人だけの薄い履歴書は「薄い」と一目で分かる。fork はコードを持てても証人ゼロ。

M4 決定論を標準にする: 履歴書のバイトは canonical(RFC 8785 形)。独立実装が同じ sha を再計算できる(NENRIN は既に Python + Node でバイト一致の前例あり)。fork 可能なコードではなく、皆が検算する参照標準になる。

M5 敵が製品: 公開 red-team(§7)。check を緩めた fork は公開ハーネスで落ちる。「うちの敵をお前の fork に当てて見てみ」が成立する。

## 5. 3 つの掟(2026-09-13 合意)

1. 自己申告の行はゼロ。行は測定由来のみ。構造で不可能にする(M1〜M3)。
2. Discrepancy は一級市民。522/Witness B のような食い違いも必ず載せる。隠した瞬間に価値ゼロ。
3. スコア・星・信用点は出さない。カウントとリンクだけ。格付けバッジの履歴書は作らない。

## 6. route 設計

- GET /resume/<id>: /paths/query(endpoint 絞り込み)+ /ledger の既存 route を集約。
- GET /resume/<id>?format=md: 人間可読(スイス組版に寄せる。角丸・影・色付きピル無し、カウントと sha のヘアライン表)。
- GET /resume/<id>/verify: 検算レシピ。
- 扉本体(hs-verify-gate)は無改造。履歴書は台帳(hs-ledger)の仕事。扉は「今この瞬間の判定」に専念。

## 7. red-team 敵(実装する)

- inject_self_asserted_line: 測定由来でない行を注入 → reject
- hide_discrepancy: discrepancy のある月を無しで出す → reject
- prover_chosen_coordinate: prover が選んだ measured_at/endpoint を座標に使う → reject (M2)
- orphan_record: record_sha256 が /record でバイト取得できない → reject
- score_injection: outcome をスコア化/星化 → 出さない(counts only)
- backdated_anchor: anchor が測定時刻より後 → postdating は M1 で構造 refuse

決定論・fail-closed・クラス生成・欠陥をログに残す、を NENRIN の既存ハーネスと同型で。

## 8. 未解決(正直に)

- backdating(現実より古い measured_at)は前方 anchor では捕まらない = 再測定(ring)のみ。
- currency(古い有効録が「今」を表すか)は fail-closed 既定(period 外は current_now:false)。
- census 闇(名乗っていない集合)は判定に効く母集団では空(呼べる = CT 必載)。
すべて NENRIN の既存 limit と同根。閉じたフリはしない。

## 9. 堀の正体(まとめ)

route 自体は MIT で fork 可。でも fork は空の台帳・証人ゼロ・敵に落ちる。堀は履歴書という機能ではなく、履歴書が指す錨付き実履歴 + 独立証人 + 運用年数で溜まるもの。ソフトの役目は「fork が真似できない物を出力で露出し、fraud と薄さを構造的に可視化する」こと。これがソフトに付けられる唯一の本物の堀である。
