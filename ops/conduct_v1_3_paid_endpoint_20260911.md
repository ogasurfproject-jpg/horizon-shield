# conduct-v1.3 draft: an endpoint that charges is not an endpoint that failed

**Date:** 2026-09-11. **Status:** draft. Nothing changed in the walk yet.
**Found by:** pointing `a2a_conduct_walk.py` at a real agent for the first time in weeks:
`api.babyblueviper.com`, Federico Blanco Sánchez-Llanos's `invinoveritas-reasoning-agent`.
**Record:** `ops/first_record_prep_out/walk_babyblueviper.json`, sha256
`e43f4fad0bcf124953893618489a6f6e01ff9c18d30c8c9ed4affa5bb8a7ab3b`, verdict FAIL 1/5.

Four of the five assertions failed. Two of those four are faults in this walk, not facts
about that agent. Both were invisible to 47 selftest vectors because every fixture agent
in them is free and every fixture card declares the extension.

## 1. An endpoint that answers 402 is recorded as an endpoint that did not answer

Node 3 came back `http 402`. Payment Required. The card says why, in four places:

    x402           true
    paymentMethods ["Bearer", "L402", "NWC", "x402"]
    pricing        {"model": "pay-per-use", "currency": "sats",
                    "review": "~200 sats per verdict", ...}
    compensation   {"paid_by": "buyer", ...}

The agent answered. It answered correctly, and it answered exactly what its own card says
it would answer. The walk decides otherwise in one line:

    j = json.loads(b3.decode("utf-8")) if s3 == 200 else None

Every status that is not 200 lands in the same bucket. 402, 500, a timeout, and a body of
garbage are one outcome in the filed record: `measured_endpoint_answered: FAIL`. A reader
cannot tell "this agent charges" from "this agent is broken", and the first is a design
decision while the second is a fault.

The walk cannot fix this by paying. A witness that pays the agent it is walking has a
financial relationship with that agent, which is the precise thing the conduct layer
exists to make visible. **The walk must never pay, and therefore must be able to record
that it did not.**

## 2. `compensation_well_formed` FAILs for a reason that is not about compensation

The card's `compensation` object, fed to this walk's own checker:

    compensation_problems({"paid_by": "buyer", "referral_fee": false,
                           "listing_fee": false, "note": "..."})  ->  []

No problems. It matches the section 2 shape exactly. The walk recorded FAIL anyway,
because the assertion is gated on something else:

    A("compensation_well_formed: ...", ext is not None and not problems, ...)

`ext` is None, so the result is false whatever the compensation says, and the evidence
filed beside it is `capabilities.extensions is not an array`, which is a statement about a
different field. **Two independent questions collapsed into one answer, with the evidence
for one attached to the conclusion of the other.**

That fault has a name in this tree already. It was written eight hours earlier, in the
reply to the same person, about `key_urls_checked`: a report that names the problem in one
field and asserts the opposite in another. Naming it once did not stop the neighbouring
tool from doing it.

## 3. What 402 is worth

This is not only a defect to patch. Since conduct-v1 the walk has carried, permanently, in
every record's `does_not_establish`:

    truth of the compensation declaration

The walk had no way to test it. A card could declare `paid_by: buyer` and charge nobody,
or declare nothing and charge everybody, and a walk could not tell. **A 402 is the first
evidence a walk can obtain that a compensation declaration is real.** The agent said it
charges, and then it charged. That is a conduct fact, it is observable without paying, and
it belongs in the record as a pass rather than as a FAIL.

## 4. The change

**`measured_endpoint_answered`** gains one case. When node 3 answers `402`, the result is
`null` with a note naming the status, instead of `false`. The three state machinery
already exists: `extension_echoed` uses it for MCP mode. An assertion recorded `null` is
excluded from `n_total`, so a paid agent is measured on what could be measured.

**`payment_required_as_declared`**, new, in both modes:

| card declares a paid model | node 3 status | result | meaning |
|---|---|---|---|
| no | not 402 | `null` | nothing to enforce |
| yes | not 402 | `null` | this method answered without charging; a free tier is legitimate and the walk cannot tell a free method from a waived charge |
| yes | 402 | `true` | it said it charges, and it charged |
| no | 402 | `false` | it charged without saying it charges |

The last row is the one that matters and it is not decoration. Without it, 402 becomes a
way to dodge measurement: answer 402 to everything, take `null` on the endpoint assertion,
and never be measured again. With it, the dodge costs an assertion unless the card admits
the charging. **A rule that makes an inconvenient answer cost nothing is a rule agents
will learn to give.**

