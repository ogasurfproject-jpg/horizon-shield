Subreddit: r/mcp
Flair: Project (or Resource, whichever the board offers)

Title: A conduct record for MCP servers that the server did not write, and one command to be a witness

Body:

Most "trust" signals for MCP servers are written by the server or by whoever the server pays: descriptions, directory scores, vendor pages. I run a small public register where the record is written by a gate the server does not control, and by anyone else who walks the server from their own machine.

What exists: a free conformance gate (five conditions, no scores, every verdict carries a sha256), daily re-measurement of listed endpoints, monthly rings per endpoint (counts only, hash-chained, the month's list anchored to Bitcoin via OpenTimestamps), and an append-only ledger that pools outside witnesses' observations and bundles them daily. Two witnesses who disagree are recorded as a discrepancy, not resolved. My own eight servers are on the register and measured the same way. A second person wrote a Node.js ring builder from the published spec and ring files; it reproduced all eight August rings byte for byte.

Honest numbers today: 9 endpoints, 1 outside witness, 37 ledger entries. That is why I am posting.

Check your own server in ten seconds (nothing is stored unless you ask to be listed):

    curl -s -X POST https://gate.horizonshield.dev/check -H 'content-type: application/json' -d '{"endpoint":"https://YOUR-SERVER/mcp"}'

Be a witness in one command (stdlib Python, no account):

    uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit --witness-name "you" --vantage "where"

Or add it as an MCP server (conduct-witness-mcp, one tool) so your agent is the witness. The sha256 it prints is your receipt.

What it is not: not a rating, not a lie detector, not quality. It records shape, the gap between what a card declares and what the endpoint does, and the gap between witnesses. Declining is honoured (`"listing": "decline"` in your origin's /.well-known/mcp-conduct.json).

Gate: https://gate.horizonshield.dev/spec | Spec: https://gate.horizonshield.dev/ext/conduct/v1 | Register: https://github.com/ogasurfproject-jpg/mcp-conduct-register | Ledger: https://ledger.horizonshield.dev/ledger

I operate the register, so I am not neutral. If your walk disagrees with mine, file it; that is the point.
