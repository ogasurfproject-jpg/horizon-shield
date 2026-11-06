# READINGS144 (written before the freeze; checker impl/war144_check.py)

Source text: README.md of maximusrufus/work-acceptance-record at 1b81ec98 (profile 1.4.4; the header line still says 1.4.3).
R1, R3-R5, R7-R16 of war12/impl/READINGS.md are carried over unchanged. R2, R6 and R17 are now decided by the 1.4.4 step 8 text
and are no longer readings: derived independence is `undeclared` with no producer named (so a claim of independent is
INDEPENDENCE_INCONSISTENT, warning PRODUCER_UNDECLARED); the outcome member `independence` is the stated value; SELF_CHECKED
is warned when the stated value is `self-checked`.

| R | Section | Text | Chosen reading | Other reading | Vectors it touches |
|---|---|---|---|---|---|
| R18 | step 8 (1.4.4) vs step 11 Checker (1.4.3) | 1.4.3: "A stated checker identifier that is empty or not listed gives self-checked ..."; 1.4.4: "only when the record claims independent, a stated key_id that is empty or not listed once" | the 1.4.4 derivation: an empty or unlisted checker or producer key_id makes derived self-checked only when the record claims independent | the checker case gives self-checked whatever the record states | none in 01-109 (103 and 106 claim independent) |
| R19 | step 8 (1.4.4) vs step 10 repeated key identifier (1.4.2) | 1.4.2: a repeated producer or checker key_id derives self-checked (75, 79); 1.4.4 lists "not listed once" under the claim-dependent rules | a repeated id is "a key entry that cannot be read": self-checked whatever the record states (KEY_REJECTED as before) | self-checked only when the record claims independent | 75 (states self-checked; the other reading would add INDEPENDENCE_INCONSISTENT, against "no outcome of 01-107 changes") |
| R20 | step 8 (1.4.4) names | "names are compared after removing leading and trailing white space and Unicode lower-casing"; absent: null, false, a number equal to zero, empty string/array/object; "unspecified", "unknown" | the trim and lower-case also apply before the empty / unspecified / unknown test; non-string declared names are compared by their JCS form; a checker name that is absent never equals a producer name; party names of any JSON type are read, not refused under the Types rule | a whitespace-only name is declared; non-string names never equal | none known in 01-109 |
| R21 | step 8 (1.4.4) | PRODUCER_UNDECLARED "follows the parties block (no producer named)" | warned whenever derived independence is `undeclared` (including names "unspecified" / "unknown") | only when the name is absent | 20, 109 |
| R22 | step 2 key rule with step 8 | a canonical-base64 party key that is not a prime-order point | KEY_REJECTED, independence derivation not changed (R9 kept) | an entry that cannot be read, so self-checked | 26, 27 (signer only; no change for 91-109) |
