# NENRIN Resume v1

可搬・第三者検算可能なエージェント行動履歴。仕様は RESUME_SPEC_v1.md。

## 構成
- RESUME_SPEC_v1.md  仕様(3掟 + ソフト堀 M1〜M5 + red-team 敵 + 未解決 limit)
- resume_v1.py       集約器(offline, 決定論。canonical は make_ring.py と同一)
- resume_redteam.py  敵(offline, 決定論, fail-closed)
- resume_v1.mjs      JS 移植(worker route が呼ぶ本体。規則・拒否コード・canonical 形は python と同一)
- resume_bytematch.py M4 ハーネス(同じ入力を python と node に入れ、sha と拒否コードを突き合わせる)

## テスト
    cd workers/hs-ledger/nenrin/resume-v1
    python3 resume_redteam.py
期待: total 10  pass 10  fail 0 (exit 0)。控え3 + 攻撃6拒否 + 正直 limit 1。

    python3 resume_bytematch.py
期待: cases 18  match 18  mismatch 0 (exit 0)。python と node が全ケースで一致(M4)。

## status
集約ロジックは python と node で一致済み(byte-match 18/18)。残りは worker.js への
GET /resume/<perma-id> の薄い配線(既存 /paths/query + /ledger を読んで resume_v1.mjs に渡す)、
Mac で本番照合、deploy。
