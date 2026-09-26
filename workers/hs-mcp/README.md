# HORIZON SHIELD  -  MCP server for construction-estimate integrity (Japan)

**An independent, third-party auditor for Japanese construction & renovation estimates.**
Ask whether a quoted price is fair. It checks the number against a curated fair-price
database (*souba-db*, supervised by Toshikatsu Oga  -  30 years in the field), flags known
overcharge tactics, and  -  uniquely  -  can return a **Bitcoin-anchored, independently
verifiable signed receipt** (PTKA: Pre-Transaction Knowledge Anchoring). The AI doesn't
just say *"fair"*  -  it hands you cryptographic proof you can verify yourself.

Works with any MCP client: **Claude  |  ChatGPT  |  Gemini  |  Perplexity  |  Cursor  |  Cline** and more.

- **Remote endpoint (streamable HTTP):** `https://mcp.horizonshield.dev`
- **No auth, no install**  -  add the URL as a custom connector.
- **Registry name:** `io.github.ogasurfproject-jpg/horizon-shield`
- Operator: The HORIZONs Inc.  |  https://shield.the-horizons-innovation.com

日本の建設・リフォーム見積もりが適正かを、AIエージェントから「呼べる」中立の第三者監査。相場データ(souba-db／大賀俊勝 実務監修30年)と照合し、過剰請求の赤旗を検知し、**Bitcoinに刻印された検証可能な署名レシート**まで返す。AIが「適正」と言うだけでなく、誰でも自分で検証できる証拠を出す。

## Why it's different
- **Verifiable, not just an opinion.** Fair prices come with a SHA-256 claim hash and a
  Bitcoin block anchor (via OpenTimestamps / the JIDEC third-party stamping ledger).
  Recompute the hash yourself  -  you don't have to trust the issuer. *Conferred verifiability.*
- **Recorded before the quote (PTKA).** A neutral fair price is anchored *before* the
  contractor's estimate arrives, so it can't be rewritten to suit the seller.
- **Field-supervised data.** souba-db is curated from multiple public price sources plus
  30 years of on-site experience  -  not scraped guesses.

## Tools (30)

### Fair price, verification and contractors (15)
| Tool | What it does |
|---|---|
| `get_price_range` | Fair price range (min/avg/max), overcharge danger threshold, unit, trend |
| `audit_estimate` | Judge a specific quoted amount vs the fair range  -  verdict, % gap, advice |
| `verify_fair_price` | Fair price as a **tamper-evident signed receipt** (SHA-256 + Bitcoin / PTKA) |
| `check_red_flags` | Detect overcharge / high-pressure sales tactics (lump-sum, today-only, etc.) |
| `preview_reverse_estimate` | Early-stage preview: which way a rough estimate deviates from average |
| `search_cost_category` | Find a construction-cost category by keyword |
| `list_cost_categories` | List the curated cost categories |
| `get_estimate_reading_guide` | Universal principles for judging any estimate (overhead ratio, lump-sum, tactics) |
| `get_fair_price_sources` | Sources, update date, and regional multipliers behind the data |
| `suggest_ehn` | Suggest an EHN (anonymous-estimate) entry |
| `get_jccdb_dataset_info` | JCCDB open dataset (95,403 items, CC BY 4.0)  -  metadata & citation |
| `verify_integrity_claim` | Third-party verification of an issued signed claim (fail-closed) |
| `create_ap2_fairness_attestation` | FairPriceAttestation shaped to attach to a Google AP2 Cart Mandate (optional quoted_price adds within/above/below) |
| `get_agent_card` | A2A (Agent2Agent) agent card for agent interop |
| `find_verified_contractor` | Verification-passed contractors on Yakumo (no referral or listing fee; scores and tiers, never prices) |

Fair-price verdicts are Japan-specific (JPY). Several tools (`check_red_flags`, `get_estimate_reading_guide`) are
language-agnostic and work for estimates anywhere.

### Construction cost data: Japan (JCCDB) and both countries (7)
| Tool | What it does |
|---|---|
| `search_jccdb_items` | Search the 95,403 JCCDB line items by name, with evidence URLs |
| `get_jccdb_observations` | Region, date and price status of an item in Japanese and U.S. public documents (licence and source on every row) |
| `get_jccdb_labor_rate` | MLIT public-works design labor rates by prefecture and trade |
| `compare_jccdb_regions` | Latest value per region for an item and spec (min, median, max) |
| `get_jccdb_work_unit_price` | Public-works unit prices for work items with composition ratios |
| `get_jccdb_index_series` | Construction cost index series with computed year-over-year change |
| `get_jccdb_coverage` | What the observation layers hold, and what is absent |

### Construction cost data: United States (USCCDB) (8)
USCCDB is the United States Construction Cost Database. The four chain tools (`get_us_price_chain`, `get_us_import_landed_cost`, `get_us_trade_margins`, `get_us_contract_discounts`) compute on request and are not distributed as files.

| Tool | What it does |
|---|---|
| `get_us_construction_prices` | U.S. public construction cost data by layer, region, period and item |
| `get_us_prevailing_wage` | Davis-Bacon prevailing wages by state, county and trade |
| `get_us_permits` | U.S. building permits and declared valuations by region and year |
| `get_us_area_factor` | DoD and USACE location cost factors |
| `get_us_price_chain` | Estimated U.S. prices from landed import cost to wholesale, retail and contractor (computed on request) |
| `get_us_import_landed_cost` | Landed cost of U.S. imports by HS code, duty included |
| `get_us_trade_margins` | U.S. wholesale and retail gross margins by NAICS |
| `get_us_contract_discounts` | Discount rates off list price in U.S. public contracts |

## Try it
```bash
# server info
curl https://mcp.horizonshield.dev

# list tools (JSON-RPC 2.0)
curl -X POST https://mcp.horizonshield.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Add it to your AI
- **Claude / ChatGPT / Gemini:** Settings -> Connectors / Custom apps -> add the remote URL above.
- **Programmatic:** any MCP client that speaks streamable HTTP JSON-RPC (stateless).

## Deploy (maintainer)
The server source is not in this repository. The maintainer deploys from a private working tree with this folder's `wrangler.jsonc` (bindings: `RL_KV`, `HEARING_SVC`, `JCCDB_SVC`); this folder holds the listing metadata and the conformance tests.

## License & data
Tool logic (c) The HORIZONs Inc. Underlying open data: JCCDB (CC BY 4.0). souba-db is a curated
reference maintained by HORIZON SHIELD.
