FURUI blind-07

This directory publishes blind-07 of FURUI: the plan, the readings fixed before the count, the count and the recount, the draw, the verdict files and the tools named in the plan. The rows were drawn after the plan was confirmed on Bitcoin.

| entry | record | claim (SHA-256 of the record) |
|---|---|---|
| [entry 272](https://ledger.horizonshield.dev/ledger/272) | the plan (BLIND07_PLAN.md) | 06bad04c14415d78dbf5168cfc3dc70af71b8448526128112d4e36bc4dd8fc67 |
| [entry 282](https://ledger.horizonshield.dev/ledger/282) | the commitment to OPERATOR_READINGS_blind07.md | 3cc366666d17681b3e321a99f5394b16e3360bddd716fba2bd2a897bf7f0eff8 |
| [entry 361](https://ledger.horizonshield.dev/ledger/361) | the commitment to OPERATOR_READINGS_blind07_addendum1.md | fc8b471f29878ff8b5768092d2529cb05f44b526bc5b0c5f5a34fd3d12d00dd9 |
| [entry 367](https://ledger.horizonshield.dev/ledger/367) | the commitment to OPERATOR_READINGS_blind07_addendum2.md | e94ecc3c7e3ef3553fe4bd77f7cbc03af16a97b14e61282db2c4b513c158bb64 |
| [entry 378](https://ledger.horizonshield.dev/ledger/378) | the result (RESULT_blind07.md) | cc2925d41ced15b2879e871c9880d31c41efc865ce0c936478247e7171073ca6 |

The publish script compared each record with its ledger entry before the commit. Each readings document has the SHA-256 that its commitment entry names.

Headline of the count: Not a pass: line(s) P1 do not hold. Lines that are lines: J1, J2, C2, C8, C3, C6, G1, G2, P1. Not lines (condition not met): E1, E2.

salt.hex holds the 64 hexadecimal characters of the salt; their SHA-256 is 9c40c171fef98b81d66e0d35d967153401fa62dfe69ad410f4e013601ef854f4, the value in section 10, item 2 of the plan. canary_run_key.hex holds the 64 hexadecimal characters of the canary run key; their SHA-256 is 884eb242a51e631cd76818994e0effaa59213f5774930c930f471bd0147d1476, the value in section 6 of the plan. manifest.json is the draw manifest (root 12091c83ad00ae666de3787eea6642a60de973d11d5ccca03b95fa48234761b9, block 0000000000000000000018e449d3c93ecaa9987897f54bccd6b3cdae9d787bc1 at height 975030); block.json is its block check.

The verdict files carry source marks, outcomes, costs and served model ids. Every quoted string is replaced by its SHA-256; no text is published. verdict_CANARY.jsonl and the other answer files listed in addendum 2 are published with the bytes that addendum 2 fixed, except the ai_*.jsonl files, which are the answers with every quote field replaced by the SHA-256 of the quoted string.

tools/ holds the files of section 13 of the plan at the paths written there, with the SHA-256 written there. Of those files, blind07_20261103/J_BENIGN_SCOPE.txt and furui_ja_benign_20261025/items.jsonl are kept and not published (row texts and scopes); their SHA-256 are in SHA256SUMS.txt and in the plan. tools/ also holds blind07_20261103/b07_draw.py and blind07_recount_20261121/recount_blind07_selftest.py and blind07_20261103/b07_day1.py and blind07_20261103/b07_day2.py and blind07_recount_20261121/count_field_names.txt, which section 13 does not name.

No holder took part (section 4 of the plan: Holders in this plan: 0), so no label file is published.

Files:

| file | sha256 |
|---|---|
| BLIND07_PLAN.md | 06bad04c14415d78dbf5168cfc3dc70af71b8448526128112d4e36bc4dd8fc67 |
| OPERATOR_READINGS_blind07.md | 7d310d0d69755a3e3929052036257ceb396fef393826b9b667cfa832d5e51914 |
| claim_282.txt | 3cc366666d17681b3e321a99f5394b16e3360bddd716fba2bd2a897bf7f0eff8 |
| OPERATOR_READINGS_blind07_addendum1.md | c1add59c048c57708dcdc2020049e71066323708996fe4ce04a4df83ccd11bc3 |
| claim_361.txt | fc8b471f29878ff8b5768092d2529cb05f44b526bc5b0c5f5a34fd3d12d00dd9 |
| OPERATOR_READINGS_blind07_addendum2.md | a779d322e0f3371988638809d99b10b6f25b19cb8d51fe951e1a646d5a813d5d |
| claim_367.txt | e94ecc3c7e3ef3553fe4bd77f7cbc03af16a97b14e61282db2c4b513c158bb64 |
| RESULT_blind07.md | cc2925d41ced15b2879e871c9880d31c41efc865ce0c936478247e7171073ca6 |
| salt.hex | 9c40c171fef98b81d66e0d35d967153401fa62dfe69ad410f4e013601ef854f4 |
| canary_run_key.hex | 884eb242a51e631cd76818994e0effaa59213f5774930c930f471bd0147d1476 |
| manifest.json | b0c698b7f3b9c293741f5feaa8f0e13a864d1084f2db8afa2c3ef2c3b5e627c1 |
| block.json | e2d40a899607057016550933d0931e54f8a30b7a5c6cf34edd7f5c3175c7a2a1 |
| plan_entry.json | ff4bbf7871765585adaacee70eec116246045c9bae9c76d19090469026c52823 |
| header1.txt | d592b58bcb161da96f81f6e6c6f0a21e727b369dee581c0e36beae9660a8ae40 |
| header2.txt | d592b58bcb161da96f81f6e6c6f0a21e727b369dee581c0e36beae9660a8ae40 |
| hash1.txt | dc46acd415e52a18527914994363874da4003ab52febb0afdde1d448d40c5122 |
| hash2.txt | dc46acd415e52a18527914994363874da4003ab52febb0afdde1d448d40c5122 |
| proof.ots | bff62bd748a746eb67e5902def486dc3624218d8a6d34d816aa7766f386c0b4d |
| ja3_manifest.json | 58f2af60e85faee83cc0a57c92c6da71d94238df7dbd5f108aaa5225261cfc90 |
| from_draw.json | cf60ce0e160dc03d9faa4cfd92f2a602a1a76bc754dd1e14d2fbfd8a195f7c94 |
| verdict_CANARY.jsonl | c93504df7697c158f20d52bbd63e185a518b27e2cf5e96e9b9e47b30f6f4db8d |
| outcomes_CANARY.jsonl | 4ce1be7ce91f1f02968b29e9ca3c4ff5a069d300ca9f0f1fc2f0d7e18ceb61d6 |
| canary.jsonl | 41f84a6f200348e50ee1b28258d90c27f5bd21ca6100340ac6b466029b3855a5 |
| day2/ai_q1v2_h.jsonl | 3fbac34c9b7e49d5c5f26368a1768c8a33442d9ad9f98cf9c31dce1d10768b1f |
| day2/ai_q1v2_o.jsonl | d2cc2bd334390e299f899a172efcbf99e3cd4692ee54c5627bdbc38e21b15f4a |
| day2/ai_q22v4_h.jsonl | 40a9da1f5acf0d94836091e418179945c5d314979e90d1e7df8c9a0f40448d0b |
| day2/ai_q22v4_o.jsonl | 5a4ec1f14d9749e789165a048a66dc0cdddfc73d0c9308b349e4b1c042289bfb |
| ai_q21v4_o.jsonl | becb2681e418533890e4768c44e9371d781844273f43335e97330612e2635504 |
| ai_q21b_o.jsonl | 690a2d7a58ce7a3becee0ab3f659994c35e05887cf9810782bc5dcb7f2a6caf2 |
| ai_q1v2_h.jsonl | 6608da82d1f8193f53e33d1b1cd690d880ab526ac29fd9f3fc7999cf6200c3e1 |
| ai_q1v2_o.jsonl | f1b0beae925869f559c0825c51da77204bb4a5f33a9f340350a10a472dcbf4ce |
| ai_q22v4_h.jsonl | fb95974c5c86cd8eef9bee1613a4a32ff113c17dc2a9e5be721255bb14d0cedb |
| ai_q22v4_o.jsonl | d48a21ec8943cd76f9d00583e22308d0af1be1d4900b33e6d27084e12ea701fb |
| rule_flags.jsonl | f151ebd43f4f5de2abac488caa269513fc325e43e9e33f142996d0fd6bcd7f47 |
| pg2_scores.jsonl | 13c8ca81badd430900a73addba96bda928aa5d07877a6a48b8079d60f7e4c7c9 |
| spend.jsonl | d62a892c7f547b611a8c50dcbfb80e0ffabaf7260b3f9496edbf039c7f6097bd |
| SCORE_blind07.json | b0abf9f2bec5ad4bc06ff72f64942bf2b8973629dc4af17187a2e76845fb0a11 |
| RECOUNT_blind07.json | eca6199163c15a58739cc9e90f8a2b213bd86c85080638c9a752f5b4aee62381 |
| score_blind07.py | e3c709eb9b6bcd16cd26f4a536c33f0c3a686ab31dadaa74e8c2de64977b5c39 |
| recount_blind07.py | 68fc54578969852bba64e8cc3507a1431447234e3114908645f2c23071fb17ea |
| tools/blind07_20261103/b07_harness.py | 098fd7fa71f0a74d082c58ee2d706cc18ff478e0f4feb9cd50e91b529c81b4c5 |
| tools/blind07_20261103/b07_arms.py | a4b6bd2943fc009786b6994b034e98852c8cd5baf5ac4bdc2a7e80444c4a675f |
| tools/blind07_20261103/b07_canary.py | d1efe94c215218265db0b8702b2a73931830abe32d5cfe1f3260331105d8fd86 |
| tools/blind07_20261103/b07_pg2.py | f0767595e77ea0e09664a335a6e3d8b5d39f9ad29b2740197406156260b05002 |
| tools/blind07_20261103/b07_canary_chance.py | 156df237eabe0641d4abc13b2d5faded724c7e797f0a676ef49662039cbd7744 |
| tools/blind07_20261103/CANARY_CHANCE.json | c8711c79ef9ac0b4f7632c4d9f8eef20edbf69e8522fb3ba6519ec36e756e5b5 |
| tools/blind07_20261103/b07_cost.py | 2f252e8a2da118ec05d2a47e1f916a4c9fbb67530a8d0547155b34c181cd295e |
| tools/blind07_20261103/b07_census.py | 275c9742041b52857c2ab9ba75933489b55f0e3c6bad517fe02ed8b2b7b8613b |
| tools/blind07_20261103/CENSUS_blind07.json | 67178175b8fd11fe2412947fd1bfee6a246f0857439c627167034f00c664809e |
| tools/blind07_20261103/b07_j3.py | 50ed528526d4e09f6203871ecc95ed2156d28b627cd9d3accb9e1e9145247ec5 |
| tools/blind07_20261103/J3_TRANSLATE_INSTRUCTIONS.txt | b06a0b446bcc392fe01ae1d43f51774f35b53bde024cb08ba28fab95db731693 |
| tools/blind07_20261103/B07_AD_TARGET_SYSTEM.txt | 891e6bdd995b0809dedc48be7dd692c99b630273cdf9521cc47a9220abb0524e |
| tools/blind07_20261103/B07_AD_TARGET_TOOLS.json | 12cdb3f9338bf4410805b6a9e76fd1ff634e57386c0a53fdf8610f93cc907ae6 |
| tools/blind07_20261103/B07_AD_GOALS.jsonl | 22e2eec187760b490281a6559b3d03a27606e9b173401cfe08b842ccb1f1c52c |
| tools/blind07_20261103/B07_AD_ATTACKER.txt | 437edc47784efbdcefad1011945f2020535a26f6a632b4a0a997d1f739f1204f |
| tools/baton_a74_20261101/a74_rules_v1.py | 696954f9e5cadad85d67f5bf827f7bcaf3b09bfb38879f7f6d2e29c408c040e1 |
| tools/baton_a74_20261101/a74_prompt_v1.py | 014b80655ab9d4146e56fdeae5193c897da6bbf98b83924517a91c0d912b0d0e |
| tools/baton_a74_20261101/a74_decide_v1.py | aaf9d4e2624dd6a081f6abd8ca1bb65a060f0482f969059ff2495be7d01ffb49 |
| tools/aprime_team_20261030/quote_check.py | 46e1ee185bd8779dc6153c1cdb8546c80cd18186b849f893c0116b5d513a7a2a |
| tools/blind06_draw/manifest.json | 38aee098a7823c8bd59a2f43a9cb5e9a9fa48581ca49774438d8e32b5f726542 |
| tools/blind07_20261103/pg2/run/PG2_FILES.sha256 | 4630e2cdb6602c93d5195395e0a24f45a77ba921115c5d925504998d1d6e6994 |
| tools/blind07_20261103/pg2/run/PG2_OUTPUTS.json | bf0e5f3019e69b047e9ecc4ff193487ffa98e9dc7409d469e0c4207c5664a228 |
| tools/blind07_20261103/pg2/run/tmatch/PG2_TMATCH.json | 3393192e83ccb97cb33aec379df3b01fb14befd290d0530ebcc1df00a8770f5f |
| tools/blind07_20261103/pg2/run/tmatch/scores_86M.jsonl | 588e8db3f1955411d7d94dea323833f3a2ac8f831399cbdad6c3c7c9c9250140 |
| tools/blind07_20261103/pg2/run/tmatch/scores_22M.jsonl | bb53538deaabc06cd171f0e83426678530a39386856e17c1a49d294080986386 |
| tools/blind07_20261103/b07_draw.py | 07396b39bb807f98ded3fbfa10a179cb90b1a65dcd9def98e4cb7f379743577e |
| tools/blind07_recount_20261121/recount_blind07_selftest.py | 345e1e5dbcff4e114f355aa4eec22edd7a402c080d635dcd45456d70ab1d9630 |
| tools/blind07_20261103/b07_day1.py | baeda00cc54570c5980926098efa57ae333ada71a4beaff1fce96896674dc9cf |
| tools/blind07_20261103/b07_day2.py | 237c59574f55314e7cf37c1f9e43bea6af6cc678863ce32956ef77105b5a9330 |
| tools/blind07_recount_20261121/count_field_names.txt | cfdc703d89cfb663cf8f623b5fbb7be73bdc87d2d7c5a542154f51f48e05fa62 |

SHA256SUMS.txt lists the SHA-256 of these files. It also lists the files that are kept and not published: the row texts and scopes, the raw answers and the answers with their quotes.
