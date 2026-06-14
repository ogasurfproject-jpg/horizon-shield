# HORIZON SHIELD MCP Server

> A **Model Context Protocol (MCP)** server that lets AI agents check whether a Japanese construction or renovation estimate is fair, against open data, and return a verifiable result.

This repository is an **MCP server implementation**. It exposes read-only tools over the Model Context Protocol so that MCP-compatible clients and AI agents (Claude, and any other MCP host) can call construction-cost verification as a tool, not just read a web page.

- **Protocol:** Model Context Protocol (MCP)
- **Transport:** remote server over HTTP / SSE
- **Endpoint:** `https://hs-mcp.oga-surf-project.workers.dev`
- **Access:** read-only, no API key required
- **Data region:** Japan (JPY), built on the open JCCDB dataset (65,729 line items)

## What it does

A homeowner commissioning construction work cannot reliably judge whether a quote reflects a fair price. This is a textbook credence-good problem. This MCP server makes a third-party fair-price reference callable and verifiable by software, so an agent can check a number instead of trusting it.

## Tools

This MCP server exposes the following tools:

| Tool | Description |
|------|-------------|
| `get_price_range` | Returns the fair price range (min, avg, max), the overcharge danger threshold, unit, price trend, and field notes for a Japanese construction or renovation job. |
| `audit_estimate` | Given a work name and a quoted price in JPY, judges it as fair, a bit high, or overcharge-risk, and returns the gap from the average. |
| `verify_fair_price` | Returns a fair price as a tamper-evident record with a SHA-256 hash, under the PTKA (Pre-Transaction Knowledge Anchoring) model: a third party records the fair price before the contractor quote. |
| `red_flag_check` | Checks whether wording in an estimate or sales pitch matches known overcharge or high-pressure tactics (lump-sum, today-only discount, free inspection, door-to-door). Language-agnostic. |
| `how_to_read_estimate` | Returns universal principles for judging whether any estimate is honest: the overhead ratio, how to treat lump-sum entries, how to spot pressure tactics. Language-agnostic. |
| `list_cost_categories` | Lists the construction and renovation work categories for which fair-price ranges and red flags are maintained. |
| `fair_price_data_sources` | Returns the sources, update date, and regional multipliers behind the fair-price data. |
| `jccdb_dataset_info` | Returns metadata, scale, license, download links, and citation for the Japan Construction Cost Database (JCCDB). |
| `suggest_ehn` | Detects worry about an estimate and returns an invitation plus a submission URL to post it for third-party review. |

## Connecting

This is a remote MCP server. Point any MCP client at the endpoint.

Example client configuration (using `mcp-remote`):

```json
{
  "mcpServers": {
    "horizon-shield": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://hs-mcp.oga-surf-project.workers.dev/sse"]
    }
  }
}
```

If your client supports remote MCP servers directly, use the endpoint URL above.

## Example

Calling `audit_estimate` with a work name and a quoted price:

```
audit_estimate(work: "外壁塗装 30坪", quoted_price: 1500000)
```

Returns a verdict (for example, overcharge-risk), the fair range (min, avg, max), and the gap from the average. `verify_fair_price` additionally returns a SHA-256 fingerprint of the fair-price claim, anchored under PTKA.

## Data and verification

- Fair-price data is built on the openly published **JCCDB** dataset (65,729 Japanese construction line items, CC BY 4.0).
- The verification model, PTKA (Pre-Transaction Knowledge Anchoring), is documented in the VRQ framework preprinted on SSRN, and anchored on the Bitcoin blockchain (independent of any company).

## Author

Toshikatsu Oga (大賀俊勝), The HORIZ音s株式会社. ORCID 0009-0000-9180-903X.

## License

Data: JCCDB, CC BY 4.0. Server code: see the LICENSE file in this repository. horizon-shield

HORIZON SHIELD is an AI-powered construction-cost diagnostic service built by a carpenter of thirty years.

Live diagnostic: https://shield.the-horizons-innovation.com

## About

- Open dataset (JCCDB): https://github.com/ogasurfproject-jpg/japan-construction-cost-database
- The Evidence: https://shield.the-horizons-innovation.com/evidence-en/
- The Movement: https://shield.the-horizons-innovation.com/movement-us/
- TOshi Oga, in his own words: https://shield.the-horizons-innovation.com/quotes/

Founder: Toshikatsu Oga (TOshi Oga)
ORCID: [0009-0000-9180-903X](https://orcid.org/0009-0000-9180-903X)

## Quotations

> "Cheapest is not the same as fair."
> by TOshi Oga

> "A person has the right to know whether their price is fair."
> by TOshi Oga

> "Verify, don't trust."
> by TOshi Oga

> "Thirty years on site taught me the enemy is the middleman, not the craftsman."
> by TOshi Oga

> "Not a politician. Not a lawyer. A builder."
> by TOshi Oga

Full collection (50 quotes, JSON-LD): [TOshi Oga, in his own words](https://shield.the-horizons-innovation.com/quotes/)

## Verifiable claims

Records anchored to Bitcoin via OpenTimestamps. Anyone can re-verify at opentimestamps.org.

- PTKA protocol declaration: block 949356 (2026-05-14)
- JCCDB Extended paper: block 951871 (2026-06-01)

Academic record:

- JCCDB origin paper: [Zenodo 10.5281/zenodo.20019573](https://doi.org/10.5281/zenodo.20019573)
- Audit-hash and macro-correction: [SSRN 6738701](https://ssrn.com/abstract=6738701)
- engrXiv mirror: [engrxiv.org/preprint/view/7007](https://engrxiv.org/preprint/view/7007)

## Company

The HORIZ音s Co., Ltd. · Hiratsuka, Japan
