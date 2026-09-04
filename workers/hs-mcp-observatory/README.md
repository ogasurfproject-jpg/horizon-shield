# hs-mcp-observatory

A public record of what answered when every https endpoint declared in the official MCP registry was contacted once, read only, on 2026-08-23. It is not a directory and it does not list addresses: you look up an address you already hold, or ask for the aggregate.

Endpoint: `https://observatory.horizonshield.dev/mcp` (streamable-http, stateless, no auth). Health: `/health`. One address without MCP: `/lookup?address=https://example.com/mcp`.

Tools

- `mcp_observatory_state`: what was measured, when, over what population, and what the measurement cannot tell you. Read this before quoting any number.
- `mcp_observatory_summary`: the counts as published and as corrected.
- `mcp_observatory_lookup`: what happened when one address was contacted, or an aggregate for one host, with the record hash and the procedure to recompute it.
- `mcp_observatory_disclosure_guide`: how the servers that stated who compensates their operator actually did it, as observed, with counts.
- `mcp_observatory_measure_now`: contact one https address now, read only, and report whether it speaks MCP, carries an agent card, and whether that card names who compensates the operator. Rate limited.
- `mcp_observatory_method`: the procedure, so anyone can redo it.

Limits, stated in the server itself: the published record is one walk on one day. A refusal can be correct behaviour. Absence of a payer field in an agent card on that day is all the record says; it is not a finding about the operator.

Report: https://shield.the-horizons-innovation.com/verify-directory/survey/1/
Raw walk: https://shield.the-horizons-innovation.com/verify-directory/survey/data/survey1_walk_2026-08-23_run2.jsonl
Recompute: https://shield.the-horizons-innovation.com/verify-directory/recompute/

Registry: `io.github.ogasurfproject-jpg/hs-mcp-observatory`, published from this directory with the MCP registry publish workflow (server_dir = workers/hs-mcp-observatory).
