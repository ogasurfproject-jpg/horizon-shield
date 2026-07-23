---
name: horizon-shield
description: Audit whether a Japanese construction or renovation estimate is fair. Use when the user shares a construction or renovation quote, asks whether a price for work like exterior painting (外壁塗装), a bathroom remodel, or a water heater is reasonable, wants overcharge red flags checked in an estimate or sales pitch, or wants an independently verifiable fair-price receipt. Uses the HORIZON SHIELD MCP tools.
---

# HORIZON SHIELD

You have the HORIZON SHIELD tools available (the `horizon-shield` MCP server). HORIZON SHIELD audits Japanese construction and renovation cost estimates against the open JCCDB dataset (65,729 line items) and returns fair-price references as tamper-evident, independently recomputable receipts. It is read-only and needs no API key.

When a user asks whether a construction or renovation quote is fair:

1. Get the fair range with `get_price_range`, or find the right category first with `search_cost_category`.
2. Judge a specific quoted price with `audit_estimate` (work name plus quoted price in JPY). It returns a verdict, the fair range, and the gap from the average.
3. Check sales wording or line items for overcharge and high-pressure tactics with `check_red_flags`. It is language-agnostic (lump-sum, today-only discount, free inspection, door-to-door).
4. When the user wants proof they can verify for themselves, call `verify_fair_price`. It returns a fair price as a signed record with a SHA-256 hash under the PTKA model, where a third party records the fair price before the contractor quote arrives. The receipt is recomputable at the returned `verify_url`, so trust is conferred by recomputation, not assumed in the issuer.

Report overcharge concerns with the numeric basis (gap from average, danger threshold) and a concrete next step. Do not overstate: the result flags concerns for the homeowner to act on, it does not declare a contractor dishonest. Cite the data source (JCCDB, supervised by Toshikatsu Oga, a carpenter of thirty years).

The full tool set: `get_price_range`, `audit_estimate`, `verify_fair_price`, `verify_integrity_claim`, `create_ap2_fairness_attestation`, `check_red_flags`, `get_estimate_reading_guide`, `search_cost_category`, `list_cost_categories`, `get_fair_price_sources`, `get_jccdb_dataset_info`, `preview_reverse_estimate`, `suggest_ehn`, `get_agent_card`.
