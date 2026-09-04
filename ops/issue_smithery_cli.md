You already list horizon-shield (98/100). Thank you for that.

You list MCP servers, and sooner or later someone asks which of them can be trusted. Answering that yourself turns a registry into a referee. I publish an outside measurement you can read next to a listing instead, free and without a key:

GET https://gate.horizonshield.dev/is-verified?endpoint=<url> returns verified true only when the latest scheduled measurement passed every measured condition, null otherwise, never false, with a state enum, measured_at, a record sha256 and a recompute URL. Absent and pending are reported honestly and are not negative verdicts. For a page of servers, POST https://gate.horizonshield.dev/feed/batch with the endpoints you list; for a fresh measurement instead of the stored one, POST /check.

The five conditions are mechanical except one: the server has to state who compensates its operator. On 2026-08-23 I walked all 12,429 https endpoints in the official registry once, read only; 152 stated it. That record is public with a hash per row.

Details, terms and what it deliberately does not do: https://shield.the-horizons-innovation.com/verify-directory/for-registries/
Where it stands today, stated plainly: my own eight servers are on the register, nobody else's yet, and I would rather you check the gate than believe me: https://gate.horizonshield.dev/self

If a field next to a listing is too much, a link from the listing to the row is enough to start: https://gate.horizonshield.dev/e/mcp.horizonshield.dev/mcp

For operators who deploy from GitHub there is a one step Action that runs the same check in their CI, so a listing can point its operators at it instead of at us: https://github.com/ogasurfproject-jpg/wedjat-check-action

Toshikatsu Oga, The HORIZONs Co., Ltd.
