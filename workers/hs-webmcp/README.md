# HORIZON SHIELD — Construction Estimate Auditor for Japan (KIRA)

> A **Model Context Protocol (MCP)** server that lets an AI agent check whether a Japanese construction or renovation **quote is fair** — auditing it against an **open 65,729-item cost database**, flagging known **overcharge tactics**, and returning a **verifiable, tamper-evident** result. Neutral third party. No referral fees. No auto-posting.

<!-- Glama badge: copy the exact SVG URL from your listing page (Glama > your server > "Badges") and paste it here -->
<!-- [![HORIZON SHIELD WebMCP on Glama](GLAMA_BADGE_URL)](GLAMA_LISTING_URL) -->

**WebMCP Intake (KIRA)** is the public intake desk of HORIZON SHIELD. A homeowner commissioning construction work cannot reliably tell whether a quote is honest — a textbook **credence-good** problem. This server makes a neutral, third-party **fair-price audit callable as a tool**, so an agent can *check* a number instead of trusting it.

- **Protocol:** Model Context Protocol (MCP), streamable HTTP
- **Endpoint:** `https://hs-webmcp.oga-surf-project.workers.dev/mcp`
- **Access:** read-only, no API key required
- **Data region:** Japan (JPY) — built on the open **JCCDB** dataset (65,729 line items) + 61 curated work categories
- **Supervision:** 30 years of construction field experience (Toshikatsu Oga, ORCID `0009-0000-9180-903X`)
- **Operator:** THE HORIZONS INC — independent, takes **no** referral fees or kickbacks from contractors

## What it does

Give it a work type (e.g. `外壁塗装` / exterior wall painting) and, optionally, the quoted price in JPY. It returns a **fair-price verdict**, flags **known overcharge tactics** with primary-source citations, and can draft public **awareness content** — all from verifiable first-party data, never guessed numbers. It never pressures, never auto-posts, and never gives a bare "too high / too low"; it hands you **what to ask the contractor**.

## Tools

| Tool | What it does |
|------|--------------|
| `orchestrate` | **Start here.** One call runs intake + tactic-scan + broadcast-draft together and returns a single bundle. The fastest way to see the whole server. |
| `intake_estimate` | Bridges a homeowner's quote (work + price in JPY) to the KIRA fair-price audit; returns a verdict plus a path to a free third-party check (EHN). |
| `scan_tactics` | Returns **verified** overcharge tactics for a given work type, with pointers to primary sources (Japan Consumer Affairs Agency, NCAC, the EHN case board). Awareness, not a price verdict. |
| `draft_broadcast` | Generates awareness **drafts** (long-form for note, short for X) with real backlinks. Verifiable first-party prices only; draft only — the operator finalizes. No auto-posting. |

## Try it (example prompts)

Once connected, ask your agent:

- `外壁塗装の見積もりが120万円。適正か診断して` → runs `intake_estimate`
- `Is a ¥1,200,000 exterior-wall-painting quote fair for a Japanese house?` → `intake_estimate`
- `シロアリ駆除でよくある過剰請求の手口を教えて` → `scan_tactics`
- `Run the full HORIZON SHIELD check on 屋根塗装, quoted ¥900,000` → `orchestrate`

## Resources & prompts

**Resources:** `about-horizon-shield`, `jccdb-dataset-info` (65,729 items, license + citation), `souba-categories` (61 work categories), `souba-sources` (fair-price sources + regional multipliers), `ehn-info` (free anonymous estimate-review board).
**Resource templates:** `souba://category/{query}` (category search), `souba://price/{work}` (fair price range: min / avg / max).
**Prompts:** `diagnose_my_estimate`, `how_to_read_an_estimate`.

## Connecting

This is a remote MCP server — point any MCP client at the endpoint:

```json
{
  "mcpServers": {
    "horizon-shield-intake": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://hs-webmcp.oga-surf-project.workers.dev/mcp"]
    }
  }
}
```

## Why trust it

- **Neutral third party.** Takes no referral fees or send-off rewards from contractors.
- **Verifiable.** Fair prices are returned as tamper-evident records with a **SHA-256** hash, under a Pre-Transaction Knowledge Anchoring model (a third party records the fair price *before* the contractor's quote).
- **Open data.** Built on the public **JCCDB** dataset (65,729 line items) plus 61 curated categories with maintained price ranges and red flags.
- **No pressure, no auto-posting.** It returns what to ask, points to primary sources, and never publishes on its own.

## Links

- Website: https://shield.the-horizons-innovation.com
- Free estimate-review board (EHN): https://shield.the-horizons-innovation.com/ehn/
- Main MCP server (raw audit tools): `https://hs-mcp.oga-surf-project.workers.dev`

## Keywords

construction estimate, renovation quote, home improvement, fair price, overcharge detection, cost verification, contractor quote, price benchmark, Japan, JCCDB, 見積もり, 外壁塗装, 屋根塗装, リフォーム, 過剰請求, 相場, 適正価格, consumer protection, credence good.
