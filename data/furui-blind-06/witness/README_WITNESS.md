FURUI blind-06: witness kit

This directory lets anyone re-check FURUI blind-06 from public material: ledger entries 231 (the plan) and 232 (the result), the files one level up in data/furui-blind-06 at commit 200d5d96, and five public datasets at fixed revisions. Nothing in it calls a model, and it costs nothing to run.

Run: python3 -I verify_blind06.py fetch-pub pub --witness-ref COMMIT (the commit that added this witness folder; without the option the files come from main); python3 -I verify_blind06.py fetch-data data; python3 -I verify_blind06.py run --pub pub --data data --out record.json. The tool needs the Python standard library only, except that stage W2 reads the GovTech parquet file with pyarrow when it is installed; without pyarrow, W2 is reported as SKIPPED with that reason. W2 needs the five dataset files, and fetch-data downloads about 270 MB.

W1 checks that the ledger entries 231 and 232 carry the SHA-256 of the published plan and result records; their OpenTimestamps state and block; that the salt matches the commitment in the plan; that the hash of block 974072, read from two public sources, matches the published one; every line of SHA256SUMS.txt that names a published file; every line of SHA256SUMS_WITNESS.txt in this directory; and that the four code files named below have the SHA-256 the plan pins.

W2 rebuilds the populations and the draw from the salt, the block hash and the datasets. excluded_keys.txt (27177 keys) lists the keys used before blind-06 and therefore removed, and excluded_scopes.txt (2272 hashes) lists the SHA-256 of the normalized scope texts removed as in blind-05. The rebuilt population key hashes must equal section 9 of the plan, and the rebuilt manifest root must equal the published one.

W3 counts the six strata again from the published answer files with the published decide (a74_decide_v1.py; a74_decide_v1.mjs with quote_check_v1.mjs is its JavaScript twin). Quote texts are not public, so quote_checks.jsonl gives, for each answer and each quote field, only whether the quote check passed (44113 flags). row_scopes.jsonl gives the SHA-256 of the scope text of each drawn row. The six line counts, exact Clopper-Pearson bounds and the L4 normal bound must equal the result record.

The per-row result of the rule stage is not published as a separate file, because it is already in the answer files: a row has a record in ai_q1v2_h.jsonl if and only if the rules did not stop it. The same holds for the v_028 rules and ai_v028_h.jsonl on the H and X rows. Both were checked on every row before this directory was published.

The four code files listed next are the scoring and counting code of the run, byte for byte at the SHA-256 the plan (ledger entry 231) pins and the run used (a7_count.py 283b3baf, score_blind06.py f44533c4, recount_blind06.py eea17bd1, quote_check.py 46e1ee18; the full values are in the table below, and W1 checks them against the plan). They read the withheld row texts and answers, so a witness cannot run them; they are published so that the decide twins can be read against them. They hold no rule pattern and no question text; both were checked before this directory was published. F5_REPLAY_RESULT.json records that the twins reproduce the row outcomes of score_blind06.py on all 5,533 rows and the rule flags on three sets; it holds numbers and hashes and no text.

What this kit cannot verify: the AI answers themselves; the rule file and the question texts, which are not published; the quote-check recomputation, since quote texts are not public; and that no other run was made and discarded. The record the tool writes lists these under does_not_establish.

The record is a jidec-path-v1 walk with the conduct-v1.1 fields, ready for the ledger witness intake at https://ledger.horizonshield.dev/witness (see BECOME_A_WITNESS.md in the repository for the identity rules). Sign the exact record bytes with your own Ed25519 key, served from your own domain or from a repository you own on raw.githubusercontent.com, with verify_blind06.py sign, and post the body it writes. Every agent that prepared this kit is an AI agent, not a person.

A witness can add limits of its own with run --limits FILE, one statement per line. They are kept word for word in the record under witness_stated_limits, apart from the does_not_establish list the tool writes.

Files:

| file | sha256 |
|---|---|
| verify_blind06.py | 4c4965c72838c1149e0826742f859e468f5a1760c21aef64d30c942d4e1b04dd |
| a74_decide_v1.py | aaf9d4e2624dd6a081f6abd8ca1bb65a060f0482f969059ff2495be7d01ffb49 |
| a74_decide_v1.mjs | 8bc0d9e6dfb408a2e9bdd8768412092a9f4d0d9d1b1fadf568dce66571968977 |
| quote_check_v1.mjs | 8c23adcac5d09f59bad52b463f1c64c914d2d049769dfbf1b2cbb5e5c018830e |
| quote_check_tables_v1.json | c251e2c31a379199739dd48d757b25ed9422c50276f2e44bbb5ed07a47e678f9 |
| quote_checks.jsonl | 38fd2649b6a5f67fe3a8d20ea39d25f863e278f53e132eea581dd4077c44d837 |
| row_scopes.jsonl | 928b4b87c4b2232e2e4b0387bd08aab64d476a00bc8bd5f95d39bd2afe15321d |
| excluded_keys.txt | b53ec16aeb4037164c986d14cf9b70df2464a89fee87b991d9bf2503038c516e |
| excluded_scopes.txt | b9105d5dcac86b7f1ee8131925a698806a766956a662f86ae51d9dbb6e4a24db |
| a7_count.py | 283b3baffa85b399dddc371685e3c0094a26055827a09986e006587e9710d128 |
| score_blind06.py | f44533c4040f5c827e1b283d2087c334f31b7a0f0d20f75653328a4f06754f68 |
| recount_blind06.py | eea17bd1b0127fd8ce4a4094ab16a6f50ae34e47d1b60948e0f1fff77d6288af |
| quote_check.py | 46e1ee185bd8779dc6153c1cdb8546c80cd18186b849f893c0116b5d513a7a2a |
| F5_REPLAY_RESULT.json | 3ac8264d127b46fa9e5d6a9b21e0a140edf310679d76e3a1d1c4fbcd4c0b52b5 |
