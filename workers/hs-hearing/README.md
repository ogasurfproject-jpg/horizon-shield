# HORIZON SHIELD YAKUMO

**A neutral, verification-gated MCP directory of Japanese renovation and construction contractors.**

Yakumo is the contractor-directory layer of [HORIZON SHIELD](https://shield.the-horizons-innovation.com/yakumo/). Only stores that pass an independent fair-price and overcharge audit (KIRA) are listed. Prices are never exposed, only integrity scores and tiers, and unverified stores are never shown to homeowners (fail-closed). Yakumo takes **no referral fees** from contractors.

- **MCP endpoint:** `https://hs-hearing.oga-surf-project.workers.dev/mcp` (Streamable HTTP, POST JSON-RPC)
- **Registry:** `io.github.ogasurfproject-jpg/hs-hearing`
- **Operator:** The HORIZ音s株式会社 / supervised by 大賀俊勝 (Toshikatsu Oga, 30 years in construction, ORCID 0009-0000-9180-903X)
- **Backing dataset:** JCCDB, an open construction-cost database of 65,729 items (CC BY 4.0)

## Tools

| Tool | What it does |
|------|--------------|
| `find_contractor` | Free-text discovery orchestrator. Give it a request like "a trustworthy exterior-painting contractor in Aichi" and it infers the area and trade and returns verified stores, or points to fair-price and third-party-check resources if none match. |
| `list_verified_stores` | List verified contractors, filterable by `area` and `work`. Returns integrity scores and tiers, never prices. Unverified stores are returned separately as `pending_stores`. |
| `get_contractor_profile` | Full verified profile for one store by `member_no` (e.g. `No.001`). |
| `mall_overview` | The directory at a glance: verified count, work categories, areas, verification method, key links. |
| `how_verification_works` | Explains the KIRA audit: fair-price checks, red-flag detection, integrity score and tier, signed receipts, continuous monitoring, fail-closed. |

All tool output is JSON. Prices are never returned; trust is expressed as integrity scores (0-100) and tiers (A-F).

## Resources

- `yakumo://mall`: mall overview (JSON)
- `yakumo://verification`: how verification works (Markdown)
- `yakumo://categories`: work categories and areas in the directory (JSON)
- `yakumo://store/{member_no}`: a single store profile (template)

## Prompts

- `find_a_contractor` (`area`, `work`): guided flow to discover and vet a verified contractor
- `is_this_store_trustworthy` (`member_no`): guided flow to check a store's verification and explain what "verified" guarantees

Argument autocompletion is provided for `area` and `work` via `completion/complete`.

## Web widget (WebMCP)

Any site can embed the discovery widget with one line:

```html
<script src="https://hs-hearing.oga-surf-project.workers.dev/embed.js" async></script>
```

It renders a Shadow-DOM-isolated panel where a visitor searches verified contractors by area and trade. It stores nothing and shows no prices, only scores and tiers, with links back to the mall and to a free anonymous estimate check.

## Discovery and standards

- `GET /.well-known/agent-card.json`: A2A agent card
- `GET /.well-known/security.txt`: RFC 9116 contact
- `GET /.well-known/glama.json`: Glama connector metadata
- Transport compliance: `GET`/`DELETE` on `/mcp` return 405, unsupported `MCP-Protocol-Version` returns 400, notifications return 202, unknown methods return `-32601`.

## How verification works

Listing is decided only by whether a store passes the independent KIRA audit:

1. Real estimate examples are checked against the open construction-cost database (JCCDB) and souba-db to verify fair pricing.
2. Overcharge red flags are detected: lump-sum ("一式") line items, inflated overhead, high-pressure same-day closing.
3. Each trade gets an integrity score (0-100) and tier (A-F). One overcharged trade lowers the whole result.
4. A signed receipt (SHA-256) is attached so anyone can recompute the basis.
5. Pricing is monitored after listing; drift alerts the operator.
6. Stores that do not pass are never shown to homeowners (fail-closed).

Actual amounts are never published to homeowner-facing pages; they are expressed through scores, tiers, and verification. The final judgment is the homeowner's.

## License

Code: see the repository root. Dataset (JCCDB): CC BY 4.0.

## Links

- Mall: https://shield.the-horizons-innovation.com/yakumo/
- Join (contractors): https://shield.the-horizons-innovation.com/yakumo/apply/
- Fair-price reference: https://shield.the-horizons-innovation.com/souba/
- Estimate Hacker News (free anonymous check): https://shield.the-horizons-innovation.com/ehn/
