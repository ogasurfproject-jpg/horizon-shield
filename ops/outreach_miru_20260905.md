# 見る側 3 通(2026-09-05 送信用)。乗る側の文面(A-1)やなく、並べろ(A-2)で話す相手。英語、ダッシュ無し。番人が書いた、送るのは TOshi

3 社とも自分の server が観測所の開示済み 152 本に入っとる。せやから最後の 1 行だけ「自分の行も取れる」と添える。主題は「一覧の横に外の測定を置け」。

## 1. TWZRD(twzrd.xyz)。x402 の pre-spend trust gate、署名付き receipt。口: hello@twzrd.xyz、X @twzrd_xyz。server: https://intel.twzrd.xyz/mcp(24 tools、payment,pricing)

    Subject: you gate the spend, we gate the conduct. two hashes, one read

    You examine a counterparty before an agent pays it and hand back a signed receipt. We measure a different thing, earlier: before an agent connects to an MCP server at all, does the server speak MCP, publish an agent card, state who pays its operator, and answer the same call the same way twice. Free, no key, and every verdict carries a record sha256 anyone recomputes without trusting us.

    The read is one GET: https://gate.horizonshield.dev/is-verified?endpoint=<url>. verified true only on a full pass, null otherwise, never false, with measured_at, the record hash and a recompute URL. Absent means never measured, not bad. If it sits next to your receipt, an agent gets two independent measurements of two different questions, each with its own hash, and neither of us has to vouch for the other.

    Your own row is available if you want it: your intel endpoint was one of 152 in the official registry that stated who pays (read only walk, 2026-08-23). The gate reads that in one exact shape, a compensation block in the agent card with paid_by, referral_fee and listing_fee, and takes a consent file on your origin (/.well-known/mcp-conduct.json, {"allow_tool_call": true}) as permission to measure determinism. Our own servers sit on the same register and can fail on it.

    Terms and what it deliberately does not do: https://shield.the-horizons-innovation.com/verify-directory/for-registries/

    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 2. fingers(fingersai.co)。x402 の merchant trust ranking(取引の実績で並べる)。口: 無し(サイトに連絡先なし。card の provider か X を探す。無ければ後回し)。server: https://fingersai.co/mcp(48 tools、payments)

    Subject: a conduct signal next to a trust ranking, free, no key

    You rank merchants and agents by what they actually did over x402. We publish an outside measurement of a different axis for MCP servers: whether the server speaks MCP, publishes an agent card, states who pays its operator, and answers the same call the same way twice. A verdict is a measurement with a record sha256 anyone can recompute, not an endorsement, and absence from our register means never measured, not bad.

    Next to a ranking it reads with one GET per row, https://gate.horizonshield.dev/is-verified?endpoint=<url>, or one POST for a page of rows, https://gate.horizonshield.dev/feed/batch. verified true only on a full pass, null otherwise, never false.

    Your own endpoint was one of 152 in the official registry that stated who pays (read only walk, 2026-08-23). A row is yours for a compensation block in the agent card (paid_by, referral_fee, listing_fee) and a consent file on your origin (/.well-known/mcp-conduct.json, {"allow_tool_call": true}). Our own servers sit on the same register and can fail on it.

    https://shield.the-horizons-innovation.com/verify-directory/for-registries/

    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan

## 3. SaSame(SASAME S.R.L.、srl-sasame.com)。MCP-native の実行サービス、「review what happened」。口: https://srl-sasame.com/company/contact、LinkedIn https://www.linkedin.com/company/sasame/、Discord https://discord.gg/AYQUhPHafP。server: https://live-vps.sasame.online/public-mcp(94 tools、payment)

    Subject: you review what happened, this measures what a server declared before it happened

    A user of yours connects an AI, chooses capabilities, and reviews what happened. Before the choice there is a question you cannot answer from your side: does that MCP server speak MCP as declared, publish an agent card, state who pays its operator, and answer the same call the same way twice. We measure exactly that, free, no key, and every verdict carries a record sha256 that anyone recomputes without trusting us.

    Next to a capability a user is about to enable, one GET: https://gate.horizonshield.dev/is-verified?endpoint=<url>. verified true only on a full pass, null otherwise, never false, with measured_at and the record hash. Absent and pending are reported as such and are not negative verdicts. Your review log and our measurement are then two halves of the same record: what was declared, and what happened.

    Your own public MCP (94 tools) was one of 152 in the official registry that stated who pays (read only walk, 2026-08-23). A row is one compensation block in the agent card (paid_by, referral_fee, listing_fee) and one consent file on the origin (/.well-known/mcp-conduct.json, {"allow_tool_call": true}). Our own servers sit on the same register and can fail on it.

    https://shield.the-horizons-innovation.com/verify-directory/for-registries/

    Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan
