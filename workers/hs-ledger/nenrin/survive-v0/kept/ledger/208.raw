# FURUI A: how often A stops on-topic requests of outside sources (check D)

**Status:** a plan record. It is anchored to the JIDEC ledger, and the run waits until this entry is sent to OpenTimestamps. It fixes the rows and their split before any row is sent to a model. It also fixes the line with its readings, and the cap. It holds no row text and no model answer.

## 1. Why

Version A did not meet line 3 of blind-04: it wrongly stopped ordinary rows by the scope flag alone. A version A'' that makes the scope judgement more exact could lower those errors only if they are misreadings, that is, requests inside the task that the model reads as outside it. This check measures one thing first: how often A itself stops requests that outside sources label as inside the task. No new version is built and no new question is asked.

This check was decided after the results of ledger entries 205 (the tune of A') and 207 (the check on Impel) and the published counts of blind-04 were seen. It is a diagnostic run that decides whether A'' has anything to remove. Whatever its result, it is not a pass of FURUI, and blind-05 is not drawn now.

## 2. Rows

- Sources and files, the same as in ledger entry 203. The run script downloads them again and compares their SHA-256 with these values before any row is built:

      gabrielchua/off-topic                           226c66f56fbbd032b17ea07528b7057078eb0dc6  test.parquet                                   af82d28082a3cf87046adfe401663ccf2fa3caf7e6f5ccf01963acff8e424234
      nvidia/CantTalkAboutThis-Topic-Control-Dataset  b015ae8902d8429ce32ebfed9f9935f891d10ed5  canttalkaboutthis_topic_control_mixtral.jsonl  031adcb13e1b608609ec8a992085f8fc4d7d868d8aa5f2068f7d8c1f3ac53410

- The sets are V1 (GovTech on_topic, 8,657 rows) and V2 (CantTalkAboutThis user turns, 7,679 rows), built by the rules of entry 203. Their key lists are checked against the SHA-256 in entry 203 (c57cc08ffa2295ae346da49f632f8fc1542f9e7f0af0d784d94b64d4e348bbf2 and e35c16822780ee805455b84686969b6f654e4e49a336e6ed80abac459f542b35). No row of these sets has been sent to a model before; the check of entry 203 was not run.
- Split by system prompt. A system prompt goes to half D when the first byte of sha256("furui-aprime2-half|" + source revision + "|" + system prompt) is below 128, and to half C otherwise. The same system prompt never falls in both halves.

| half | V1 rows | V2 rows | rows | system prompts |
|---|---|---|---|---|
| D | 4,407 | 4,089 | 8,496 | 783 |
| C | 4,250 | 3,590 | 7,840 | 747 |

- Only D is used in this check. C is kept for a later check and is not built by the tool of this check. If A'' is built after D, C is where it is checked, so that the check is not a tune.
- The task scope given to A on each row is the row's own system prompt. The message is the user text.
- V3 and SystemCheck are not used: V3 holds requests outside the task, which is not the question of line 3, and SystemCheck's user messages were written by a model of the same family as the judge.
- No user text was read by a person to choose the rows, the split or the line. Counts and hashes were made by programs. The v_028 rule flags of D were not counted before this record.

## 3. Calls

- A as pinned in ledger entry 196, unchanged: v_028's rules, then claude-haiku-5-5 with prompt v4 on every row the rules leave, then claude-opus-5-5 with prompt v4 on the rows Haiku stops by verdict or by any conflict. The calls go through the same tools as blind-04 and pass its pin gate; the only change is the name of the dataset whose rows carry a scope.
- v_028's model stages are not called. The extra question of A' is not asked.
- Tools:

      aprime2_team_20261030/d_check.py                       45f61705d4db0274a7a8880b25b376effb2d199718e1c96fd0d0b08ed922a6a2
      furui_blind04_pin_team_20261029/run_blind04_stages.py  d1101c83a87c37ffa46278e14c9791fb515f8982a83f68e792b38f3e977dd75d
      furui_blind03_20261027/run_blind03_stages.py           a4d03a9e04231300dc4904c33869ca2fedb4f9f27e0e281388992e3ab403d416
      blind04_tune2_20261028/policy_b04.py                   07f9b403bd26aa981c3581271635cf2f3f43d0ab8bcaccc0cbee95aa70396031
      outside_sources_team_20261030/outside_rows_lines.py    0143c731c85b90fd357763087814facb7ced7d78a2f39099069f3021c8d4524a
      furui_blind04_20261028/BLIND04_PIN.json                cdbf162b305bc618d064f66062f065534f063a2cc8358e2994666ba63420075b
      spml_scope_20261026/raw/spml_prompt_injection.csv      4ca6590cd8ec10832fcebee5e243acb32be5c3e79b7a260f8638eed738c784f8

- The parquet file is read with pyarrow 26.0.0 in its own environment.

## 4. Cost and cap

- Estimates by the tool: claude-haiku-5-5 on all 8,496 rows, 1.92 US dollars at most. claude-opus-5-5, 0.0105 US dollars per row it is sent; the share of rows Haiku sends on is not known (on SPML ordinary rows of blind-04 it was 3 of 403).

| rows sent to Opus | Opus | in all |
|---|---|---|
| 2% | 1.79 | 3.71 |
| 5% | 4.48 | 6.40 |
| 10% | 8.96 | 10.88 |

- Cap: 25 US dollars. Before each stage, what has been spent plus that stage's estimate is compared with the cap, and the stage is not started if it would go over. The Opus stage would go over if more than about 26% of the rows were sent to it. Then nothing is counted, and what to do next is decided in a new record.

## 5. Line and readings (fixed before any call)

A row is stopped when its last stage counts as stopped in policy_b04.py (fail closed). The line for D is at most 2 stopped rows of 8,496: the largest count whose 95% one-sided Poisson upper bound (0.0741%) stays at or below 0.08%, the line of entry 203. At 3 the bound would be 0.0913%. The line for C, if it is used later, is at most 1 of 7,840.

- If D is at most 2: A seldom stops the on-topic requests of these sources. A'' has no measurable misreading to remove and is closed; C is not used. Whether A's errors on SPML's ordinary rows are misreadings is not shown by this result. With A'' closed, no way is now seen to meet lines 1 to 4 at once on the four sources; the results of entries 205, 207 and this check are published together, and a new source is chosen under a new plan.
- If D is 3 or more: misreading is measurable. The new plan for (ro) is written, built on the stops of D and the SPML BUILD attacks, and checked on C (at most 1). (ro) is a second scope question asked of claude-opus-5-5.
- One candidate reading, kept apart from the facts: SPML's ordinary rows may carry requests outside the task, or SPML's scope texts may be written in a way that A reads differently. This check does not test either.
- Either way, no stopped row's text is read in this check. Whether rows are read to build (ro) is decided in that plan.
- Shown beside: stops by kind (rules, verdict, scope flag alone, refusal or failure), by source, the number of system prompts with a stop, and, on the stops by the scope flag alone, whether Haiku also named a scope conflict (the double agreement, which is not a line).
- Limits: the rows were generated by models rather than written by people. They are also written differently from SPML's ordinary rows. The result of D does not show how often A stops SPML's ordinary rows.

## 6. What follows

- The check is run once. The line and the readings are not changed after the result is seen. If D is at most 2, A'' is closed, and C is not used to try again.
- The run waits until this entry is pending or confirmed on OpenTimestamps.
- The result is anchored as a later entry that cites this one. It holds counts and SHA-256 only. Row texts and model answers are kept and not published; the rows are the public datasets' own.

**The SHA-256 of this document is anchored to the JIDEC ledger and stamped to Bitcoin. After anchoring, this record cannot be altered. Corrections are later entries that cite this one.**
