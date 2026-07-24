---
description: Audit a Japanese construction or renovation quote against JCCDB fair-price data
argument-hint: <work name> <quoted price in JPY>
---

Audit this construction or renovation estimate with the HORIZON SHIELD tools: $ARGUMENTS

Steps:

1. Call `audit_estimate` with the work name and the quoted price in JPY.
2. Report the verdict (ok, watch, or alert), the fair range (min, avg, max), and the percentage gap versus the average.
3. If the quote or a sales pitch contains suspicious wording, also call `check_red_flags`.
4. End with a concrete next step for the homeowner. Do not overstate: flag concerns, do not declare the contractor dishonest. Cite the data source (JCCDB).