"Declares a paid model" is read from the card as: `compensation.paid_by == "buyer"`, or
`x402 == true`, or a non-empty `paymentMethods`, or `pricing.model == "pay-per-use"`. The
walk records which of these it saw, so recognition is never silent. This is a closed list
of exact keys, as with the extension URI: nothing is normalised and nothing is guessed.

**`does_not_establish`** gains one line whenever node 3 answered 402:

    that the amount charged matches the price the card declares: the walk did not pay

**`compensation_well_formed`** stops answering a question about the extension. The two
questions are separated: `conduct_ext_declared` keeps its own job, and this assertion is
asked of whichever declaration exists, with the record saying which one it read.

| extension | top-level `compensation` | result |
|---|---|---|
| declared | either | `params.compensation` is checked, as before |
| absent | present | that object is checked, and the note says it was read from there |
| absent | absent | `null`, and the note says the card carries no declaration anywhere |

The card's top-level key is a real declaration surface, not a consolation prize: the gate's
condition 3 has read it since 0.2.0 and section 2 of the extension names it. An agent
cannot dodge anything this way, because dropping the extension already costs
`conduct_ext_declared` and, in A2A mode, `extension_echoed` as well.

## 5. Measured, after the change

Replaying the fixed walk against the exact card bytes fetched on 2026-09-11 and a 402 from
the endpoint, the record moves from **FAIL 1/5** to **FAIL 3/5**, and the two assertions
still failing are the two that are true about that agent: it does not declare the conduct
extension, and so it does not echo it. `compensation_well_formed` passes and names where it
read the declaration. `measured_endpoint_answered` is `null` and says why. And the walk's
own selftest went from 47 vectors to 55, the eight new ones being: a paid endpoint that
declares and charges (control, PASS), one that charges without declaring (attack, FAIL), a
free endpoint making no payment claim, a paid card that answered without charging, a 500
that stays a failure rather than becoming a payment, a 402 that does not hide a missing
extension, a card with no extension and a malformed top-level declaration, and a card with
no compensation declaration anywhere.

One vector had to be changed rather than added. `no_extension_declared` expected
`compensation_well_formed: False` for a card whose top-level declaration is flawless. **The
expectation was the bug, written down and passing.** Six of the nine mutants that survived
the agreement verifier's battery last week were the same shape: holes in the test set, not
in the code. This one was worse, because it did not merely fail to catch the fault, it
asserted the fault was correct.

## 6. What is not decided here

- **401 is not handled.** Authentication required is a different fact from payment
  required and deserves its own reasoning, not a widened branch. Left open on purpose.
- **The spec text is not edited yet, and neither is the gate.** `CONDUCT_EXT_v1.md`
  section 4 names five assertions and defines `measured_endpoint_answered` as status 200,
  so the old behaviour was spec conformant and the hole is the spec's too. That text is
  also embedded in `hs-verify-gate/src/worker.js` as a single string with a published
  `spec_markdown_sha256`, so editing it means running `sync_ext_md.py`, moving the hash,
  and deploying the gate. v1.1 was drafted in `ops/` first for the same reason and this
  follows that path. The walk and its vectors ship now; the spec section and the gate's
  served assertion list wait on the line below.
- **The identifier.** Section 7 says a breaking change to the walk MUST use a new URI.
  This change adds an assertion and moves one result from `false` to `null`. Every agent
  that passed 5 of 5 before still passes 5 of 5, because the new assertion is `null` for
  free agents and the moved result only moves on 402, which no passing agent returned. So
  it is additive in effect, and the intake does not validate the assertion list at all: its
  own test files a record carrying one assertion. Section 12 set the precedent of revising
  in place with a numbered section and saying so. This draft assumes the same and **TOshi
  decides**.
- **Records already filed do not move.** Anchored bytes are anchored bytes. The walk of
  `api.babyblueviper.com` above stays what it is: a record of what this walk saw on
  2026-09-11 with the tool as it was. If it is refiled after the fix, that is a second
  record, and both are true about their own instant.

## 7. Consequence for the first agreement record

`ops/agreement_first_record_federico_20260910.md` section 8 offered two options for the
conduct record about party B, and asked which. **Neither, yet.** The walk as it stands
cannot describe that agent honestly, so a record produced by it should not be pinned by
sha256 inside the first agreement anyone is asked to co-sign. The tool is fixed first, the
walk is run again, and the record that gets pinned is one that says true things.

This is the third hole that only appeared when a real record was attempted, after the two
in `AGREEMENT_EXT_v0_1_DRAFT.md` section 6. All three came from the same person's
involvement, and none of them came from a fixture.
