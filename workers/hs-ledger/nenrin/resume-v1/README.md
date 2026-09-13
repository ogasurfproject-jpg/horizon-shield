# NENRIN Resume v1

可搬・第三者検算可能なエージェント行動履歴。仕様は RESUME_SPEC_v1.md。

## 構成
- RESUME_SPEC_v1.md  仕様(3掟 + ソフト堀 M1〜M5 + red-team 敵 + 未解決 limit)
- resume_v1.py       集約器(offline, 決定論。canonical は make_ring.py と同一)
- resume_redteam.py  敵(offline, 決定論, fail-closed)

## テスト
    cd workers/hs-ledger/nenrin/resume-v1
    python3 resume_redteam.py
期待: total 10  pass 10  fail 0 (exit 0)。控え3 + 攻撃6拒否 + 正直 limit 1。

## status
worker route (GET /resume) は未実装。次に worker 本体 + byte-match テスト
(worker 出力 == resume_v1.assemble_resume) を書き、Mac で本番照合してから deploy。
