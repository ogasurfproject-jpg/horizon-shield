# a2aproject/A2A への提案 issue (Proposal Phase、Extension and Protocol Binding Governance に沿う)

貼る場所: https://github.com/a2aproject/A2A/issues/new/choose → 「Feature Request」
title 欄に 1 行目、以下の 4 欄にそれぞれの節を貼る。Code of Conduct のチェックを入れる。
配備(第二波)が終わって、本番の sha が 3aa5a50d... に揃ってから貼る。貼る前に 3 つの URL を開いて 200 を確かめる。

----- title -----
[Feat]: Extension proposal: Conduct (conduct-v1), a data-only disclosure and client-as-witness extension

----- Is your feature request related to a problem? Please describe. -----
An agent that is about to hand work to another agent can read the other agent's card, but the card is written by the agent it describes. Two things the card cannot tell it today: who pays that agent (a referral fee, a listing fee, a success fee changes what "the best result" means), and where a record of that agent's measured conduct lives that the agent itself did not write. Discussion #1631 converged on separating attestation surfaces from scoring policies; this proposal is the attestation surface only, with no score in it.

----- Describe the solution you'd like -----
A data-only extension on the Agent Card (never `required: true`), plus an optional request-level echo, with a specification that is already written, licensed Apache 2.0, and served at its own URI:

- URI: https://gate.horizonshield.dev/ext/conduct/v1 (GET returns the spec as JSON; `Accept: text/markdown` returns the text; sha256 of the markdown is published beside it)
- `params` carry: a compensation declaration in a fixed shape (paid_by, referral_fee, listing_fee, success_fee_pct, disclosure_url), the measured endpoint(s), a URL to a conduct record written by a party other than the agent, and a URL where any client can file its own walk of the agent. Nothing else. A reader judges only whether the declaration exists and is well formed; if a card carries the declaration in two places and they disagree, the card fails.
- Echo: on activation via `A2A-Extensions` (the 0.3 spelling `X-A2A-Extensions` is read as well and echoed back in the spelling received), the agent returns the URI in the header, three URLs under `metadata`, and lists the URI in `Message.extensions`. No timestamp, no score.
- Witness walk: a client reads the card twice, sends one message with the extension activated, and posts a content-addressed record of what it saw to a public append-only ledger that receives a Bitcoin timestamp. Monthly rings count those walks per endpoint as counts with denominators. A second implementation of the ring builder (Node.js, written from the spec by someone else) reproduced all eight August 2026 rings byte for byte.

Reference implementations, all live and Apache 2.0:
- Server side: three agent cards declare and echo it on both wire versions (https://mcp.horizonshield.dev/.well-known/agent-card.json, https://gate.horizonshield.dev/.well-known/agent-card.json, https://ledger.horizonshield.dev/.well-known/agent-card.json).
- Reader side: MCP Verification Gate 0.3.3 reads the declaration as one of its five conditions and serves the spec.
- Client side: a stdlib Python walk client, and an interoperability harness that drives the real server code with the official `a2a-sdk` (Python 1.1.x) and `@a2a-js/sdk` (1.1.x) clients on both the 1.0 and the 0.3 wire, no network. Repository: https://github.com/ogasurfproject-jpg/horizon-shield (workers/hs-verify-gate/ext for the spec, workers/hs-mcp/test for the harness).

What I am asking for: a maintainer willing to sponsor this as `experimental-ext-conduct` under the governance process, or a clear no with the reason, which is also useful. If sponsored, the URI above stays valid for v1 as published and the a2a-protocol.org URI would be a new identifier for the next version, not an alias.

----- Describe alternatives you've considered -----
- Putting scores in the card (#1631, ERC-8004 Reputation Registry): rejected for this extension because a score is a policy, and the surface should carry facts a reader can re-check. The two are complementary; an ERC-8004 registration file can point at a card that carries this extension.
- Signing the card (Sigstore-signed cards, AgentCardSignature in 1.0): answers who published the card, not how the agent behaved or who pays it. Complementary; a signed card can carry this extension.
- A core protocol change: not needed. Everything here fits `capabilities.extensions[]` and `metadata` as A2A 1.0 already defines them, which is why it is proposed as an extension and not as a spec change.
- Doing nothing: registries then answer "which agent can be trusted" themselves, which makes each registry a referee. The point of this extension is that the record is outside both the agent and the registry.

----- Additional context -----
Prior art is named in section 9 of the spec (ERC-8004, #1631 and its prototype, Sigstore-signed cards, Agent Certificates arXiv 2603.14332, and the transparency primitives underneath: CT, Rekor, in-toto, SCITT, OpenTimestamps, RFC 8785). Section 6 states the intended mappings to in-toto Statement v1 and SCITT as direction, not delivery. Known weaknesses are in the spec too: it does not verify that a compensation declaration is true, one witness per endpoint is still the normal case, and the canonical form is inherited from a language runtime until the ring spec adopts RFC 8785.

Two interop findings from writing the harness, offered in case they are useful to SDK maintainers: (1) `@a2a-js/sdk` 1.1.0 with default options cannot build a client from a 0.3-shaped card at all ("No compatible transport found"), and with `legacyCompat` it emits only `X-A2A-Extensions` on the 0.3 wire; `a2a-sdk` (Python) emits both spellings on that wire. A server that reads only `A2A-Extensions` therefore silently drops activation from half of the compatibility clients. (2) A card that carries both `supportedInterfaces` (1.0 first) and the 0.3 `url`/`preferredTransport`/`protocolVersion` keys is read as 1.0 by both SDKs and as 0.3 by 0.3-only readers, which is the shape the reference cards now use.

This text was drafted with AI assistance and reviewed by the author, who runs the servers named above.

----- Code of Conduct -----
[x] I agree to follow this project's Code of Conduct
