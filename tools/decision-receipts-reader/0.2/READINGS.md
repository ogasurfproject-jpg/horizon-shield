# dr_check 0.2.0: places where the text of -11 reads two ways

This is a record of the places that read two ways when dr_check 0.2.0 was written from the text of draft-gruszka-audit-decision-receipts-11 alone.
The expected values of the test package (617 vectors) were not looked at. R-1 to R-17 were decided before looking at the package. R-18 to R-22 and the rewrite of R-10 were decided after looking at the input files of the package, without the expected values. The code names only the number (R-n).
Each item gives the section and step, then Reading A and Reading B, then Chosen with the reason.

## R-1 An escape of an unpaired surrogate (3.10 step 1, 3.2 step 4, 3.3 Case 1, Section 4)

- Reading A: The grammar of RFC 8259 allows `"\ud800"`. Section 8.2 only says that the behaviour is not determined. So it can be read as JSON in the envelope, the approval record and the consumption state. P fails under RFC 8785, as the sentence of 3.2 step 4 says. The approval record fails at Case 1, under the rule that it is its own RFC 8785 serialization.
- Reading B: For every input, JSON that holds an unpaired surrogate cannot be read. It fails at the step that reads it.
- Chosen: A. The text names this failure only for P in step 4. 3.10 step 1 says only "JSON text of [RFC8259]". The readings differ only for a surrogate in a member of the envelope that is not checked (such as keyid), or in the consumption state.

## R-2 The trust policy lists several keys, and one of them does not meet the key rules (3.2 step 3, B.3 step 3)

- Reading A: A key that does not meet the rules is dropped from the candidates. The rules are: it decodes under 5.1.7, it is not the identity point, and multiplying it by L gives the identity point. If no key that meets them verifies, it fails at step 3.
- Reading B: Read "a receipt whose expected key does not meet this fails this step whatever signature it carries" as follows: if any one of the listed keys does not meet the rules, it fails at step 3.
- Chosen: A. The text writes "the expected key" in the singular. When the policy lists only one key, A and B give the same result.
- After seeing the package: The package calls pass the expected keys one at a time (-pub, -decision-pub, the key of -held). So 0.2.0 tries only that one key. This item has no effect on the results of the package's vectors.

## R-3 The payload of the envelope is not a string (3.10 step 1, step 2)

- Reading A: It fails at step 2. A payload that cannot be read as base64 falls under "a payload in another form fails this step".
- Reading B: It fails at step 1, as a malformed envelope.
- Chosen: A. Step 1 fixes types only for payloadType (a value), signatures (an array) and each entry of signatures (an object whose sig is a string). For payload it asks only that it be present.

## R-4 "The key that step 1 verified" for an outcome receipt (3.4 step 1, step 5)

- Reading A: Go through signatures in their order. The key that step 1 verified is the key of the first entry that verifies. That is the first key that passes, in the order the policy lists them.
- Reading B: When more than one key verifies, it passes if any of them meets step 5.
- Reading C: If any key that verifies is a key of the decision maker, it fails at step 5.
- Chosen: A. Step 5 fixes a single key: "The outcome-signing key is the key under which step 1 verified the outcome receipt". 3.10 step 3 stops at "At least one entry". For a receipt with one signature, A, B and C give the same result.

## R-5 Where the approver key comes from (3.11.2, 3.11.3 check 3)

- Reading A: The approver key is given as an input. 3.1 lists "the approver key of Section 3.11.2" among the inputs. Check 3 looks at whether the policy binds that key to the approver of A. When no key is given, the key that the policy binds to the approver of A is used. If there is not exactly one such key, it fails at check 3.
- Reading B: The policy always picks the key by the approver's name. Check 3 then always passes.
- Chosen: A. I read check 3 as a separate check because the key can come from outside the policy.

## R-6 The item that applies when the approval is found in the consumption state (Section 4 item 1, item 4)

- Reading A: If it is found in the current generation, item 1 applies. This holds for the same bytes and for a copy with other bytes; the second to last paragraph of Section 4 says item 1. If it is found only in a rotated generation, item 4 applies.
- Reading B: If it is found in any generation, item 1 applies. Item 4 and item 5 only say which states are counted.
- Chosen: A. Item 4 is the item that names the rotated representations (rotated, archived, compacted). This is the same as G24 of 0.1.1.

## R-7 The item for a consumption state that cannot be read (the depth of 3.1, Section 4 item 5)

- Reading A: A state that is not JSON, is deeper than 64, or has an unknown shape is refused under item 5 as "Missing or unreadable state".
- Reading B: "fails the step that parses it" in 3.1 means the steps of 3.2 to 3.4. The depth of the state has no named item.
- Chosen: A. 3.1 says the same limit applies to the consumption state. Item 5 is the only item of Section 4 that reads the state.

