# NENRIN Resume v1

可搬・第三者検算可能なエージェント行動履歴。仕様は RESUME_SPEC_v1.md。route は台帳 worker の GET /resume?endpoint=<https url>。

## 構成
- RESUME_SPEC_v1.md         仕様(識別子・台帳の実形と二段認証・出力・堀 M1〜M5・掟・拒否・未解決)
- resume_v1.py              python 核(参照実装。offline, 決定論。canonical は make_ring.py と同一)
- resume_v1.mjs             JS 核(worker が bundle する本体。node import ゼロ、sha256 は注入、非同期)
- resume_cli.mjs            node 用の runner(node:crypto を核に注入。byte-match が呼ぶ)
- resume_fixtures.py        fixture 生成(a2a_conduct_walk の実形: verdict{ok,outcome,n_pass,n_total}, walked_at, base, witness, nodes)
- resume_redteam.py         敵(offline, 決定論, fail-closed)
- resume_bytematch.py       M4 ハーネス(同じ fixture を python と node に入れ、sha と拒否コードを突き合わせる)
- resume_route_selftest.mjs 実 worker.js の /resume を KV モックで叩く(本番と同じ束ね形)

## テスト(この dir で)
    python3 resume_redteam.py                                             期待 total 14 pass 14
    python3 resume_bytematch.py                                           期待 cases 21 match 21
    node --experimental-default-type=module resume_route_selftest.mjs     期待 route selftest all green (19)

## 配備(TOshi の手)
    cd workers/hs-ledger
    npx wrangler deploy --dry-run --outdir /tmp/hsl-bundle    bundle の門
    npx wrangler deploy
    curl -s "https://ledger.horizonshield.dev/resume?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp" | head -c 2000
    curl -s "https://ledger.horizonshield.dev/resume?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp&format=md"
