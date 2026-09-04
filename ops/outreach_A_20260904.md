# 道 A の最初の 2 通(2026-09-05 送信用)。番人が書いた、送るのは TOshi。英語、ダッシュ無し

## 1. ToolOracle(乗る側 + 見る側、1 通で両方)

宛先: FeedOracle Technologies(Herford, Germany)、創業者 Murat Keskin。口は GitHub(github.com/ToolOracle の Discussions か Issue)か LinkedIn の DM。
根拠: observatory の 8/23 の走行で tooloracle.io の 54 本が「誰が払うか」を名乗っとった(欄は payment、x402 の従量課金)。彼らは 89 サーバー・1,096 ツールを agent に振り分ける router で、trust scoring を自前でやっとる = 外の測定を横に置く動機がある。

    Subject: 54 of your endpoints already say who pays. three keys more and a badge, plus a signal you can route on

    Murat,

    On 2026-08-23 I contacted every https endpoint declared in the official MCP registry once, read only, 12,429 addresses. 152 of them stated who compensates the operator. 54 of those 152 are yours, under tooloracle.io. Most of the field did not state it at all.

    A free gate measures five conditions on a server. Four are mechanical: initialize, tools/list, an agent card, the same answer twice. The fifth is that disclosure, and the gate reads it in one exact shape, a top level block in the agent card: {"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}. Your cards carry a payment field, which says a caller pays per call, but not whether anyone else pays you for referrals or listings, which is what the block states. Three keys, filled truthfully, and the condition passes; the content is not judged, only its absence.

    I ran that check once already, read only, on 2026-09-04 13:30 UTC, against https://tooloracle.io/ampel/mcp/: conditions 1 and 2 pass, 3 fails only because the block is absent, 4 was not measured because the gate calls no tool without the owner's consent. record_sha256 a8671fdec93251e03d1ffe3ee0b4c12d7224873d777a2298cb6c7950e17c46ea, recomputed on my side from the verdict body.

    Then one call: POST https://gate.horizonshield.dev/check {"endpoint":"https://tooloracle.io/ampel/mcp/","allow_tool_call":true}. No account, no fee. A server that passes all five may show a badge that is revoked by measurement, not by me; my own servers sit on the same public register and can fail on it. To have the badge measured weekly with determinism included, put {"allow_tool_call": true} at https://tooloracle.io/.well-known/mcp-conduct.json; only the owner of the origin can place that file, so the gate takes it as consent and records where it read it.

    Two things you can do with it, both free. Run it on your 54 endpoints and take the badges. And read GET https://gate.horizonshield.dev/is-verified?endpoint=<url> next to your routing: it returns verified true only on a full pass, null otherwise, never false, with a record sha256 and a recompute URL, so you are not asked to trust the gate.

    If your servers deploy from GitHub, one step in the workflow does the same check on every push and recomputes the verdict hash on the runner, so the gate is never trusted: uses: ogasurfproject-jpg/wedjat-check-action@v1 (https://github.com/ogasurfproject-jpg/wedjat-check-action)

    Your rows from the walk, with the hash of each record: https://observatory.horizonshield.dev/lookup?host=tooloracle.io
    What the badge does and does not claim: https://shield.the-horizons-innovation.com/verify-directory/badge/
    For routers and registries: https://shield.the-horizons-innovation.com/verify-directory/for-registries/

    I would rather you check it than believe me.

    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 2. Smithery / Arcade.dev(見る側)

宛先: Smithery(Arcade.dev 傘下)。口は Discord discord.gg/sKd9uycgH9 か GitHub github.com/smithery-ai(Discussion か Issue)。
根拠: 既に KIRA を 98/100(Typed Output)で載せとる = 一番近い見る側。一覧に uptime や security の欄は無く、外の測定を並べる場所は空いとる。

    Subject: a free verify signal you can show next to a listing, two GET calls, no key

    You already list horizon-shield (98/100). Thank you for that.

    You list MCP servers, and sooner or later someone asks which of them can be trusted. Answering that yourself turns a registry into a referee. I publish an outside measurement you can read next to a listing instead, free and without a key:

    GET https://gate.horizonshield.dev/is-verified?endpoint=<url> returns verified true only when the latest scheduled measurement passed every measured condition, null otherwise, never false, with a state enum, measured_at, a record sha256 and a recompute URL. Absent and pending are reported honestly and are not negative verdicts. For a page of servers, POST https://gate.horizonshield.dev/feed/batch with the endpoints you list; for a fresh measurement instead of the stored one, POST /check.

    The five conditions are mechanical except one: the server has to state who compensates its operator. On 2026-08-23 I walked all 12,429 https endpoints in the official registry once, read only; 152 stated it. That record is public with a hash per row.

    Details, terms and what it deliberately does not do: https://shield.the-horizons-innovation.com/verify-directory/for-registries/
    Where it stands today, stated plainly: my own eight servers are on the register, nobody else's yet, and I would rather you check the gate than believe me: https://gate.horizonshield.dev/self

    If a field next to a listing is too much, a link from the listing to the row is enough to start: https://gate.horizonshield.dev/e/mcp.horizonshield.dev/mcp

    For operators who deploy from GitHub there is a one step Action that runs the same check in their CI, so a listing can point its operators at it instead of at us: https://github.com/ogasurfproject-jpg/wedjat-check-action

    Toshikatsu Oga, The HORIZONs Co., Ltd.

## 送る前に TOshi が確かめること

- github.com/ogasurfproject-jpg/wedjat-check-action は公開済み(2dc0774)。扉 0.2.4(well-known 同意)が本番に載っとるか: `curl -s https://gate.horizonshield.dev/spec | grep -o well_known_consent` で出ること。出んなら文面の well-known の 1 文を消して送る
- 09-04 23:30 の実測(TOshi の Terminal、read only): tooloracle.io/ampel/mcp/ は 01 pass / 02 pass / 03 「compensation block not declared in agent-card」/ 04 not measured、record a8671fde…。文面の主張どおり。判定に consent_lookup(404 と置き方)が載った = 0.2.4 の well-known 経路が本番で動いとる最初の記録
- 番人の訂正(09-04 22:45): 観測所の「開示済み 152 本」は card に payment / pricing 等の欄があった意味で、扉の条件 3 が読む compensation ブロックとは別物。相手が /check を叩けば条件 3 は落ちる。文面は「3 つの鍵を足せば通る」に直した。旧文の「already pass the hard condition」は誇張やった
- observatory の lookup は host 指定で動くか: https://observatory.horizonshield.dev/lookup?host=tooloracle.io を一度ブラウザで開く(番人の VM からは届かん)
- /e/ の行の URL が生きとるか: https://gate.horizonshield.dev/e/mcp.horizonshield.dev/mcp
- 会社名の英語表記は TOshi の LinkedIn と同じ形にする(The HORIZONs Co., Ltd.)。日本語では The HORIZ音s株式会社

## 3 通目以降(週末)

ops/badge_cohort_disclosers_20260904.tsv の上から、tooloracle.io 以外の運営者を tool_count 順に 20。文面は ops/doujin_20260904.md の A-1 を使い、<endpoint> と lookup の address を差し替えるだけ。1 運営者 1 通、同じ host の複数 endpoint はまとめる。
