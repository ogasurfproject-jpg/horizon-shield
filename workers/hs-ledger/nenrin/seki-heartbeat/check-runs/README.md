# The SEKI door's check call through MUSUBI

Once a day at 03:47 UTC the door sends its fixed check request: the content check runner (FURUI) checks it, the door (SEKI) admits it, the public ledger (NENRIN) holds the admission. check_loop.py files the execution record under the check contract (../check-contract.json) at the MUSUBI intake, and once Bitcoin has confirmed both records the day is settled with MUSUBI settle v1.19. TOOSHI reads index.json every day. Principal, contractor and relying party are all The HORIZONs Co., Ltd., and the contractor's key is made from a public label.

| day (UTC) | admission record | execution | settlement |
|---|---|---|---|
| 2026-11-09 | ccffd1bd | 6264788f | waiting for Bitcoin |
| 2026-11-08 | af16aa6e | 09542ebd | within_grant, final (settle v1.19) |
| 2026-11-07 | 38270d2a | 85ce2faa | within_grant, final (settle v1.19) |
| 2026-11-06 | df3cddd1 | 4c0973d4 | within_grant, final (settle v1.19) |
| 2026-11-05 | cd381007 | 8ba9b121 | within_grant, final (settle v1.19) |
| 2026-11-04 | 15a956ec | c0e7779e | within_grant, final (settle v1.19) |
| 2026-11-03 | 413fcf06 | 56a2f439 | within_grant, final (settle v1.19) |