## R-8 The range of keys tried at step 3 (3.1, 3.2 step 3, step 8)

- Reading A: Try every key the policy lists for decisions. If the key that verifies is not bound to the expected decisionMaker.id, it fails at step 8.
- Reading B: Try only the keys bound to the expected decisionMaker.id. A receipt signed by another key of the policy fails at step 3.
- Chosen: A. Step 8 checks separately that the name is bound to the key of step 3: "the trust policy binds to the key of step 3". This is the same as G22 of 0.1.1.
- After seeing the package: The call passes one expected key with -pub. That is the key the call chose under "keys selected by its trust policy" of 3.1. 0.2.0 tries only that key. Step 8 checks whether the policy binds the expected decisionMaker.id to that key.

## R-9 The approver signature check is asked for outside Case 1 (3.11.2)

- Reading A: Do not run the check, and report that it was not run because the case is not Case 1. Leave the result of the receipt as it is.
- Reading B: Treat it as an error in the input, and give no result.
- Chosen: A. "is not asked for under another case" is a rule for the one who asks. The text names no failure for the one who checks.

## R-10 How the decisions that belong to the consumption scope are named (3.5 first check)

- Rewritten after seeing the package. The audit context and the trust policy of the package put an array of content roots in decisions of consumptionScope. They also put unreleased as an array of content roots.
- Reading A: When decisions is not an array of content roots, the scope cannot be read in full. The package has a file with "decisions": "all". The first check then gives no result (3.5 "cannot read its audit context or the scope it obtains"). It does not fall back to the scope of the policy.
- Reading B: Read "all" as all the decisions it holds.
- Chosen: A. The text does not fix the form. The other files of the package name decisions by content root. So any other form is a form this reader cannot read. The name of that file (e-ac-bad-scope) was seen. This records that the choice was made for the reason above, not to fit the name.

## R-11 A receipt "whose verdict is not ALLOW" (3.5 second check)

- Reading A: The preliminary checks do not apply step 7 of 3.2. So a held decision receipt may have no valid verdict in its predicate. It is still counted as a conflict, as not ALLOW. When decisionRef names an outcome receipt, it is not counted, since an outcome receipt has no verdict.
- Reading B: Count only the decision receipts whose verdict holds a value other than ALLOW.
- Chosen: A. The sentence is written in the negative, "whose verdict is not ALLOW". This matches Case 3, which asks for ALLOW. Outcome receipts are left out because the sentence gives verdicts such as DENY and REFUSE as examples. So it speaks of decision receipts.

## R-12 The "valid URI" of StringOrURI (B.2, B.3 step 1)

- Reading A: The `URI` production of RFC 3986: an absolute URI with a scheme, ASCII only. A value that holds a colon and a non-ASCII character fails.
- Reading B: Also allow URI-reference or IRI (RFC 3987).
- Chosen: A. RFC 8392 cites the definition of RFC 7519, which says "MUST be a URI [RFC3986]". A value with no colon passes even if it holds a space. The iss "gate 1" passes, and the sub "decision:dec 0001" fails.

## R-13 A CBOR text string is not valid UTF-8 (B.3 step 1)

- Reading A: It fails at step 1. Under RFC 8949 5.3.1 it is not valid CBOR, and core deterministic encoding assumes a valid data item.
- Reading B: Step 1 checks only what it lists, so it passes.
- Chosen: A.

## R-14 In the third check, the receipt being verified is not itself held (3.5)

- Reading A: If that receipt does not pass steps 1 to 6 and the rules of relationships, the third check gives no result.
- Reading B: The supersedes entries of that receipt cannot be confirmed, so the third check fails.
- Chosen: A. A failure of the receipt being verified shows up as its own step under 3.2 to 3.4. So it is not repeated in the third check.

## R-15 The supersedes chain forms a loop (3.5 third check)

- Reading A: The entries of a receipt already seen (the same content root) are not looked at twice.
- Reading B: The text does not foresee a loop, so this is left open.
- Chosen: A. Every entry is still checked once, so the result does not change. It only makes sure that the check stops.

## R-16 "including when kid is used" for the length of iss (B.2, B.3 step 1)

- Reading A: kid is always in the protected header. So the iss length of 1 to 8192 (Unicode code points) always applies. It does not apply to sub.
- Reading B: It applies only when kid is used to choose the receipt. The text says, however, that kid is not used to choose the key.
- Chosen: A.

## R-17 Which receipt types the SHA-256 and signatures of the V1-good and V1-bad payloads of Appendix A.3 belong to (Appendix A, A.3)

