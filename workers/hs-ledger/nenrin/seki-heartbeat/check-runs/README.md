# The SEKI door's check call through MUSUBI

Once a day at 03:47 UTC the door sends its fixed check request: the content check runner (FURUI) checks it, the door (SEKI) admits it, the public ledger (NENRIN) holds the admission. check_loop.py files the execution record under the check contract (../check-contract.json) at the MUSUBI intake, and once Bitcoin has confirmed both records the day is settled with MUSUBI settle v1.19. TOOSHI reads index.json every day. Principal, contractor and relying party are all The HORIZONs Co., Ltd., and the contractor's key is made from a public label.

| day (UTC) | admission record | execution | settlement |
|---|---|---|---|
| 2026-11-24 | f516a9ea | f4c44518 | within_grant, final (settle v1.19) |
| 2026-11-23 | d1731b3a | ad8ae9a0 | within_grant, final (settle v1.19) |
| 2026-11-22 | f2cffe2f | 6d557d27 | within_grant, final (settle v1.19) |
| 2026-11-21 | b984e1c3 | 16617ffe | within_grant, final (settle v1.19) |
| 2026-11-20 | a69f2639 | 825f2a61 | within_grant, final (settle v1.19) |
| 2026-11-19 | 03cf8647 | 36211659 | within_grant, final (settle v1.19) |
| 2026-11-18 | b4c76ee2 | 876250a2 | within_grant, final (settle v1.19) |
| 2026-11-17 | 70a96425 | 7315f192 | within_grant, final (settle v1.19) |
| 2026-11-16 | 5d26fa65 | e123da3e | within_grant, final (settle v1.19) |
| 2026-11-15 | c749dc12 | 877e6205 | within_grant, final (settle v1.19) |
| 2026-11-14 | 4fdb18bf | 9af775c3 | within_grant, final (settle v1.19) |
| 2026-11-13 | 87802c42 | ecddd3da | within_grant, final (settle v1.19) |
| 2026-11-12 | 1f03e62f | 26a90e5c | within_grant, final (settle v1.19) |
| 2026-11-11 | be877c15 | 4db0cc7a | within_grant, final (settle v1.19) |
| 2026-11-09 | ccffd1bd | 6264788f | within_grant, final (settle v1.19) |
| 2026-11-08 | af16aa6e | 09542ebd | within_grant, final (settle v1.19) |
| 2026-11-07 | 38270d2a | 85ce2faa | within_grant, final (settle v1.19) |
| 2026-11-06 | df3cddd1 | 4c0973d4 | within_grant, final (settle v1.19) |
| 2026-11-05 | cd381007 | 8ba9b121 | within_grant, final (settle v1.19) |
| 2026-11-04 | 15a956ec | c0e7779e | within_grant, final (settle v1.19) |
| 2026-11-03 | 413fcf06 | 56a2f439 | within_grant, final (settle v1.19) |
