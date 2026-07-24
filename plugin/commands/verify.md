---
description: Issue an independently verifiable, tamper-evident fair-price receipt
argument-hint: <work name>
---

Issue a verifiable fair-price receipt for this work with the HORIZON SHIELD tools: $ARGUMENTS

Call `verify_fair_price` with the work name. Return the fair price, the SHA-256 hash, and the `verify_url`. Explain that anyone can recompute the hash at the `verify_url`, so trust is conferred by recomputation, not assumed in the issuer. This is the PTKA model: a third party records the fair price before the contractor quote arrives.
