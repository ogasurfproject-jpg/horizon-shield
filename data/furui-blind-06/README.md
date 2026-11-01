FURUI blind-06

This directory publishes blind-06 of FURUI: version A7.4, compared with v_028 as pinned on the H rows. The rows were drawn after the plan was confirmed on Bitcoin.

| entry | record | claim (SHA-256 of the file) |
|---|---|---|
| [entry 231](https://ledger.horizonshield.dev/ledger/231) | BLIND06_PLAN.md: the plan (strata and sources; the lines; the salt commitment; the cap) | a49269c9780fca8ec96c6cfd882436fedc6309550f79b997d8cf02912e768368 |
| [entry 232](https://ledger.horizonshield.dev/ledger/232) | BLIND06_RESULT.md: the result as counts and SHA-256 | 7cc39be85e5e0e7bce28dc39bd861c6a55be81b5d6b45b1a72fee01da141555d |

The two records here are the anchored bytes. The publish script compared each of them with its ledger entry before the commit.

Outcome: all lines held. The model calls cost 71.7477 US dollars.

The eight ai_*.jsonl files are the answers of the eight stages (category, the chosen values, cost). Every quote field of an answer is replaced by the SHA-256 of the quoted string; no text is published. salt.hex is the salt committed in the plan record. plan_entry.json is the ledger entry of the plan as read at the draw, with its OpenTimestamps state and block; block_height.txt and block_hash.txt name the block. With these and the pinned source files, draw_blind06.py (published here) draws the same rows again (manifest.json, root c2bce1f90183236e90ad280a6cc5113ed87de65d2704864978bc27d71b731ed8). The five BUILD files are the build-side counts the plan cites; they hold counts only. manifest.json carries the key and the stratum of each row. It also carries the source with its ID, and the SHA-256 over the key with the text and the scope. For Tensor Trust rows only the sample ID and the hash are published.

Files:

| file | sha256 |
|---|---|
| BLIND06_PLAN.md | a49269c9780fca8ec96c6cfd882436fedc6309550f79b997d8cf02912e768368 |
| BLIND06_RESULT.md | 7cc39be85e5e0e7bce28dc39bd861c6a55be81b5d6b45b1a72fee01da141555d |
| manifest.json | 38aee098a7823c8bd59a2f43a9cb5e9a9fa48581ca49774438d8e32b5f726542 |
| salt.hex | 5924278ab3433c010298aba034c1ed8318e6507bdbba43447de599cb2fac5fb7 |
| block_hash.txt | 2cc3198e74d2bb45ef52ce46f11b767b9d9facee1b2ddd1a1ae2410ce264274a |
| SCORE_blind06.json | 2b09cf40a54dd64183f44b382f19797e56d41f74b887d9681bd6b21b2a2ccc43 |
| recount.txt | b66ba1eeb4c52cc26366f0954bbce81876a7a69604290cd214b801f4320911a8 |
| census_blind06.json | e84ec5b1c2a9140bbde93d4b0c21999f5b9fc4f469f3ebe836c7416ca5f05d9b |
| power_blind06.json | 9870928a3f128fee62717fadd59da7c55289c9422aab7a606013c9dd155e49b2 |
| plan_entry.json | 972c015af3dee9106f5caea17d102405d9f5c75f74c9464da0bb07842ed0a3cb |
| block_height.txt | 16d539bbc79a8596aafc383f7ce74f95b4654c2803a5d5ed1e6b69058c528a4d |
| draw_blind06.py | 9806c3f8fb8bba2200284998f88d591a870cf5a0518e558fc0ea23ba7163c341 |
| BUILD_A7_4_RESULT.json | 6402065c2b9cffd61e51b629649ec049647fa351bcfebb6fde81e6859e88199b |
| BUILD_N2_RESULT.json | ea80b6afb1d9492e254295c87190011f6d758907061faf1febfc81b5ceee7f01 |
| BUILD_A7_3_RESULT.json | 035af64ceffb152fdbd673cdb5e5b6fdcb3fa322a3d3f7ec0d94662dc0f9e2a9 |
| BUILD_A7_RESULT_recount_fixed.json | 8be0481140772583c0136a8cde148c428673a4c4821d036e7d6814fc46cd0302 |
| BUILD_A7_4R_RESULT.json | 8c6aedde5ad66b40dde9230ad18ac25d645aff296819e373466f814010b03bfc |
| ai_q21v4_o.jsonl | 672d5bd03c160f97b340408430c8bae89d00b2a7f5f7ad7ed07414d2e3ab9cec |
| ai_q21b_o.jsonl | 73f443ac7a3226b555d6cff609bc1dea8ad2ce857c5eb069299d8e756521facc |
| ai_q1v2_h.jsonl | abeff3d2fd4efc5426159966ec05f045213b11497007d9ad0df4127a5b1b4ad3 |
| ai_q1v2_o.jsonl | 2f0c64b73c7bc74d8d676398dc149d5d8b2ecbde7540f3712a256e5459d134e0 |
| ai_q22v4_h.jsonl | f3206eae608db065a88efd3ec33536f7e2d2367e8136ef142722b798d145c139 |
| ai_q22v4_o.jsonl | 34c7e02ff777d557a168c474b92855cffb911e6253a0b1892c891b7e9f9b3136 |
| ai_v028_h.jsonl | ae3612091cecb6dc88acff953057ab5a60788c57a818f4dbffb2c06a85fc06fe |
| ai_v028_o.jsonl | c683e75bcd4e7e20a5bc5fc59ca9f96d82e005a2f9c3f79b25ee70c3567196a4 |

SHA256SUMS.txt lists the SHA-256 of these files. It also lists the files that are kept and not published: the drawn rows with their texts; the rule flags; the raw model answers; the answers with their quotes.
