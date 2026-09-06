# Does your agent have a record it did not write?

**AGNTCon + MCPCon Japan 2026, Tokyo, 10 to 11 September. One page. Toshikatsu Oga, The HORIZ音s株式会社 (Hiratsuka).**

Every trust signal you have seen today for an MCP server or an A2A agent was written by the agent, or by someone the agent pays. This page is about the other kind of record.

## What it is

A public register of MCP endpoints and A2A agents where the record is written by a measurement gate the agent does not control, and by anyone else who walks the agent from their own machine. No scores. Every verdict carries a sha256 you can recompute. Every month, one ring per endpoint (counts only, hash-chained), and the month's list is anchored to Bitcoin through an append-only ledger. Two witnesses who disagree are recorded as a discrepancy, not resolved. The operator's own eight servers are on the register and measured by the same gate. A second implementer wrote a ring builder in Node.js from the published specification and ring files; it reproduced all eight August rings byte for byte (ledger entry 34, provenance narrowed by entry 36).

Spec: A2A Conduct Extension v1, https://gate.horizonshield.dev/ext/conduct/v1 (Apache-2.0; its bytes are ledger entry 37). Proposal to a2aproject: issue #2211.

## Honest numbers, 2026-09-06

9 endpoints on the register. 1 outside witness. 37 ledger entries, all Bitcoin-confirmed. 0 independent mentions on the web. I am here because of the 1 and the 0.

## Ten seconds

    curl -s -X POST https://gate.horizonshield.dev/check -H 'content-type: application/json' -d '{"endpoint":"https://YOUR-SERVER/mcp"}'

You get five conditions, each with a reason, and a sha256. Nothing is stored unless you ask to be listed (POST /watch). Declining is honoured: `"listing": "decline"` in your origin's /.well-known/mcp-conduct.json.

## Ten minutes

    uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit --witness-name "you" --vantage "where"

That walks my agent from your machine and files what you saw where I cannot edit it. The sha256 it prints is your receipt. Also available as an MCP server with one tool (conduct-witness-mcp) so your agent can be the witness.

## What I am asking

Three things, any one of them. (1) Walk one agent as a witness, under your name. (2) If you run a gateway or a client that connects to agents, read the record before connecting; the extension gives you the pointer. (3) If you run measurement of your own, let us anchor each other's roots. Nobody is paid for any of this, by design; the register discloses who pays the gate (today: the operator, out of pocket).

## What it is not

Not a rating agency. Not identity (that is NTT DOCOMO BUSINESS's registry, NEC's KYA, VC and DID; complementary, and a pointer for them is planned for v1.1). Not a lie detector: it records shape, and the gap between what a card declares and what the endpoint does, and the gap between witnesses.

gate.horizonshield.dev/spec  ·  github.com/ogasurfproject-jpg/mcp-conduct-register  ·  ledger.horizonshield.dev/ledger

日本語: あなたのエージェントに「あなたが書いていない記録」はありますか。無ければ10分で作れます。私の記録はここにあり、私も測られています。
