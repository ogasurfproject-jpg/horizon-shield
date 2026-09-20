# Agreement Intake v0, the five decisions, 2026-09-16

**Status:** decided, 2026-09-16. This document answers section 4 of
`ops/AGREEMENT_INTAKE_v0_BOUNDARY.md`, which named five things and said they
"MUST be decided before code ... so that they are decided deliberately rather
than by whoever writes the first handler." They are decided here, in the open,
before the handler, on purpose. The handler
(`workers/hs-ledger/nenrin/agreement-v0/agreement_intake.mjs`) is built to
these and to nothing the boundary forbids.

**Author:** The HORIZON SHIELD / The HORIZ音s株式会社. **License:** Apache-2.0.
**Language:** RFC 2119 keywords. Field names are exact.

**What does not move.** Everything in the boundary doc still holds. The verifier
opens no socket, has no clock, fetches nothing, and two people holding the same
bytes reach the same verdict. These five decisions live entirely in the intake,
which is the thing that gathers what the verifier is not allowed to gather and
publishes what comes back without changing a byte of it. Nothing here relaxes a
MUST or a MUST NOT from the boundary.

---

## 4.1 Who may submit. Decided: anyone holding the fully signed bytes.

A record carries both signatures over the exact bytes it names, and the verifier
proves them with no network and no live key server. So the identity of the
submitter adds nothing to the record's authenticity: the bytes speak for
themselves or they do not. The intake therefore MUST NOT authenticate the
submitter, because to gate submission on "a party only" it would have to fetch
or trust something outside the signed bytes, which is the side channel the whole
design refuses.

Open submission has one real hazard, named in the boundary: a third party can
publish an agreement one side wanted kept quiet. Two things bound it, and
neither is an editorial step.

First, both signatures MUST verify before anything is stored (this is the
verifier's `one_sided` and `signatures_disagree`, unchanged). Nobody can publish
a draft a counterparty never signed. What can be published is only a record both
parties actually signed, whose declared schema is a public agreement record.

Second, only an accepted record is ever made public (see 4.2). A half signed or
tampered record naming someone is refused, and a refused record is not published.

This matches the witness intake, where anyone holding a signed walk may file it.
Abuse of the open door is a rate problem, handled in 4.4, not an identity
problem.

## 4.2 What happens to a refused record. Decided: returned to the submitter, never published.

An accepted record is stored, deduplicated, pooled, and anchored, and is served
by its `canonical_sha256`. A record that is refused, or that comes back
`incomplete` (shape valid, no signatures checked), is NOT stored, NOT counted in
the pool, NOT anchored, and NOT served by sha. The verifier's full report,
verbatim, is returned in the HTTP response to the submitter, so they know
exactly why and can fix the record and re-sign it.

The reason is anti-smear. A public, anchored, content addressed layer of refused
records would let the intake become an instrument for attaching a negative
looking public artifact to a named counterparty who never signed a valid record.
"Refused" printed next to two company names reads, to a careless reader, as
"these two had a bad deal," which is precisely the harm the record layer exists
to prevent, run in reverse. Publishing only accepted records costs the honest
submitter nothing: they still receive the whole report in the response, and only
the case where the parties genuinely agreed becomes a public, permanent fact.

Auditability of refusals is a real want and can come later, but only as
something the parties opt into by both signing a record that says so, never as a
default the intake imposes on a named third party. Not in v0.

## 4.3 Retention and deletion. Decided: accepted records are kept and served; v0 offers no deletion.

A record anchored to Bitcoin cannot be unanchored: its sha stays in the bundle
forever. What an operator could withdraw is its own serving copy of the bytes.
v0 does not offer that. An accepted record is submitted in the knowledge that it
will be anchored and served by sha, and that permanence is the product. To
withdraw the bytes while the sha remains in an anchored bundle would produce a
record a reader can name but cannot check, which is the exact failure that
boundary section 2.5 ("serve the bytes back by sha") exists to prevent.

Because refused records are never stored (4.2), there is nothing to delete on
that side. A later version may offer a bytes withdrawal that leaves an explicit
tombstone ("the sha remains anchored; the operator no longer serves the bytes"),
so the gap is visible rather than silent, but that is not v0.

## 4.4 Rate limiting. Decided: daily caps on the salted-network instrument, stated openly, never a fee.

The intake uses the same instrument the witness intake and the gate already run:
the requesting network prefix (IPv4 /24, IPv6 /48) hashed with a per day random
salt, the first 32 hex kept for 48 hours as a mark. The raw IP is never written;
when the day's salt expires the marks cannot be traced back to anyone. On top of
that, a per network daily cap and a global daily cap bound submissions. All caps
are stated in the open at `GET /agreement`, exactly as `GET /witness` states its
own.

No cap is ever lifted by payment. There is no paid tier and no fast lane. This
keeps rate limiting a spam control and keeps it from taking the shape of a fee,
which boundary section 4.4 requires and section 3.4 enforces on the record side.

The rate counters MAY live on eventually consistent storage (KV): an occasional
off by one on a spam cap harms nobody. This is deliberately separate from the
deduplication in 2.3, which MUST be strongly consistent. Two different jobs, two
different guarantees, kept apart on purpose.

## 4.5 Whether the intake exposes its verifier over a URL. Decided: no oracle; only submit and fetch by sha.

The intake exposes exactly two things and no third.

`POST /agreement` takes a signed record for recording. Its response carries the
verifier's report for that one submission, plus the recompute recipe: the exact
offline steps to reproduce the verdict, and the `verifier_version` that produced
it. The submitter is told the verdict because they need it, and in the same
breath they are told how to stop trusting this answer and check it themselves.

`GET /agreement/{canonical_sha256}` serves the stored bytes of an accepted
record, so anyone can recompute the hash and re run the offline verifier on the
bytes themselves.

There is no `POST /verify` that returns a verdict on bytes the caller did not
submit for recording. The boundary's worry is exact: an endpoint that answers
"accepted" is convenient and is a thing people will start to trust instead of
checking. The whole design rests on "anyone can run the verifier offline," and a
convenience oracle quietly undermines that. The report on submission is
unavoidable, so it always ships with the recipe and the version, keeping the
honest path one named step away. This is the ledger's existing stance, the one
`jidec_how_to_verify` already takes: you fetch the bytes, you recompute the hash,
you do not take the operator's word.

---

## What this document does not establish

That the intake is correct: only that its handler is tested against the real
verifier and an atomic deduplication stub, and that the boundary's MUSTs and MUST
NOTs are each exercised by a test. That the boundary is complete: the last
several boundaries here grew holes when the thing behind them was built, and this
one may too. That an endpoint will be deployed: the handler and its test are the
design-and-verify deliverable; wiring the Durable Object binding into
`wrangler.jsonc`, adding the routes to the live worker, and deploying are a
separate, deliberate hand.