- Reading A: They belong to the types of -11 (3.10). The start of Appendix A says "rewritten with the receipt types of Section 3.10" and "signed again by the same keys".
- Reading B: Read "recorded with the receipt types of revision -10" in A.3 as covering the printed values too. They then belong to the types of -10.
- Chosen: A. I read the sentence of B as applying to the record of exit codes. The self test (`--selftest`) compares values under this reading. So if it gives NG, B is the right one.

## R-18 The kinds and bindings of held receipts (3.5 preliminary checks)

- For each held receipt, the package calls pass only a key and a file (-held key:file). They do not say whether it is a decision or an outcome, or which binding it uses.
- Reading A: The binding is DSSE. The start of Section 3 takes the binding as an input, but -held has no field for it, and every file is .json. For the kind, a held receipt must pass steps 1 to 5. It then passes the preliminary checks if step 6 passes under the decision type or the outcome type. Steps 1 to 5 are the same for both, so the only difference is the type at step 6.
- Reading B: There is no input for the kind or the binding. So every preliminary check is run as for a decision. An outcome receipt then fails at step 6.
- Chosen: A. 3.5 assumes held receipts of both kinds: "Either kind of held receipt may be a predecessor of either kind of receipt". The S1 and S2 calls pass outcome receipts with -held.

## R-19 The validUntil of received copies (Section 4 item 2) and the order of the items

- Reading A: Take the -received copies with the same identity (approvalId, session, actionDigest) whose validUntil has the date and time form of 3.8. Take also the validUntil of the approval record A being checked. If T is not strictly before the earliest of these times, it is refused under item 2. A malformed copy gives no time, so it is not counted. The order is item 5 (the check of the state), item 1 (the current generation), item 4 (the rotated generations), then item 2.
- Reading B: A malformed copy is also a reason to refuse. The order follows the numbers: item 1, 2, 4, 5.
- Chosen: A. Item 5 puts the check of the state first: "Before it checks whether an approval is consumed". The limit of item 2 is a separate matter from consumption, so it comes after. The item 2 vectors of the package (F90, G15a, G15b) have an empty state, so the order has no effect on their results.

## R-20 No outcome receipt is passed in Case 3 (3.3 Case 3)

- I1 of the package adds -case executed to a decision call and passes no outcome receipt.
- Reading A: If the verdict is ALLOW, the next sentence, "the outcome receipt MUST pass Section 3.4", cannot be met. So it fails at Case 3 (the step is 3.3 case 3).
- Reading B: An input of 3.1 is missing, so no result is given (an error in the input).
- Chosen: A. 3.1 says that Case 3 needs the key of the outcome receipt and executor.id. It does not say what happens when they are missing. The sentence of Case 3 is written with MUST.

## R-21 "The receipt being verified" in the third check under Case 3 (3.5)

- Reading A: In an outcome call, both the decision receipt and the outcome receipt are the receipt being verified. The supersedes entries of both are followed.
- Reading B: Follow only the outcome receipt placed last in the call.
- Chosen: A. Case 3 verifies both receipts in their own right (3.3). If the decision receipts of the package (v3-decision, c3-decision) have no relationships, A and B give the same result.

## R-22 The order for folding the results of 3.5 into one result and step (3.5, the form of the verdicts file)

- The text does not say how the results of 3.5 (the three checks and the preliminary checks) are ordered against the result of the receipt check. The verdicts file holds one result and one step per vector, so a way to fold them was fixed.
- Chosen: (1) If the verification of the receipt fails, that step. (2) If Section 4 refuses, that item. (3) If a held receipt fails the preliminary checks, result "invalid input" and step "3.5 preliminary checks" (3.5 "the input is invalid"). (4) If a requested check fails, result "fail" and step "3.5 first check" and so on, in the order first, second, third. (5) If the requested first check gives no result, result "no result" and step "3.5 first check". (6) Otherwise pass. The third check runs when -held is given. The package has no flag that asks for the third check, and the K vectors pass only -held. The result of each check of 3.5 is kept apart in the set_checks member.
- Other readings: "invalid input" applies only to the result of the third check (3.5 "reports no result for this third check"). The first and second checks give results with the held receipts that passed the preliminary checks. So (3) would come after (4). Another reading lists the result of the receipt and the results of 3.5 as separate results.
- Reason: 3.5 writes a failure of the preliminary checks as a matter of the whole input: "failure of either makes the input invalid". So (3) was put first.

## Not readings, but forms fixed after seeing the package (not counted as items)

