FURUI A': a small check on Impel/Jailbreak_Benchmark

This directory publishes a check of version A' of FURUI on data that labels hijacking apart from requests outside the task. It follows the tune in ../furui-aprime-tune/, which did not pass, and the hypothesis written there in FINDING.md. The rows are 83 rows of Impel/Jailbreak_Benchmark: 31 prompt injection, 27 out-of-domain and 25 in-domain. The task scope given to A is one sentence written by us; it is in the plan.

| entry | record | claim (SHA-256 of the file) |
|---|---|---|
| [entry 206](https://ledger.horizonshield.dev/ledger/206) | IMPEL_CHECK_PLAN.md: rows, scope sentence, tools, lines, cap | 2bf928a169564cda74019faaa6d7043d73b9a7c2b6a1640e96d23dc9441664bc |
| [entry 207](https://ledger.horizonshield.dev/ledger/207) | IMPEL_CHECK_RESULT.md: the result, counts and SHA-256 only | a83beb9763bc7439639671f4e6de0a8278e31f9142e972cb5d710294a333465a |

The two records here are the anchored bytes. The publish script compared each of them with its ledger entry before the commit.

What came out. A stopped all 27 out-of-domain rows by the scope flag alone, so the check can be read (line I0). A' stopped 30 of the 31 prompt injection rows, at the same stages as A, and none of the 27 out-of-domain or 25 in-domain rows. All four lines were met. The model calls cost 0.3849 US dollars.

Two limits come first. The extra question of A' reached no prompt injection row, because the verdict had already stopped them; so this check shows that the extra question lets requests outside the task through, not that it keeps a hijack that only the scope flag catches. And section 4 of the result record says that the plan's entry was sent to OpenTimestamps after the run, not before it. The order of plan and run rests on the ledger's own created_at and sequence, which we keep.

The other limits are in the plan and the result: 83 rows, one domain, our scope sentence, English only, rows already used in a published paper, and a category column whose maker the paper does not state. It is not a blind set. The hypothesis about SPML is not settled by it.

Files:

| file | sha256 |
|---|---|
| IMPEL_CHECK_PLAN.md | 2bf928a169564cda74019faaa6d7043d73b9a7c2b6a1640e96d23dc9441664bc |
| IMPEL_CHECK_RESULT.md | a83beb9763bc7439639671f4e6de0a8278e31f9142e972cb5d710294a333465a |
| IMPEL_CHECK_RESULT.json | f416fe8a5872b6ea3b814c0f2e25ffa8bf839014fb48daf8ac6979f73c93bef2 |
| tools/impel_check.py | cb44b674fc8622617b1d9a9de9f1005477f99dafdef640ec7afde2882baaba4c |

IMPEL_CHECK_RESULT.json holds counts, SHA-256 and the scope sentence of the plan. tools/impel_check.py is the tool named in the plan; it reads the A and A' tools named there (in ../furui-aprime-tune/tools/ and in earlier entries), so it does not run from here alone.

Not published: the row texts (items.jsonl and q3/items_q3.jsonl), the model's answers and the quote fields of the extra question (the raw and ai files), and the two dataset files. The rows are the public dataset's own. The SHA-256 of the kept files are in the result record.
