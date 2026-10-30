FURUI A': a tune of the scope stop bound to a quoted passage, not passed

This directory publishes one tune of version A' of FURUI. A' is version A (published with blind-04 in ../furui-blind-04/) with one question added. When A stops a row by the scope flag alone, the model is asked whether the message directs the assistant outside its task, asks to reveal or change the task, or is some other request, and to quote the passage it relies on. A' keeps the stop only for the first two kinds, and only when a program finds the quoted passage in the message. Every refused, unreadable or failed answer keeps the stop.

Records, each anchored to the JIDEC ledger before the next step:

| entry | record | what it fixes | claim (SHA-256 of the file) |
|---|---|---|---|
| [entry 203](https://ledger.horizonshield.dev/ledger/203) | VALIDATE_OUTSIDE_PLAN.md | the plan to check A' on rows from outside sources, after a tune on SPML | 1ce79ea37beb665a5207727266b883e6af95a8d886457baaaeef5635716149d8 |
| [entry 204](https://ledger.horizonshield.dev/ledger/204) | TUNE_APRIME_LINES.md | the tune lines, the rows, the tools and the question, before any call | 633935a7720df8149ef80ae830b439f9703d4481435d13943dbe8b4386b5fa28 |
| [entry 205](https://ledger.horizonshield.dev/ledger/205) | TUNE_APRIME_RESULT.md | the result, under the lines of entry 204 | 033299fe5207a267a60da4429368ca159f70fbd42d28b2b19b7cfaf303cab45d |

The three files here are the anchored bytes. The publish script compared each of them with its ledger entry before the commit.

What was done and what came out. The question was asked once on each of the 184 rows that A stops by the scope flag alone (183 attack, 1 ordinary), for 1.1505 US dollars. Of the 183 attack rows, A' kept 32 stops with an accepted passage; the line asked for at least 174. On the 600 attack rows of validate2, A' stopped 534 where A stopped 576, a fall of 7.00 points; the line allowed at most 1.0. The two lines on ordinary rows and on rows not asked were met (0 and 0).

The tune is not passed. As entry 204 fixed before the run, A' is not pinned, the check of entry 203 is not run and blind-05 is not drawn. No line was changed after the result was seen. A stays as published for blind-04.

Section 4 of TUNE_APRIME_RESULT.md separates the facts from the counts and a reading of them. The reading, and FINDING.md in this directory, are hypotheses. The counts alone do not show them.

Files:

| file | sha256 |
|---|---|
| VALIDATE_OUTSIDE_PLAN.md | 1ce79ea37beb665a5207727266b883e6af95a8d886457baaaeef5635716149d8 |
| TUNE_APRIME_LINES.md | 633935a7720df8149ef80ae830b439f9703d4481435d13943dbe8b4386b5fa28 |
| TUNE_APRIME_RESULT.md | 033299fe5207a267a60da4429368ca159f70fbd42d28b2b19b7cfaf303cab45d |
| TUNE_APRIME_RESULT.json | 004d5cf97816083746b0732fdba174c4b531f267cc041cf9c545461ee04419d0 |
| tools/quote_check.py | 46e1ee185bd8779dc6153c1cdb8546c80cd18186b849f893c0116b5d513a7a2a |
| tools/policy_aprime.py | 73a36fd1c1c76eab4607756ac2d4b9ad227b8a470dc5bdb8c1be78bc13708277 |
| tools/aprime_q3.py | daf52400bf855888c371c78639cc778b584c02daf1b90faa50346f8843316226 |
| tools/tune_aprime.py | 1baebbf8c6267fc9e77a3cafb6d84efee17dd2bef7fc4232aa9520f712d23315 |
| tools/selftest_aprime.py | 0a08dcf1188e96a3de3b717598c6dc83b8616339267fe0bf601082f6dd95cb3b |
| tools/selftest_tune_aprime.py | c6b07ee1e1048ec898c86e4a7582a7dc30597f5252b383a667baa0396e7f112b |
| tools/tune_inputs_sha256.json | 65de99e332db02cd963f7d88e665d5657190e78225d2023c5af78d2e7e7e3e2f |

TUNE_APRIME_RESULT.json holds the counts and SHA-256 only. Its SHA-256 is in entry 205.

tools/ holds the A' tools with the SHA-256 named in entry 204, which also names the three earlier tools they read: policy_b04.py (the policy of A), ai_judge.py and spml_scope_run.py. Those three are not in this directory, and the tune reads SPML rows, so the tools do not run from here alone. The two selftests run on made-up rows.

Not published, with the reason:

| file | why |
|---|---|
| items_q3.jsonl | it holds the text and the task scope of each row asked |
| ai_q3.jsonl, raw_q3.jsonl | the answers hold passages quoted from the rows |
| SPML rows | they are the public dataset's own and are not copied here |

We do not copy row text into this repository. The SHA-256 of the three files are in entry 205, so the kept files can be compared with it later.
