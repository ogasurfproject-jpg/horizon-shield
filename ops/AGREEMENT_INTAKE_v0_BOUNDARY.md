# Agreement Intake v0, the boundary, DRAFT

**Status:** draft, 2026-09-10. No intake exists. This document is written BEFORE one does,
because the verifier was written before the fixture and the fixture before the second
implementation, and each time the order was what kept the next thing honest. A boundary decided
while writing the code that crosses it is not a boundary.

**Author:** The HORIZ音s株式会社 / HORIZON SHIELD. **License:** Apache-2.0, as `conduct-v1`.
**Language:** RFC 2119 keywords. Field names are exact.

**What is already settled, and is not up for discussion here.** The verifier
(`workers/hs-ledger/nenrin/agreement-v0/agreement_verify.py`, and its second implementation
`agreement_verify.mjs`) opens no socket. It has no clock of its own. It fetches no key, no agent
card, no conduct record and no ledger. Two people holding the same bytes reach the same verdict,
and neither has to be able to reach this operator. That property is proved twice over: 194
adversary vectors, 74 mutants against the Python, 33 against the JavaScript, and 5,283 frozen
cases on which the two implementations produce the same report byte for byte.

Everything the verifier refuses to do is the intake's job. This document is that list, and the
list of what the intake may not do either.

## 1. The seam, in one sentence

The intake gathers the facts the verifier is not allowed to gather, hands them in, and publishes
what comes back without changing a byte of it.

Concretely, the verifier's entry point takes five things: the record, a map from `key_url` to the
public key served there, the recorder's own domain, an instant, and the exact input text. The
intake supplies the second and the fourth from the world. It supplies the first and the fifth from
the request. It supplies the third from its own configuration. It supplies nothing else, and it
MUST NOT alter any of them on the way in.

## 2. What the intake MUST do

**2.1 Fetch the keys.** For each party, GET its `key_url` over https and read the public key
served there. Compare, do not judge: the comparison is the verifier's, and the intake only carries
the bytes it fetched.

**2.2 Answer 503 when a key cannot be fetched, and retry.** A `key_url` that times out, refuses
the connection or returns 5xx is not a bad record. It is an unanswered question. The intake MUST
NOT convert it into a verdict. It MUST answer `503` with a `Retry-After`, and MUST retry on its
own schedule. The verifier already has the matching refusal, `key_url_unreachable`, and says in
its own text that this is the intake's problem and not a verifier's.

**2.3 Refuse a duplicate submission, once, atomically.** Two submissions of the same record are
one record. This MUST be closed by serialising on strongly consistent storage, not by a read
followed by a write on eventually consistent storage. The reason is written up in
`workers/hs-hearing/src/dispatch_do.js`: an eventually consistent read has a window that no amount
of care in the calling code can close, because the window belongs to the storage and not to the
code. The idempotency key is the record's `canonical_sha256`, which is what makes two submissions
of the same record the same record.

**2.4 Batch and anchor.** Bundle the day's accepted records, publish the bundle, and anchor its
sha256 to Bitcoin as the existing ledger already does. The anchor is what bounds `agreed_at` from
above. The verifier states plainly that it never saw an anchor and that nothing in its report says
anything about time; the anchor is the only thing that does.

**2.5 Serve the bytes back by sha.** Anyone holding a `canonical_sha256` MUST be able to fetch the
exact bytes it names and recompute the hash themselves. A record that can only be seen through the
operator's own rendering of it is a record the operator can change.

**2.6 Publish the report unchanged.** The verifier's report is the answer. The intake MUST store
and serve it as produced, including every refusal code and the English sentence attached to it. It
MUST NOT summarise, reorder, translate or soften it.

**2.7 State which verifier version answered.** The report carries `verifier_version`. The intake
MUST keep it, so that a reader who disagrees today can find out which rules were in force then.

## 3. What the intake MUST NOT do

**3.1 It MUST NOT judge the terms.** Not their fairness, not their lawfulness, not their
completeness. No editorial step exists in this layer and none may be added. This is stated in the
anchored v0 draft and it does not move.

**3.2 It MUST NOT accept a one sided record.** Both signatures or nothing.

**3.3 It MUST NOT hold funds, take custody, or match orders.** It records that two keys signed the
same bytes. It is not an exchange and it is not an escrow.

**3.4 It MUST NOT charge a fee that varies with the deal.** The recorder fee basis is checked by
the verifier against a fixed list, and a basis that moves with the amount is refused by name
(`fee_tied_to_outcome`). The intake MUST NOT accept out of band payment that would do the same
thing while the record says otherwise.

**3.5 It MUST NOT re-canonicalise a record it stores.** The bytes it received are the bytes it
keeps. Under v1.1 a record travels in canonical form and a record that does not is refused
(`not_canonical`); under v1 it is a finding. Either way the intake stores what it was handed, and
the two shas in the report are what let a reader tell the difference.

**3.6 It MUST NOT fix a record.** Not a trailing dot on a hostname, not a missing field, not an
uppercase currency. A record that needs fixing is refused and the parties sign a new one. An
intake that repairs records is an intake whose output nobody signed.

**3.7 It MUST NOT answer while a key is unreachable.** See 2.2. Refusing and retrying are
different acts and the difference is the whole point of `key_url_unreachable`.

## 4. What is undecided, and MUST be decided before code

These are named here so that they are decided deliberately rather than by whoever writes the
first handler.

**4.1 Who may submit.** Either party, both, or a third party holding the signed bytes. The record
carries `record_paid_by`, which is about who paid, not about who submitted. If submission is open,
anyone holding a valid record can file it, which is arguably the point of a public record layer
and is also a way to publish an agreement one party wanted kept quiet. Not decided.

**4.2 What happens to a refused record.** Discarded, or kept and served under its own sha with its
refusal report attached. Keeping it makes the refusals auditable and makes the intake a publisher
of failed agreements. Not decided.

**4.3 Retention and deletion.** A record anchored to Bitcoin cannot be unanchored. What can be
withdrawn is the operator's copy of the bytes. Whether that is offered, and what it means when the
sha remains in an anchored bundle, is not decided.

**4.4 Rate limiting.** Necessary, and it MUST NOT be the shape of a fee.

**4.5 Whether the intake exposes its verifier over a URL at all.** Anyone can run the verifier
offline; that is the property the whole design is built on. An endpoint that answers "accepted" is
convenient and is also a thing people will start to trust instead of checking.

## 5. What this document does not establish

That an intake will be built. That the boundary above is complete: it is what is known on
2026-09-10, and the last three times a boundary was written here, building the thing behind it
found holes in it. That the verifier is correct; only that two independent implementations of it
agree, which is a different and weaker claim, and one this project measures rather than assumes.
