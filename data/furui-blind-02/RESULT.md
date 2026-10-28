# FURUI blind-02: the result

1. On blind-02, a set of 2,030 public rows drawn after our plan was anchored and sealed before anyone read it, FURUI 0.2.8 refused 1,058 of 1,280 attacks (82.7%, 95% interval 80.5% to 84.6%) and wrongly refused 3 of 560 ordinary rows. Counting a model's refusal to answer as a pass instead of a refusal, it refused 1,054 of 1,280.
2. On jackhhao's ordinary rows, which are requests written to an AI assistant, FURUI 0.2.8 refused 100 of 190. FURUI asks whether text carries instructions to an AI; for text whose purpose is to instruct an assistant, it is the wrong check.
3. The change to unwinding in 0.2.8 (shorter minimum lengths for encoded runs, and unwinding each field before joining) was built from our own generator's phrase tables. On blind-02 it changed no verdict. We do not claim it helps on public attacks.
4. blind-02 is English public data, with some German in deepset. It says nothing about FURUI on Korean, Chinese, Portuguese, French, Spanish or German attacks; on our own generated attacks in those languages, the reading layers catch a minority.

Beside them, always in the same place (added after opening; not part of the pinned sentences):

The three bars fixed in advance were all met: all attacks 1,058 of 1,280 (bar 991), SPML attacks 787 of 1,000 (bar 729; 95% interval 76.1% to 81.1%, the weakest stratum), ordinary rows 3 of 560 (bar 3). Counted strictly, 1,054, 785 and 3.

FURUI 0.2.8 is rules plus two AI stages. The rules alone refused 579 of 1,280 blind-02 attacks (45.2%); the two AI stages added 479, for 1,058 of 1,280. Rows the rules refuse never reach the AI stages, so nothing the rules refused is passed, by construction.

| Ordinary text | Wrongly refused by FURUI 0.2.8 | 95% interval | What was measured |
|---|---|---|---|
| deepset and SPML ordinary rows (the bar fixed in advance) | 3 of 560, exactly the most the bar allowed | 0.2% to 1.6% | blind-02, drawn and sealed |
| jackhhao ordinary rows (requests to an assistant) | 100 of 190 | 46% to 60% | blind-02, outside the bar (sentence 2) |
| English business sentences written in-house (estimates, invoices, contracts, requests, delegations, notices) | 14 of 120, all by the rules; the AI stages added none (Haiku passed 102, Opus passed the other 4) | 7% to 19% | written in-house on 2026-10-26, frozen before the narrowed rules were written; not drawn, not blind; ledger entry 176 |
| English business sentences from real correspondence and contracts (Enron e-mail and SEC EDGAR contract exhibits, the tuning half) | 0 of 495 | 0% to 0.8% | drawn by seed and frozen on 2026-10-26; the validation half, 500 sentences, is sealed and will be opened together with blind-03 |

On ordinary chatbot prompts drawn into blind-02 (deepset and SPML), FURUI 0.2.8 wrongly refused 3 of 560, exactly the most the bar fixed in advance allowed. On requests written to an assistant (jackhhao) it refused 100 of 190, and on 120 business sentences we wrote ourselves it refused 14, all of them in its rule layer; the AI stages added none. On 495 sentences drawn from real business e-mail and contracts it refused none. FURUI is a check for text that should carry no instructions to an AI. The business-correspondence rows will be updated when the sealed 500 are opened with blind-03.

Of the business sentences, 12 have been refused by the rules since 0.2.4 and 2 since 0.2.7; most are ordinary contract, agency and correspondence wording that the rules read as instructions to an AI. Delegation notices were refused most often (6 of 20). The 0.2.9 fix is measured on sentences drawn from Enron e-mail and SEC EDGAR contract exhibits: 495 for tuning, and 500 sealed for a single validation count, opened with blind-03.

The AI stages cost USD 3.31 on blind-02, below the USD 4.5 to 10 estimated in advance, because the rules stopped 585 rows (579 attacks and 6 ordinary rows) without a call and Haiku passed most ordinary rows (601 of 750) without a second stage.

Records: plan entry 158, root entry 164, pin entry 165, score entry 167 on the JIDEC ledger (stamped to Bitcoin block 973,212); the salt and the selection manifest are published in horizon-shield commit e8ca10f9 (data/furui-blind-02/). The per-row flags and the raw model answers are not published; their SHA-256 are in the score record. A model's answers can differ between runs; the raw answers' SHA-256 let anyone check these ones, and we do not claim a rerun gives the same numbers.

Added on 2026-10-28, when blind-03 was opened: the sealed validation part of the business sentences (505 sentences from Enron e-mail and SEC EDGAR contract exhibits; the split by seed gave this number, not the 500 written above) is opened in [the blind-03 result](../furui-blind-03/RESULT.md) (score entry 186): 0.2.9 (a) wrongly refused 0 of 505 (0.2.8: 0). The text and the table above are left as first published.
