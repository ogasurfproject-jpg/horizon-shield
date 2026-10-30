# FURUI blind-04: the salt, the selection, the pin and the answers, published after the score record

Each file below is named by its SHA-256 in the score record (JIDEC ledger entry 202), in the pin (entry 196) or in the score file. The result is in RESULT.md.

| file | sha256 |
|---|---|
| salt.hex | 0af987caeb52e85de2e289ffff0cbedf72882127d583ad8cccc1168e6f869743 |
| manifest.json | db6d892a664ab19c49a6337aa5436b4c379f2cdd1413ab454df9755835b2fe46 |
| draw_blind04.py | ae99059e6b2f02e4875ac3fe796bf1960d0103a9a9f2cf766ecb76513de015fe |
| BLIND04_PIN.json | cdbf162b305bc618d064f66062f065534f063a2cc8358e2994666ba63420075b |
| COUNTING_RULES_blind04.md | 72aa667abb0336f54004f44120195ce8042520f8ec65957c7825f3e9d5f3e8a0 |
| SCORE_blind04.json | 28fe1ce4b369cbfc4996f50afd2bfc6d18a3d201aee75a7fbaf177190262915a |
| RECOUNT_blind04.json | 45b0d9d2500dd83f0b42ed111897064ee14ef9a0ad7395379118ef94f4c8d387 |
| answers/ai_v4_0_h.jsonl | bd4f0738f12016606b518ee506cf43bac7bf280cffe058631979fd44a786c3ca |
| answers/ai_v4_0_o.jsonl | fda88f7c2458ee621c5b5906fd1fc4eb5a0ce701d54f3a695a5d649984ee34e6 |
| answers/ai_v_028_h.jsonl | d40170097f6328abb75e6d489c9d192fd07fff29f1c02c888d1945fa27b6d85d |
| answers/ai_v_028_o.jsonl | b4a8637edf5657da6370eac7318e6b59871719efbec945365463dc35b2a515c4 |
| answers/raw_v4_0_h.jsonl | d19047a07cc435dba906aa9e2cd9fab396177588c0821282e5a39f1aec4b406f |
| answers/raw_v4_0_o.jsonl | 18cfa3cefe55510f56ffa7890dc663da6ca003269dacb24913622d87f5ec674d |
| answers/raw_v_028_h.jsonl | bf7e5e1e1d219ef143aca22cdefcfe43a7e0d9c8fc36879ada29c42b0bfe1ffc |
| answers/raw_v_028_o.jsonl | fb80c92a2d03fce10819e5ab84b6de50344424fedc4b51d67f34d4af07e65d06 |
| answers/rule_flags.jsonl | d345d91128ce929b739f69c22599ef1d2532a06866ded8883bdd65fed63174c7 |

- salt.hex: the 32 byte salt. Its SHA-256 was anchored before the draw in the plan (entry 194).
- manifest.json: the strata, the drawn keys and the root. The root was anchored in entry 195 before anyone read the drawn set.
- draw_blind04.py: the draw tool named in the plan and the pin (sha256 ae99059e6b2f02e4875ac3fe796bf1960d0103a9a9f2cf766ecb76513de015fe). It uses the Python standard library only and holds no FURUI rule, classifier or prompt.
- BLIND04_PIN.json and COUNTING_RULES_blind04.md: the pin and the counting rules, fixed before opening (entry 196 names both by SHA-256).
- SCORE_blind04.json: the counts. RECOUNT_blind04.json: the recount from the raw answers by the pinned recount tool, with no difference.
- answers/raw_*.jsonl: the raw model answers, one line per row and stage (v_028 and v4_0, stage h for claude-haiku-5-5 and o for claude-opus-5-5). answers/ai_*.jsonl: the same answers as read by the run tool. answers/rule_flags.jsonl: the v_028 rules' flag for each row. Rows are named by key; no row text is in these files.
- A has no answer files of its own: as the pin says, A is counted from the rule flags and the v4_0 answers by the counting rules.
- The task scopes given on SPML (the System Prompt column of the pinned SPML revision) are not published here; they are in the public dataset.

Anyone can recompute the seed, the selection and the root from salt.hex, manifest.json, the hash of the block at the plan's height H (0000000000000000000007e65dae9fdace3a8f71630dfcb0357a962bd38f745a) and the four MEASURE files named with their SHA-256 in the plan record and in draw_blind04.py:

    python3 -I draw_blind04.py verify salt.hex 0000000000000000000007e65dae9fdace3a8f71630dfcb0357a962bd38f745a <dir of the four MEASURE files> manifest.json <blind04.jsonl>

The four MEASURE files are what remained of blind-03's after its draw (../furui-blind-03/manifest.json names the rows drawn into blind-03), which in turn are what remained of blind-02's (../furui-blind-02/). blind04.jsonl holds the drawn rows: the manifest's keys, taken from those four files. The row texts are the public datasets' own.
