# /.well-known/mcp-conduct.json, version 1 (draft for public proposal)

Status: draft written 2026-09-05 by The HORIZONs Co., Ltd. (Hiratsuka, Japan) as the operator of the MCP Verification Gate. Not yet submitted anywhere. Intended for the Model Context Protocol community (discussion or SEP) and for the A2A community, since it touches both.

## One sentence

A small JSON file at a fixed location on an MCP server's origin, which only the owner of that origin can place, through which the operator states who pays it and consents to being measured, so that any independent measurer can read both without asking anyone.

## Why a file, and why there

Two facts about an MCP server cannot be measured from the outside and have to be declared by the operator: who compensates the operator, and whether an outside party may execute a tool on the server in order to measure it. Today the first lives in an A2A agent card (`compensation` block, as read by the MCP Verification Gate since 0.2.0) and the second was, until 2026-09-04, a hand written list in one measurer's source code. Both declarations need a place that satisfies three properties at once: only the owner can write there, any reader can find it without a registry, and it is tied to the origin the endpoint actually runs on rather than to a registry entry that anyone can file.

`/.well-known/` (RFC 8615) is that place. Placing a file there is control of the origin, which is the strongest ownership claim available without keys. The MCP Verification Gate has read `/.well-known/mcp-conduct.json` as consent since gate 0.2.4 (2026-09-04, gate_commit b237ce0675ec, red team 63/63). This draft writes down the shape so that other measurers, registries and clients can rely on the same file rather than on one operator's reading of it.

## The file

```
GET https://<origin>/.well-known/mcp-conduct.json
Content-Type: application/json
```

```json
{
  "version": 1,
  "allow_tool_call": true,
  "endpoints": ["https://example.com/mcp"],
  "compensation": {
    "paid_by": "buyer",
    "referral_fee": false,
    "listing_fee": false,
    "success_fee_pct": 0,
    "disclosure_url": "https://example.com/pricing"
  },
  "contact": "https://example.com/contact"
}
```

| field | required | meaning |
|---|---|---|
| `version` | no | integer, 1. Absent means 1. |
| `allow_tool_call` | no | boolean. `true` is consent for a measurer to call tools on the listed endpoints for the purpose of measurement (for example, one tool twice with empty arguments to measure determinism). Anything but the boolean `true` is no consent. |
| `endpoints` | no | array of exact endpoint URLs on this origin that the file speaks for. Absent means every MCP endpoint on the origin. A measurer matches by exact string. |
| `compensation` | no | who compensates the operator, in the shape the gate already reads from agent cards: `paid_by` one of `buyer`, `seller`, `referral`, `advertising`, `subscription`, `public`, `other`; `referral_fee` and `listing_fee` booleans; `success_fee_pct` number 0 to 100, optional; `disclosure_url` string, optional. |
| `contact` | no | URL or mailto for the operator. |

Rules a measurer follows, all of them the same as for the agent card: fetch with redirects followed only within the same origin; a redirect to another origin is not a file at this origin; any HTTP status other than 2xx, a non JSON body, or a JSON value that is not an object means the file is absent; nothing in the file is executed; the measurer records in its verdict where and when it read the file.

## What the file proves and what it does not

It proves control of the origin at the time of reading. It does not prove that the declaration is true; a false `compensation` declaration is published and recorded, which is the deterrent, and its content is never judged by a measurer. It does not prove that the person who placed it is the legal operator; on a platform that serves many operators under one origin by path, the file belongs to the platform, so the platform consents and declares for its tenants and no tenant can do so alone. The `endpoints` list narrows the scope; it does not remove this limit. Consent is per origin, exactly like the agent card.

## Relationship to existing places

The A2A agent card at `/.well-known/agent-card.json` remains the place a measurer reads `compensation` first; this file is the fallback for servers that publish no card, and the only place for consent. When both exist and disagree on `compensation`, a measurer reports the disagreement and does not pick one. Stated plainly: as of gate 0.2.4 the gate reads only `allow_tool_call` and `endpoints` from this file; reading `compensation` from it, and the disagreement rule, are proposed here and not yet implemented. The official MCP registry's `server.json` is a listing filed by anyone with a GitHub account and is not a statement by the origin; nothing in this draft reads it.

## What a client does with it

Nothing directly. A client reads a measurer's verdict, not this file. The point of a standard shape is that a measurer's verdict can name `consent_source: "well_known"` and any second measurer can reproduce the reading. One client library that consults the gate before connecting: `mcp-conduct` (npm). One CI step that measures on every push and recomputes the verdict hash on the runner: `ogasurfproject-jpg/wedjat-check-action`.

## Reference reading and red team

The gate's implementation is `wellKnownConsent()` and `resolveConsent()` in `workers/hs-verify-gate/src/worker.js` (public repository `ogasurfproject-jpg/horizon-shield`). Adversarial cases in `workers/hs-verify-gate/test/redteam_gate.mjs`: absent file, `allow_tool_call` as a string or a number, an array instead of an object, HTML at the path, HTTP 500, an off origin redirect, an `endpoints` list that excludes the endpoint or is not strings, and two cases proving that consent never excuses a failed condition. Anyone can rerun them: `node test/redteam_gate.mjs`.

## Open questions for the community

1. Should `compensation` live only here, only in the agent card, or in both with a disagreement rule? This draft says both, with the disagreement reported.
2. Is a boolean `allow_tool_call` enough, or should consent name what may be called (a tool allow list, argument shapes, a rate)? This draft keeps the boolean and expects measurers to call one tool twice with empty arguments and to disclose which one.
3. Should the file carry a list of measurers the operator acknowledges? This draft says no: a measurer's verdict is checkable by its hash, not by the operator's blessing, and an acknowledged list would turn measurement into endorsement.
