---
name: conduct-witness
description: Walk an A2A or MCP agent as an independent witness and file the observation on the public conduct ledger under the user's name. Trigger with "be a witness for", "witness walk", "walk this agent", "証人になる", "この agent を歩いて", or when the user wants their own observation of an agent recorded where the agent cannot edit it.
---

# Conduct witness

You are about to add one line to a record that the agent being walked did not write and cannot delete. Treat it that way: no guessing, no editing, no invented names.

## Before running

1. Ask the user once, if not already known in this conversation: their witness name (a person, a project, or "anonymous") and the vantage (where this machine is, in a few words: "laptop, Osaka", "VPS eu-west", "CI runner"). Never invent either. Reuse them for later walks in the same conversation.
2. Confirm the origin is `https://` and is the agent's card origin (the card lives at `<origin>/.well-known/agent-card.json`), not a page on the site.
3. Do not walk an agent whose owner has declined measurement (`listing: "decline"` in the origin's `/.well-known/mcp-conduct.json`). If unsure, fetch that file first; absent means no objection.

## Run

Preferred (uv installed):

```
uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" a2a-conduct-walk --origin <ORIGIN> --mode a2a --submit --witness-name "<NAME>" --vantage "<VANTAGE>"
```

Fallback (no uv):

```
curl -sSLO https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/a2a-conduct-walk/a2a_conduct_walk.py && python3 a2a_conduct_walk.py --origin <ORIGIN> --mode a2a --submit --witness-name "<NAME>" --vantage "<VANTAGE>"
```

If a fetch node shows `http 403` at the edge, rerun with `--transport curl`. If the user asked to look before filing, omit `--submit` first, show the assertions, then rerun with `--submit` only if they say so.

## Report back, exactly

Give the user these five things from the output, verbatim: the purpose line (which endpoint), `PASS n/5` or `FAIL n/5`, the record's sha256, the intake's answer (`submitted ... http 200` or the reason it was not submitted), and the list of assertions with pass / FAIL / n/a. Say that a FAIL is filed the same way as a PASS and is a finding about the agent, not an error in the walk. Say where it will show up: the ledger bundles the pool once a day (00:30 UTC) at https://ledger.horizonshield.dev/ledger and the month's ring counts the witness by name.

## Never

Never change the witness name to make a record look independent when it is not. If the user operates the agent being walked, put that in the name (for example "Example Corp (operator)"). Never submit twice to pad a count; one walk per agent per day is plenty. Never call this a rating, a score, or a verification of quality.
