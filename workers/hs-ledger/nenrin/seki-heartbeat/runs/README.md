# SEKI heartbeat

Once a day the agent calls HORIZON SHIELD's own paid tool through the SEKI door under the demonstration contract (../../musubi-v0/run0003/contract.json): a report inside its limit, an audit over its limit, a comparison the contract prohibits. The door must admit the first and refuse the other two, and every answer is a signed record on the public ledger. Once the ledger's batch is confirmed in Bitcoin the day is settled with settle v1.15. Principal, agent and door are all The HORIZONs Co., Ltd.; it is a demonstration, not an outside customer, and the pilot's tickets carry no monetary value. heartbeat.py and the workflow seki-heartbeat.yml write this folder. Every deviation is explained in ../README.md, and a final verdict is never rewritten.

| day (UTC) | report (limit 20) | audit 30 (limit 25) | compare (prohibited) | settlement |
|---|---|---|---|---|
| 2026-10-29 | admit 885b76db | refuse 0a5bd41f | refuse 022eee4d | waiting for Bitcoin |
| 2026-10-28 | admit 66cf1503 | refuse afc80e7d | refuse 80ebec8f | waiting for Bitcoin |
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
