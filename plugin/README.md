# HORIZON SHIELD (Claude plugin)

Audit Japanese construction and renovation estimates against the open JCCDB dataset (65,729 line items, CC BY 4.0) and return Bitcoin-anchored, independently recomputable fair-price receipts.

This plugin bundles:

- A remote MCP connector (`horizon-shield`) that points at the public HORIZON SHIELD server at `https://hs-mcp.oga-surf-project.workers.dev`. Read-only, no API key.
- A skill that teaches Claude when and how to use the audit tools.

## What it does

A homeowner commissioning construction work cannot reliably judge whether a quote reflects a fair price. HORIZON SHIELD makes a third-party fair-price reference callable and verifiable by software, so an agent can check a number instead of trusting it. Each fair-price claim carries a SHA-256 hash under the PTKA model (a third party records the fair price before the contractor quote) and is recomputable by anyone at a public verify URL.

## Tools (14, all read-only)

`get_price_range`, `audit_estimate`, `verify_fair_price`, `verify_integrity_claim`, `create_ap2_fairness_attestation`, `check_red_flags`, `get_estimate_reading_guide`, `search_cost_category`, `list_cost_categories`, `get_fair_price_sources`, `get_jccdb_dataset_info`, `preview_reverse_estimate`, `suggest_ehn`, `get_agent_card`.

## Safety

Read-only. The server moves no money and no cryptocurrency: the AP2 tool only issues a verification attestation, and Bitcoin is used solely as an OpenTimestamps timestamp anchor. No personal data is stored by the server; inputs are a work name and a price.

## Source and data

- Server and dataset: https://github.com/ogasurfproject-jpg/horizon-shield
- Live service: https://shield.the-horizons-innovation.com
- Privacy policy: https://shield.the-horizons-innovation.com/privacy

## Author

Toshikatsu Oga, The HORIZONs Co., Ltd., Hiratsuka, Japan. ORCID 0009-0000-9180-903X.

## License

MIT
