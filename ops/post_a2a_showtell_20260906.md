Title: Be a witness of an A2A agent in one command (conduct records the agent did not write)

Body:

This is the working side of the proposal in #2211 (A2A Conduct Extension v1), shown rather than argued.

**What it is.** A public register where each agent's record is written by a measurement gate the agent does not control, and by anyone else who walks the agent from their own machine. No scores. Every verdict carries a sha256 anyone can recompute. Monthly rings per endpoint (counts only, hash-chained) and the month's list is anchored to Bitcoin through an append-only ledger. Two witnesses who disagree are recorded as a discrepancy, not resolved. The operator's own agents are on the register and measured the same way.

**Honest numbers today (2026-09-06):** 9 rows, 1 outside witness, 37 ledger entries, all Bitcoin-confirmed. That is why this post exists.

**Be a witness in one command** (Python 3.8+, stdlib only, no account):

```
uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" \
  a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit \
  --witness-name "you or your project" --vantage "where this runs"
```

It fetches the agent card twice, validates the extension declaration, sends one `SendMessage` with the `A2A-Extensions` header (or `message/send` with `X-A2A-Extensions` on the 0.3 wire, `--wire 0.3`), records every response body's sha256, and files the record at the intake the card itself names. The sha256 it prints is your receipt; it lands in the next day's ledger bundle and the month's ring counts you by name. `--submit` off walks without filing.

**As an MCP server** (one tool, `witness_walk`, runs where your agent runs so the vantage is yours): `conduct-witness-mcp`, same package. Config and a Claude Code skill are in the README.

**Interop.** Both official SDKs (`@a2a-js/sdk` 1.1.0 and `a2a-sdk` 1.1.2) were run against the real server code on both wire versions; the header spelling and wire shape details are in section 3 of the spec.

**What it is not.** Not a rating, not identity, not a lie detector. It records shape, the gap between what a card declares and what the endpoint does, and the gap between witnesses. Prior art is named in section 9 (ERC-8004, discussion #1631, Sigstore-signed cards, and the transparency primitives underneath).

Spec: https://gate.horizonshield.dev/ext/conduct/v1 (Apache-2.0; bytes anchored as ledger entry 37). Register: https://github.com/ogasurfproject-jpg/mcp-conduct-register . Ledger: https://ledger.horizonshield.dev/ledger . Witness tool: https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/a2a-conduct-walk

Disclosure: drafted with AI assistance; I operate the register, so I am not neutral. A finding beats a star.