- Inputs: make_inputs.py copies the verifier.argv of each vector into inputs-11.json. It reads 6 places in the package: inputs.json, inputs-08/, inputs-10/, cose/inputs-cose.json, approver-signature/inputs-sa.json and first-check/inputs-first.json. It keeps only the name, the source file, argv, and the MANIFEST.sha256 values of the files the call reads.
- Call flags: A decision call takes -policy, -pub (the expected key), -signer (the expected decisionMaker.id), -t, -aud, -nonce and -case (approval, declined, executed). It also takes -binding, -action, -approval and -approver-pub (if present, 3.11 is asked for). Then come -consumed (the state; if present, Section 4 runs), -received, -held key:file, -held-approval, -first, -second and -audit-context. The receipt file comes last. An outcome call is Case 3. It takes -decision, -decision-pub, -decision-signer, -decision-aud, -decision-nonce and -decision-binding. It also takes -pub (the expected key of the outcome), -binding (the binding of the outcome), -executor-id and -effect.
- Trust policy: {"decision": {key: [name]}, "outcome": {...}, "approver": {...}, "consumptionScope": {...}}.
- Consumption state: An array is the current generation. An object is a set of generations: current is the current generation, and the others (such as rotated) are rotated generations. A generation whose value is not an array is refused under item 5. This is the form where compacted holds only a count.
- Audit context: {"consumptionScope": {"id", "decisions": [content root]}, "unreleased": [content root]}.

## Rewrites in 0.2.1 (from the posted text of -11)

- R-1 to R-22 above are the readings of 0.2.0. The verdicts of 0.2.0 (gruszka11_verdicts_06ddf097.json) were frozen before 0.2.1 was written. The lines above are not deleted or changed.
- draft-gruszka-audit-decision-receipts-11 was posted on 2026-11-22 (datatracker, rev 11). The posted text adds sentences to 3.1, 3.4 step 5, 3.5, 3.10 step 3, Appendix A.3 and Appendix B.5 (the change log in Appendix C). 0.2.1 puts into the code only the rewrites that go the same way as two of them. All other verdicts stay as in 0.2.0.
- dr_check_0.2.0.py (14118f11) is 0.2.0, kept unchanged; dr_check.py is 0.2.1.
- The quotes below are from the posted text of -11.

### The rewrite of R-18 (the binding of a held receipt)

- -11, 3.5: "The Auditor knows the binding of a held receipt as it knows its expected signing key. It need not know whether the receipt is a decision receipt or an outcome receipt; a held receipt passes these preliminary checks where it passes them as one of the two, and step 6 of its binding lets it pass as one of them at most."
- 0.2.1: The binding is an input of the call (-held [binding:]key:file). A call that gives no binding is taken as dsse, and every call of the package is of this form. The kind is handled as in Reading A of 0.2.0.
- This has no effect on the verdicts of the 617 vectors of the package. Every held receipt in the package is DSSE, and 0.2.0 had also fixed the binding to DSSE.

### The rewrite of R-20 (no outcome receipt in Case 3)

- -11, 3.1: "A request for Case 3 that supplies no outcome receipt is incomplete; the verifier gives no result for it, and no result is neither a pass nor a failure of a step."
- 0.2.1: Such a call returns "no result" (step 3.1 incomplete invocation) before any step runs. Under Reading A, 0.2.0 failed it at 3.3 case 3.
- The vector it affects: I1 (the one disagreement of 0.2.0).
- The same paragraph says: "Required approval record bytes that are not supplied fail Case 1, and required action bytes that are not supplied fail check 1 of Section 3.11.3." The code of 0.2.0 already works this way (case1 "approval record bytes not supplied", approver_signature "check 1: action bytes not supplied"). It is not changed.

### Sentences not put into the code (no effect on the verdicts, or already the same)

- Appendix B.5: "A step of Appendix B.3 that cose/expected-cose.json names as the step at which a decision receipt fails is the step of the same number of Section 3.2, which applies it; for an outcome receipt that file names the step of Section 3.4." 0.2.1 does not change the names of the steps. In the count, 11 vectors were listed apart as steps of B.3. All of them are decision receipts and name the same number. So under this sentence they count as agreeing.
- 3.5: "Their results are reported apart from the result of a receipt under Sections 3.2 to 3.4; a failure or a missing result here does not turn a pass of that receipt into a failure, and a pass here does not turn its failure into a pass." 0.2.0 and 0.2.1 put the three checks apart in the set_checks member. To give one result and step per vector, they still fold them by R-22 and change the result. The expected value of the package is also one value per vector, so this has no effect on the count. This only records that the form differs from the sentence of -11. On a line whose result is "3.5 ... check", the verification of the receipt itself passed.
- 3.4 step 5: "That is the one expected key that the verifier selected under its trust policy and supplied to step 1; no step takes a key from the receipt, and where a receipt carries more than one signature and several of them verify, they verify under that same key." Under this sentence, the three readings of R-4 give the same result. The package calls pass one key at a time, so the verdicts do not change.
