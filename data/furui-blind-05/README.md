FURUI blind-05

This directory publishes blind-05 of FURUI: the version named in the plan record, compared with v_028 as pinned. The rows were drawn after the plan was confirmed on Bitcoin.

| entry | record | claim (SHA-256 of the file) |
|---|---|---|
| [entry 224](https://ledger.horizonshield.dev/ledger/224) | BLIND05_PLAN.md: the plan (strata and sources; the lines; the L4 form and the H row count from the preview; the salt commitment; the cap) | 84e04ff951cf1bd01c5032a4bd80943792a2717b6b8bb9c2a34a338de93b4cdb |
| [entry 225](https://ledger.horizonshield.dev/ledger/225) | BLIND05_RESULT.md: the result as counts and SHA-256 | 1bdd511e1b5134fef1de7c523b3845a849d5887952e9e781240d6cb9627de674 |

The two records here are the anchored bytes. The publish script compared each of them with its ledger entry before the commit.

Outcome: at least one line did not hold; the result record names it. The model calls cost 15.8772 US dollars. L5 is not a line for A6: as for A5, its count of silent passes is 0 by definition.

The four ai_v*.jsonl files are the answers of the four stages (category, scope conflict, cost; no text). salt.hex is the salt committed in the plan record. With block_hash.txt and the pinned source files, draw_blind05.py draws the same rows again (manifest.json, root d64c32bf15ac6b1ac13730d3603c116ae51ee66eab6de9a2790c8c25bfc3dcce). manifest.json carries for each row the key; the source and its ID; the SHA-256 over key, text and scope. It carries no text. For Tensor Trust rows only the sample ID and the hash are published.

Files:

| file | sha256 |
|---|---|
| BLIND05_PLAN.md | 84e04ff951cf1bd01c5032a4bd80943792a2717b6b8bb9c2a34a338de93b4cdb |
| BLIND05_RESULT.md | 1bdd511e1b5134fef1de7c523b3845a849d5887952e9e781240d6cb9627de674 |
| manifest.json | 079a41fb325e89b2dc3d47c54ea2da82f59b1b167fead778412442158ed9dd23 |
| salt.hex | 40757f5cde8762602dc3d761e8234d016fcf1966244bf05a627d5ddd8f41588b |
| block_hash.txt | 233f5dd5ca65180468655e03e975c7c03fdf47e7002bb40de621da924b0e8753 |
| PREVIEW_RESULT.json | b3c91455b1fc4773b294d41e5700f85521ba3bb8bbb7b48387e8f11595e5d183 |
| SCORE_blind05.json | 3192eecc2152b17f0ccbb8291451ba0e48da8f0eb5a47fa69d46d6025a7b1184 |
| recount.txt | 0a2486fd11db32e4883eb2fdfa82694065ccb991fcda06e68adb291f0ed6008a |
| blind05_pin.json | fd9fe14c8112bc9e2af8ed56735c95bb9411991731bb603e5e40192b096e3cc8 |
| A6_PIN.json | 47fa9110afed3cc34e477ff2e576d97d3ddf8738053a090d261735447e1859f9 |
| ai_v_028_h.jsonl | 6dcbaf72470f164e05ef64fd45ec62a693cca50936d8303f2d1481148915e9c3 |
| ai_v_028_o.jsonl | ee769edb844324a531bf9778eb63cc4f05277614e173a7afca9939a5e4e56d51 |
| ai_v4_0_h.jsonl | 985da4c67bea02e128b41457c12ccb742f2ae78cedda50616e8e97624019b859 |
| ai_v4_0_o.jsonl | bbe3837517dad944b91064d7675ffa397a80022342acff82eaf786e2730c8eb7 |

SHA256SUMS.txt lists the SHA-256 of these files and of the files that are kept and not published (the drawn rows with their texts, the rule flags and the raw model answers).
