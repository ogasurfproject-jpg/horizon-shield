<div align="center">

# 🛡️ HORIZON SHIELD

### Verifiable construction estimate auditing for AI agents

**Don't trust the estimate. Verify it.**

An [MCP](https://modelcontextprotocol.io) server that lets AI agents check whether a Japanese construction or renovation estimate is fair, against open data, and returns a result **anyone can verify against Bitcoin** (OpenTimestamps). No account, no key.

[![MCP Registry](https://img.shields.io/badge/MCP-Registry-2f6feb)](https://registry.modelcontextprotocol.io/v0.1/servers?search=horizon-shield)
[![Transport: streamable-http](https://img.shields.io/badge/transport-streamable--http-2ea043)](https://mcp.horizonshield.dev)
[![Open data: JCCDB 95,403 · CC BY 4.0](https://img.shields.io/badge/open%20data-JCCDB%2095%2C403%20%C2%B7%20CC--BY%204.0-e36209)](https://github.com/ogasurfproject-jpg/japan-construction-cost-database)
[![Anchored: Bitcoin / OpenTimestamps](https://img.shields.io/badge/anchored-Bitcoin%20%2F%20OpenTimestamps-f7931a)](https://ledger.horizonshield.dev/ledger)
[![Auth: none](https://img.shields.io/badge/auth-none-6e7681)]()
[![GitHub stars](https://img.shields.io/github/stars/ogasurfproject-jpg/horizon-shield?style=social)](https://github.com/ogasurfproject-jpg/horizon-shield/stargazers)
[![HORIZON SHIELD KIRA on Glama](https://glama.ai/mcp/servers/ogasurfproject-jpg/horizon-shield/badges/score.svg)](https://glama.ai/mcp/servers/ogasurfproject-jpg/horizon-shield)
[![Smithery](https://img.shields.io/badge/Smithery-listed-e35f34)](https://smithery.ai/servers/oga-surf-project/horizon-shield)

</div>

---

## NENRIN: tree rings for AI facing services

> A tree adds one ring a year. Nobody can paint one in afterwards. NENRIN gives that property to software services.

In one thirty day window, measured 2026-08-17, this server appeared in **93,983** AI search results. How many of those became a call from outside, we cannot say. The usage counter deliberately stores no IP addresses, so it cannot separate our own automated checks from external traffic. An earlier version of this paragraph said the answer was **0**. This instrument cannot establish that, so the claim is withdrawn here rather than quietly deleted. Discovery is solved. Choice is not. An agent picking between 90,000 servers can only read what each vendor wrote about itself. NENRIN adds the missing layer: records of conduct that the vendor did not author and cannot delete.

How it works, in three lines:

1. **Open witnessing.** Anyone can measure any endpoint and submit the walk to the public ledger under their own name and vantage. The operator holds no veto: acceptance is mechanical schema checking, and the code that enforces this is in this repository.
2. **Discrepancies are the product.** When two witnesses report incompatible observations of the same target, the disagreement itself becomes a permanent, citable record. The founding one is real: [NENRIN_DISCREPANCY_0001](workers/hs-ledger/nenrin/NENRIN_DISCREPANCY_0001.md), two honest witnesses, one target, both correct.
3. **Rings.** Each month the accepted records bundle into a ring that carries the hash of the previous ring, timestamped to Bitcoin. Eighteen months of rings cannot be created in an afternoon, by anyone, including us.

The specification is anchored on the public ledger as entry 19
(`sha256 9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d`):
[NENRIN_SPEC_v1.md](workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md). It names its own prior art (Certificate Transparency, Rekor, in-toto, SLSA, OpenTimestamps), states exactly which combination is claimed as new, and invites refutation into the same ledger.

**The witness intake is live.** Start here:

```
curl -s https://ledger.horizonshield.dev/witness
```

We are the first test subject under our own rules. The ledger keeps the record of our gate failing its own test, and the full 522 incident that started all of this. Unflattering records stay.

**If a register that cannot delete criticism of its own operator is infrastructure you want to exist, star this repository.** Stars are how researchers and agent platforms find it. The rings accumulate either way. They accumulate faster with witnesses.

## Repository map

| Path | What it is |
|------|------------|
| `workers/hs-verify-gate` | The verification gate: nightly sweeps, on demand checks, `probed_via` route disclosure, `gate_commit` pinning, surface change tracking |
| `workers/hs-ledger` | The JIDEC append only ledger and the NENRIN witness intake |
| `workers/hs-verify-relay` | The public edge relay born from the 522 incident (documented in the discrepancy record) |
| `verify-directory` | The public register page: every listed server, our own included, with its live verdict |
| everything else | The GitHub Pages site for the human facing service at the-horizons-innovation.com |

## The register, as a repository

The same measurements are published as a standalone, machine generated repository:
**[mcp-conduct-register](https://github.com/ogasurfproject-jpg/mcp-conduct-register)**.

Nobody selects the rows there either. A script rebuilds the table from the public API once a day,
and the same run writes a
[`register.json`](https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json)
snapshot so an agent can read the register without parsing Markdown. It carries a `CITATION.cff`,
so the register can be cited the way a dataset is cited, and an
[`llms.txt`](https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/llms.txt)
that states in plain words what the register is and, more importantly, what it is not.

## Three ways in, none of which need us

Since 2026-09-04 the gate can be used without asking anyone at HORIZON SHIELD.

**For the server you operate.** Put `{"allow_tool_call": true}` at `/.well-known/mcp-conduct.json` on your
origin. Only the owner of an origin can place a file there, so the gate takes it as consent, measures
determinism on the public register with it, and writes into every verdict where it read it (gate 0.2.4).
Add a `compensation` block to your agent card (`paid_by`, `referral_fee`, `listing_fee`; the content is not
judged, only its absence) and `POST /watch` once. A row can then reach `verified` with no hand of ours involved.

**For your CI.** One step measures the server on every push and recomputes the verdict hash on the runner,
so the gate is never trusted:
[mcp-conduct-action](https://github.com/ogasurfproject-jpg/mcp-conduct-action)
(`uses: ogasurfproject-jpg/mcp-conduct-action@v1`).

**For the agent that connects.** [`mcp-conduct`](https://www.npmjs.com/package/mcp-conduct) on npm
(zero dependencies) reads `/is-verified` before an MCP client connects and applies a policy you choose:
`warn`, `measured` (block only what was measured and did not pass), `verified-only`, or `off`.
`verified` is `true` or `null`, never `false`; not measured is never failed. Source:
[mcp-conduct](https://github.com/ogasurfproject-jpg/mcp-conduct).

Stated plainly: as of 2026-09-05 the register holds our own servers and nobody else's. The doors are open;
the first outside row has not walked through yet.

## JIDEC: verify this project without trusting it

The verification process behind HORIZON SHIELD's results is published as a Bitcoin anchored, append only public ledger. You do not have to trust us: fetch the anchored bytes, hash them yourself, and check the timestamp.

- Start here: <https://ledger.horizonshield.dev/llms.txt>
- Ledger index: <https://ledger.horizonshield.dev/ledger>
- Machine readable catalog (RFC 9727): <https://ledger.horizonshield.dev/.well-known/api-catalog>
- Read only MCP endpoint: <https://jidec.horizonshield.dev/mcp>

One line is enough to check any entry:

```
curl -s "https://ledger.horizonshield.dev/ledger/5?format=raw" | shasum -a 256
```

What this proves and what it does not is stated by the ledger itself at `/health` under `transparency`, including that OpenTimestamps has no RFC, ISO or eIDAS standing.

The previous hostnames, `hs-ledger.oga-surf-project.workers.dev` and `hs-jidec-mcp.oga-surf-project.workers.dev`, still answer and always will. Records already anchored to Bitcoin cite them, so retiring them would make past receipts unverifiable.

## What the MCP server does

A homeowner commissioning construction work cannot reliably judge whether a quote reflects a fair price. This is a textbook credence good problem. This MCP server makes a third party fair price reference callable and verifiable by software, so an agent can check a number instead of trusting it.

- **Protocol:** Model Context Protocol (MCP)
- **Transport:** MCP over Streamable HTTP (JSON-RPC 2.0). The legacy SSE transport is not implemented; GET on /sse answers 405 sse_not_supported.
- **Endpoint:** `https://mcp.horizonshield.dev`
- **Access:** read only, no API key required
- **Data region:** Japan (JPY), built on the open JCCDB dataset (95,403 line items)

## Tools

| Tool | Description |
|------|-------------|
| `get_price_range` | Returns the fair price range (min, avg, max), the overcharge danger threshold, unit, price trend, and field notes for a Japanese construction or renovation job. |
| `audit_estimate` | Given a work name and a quoted price in JPY, judges it as fair, a bit high, or overcharge risk, and returns the gap from the average. |
| `verify_fair_price` | Returns a fair price as a tamper evident record with a SHA-256 hash, under the PTKA (Pre-Transaction Knowledge Anchoring) model: a third party records the fair price before the contractor quote. |
| `check_red_flags` | Checks whether wording in an estimate or sales pitch matches known overcharge or high pressure tactics (lump sum, today only discount, free inspection, door to door). Language agnostic. |
| `get_estimate_reading_guide` | Returns universal principles for judging whether any estimate is honest: the overhead ratio, how to treat lump sum entries, how to spot pressure tactics. Language agnostic. |
| `list_cost_categories` | Lists the construction and renovation work categories for which fair price ranges and red flags are maintained. |
| `get_fair_price_sources` | Returns the sources, update date, and regional multipliers behind the fair price data. |
| `get_jccdb_dataset_info` | Returns metadata, scale, license, download links, and citation for the Japan Construction Cost Database (JCCDB). |
| `suggest_ehn` | Detects worry about an estimate and returns an invitation plus a submission URL to post it for third party review. |
| `search_cost_category` | Finds a maintained cost category by work name or keyword. |
| `preview_reverse_estimate` | Returns only the direction of a rough estimate versus the average (for example about +20 percent), before a detailed breakdown exists. |
| `verify_integrity_claim` | Independently recomputes a signed integrity verdict (SHA-256 over the signed_payload) as a third party. Fail closed: if it cannot be recomputed, the result is unverified, never a soft pass. |
| `create_ap2_fairness_attestation` | Issues a FairPriceAttestation shaped to attach to a Google AP2 (Agent Payments Protocol) Cart Mandate, so a fair price proof can ride alongside the payment authorization. Optional `quoted_price` adds a within / above / below verdict. |
| `get_agent_card` | Returns the A2A Agent Card URL and published skills for agent to agent discovery. |

## Connecting

This is a remote MCP server. Point any MCP client at the endpoint.

```json
{
  "mcpServers": {
    "horizon-shield": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.horizonshield.dev/"]
    }
  }
}
```

If your client supports remote MCP servers directly, use the endpoint URL above.

## Example

```
audit_estimate(work: "外壁塗装 30坪", quoted_price: 1500000)
```

Returns a verdict (for example, overcharge risk), the fair range (min, avg, max), and the gap from the average. `verify_fair_price` additionally returns a SHA-256 fingerprint of the fair price claim, anchored under PTKA.

## Verify a verdict yourself

Every `verify_fair_price` call returns a `verify_url` of the form `https://shield.the-horizons-innovation.com/verify/?id=<claim_sha256>`. The [public verify page](https://shield.the-horizons-innovation.com/verify/) recomputes the SHA-256 in your own browser (Web Crypto) and checks it against the receipt. Nothing is sent to any server. The same claim is served back as JSON at `https://mcp.horizonshield.dev/ledger/<claim_sha256>`. Trust is conferred by recomputation, not assumed in the issuer.

Twenty real overcharge diagnoses are also published as tamper evident receipts, each with `claim.txt`, its SHA-256 digest, and an OpenTimestamps proof:

```
sha256sum claim.txt
ots verify -f claim.txt proof.ots
```

- Index of the 20 receipts: <https://shield.the-horizons-innovation.com/souba/kajou-seikyu-jirei-20/>
- The dataset these verdicts belong to is anchored at Bitcoin block 949356.

## AP2 bridge

Google's Agent Payments Protocol (AP2) makes what a user **authorized** verifiable through a signed, tamper evident Mandate. `create_ap2_fairness_attestation` issues a parallel attestation that makes **value** verifiable, shaped to attach to an AP2 Cart Mandate before the user signs. Parallel layers, same philosophy: pre transaction, tamper evident, independently recomputable.

## Data and academic record

- Fair price data is built on the openly published **JCCDB** dataset (95,403 Japanese construction line items, CC BY 4.0): <https://github.com/ogasurfproject-jpg/japan-construction-cost-database>
- PTKA protocol declaration anchored at Bitcoin block 949356 (2026-05-14); JCCDB Extended paper at block 951871 (2026-06-01)
- JCCDB origin paper: [Zenodo 10.5281/zenodo.20019572](https://doi.org/10.5281/zenodo.20019572)
- Audit hash and macro correction: [SSRN 6738701](https://ssrn.com/abstract=6738701), mirrored at [engrXiv](https://engrxiv.org/preprint/view/7007)
- VRQ framework and PTKA model: [SSRN 6807738](https://ssrn.com/abstract=6807738)
- Reproduction package (buyer side verification gate): [GitHub](https://github.com/ogasurfproject-jpg/hs-ehn-verify), archived at [Zenodo 10.5281/zenodo.20756867](https://doi.org/10.5281/zenodo.20756867) (MIT, runnable: `node test/run_local.mjs`)

## Author

Toshikatsu Oga (大賀俊勝), The HORIZONs Co., Ltd., Hiratsuka, Japan. A carpenter of thirty years. ORCID [0009-0000-9180-903X](https://orcid.org/0009-0000-9180-903X).

> "Cheapest is not the same as fair."

> "Verify, don't trust."

> "Thirty years on site taught me the enemy is the middleman, not the craftsman."

Full collection (50 quotes, JSON-LD): [TOshi Oga, in his own words](https://shield.the-horizons-innovation.com/quotes/)

Live diagnostic: <https://shield.the-horizons-innovation.com> · The Evidence: <https://shield.the-horizons-innovation.com/evidence-en/> · The Movement: <https://shield.the-horizons-innovation.com/movement-us/>

## License

Data: JCCDB, CC BY 4.0. Server code: see the LICENSE file in this repository.
