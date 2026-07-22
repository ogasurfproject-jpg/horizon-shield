# HORIZON SHIELD  -  MCP server for construction-estimate integrity (Japan)

**An independent, third-party auditor for Japanese construction & renovation estimates.**
Ask whether a quoted price is fair. It checks the number against a curated fair-price
database (*souba-db*, supervised by Toshikatsu Oga  -  30 years in the field), flags known
overcharge tactics, and  -  uniquely  -  can return a **Bitcoin-anchored, independently
verifiable signed receipt** (PTKA: Pre-Transaction Knowledge Anchoring). The AI doesn't
just say *"fair"*  -  it hands you cryptographic proof you can verify yourself.

Works with any MCP client: **Claude  |  ChatGPT  |  Gemini  |  Perplexity  |  Cursor  |  Cline** and more.

- **Remote endpoint (streamable HTTP):** `https://hs-mcp.oga-surf-project.workers.dev`
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

## Tools (13)
| Tool | What it does |
|---|---|
| `get_price_range` | Fair price range (min/avg/max), overcharge danger threshold, unit, trend |
| `audit_estimate` | Judge a specific quoted amount vs the fair range  -  verdict, % gap, advice |
| `verify_fair_price` | Fair price as a **tamper-evident signed receipt** (SHA-256 + Bitcoin / PTKA) |
| `red_flag_check` | Detect overcharge / high-pressure sales tactics (lump-sum, today-only, etc.) |
| `reverse_estimate_preview` | Early-stage preview: which way a rough estimate deviates from average |
| `search_cost_category` | Find a construction-cost category by keyword |
| `list_cost_categories` | List the curated cost categories |
| `how_to_read_estimate` | Universal principles for judging any estimate (overhead ratio, lump-sum, tactics) |
| `fair_price_data_sources` | Sources, update date, and regional multipliers behind the data |
| `suggest_ehn` | Suggest an EHN (anonymous-estimate) entry |
| `jccdb_dataset_info` | JCCDB open dataset (65,729 items, CC BY 4.0)  -  metadata & citation |
| `verify_integrity_claim` | Third-party verification of an issued signed claim (fail-closed) |
| `get_agent_card` | A2A (Agent2Agent) agent card for agent interop |

Pricing is Japan-specific (JPY). Several tools (`red_flag_check`, `how_to_read_estimate`) are
language-agnostic and work for estimates anywhere.

## Try it
```bash
# server info
curl https://hs-mcp.oga-surf-project.workers.dev

# list tools (JSON-RPC 2.0)
curl -X POST https://hs-mcp.oga-surf-project.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Add it to your AI
- **Claude / ChatGPT / Gemini:** Settings -> Connectors / Custom apps -> add the remote URL above.
- **Programmatic:** any MCP client that speaks streamable HTTP JSON-RPC (stateless).

## Deploy (maintainer)
The parent folder's `wrangler.jsonc` points at a different Worker, so **cd into this folder first**:
```bash
cd workers/hs-mcp
npx wrangler deploy   # no bindings, no secrets required
```

## License & data
Tool logic (c) The HORIZONs Inc. Underlying open data: JCCDB (CC BY 4.0). souba-db is a curated
reference maintained by HORIZON SHIELD.
