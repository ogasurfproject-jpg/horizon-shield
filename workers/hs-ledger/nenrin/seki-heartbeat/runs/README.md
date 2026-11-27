# SEKI heartbeat

Once a day the agent calls HORIZON SHIELD's own paid tool through the SEKI door under the demonstration contract (../../musubi-v0/seki_demo_v2/contract.json; before 2026-11-12 ../../musubi-v0/run0003/contract.json, under which the audit was over its limit rather than prohibited): a report inside its limit and its payload schema, an audit and a comparison the contract prohibits. The door must admit the first and refuse the other two, and every answer is a signed record on the public ledger. Once the ledger's batch is confirmed in Bitcoin the day is settled with settle v1.15. Principal, agent and door are all The HORIZONs Co., Ltd.; it is a demonstration, not an outside customer, and the pilot's tickets carry no monetary value. heartbeat.py and the workflow seki-heartbeat.yml write this folder. Every deviation is explained in ../README.md, and a final verdict is never rewritten.

| day (UTC) | report (limit 20) | audit 30 | compare (prohibited) | settlement |
|---|---|---|---|---|
| 2026-11-27 | admit f9df628d | refuse c5df3a25 | refuse 627bdafa | waiting for Bitcoin |
| 2026-11-26 | admit f8507217 | refuse 0472b788 | refuse 40214fb1 | within_grant, final |
| 2026-11-25 | admit d0e4a5b1 | refuse 460d47b0 | refuse bff3a0ff | within_grant, final |
| 2026-11-24 | admit 06165c8a | refuse b3e08d38 | refuse 01d72f5a | within_grant, final |
| 2026-11-23 | admit dff11f2f | refuse 5e0a0d74 | refuse 3ac9fbf8 | within_grant, final |
| 2026-11-22 | admit ae702084 | refuse 9a785331 | refuse d4b9c9cb | within_grant, final |
| 2026-11-21 | admit bb6bd45f | refuse b0ae1bae | refuse 3b1ac5bb | within_grant, final |
| 2026-11-20 | admit dda51d41 | refuse eb85d045 | refuse e54733a3 | within_grant, final |
| 2026-11-19 | admit 9064a851 | refuse cf08f50d | refuse 30c261b6 | within_grant, final |
| 2026-11-18 | admit fba7a419 | refuse 43f3eb8a | refuse e926a097 | within_grant, final |
| 2026-11-17 | admit 13c20854 | refuse 131c5cf8 | refuse dd36364d | within_grant, final |
| 2026-11-16 | admit 902a8b84 | refuse c13b73c5 | refuse e4e3d36a | within_grant, final |
| 2026-11-15 | admit 5d3f812b | refuse 6ca73d27 | refuse 19194980 | within_grant, final |
| 2026-11-14 | escalate e1d3549d | refuse baadfa0b | refuse 94b880f8 | waiting for Bitcoin |
| 2026-11-13 | admit be8a7137 | refuse 1820aad3 | refuse a7b3283b | within_grant, final |
| 2026-11-12 | admit c21fd8c7 | refuse ce056797 | refuse 97feb018 | waiting for Bitcoin |
| 2026-11-11 | admit 869772c5 | refuse 4b10718b | refuse 28f4469c | within_grant, final |
| 2026-11-10 | admit 2145f125 | refuse 635a2933 | refuse b56e6780 | within_grant, final |
| 2026-11-09 | admit 11608863 | refuse 2fc779d8 | refuse d9cfdbd4 | within_grant, final |
| 2026-11-08 | admit 62ce1e38 | refuse 93c89bdf | refuse 1f353027 | within_grant, final |
| 2026-11-07 | admit 44ee1e02 | refuse 474f6c86 | refuse 370cae08 | within_grant, final |
| 2026-11-06 | admit 05190272 | refuse 525256c7 | refuse cde84927 | within_grant, final |
| 2026-11-05 | admit 5a917a3f | refuse 6aa2b93a | refuse 9e7d9ccd | within_grant, final |
| 2026-11-04 | admit 0723f411 | refuse 57d14fbd | refuse 106c7092 | within_grant, final |
| 2026-11-03 | admit 26e53961 | refuse f7f82af8 | refuse 79774d46 | within_grant, final |
| 2026-11-02 | admit 12b32db2 | refuse 621ecb5e | refuse 986ae393 | within_grant, final |
| 2026-11-01 | admit 9287ff60 | refuse aecf5f31 | refuse d8511ec8 | within_grant, final |
| 2026-10-31 | admit fe955351 | refuse 14fb1ee8 | refuse 47e85079 | within_grant, final |
| 2026-10-30 | admit d3c726f1 | refuse 7d3239c6 | refuse e534664e | within_grant, final |
| 2026-10-29 | admit 885b76db | refuse 0a5bd41f | refuse 022eee4d | within_grant, final |
| 2026-10-28 | admit 66cf1503 | refuse afc80e7d | refuse 80ebec8f | within_grant, final |
| 2026-10-27 | admit f85d04e5 | refuse 4fca7208 | refuse e6b2d24b | within_grant, final |
| 2026-10-25 | admit 47873483 | refuse 20a5a637 | refuse f1108945 | within_grant, final |
| 2026-10-24 | admit 6b33f14a | refuse 748138f9 | refuse 2280ce50 | within_grant, final |
| 2026-10-23 | admit fd331424 | refuse f67530fe | refuse bde27946 | within_grant, final |
| 2026-10-22 | admit 0842c774 | refuse e6040235 | refuse 4aebf9ca | within_grant, final |
| 2026-10-20 | admit 996db39a | refuse 14d7ddc8 | refuse e93c3e5a | deviation, final |
| 2026-10-19 | admit 76c56f87 | refuse 4221a4c6 | refuse 48ce3ec1 | deviation, final |
| 2026-10-18 | admit 457f0bb1 | refuse 69ddc3b5 | refuse 50a1fbd5 | within_grant, final |
| 2026-10-17 | admit 0c50a9b8 | refuse f3037852 | refuse 2ec321e2 | within_grant, final |
| 2026-10-16 | admit 4fcefcae | refuse 902dc1e5 | refuse dd2f7bda | within_grant, final |
| 2026-10-15 | admit 182a38f0 | refuse e98a7aa4 | refuse a9dd6271 | within_grant, final |
| 2026-10-14 | admit d1ae4180 | refuse b68d22f9 | refuse b8a704b7 | within_grant, final |
| 2026-10-13 | admit 8e8b2853 | refuse adc2d46d | refuse ca0a82ec | within_grant, final |
| 2026-10-12 | admit 97939e52 | refuse 91dd010c | refuse 58f814c1 | within_grant, final |
| 2026-10-11 | admit 46bd1bc3 | refuse 6caab24b | refuse f47c90c7 | within_grant, final |
| 2026-10-10 | admit 48a1aa26 | refuse d8468d27 | refuse 52c9d0c7 | within_grant, final |
