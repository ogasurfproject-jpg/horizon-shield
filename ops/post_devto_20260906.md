---
title: Give your AI agent a record it did not write (ten minutes)
published: false
tags: mcp, ai, opensource, security
canonical_url:
---

## The short version

Almost every "trust" signal for an AI agent today, whether it is an MCP server or an A2A agent, is self-reported. The description in the card, the score on a directory, the vendor's blog. All of it is written by the agent or by someone the agent pays.

This is a ten minute procedure for the other kind of record: **your agent measured by someone who is not you, from their own machine, with the observation stored where neither you nor the register operator can edit it.** Or the reverse: you become that someone for another agent. One command. No key, no account, no payment.

Honest numbers first (2026-09-06): 9 rows on the register, 1 outside witness, 37 ledger entries, all anchored to Bitcoin. It is small. That is why this post exists.

## What exists

Three parts, all public, all Apache-2.0, all run by my company (The HORIZ音s株式会社, Hiratsuka, Japan). The operator's own servers are on the same register and measured by the same gate.

1. **The gate** (https://gate.horizonshield.dev). A free checker that measures an MCP endpoint on five conditions: does it answer, does it publish an agent card, does it disclose who pays it, does the same input give the same output, does every verdict carry a SHA-256 you can recompute. No scores. Verified or pending, that is all. Listed rows are re-measured daily or weekly. The day and the tool measured are derived from a salt the gate commits to before the window opens and from a Bitcoin block mined after that, so the subject cannot predict its turn and the gate cannot choose after the fact.
2. **Rings** (NENRIN). Once a month, per endpoint, a JSON file of counts: measurements, witnesses, discrepancies. No rates, no scores, no ranks. Each ring carries the sha256 of the previous one; the month's list is anchored to Bitcoin. A Python builder and a Node.js builder written by someone else from the published spec and ring files produced the same eight August rings byte for byte (ledger entry 34, with entry 36 narrowing the provenance claim).
3. **The ledger** (JIDEC). Append-only. Witness observations are pooled, bundled once a day, and stamped to Bitcoin through OpenTimestamps. The operator cannot edit it either.

An agent card can carry a small extension pointing at all of this, the [A2A Conduct Extension v1](https://gate.horizonshield.dev/ext/conduct/v1): who pays the agent, where the third-party record lives, where to file your own observation. Three pointers, no score.

## Ten minutes: be a witness

With Python 3.8+ and [uv](https://docs.astral.sh/uv/):

```
uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" \
  a2a-conduct-walk --origin https://mcp.horizonshield.dev --mode a2a --submit \
  --witness-name "your name or project" --vantage "where this runs, e.g. laptop in Berlin, VPS us-east"
```

What happens: the agent card is fetched twice and compared byte for byte; the extension declaration is validated against the spec; one A2A `SendMessage` goes to the measured endpoint with the `A2A-Extensions` header, and the response shape and header echo are checked; every response body's sha256 goes into the record; the record is POSTed to the intake the card itself names. The last line prints `submitted ... http 200` and the record's sha256. **That sha256 is your receipt.** It appears in the next day's bundle on the ledger, and the month's ring counts you by name.

Leave off `--submit` and nothing leaves your machine (the record is written to `walk_<sha12>.json` so you can read it first). `--transport curl` if an edge answers 403 to Python. `--wire 0.3` walks as a 0.3 client would.

If your agent already speaks MCP, the same walk is a one-tool MCP server. Claude Code:

```
claude mcp add conduct-witness -- uvx --from "git+https://github.com/ogasurfproject-jpg/horizon-shield#subdirectory=workers/hs-ledger/nenrin/a2a-conduct-walk" conduct-witness-mcp
```

Then: "walk https://mcp.horizonshield.dev as a witness, my name is X, vantage Y". The walk runs where your agent runs, so the vantage is yours.

## Ten seconds: see your own server

```
curl -s -X POST https://gate.horizonshield.dev/check -H 'content-type: application/json' -d '{"endpoint":"https://your-server/mcp"}'
```

Five conditions, each with a reason, and a sha256. Nothing is stored unless you ask to be listed (`POST /watch`). To decline measurement, put `"listing": "decline"` in your origin's `/.well-known/mcp-conduct.json`; the gate honours it and records only that you declined.

## The ladder

Ten minutes: file one walk under your name. One hour: declare the extension in your own card so your record is findable (the gate's `/check` tells you whether the declaration is well formed). One day: run your own gate or ledger and anchor each other's roots. Every month: countersign the ring list with your key (a witness council is being designed; a seat is earned by records written, never bought).

Each step up is built so that if that person disappears, the record stays. Not blaming volunteers who leave is how you get volunteers.

## What this is not

It does not measure quality. It cannot tell whether a card's `compensation` is true; it records malformed shape, the gap between what a card declares and what the endpoint does, and the gap between witnesses. A PASS is one observation, not a verdict. A FAIL is filed the same way. Once filed, you cannot withdraw your own observation; that is the property you are contributing.

It is not a lie detector. It is a machine for keeping disagreements. A liar cannot delete a disagreement.

## Prior art and neighbours

Every component is old: Certificate Transparency, Rekor, in-toto, SCITT, OpenTimestamps, RFC 8785. Section 9 of the spec names what differs from ERC-8004, A2A discussion #1631 and Sigstore-signed agent cards. The closest thing running today is Agenstry, an observatory that re-measures A2A agents weekly and publishes Merkle roots; they have scale and identity checks, this has outside witnesses, external anchoring and no scores. Less a competitor than the first witness I would like to recruit.

## How to falsify it

Every verdict carries a sha256. Pull a ledger entry's bytes, hash them yourself, verify the `.ots` with OpenTimestamps. Rebuild any ring from the archived history with `scripts/make_ring.py --verify`. The gate's source is public with an 82 vector red team and a 40 vector red team on the time coordinate. If you get a different result, that itself becomes a record. Section 10 of the spec says fork it or reimplement it without asking.

Gate: https://gate.horizonshield.dev/spec · Register: https://github.com/ogasurfproject-jpg/mcp-conduct-register · Ledger: https://ledger.horizonshield.dev/ledger · Spec: https://gate.horizonshield.dev/ext/conduct/v1 · Witness tool: https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/a2a-conduct-walk

I operate the register, so I am not neutral. Disclosure: drafted with AI assistance.
