Murat,

On 2026-08-23 I contacted every https endpoint declared in the official MCP registry once, read only, 12,429 addresses. 152 of them stated who compensates the operator. 54 of those 152 are yours, under tooloracle.io. Most of the field did not state it at all.

A free gate measures five conditions on a server. Four are mechanical: initialize, tools/list, an agent card, the same answer twice. The fifth is that disclosure, and the gate reads it in one exact shape, a top level block in the agent card: `{"compensation":{"paid_by":"buyer","referral_fee":false,"listing_fee":false}}`. Your cards carry a payment field, which says a caller pays per call, but not whether anyone else pays you for referrals or listings, which is what the block states. Three keys, filled truthfully, and the condition passes; the content is not judged, only its absence.

I ran that check once already, read only, on 2026-09-04 13:30 UTC, against https://tooloracle.io/ampel/mcp/: conditions 1 and 2 pass, 3 fails only because the block is absent, 4 was not measured because the gate calls no tool without the owner's consent. record_sha256 a8671fdec93251e03d1ffe3ee0b4c12d7224873d777a2298cb6c7950e17c46ea, recomputed on my side from the verdict body.

Then one call: POST https://gate.horizonshield.dev/check `{"endpoint":"https://tooloracle.io/ampel/mcp/","allow_tool_call":true}`. No account, no fee. A server that passes all five may show a badge that is revoked by measurement, not by me; my own servers sit on the same public register and can fail on it. To have the badge measured weekly with determinism included, put `{"allow_tool_call": true}` at https://tooloracle.io/.well-known/mcp-conduct.json; only the owner of the origin can place that file, so the gate takes it as consent and records where it read it.

Two things you can do with it, both free. Run it on your 54 endpoints and take the badges. And read GET https://gate.horizonshield.dev/is-verified?endpoint=<url> next to your routing: it returns verified true only on a full pass, null otherwise, never false, with a record sha256 and a recompute URL, so you are not asked to trust the gate.

If your servers deploy from GitHub, one step in the workflow does the same check on every push and recomputes the verdict hash on the runner, so the gate is never trusted: `uses: ogasurfproject-jpg/wedjat-check-action@v1` (https://github.com/ogasurfproject-jpg/wedjat-check-action)

Your rows from the walk, with the hash of each record: https://observatory.horizonshield.dev/lookup?host=tooloracle.io
What the badge does and does not claim: https://shield.the-horizons-innovation.com/verify-directory/badge/
For routers and registries: https://shield.the-horizons-innovation.com/verify-directory/for-registries/

I would rather you check it than believe me.

Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan
