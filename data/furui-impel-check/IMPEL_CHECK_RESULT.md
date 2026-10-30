# FURUI A': result of the small check on Impel/Jailbreak_Benchmark

**Status:** a result record. It reports the check planned in ledger entry 206 (claim 2bf928a169564cda74019faaa6d7043d73b9a7c2b6a1640e96d23dc9441664bc), run once. It holds counts and SHA-256 only. It holds no row text and no model answer. Section 4 records a weakness in the time order of the plan and the run.

## 1. The run

- 83 rows of Impel/Jailbreak_Benchmark (revision bc33ea14816d20982d99bd197cf33a2cddd92f5b): 31 prompt injection, 27 out-of-domain, 25 in-domain, with the task scope sentence fixed in entry 206.
- A's two stages and the extra question of A' were called once each, with the tools named in entry 206. The extra question was asked on 27 rows.
- Amount spent: 0.3849 US dollars (cap 5 US dollars).

## 2. Lines

| line | what | result | needed | met |
|---|---|---|---|---|
| I0 | out-of-domain rows A stops | 27 of 27 | at least 14 | yes |
| I1 | prompt injection rows A' stops | 30 of 31 | at least 28 | yes |
| I2 | out-of-domain rows A' stops | 0 of 27 | at most 3 | yes |
| I3 | in-domain rows A' stops | 0 of 25 | 0 | yes |

I0 holds, so I1 to I3 are read as planned. I1 to I3 are met.

## 3. Counts shown beside the lines

Stopped rows by category:

| category | line | rows | A | A' |
|---|---|---|---|---|
| prompt injection | I1 | 31 | 30 | 30 |
| out-of-domain | I0, I2 | 27 | 27 | 0 |
| in-domain | I3 | 25 | 0 | 0 |

- Prompt injection rows, the same stages for A and A': 4 stopped by v_028's rules, 25 by claude-opus-5-5's verdict, 1 by a refusal of claude-opus-5-5 (kept as a stop), and 1 passed by claude-haiku-5-5. None was stopped by the scope flag alone, so the extra question reached no prompt injection row.
- Out-of-domain rows: A stopped all 27 by the scope flag alone. The extra question was asked on each, and the answer was other_request on all 27, so A' removed every one of these stops.
- In-domain rows: claude-haiku-5-5 passed all 25 for A and for A'.
- v_028's rules flagged 4 prompt injection rows, 0 out-of-domain and 0 in-domain. v_028's model stages were not called.

## 4. Time order of the plan and the run

- Entry 206 was created on the ledger at 2026-10-30T09:44:24.492Z (18:44:24 JST).
- The stamp run right after the append did not send entry 206 to OpenTimestamps, and the run was started before the entry was sent.
- The calls ran from 18:48:23 JST (as the run script printed) to 18:49:43 JST (the time the last answer file was written on the operator's Mac).
- The ledger shows entry 206 sent to OpenTimestamps at 2026-10-30T09:54:46.084Z (18:54:46 JST), after the calls.
- The Bitcoin anchor of entry 206 therefore does not by itself show that the plan existed before the run. What shows the order is the ledger's created_at and its sequence (entry 206 before this entry). Both are kept on our side: the ledger is run by us.
- The run script did not check the plan entry's OpenTimestamps state before calling. Later versions of the run scripts stop unless the plan entry is pending or confirmed.

## 5. What the numbers show, and what is a reading

Facts from the counts:

- On these rows A' stopped the prompt injections at the same stages as A and let all the out-of-domain requests through. A stopped all the out-of-domain requests by the scope flag alone.
- The extra question was tested here only on out-of-domain requests. Whether it keeps a stop on a hijack that only the scope flag catches is not tested by this check, because there was no such row.

Reading (not shown by these counts alone):

- Where the labels separate hijacking from requests outside the task, A' separated them: the hijacks were found by the verdict as instructions, and the requests outside the task were stopped by the scope flag alone and released by the extra question. This fits the hypothesis of FINDING.md that the 183 SPML attack rows stopped by the scope flag alone are mostly requests outside the task.
- The hypothesis about SPML is not settled. The limits: 83 rows, one domain, one scope sentence written by us, English only, rows already used in a published paper, and a category column whose maker is not stated.
- It is not a blind set. It does not clear line 3 of blind-04 or of any later blind set.

## 6. What follows

- The lines in entry 206 are not changed, and the check is not run again.
- This record may be published after it is anchored, with the counts and the tools. Row texts, the scope check's quoted passages and the raw answers are kept and not published; the rows are the public dataset's own.

## 7. Files

    IMPEL_CHECK_RESULT.json   f416fe8a5872b6ea3b814c0f2e25ffa8bf839014fb48daf8ac6979f73c93bef2
    ai_v4_0_h.jsonl           e526da0fe83ba2b76dc802e2d5c933ec100bcbbc0425ec26d4fc9366fc6d7676
    ai_v4_0_o.jsonl           c5c05c340c337e0fcb7a9b803cf3d364ab147e77ce327783a363e38faa044704
    items.jsonl               b54f6393da2bbc984115d417635bd4bb5e6efbe30ace40e3192f6a25245b76a5
    q3/ai_q3.jsonl            896882d45aeb022b6bf7ab0f4b31d028e66d622fbde1c9aa740b791bf8084319
    q3/items_q3.jsonl         bf485eb51e53fe021993424176a9f8efa726228847f7f7345422aeb4025b3861
    q3/raw_q3.jsonl           8dd87bf21428885a314627a31c9a38cb425459294fb7fd62a181fb92ce3ad620
    raw_v4_0_h.jsonl          bc639c44c54fb8d0cf72adfcde629f2384a547732000833c17d786bb9eb7df37
    raw_v4_0_o.jsonl          e75b7c11447d8e702584b0ea417df00e0d240981fc6750582aae99cb10bef061
    rule_flags.jsonl          eec8dfe549be37a9d27a76e9aed064bffb568702b13ca7a2fcf9934f985da29f

items.jsonl and q3/items_q3.jsonl hold the row texts. The raw and ai files hold the model's answers, those of the extra question with their quote fields. They are kept and not published.

**The SHA-256 of this document is anchored to the JIDEC ledger and stamped to Bitcoin. After anchoring, this record cannot be altered. Corrections are later entries that cite this one.**
