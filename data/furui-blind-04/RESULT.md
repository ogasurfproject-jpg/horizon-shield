# FURUI blind-04: the result

blind-04 was drawn after the plan was anchored, pinned before anyone read the drawn rows, opened once and scored with the pinned versions and counting rules. A separate recount tool, named in the pin, counted the raw answers again and found no difference. The digests of the score were anchored to the JIDEC ledger (entry 202) before this page was published.

The sentences below were fixed in the pin (entry 196) before opening and chosen from the numbers by the pinned rule. They are printed as chosen, for each version in the order the score file gives them.

## A (the v_028 rules, then the two AI stages with the task scope on SPML)

A wrongly refused 2 of 451 deepset and SPML ordinary rows on blind-04, above the 1 we fixed in advance.

On jackhhao's ordinary rows, which are requests written to an AI assistant, A refused 69 of 150. FURUI asks whether text carries instructions to an AI; for text whose purpose is to instruct an assistant, it is the wrong check.

On SPML, A, given the system prompt as the task's scope, met both lines we fixed before the draw: it flagged 1,648 of 1,749 attacks against 1,342 for v_028 (17.50 points more counted fail-closed and 17.44 points more counted strictly; the lines were 15 and 10), and wrongly flagged 2 of 403 ordinary rows against 2 (the line was at most 3 more). On the instruction verdict alone it flagged 1,388. SPML's system prompt stands in for the task scope.

## v_028 (FURUI 0.2.8)

On blind-04, v_028 refused 1,566 of 1,978 attacks and 1,342 of 1,749 SPML attacks; the bars we fixed in advance were 1,579 and 1,331. We report it as not met.

v_028 wrongly refused 2 of 451 deepset and SPML ordinary rows on blind-04, above the 1 we fixed in advance.

On jackhhao's ordinary rows, which are requests written to an AI assistant, v_028 refused 69 of 150. FURUI asks whether text carries instructions to an AI; for text whose purpose is to instruct an assistant, it is the wrong check.

## Both versions

blind-04 is English public data, with some German in deepset. It says nothing about FURUI on Korean, Chinese, Portuguese, French, Spanish or German attacks; on our own generated attacks in those languages, the reading layers catch a minority.

Rows sent to a model a second time, because a run stopped after the call and before its answer was saved: 0. Any such first answer is kept in a separate file and is not counted.

## Lines fixed before the draw

Line 1: at least 1,579 of 1,978 attacks. Line 2: at least 1,331 of 1,749 SPML attacks. Line 3: at most 1 of 451 deepset and SPML ordinary rows wrongly refused. Lines 4 and 5 compare A with v_028 on SPML. A version clears blind-04 when it meets lines 1 to 3.

| | line 1 | line 2 | line 3 | cleared |
|---|---|---|---|---|
| A | 1,872 (met) | 1,648 (met) | 2 (not met) | no |
| v_028 | 1,566 (not met) | 1,342 (met) | 2 (not met) | no |

The numbers in this table are copied from SCORE_blind04.json (lines_fc); that file is the source.

## Records

| record | JIDEC ledger entry |
|---|---|
| plan | [194](https://ledger.horizonshield.dev/ledger/194) |
| root | [195](https://ledger.horizonshield.dev/ledger/195) |
| pin | [196](https://ledger.horizonshield.dev/ledger/196), claim 9bb6eb57d9f51b8d932a47894a94b05bc85bf21c64d8c6302347cbc394cdcd43 |
| score | [202](https://ledger.horizonshield.dev/ledger/202), claim 9c4375f3f17606e21b719a66431e85be2d63043f72090af82b05c7e19cab757b |

## Checks by others before the draw

Two people outside the company checked the plan's timestamp before the draw. What each checked, in their own limits:

- Pavel Shtomko (Pavlo), who has worked with us before (MUSUBI, September 2026), recomputed the SHA-256 of the plan record (entry 194, claim 192797c793ce9a73cbdc6a42edd0e0f562b6152cda5ca1ab8b46774cc0be1233) and checked its OpenTimestamps path to Bitcoin block 973640 on 2026-10-29, while the chain tip was 973682, before the draw height 973697. In Pavlo's words, this is "confirmation of the pre-draw timestamp commitment through public-provider headers, not local full-node consensus validation, and no claim about who has seen which rows." Pavlo disclosed that Codex assisted the check. The seed, selection, root and result remain unverified on Pavlo's side until the files below have been checked.
- Federico Blanco Sánchez-Llanos recomputed the same claim from the record bytes and walked the .ots proof with a standard-library tool of Federico's own to block 973640, comparing the header, proof of work, bits and merkle root on mempool.space and blockstream.info, while the chain tip was 973683. Federico has not checked the seed, the selection, the root or the result.

Neither check covers the rows, the answers or the counts. Whatever either of them finds from the files below will be reported as found, a match or not.

The files are listed in README.md in this directory.
