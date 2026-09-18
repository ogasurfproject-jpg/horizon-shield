# nenrin-consume-v0 : how a trust engine consumes NENRIN evidence

The competitive picture is clear about the seam: a reputation or policy engine computes trust; NENRIN does not.
NENRIN is a neutral EVIDENCE source. This surface lets any such engine read one task's verified evidence in a
single call, in a compact and stable shape, and re-verify all of it itself.

## The contract (the whole point)
NENRIN returns verified evidence and its honest limits. It computes no trust score and makes no allow or deny
decision. The consuming engine reads the facts and the conflicts and decides for itself. Absence of conflict is
not evidence of good conduct; it may mean no evidence was presented. This split is enforced in code: the
projection contains no score, trust, allow, deny, decision or recommendation field anywhere (consume.test.mjs).

## One call
    import { consumeEvidence } from "./consume.mjs";
    const bundle = consumeEvidence({ task_id, observations, grant, intent, receipt|receipts, resolve, lookup?, require_signatures? });

Input is the records for one A2A task, plus resolve (id to public key; did:key needs no network) and an
optional lookup that confirms the outcome evidence pointer in its own system. Output:

    { schema, consume_version, task_id, facts, conflicts, anchors, does_not_establish, contract, reverify, provenance }

## facts (each is a fact or null, never a score)
- verified: the whole provenance graph verified with no refusals
- authorized_before_execution: a signed pre-execution intent matched the caller authorization (preflight), or null
- executed_matches_authorization: the receipt executed_action equals the grant action, byte for byte (E1), or null
- outcome: { status, reconciled } from the single authentic reconciled receipt (E2), or null
- hops: [{ seq, verdict, disagreement }] per delegation hop, disagreement surfaced first-class (R4)
- evidence_pointer: { bound, checked_externally } for the outcome's independently checkable pointer
- digest_links: how many observations name the reconciled receipt by content hash

## conflicts (surfaced, never collapsed to the favorable value)
- refused, refusal_codes: why the graph was refused, if it was
- disagreements: hops where independent witnesses disagreed
- equivocations: grants where the authorized provider signed conflicting outcomes

## anchors (content addresses to store and reference)
grant_ref, intent_id, reconciled_receipt_id, observation_evidence_ids. All recompute from the records.

## Two rules for a consumer
1. Re-verify it yourself. Do not trust this operator. reverify.how and reverify.provenance give the exact steps;
   every hash and signature recomputes offline, with no clock and no network.
2. NENRIN gives you evidence and its limits. YOU compute trust. A "verified" task that still carries an
   unresolved disagreement is reported as exactly that; it is not smoothed into a pass.

## How different engines use the same bundle
- A trust graph (TrustChain style): feed facts and conflicts into its own trust computation; key on anchors;
  never expect a score from NENRIN, supply your own.
- A risk gateway (PHION style): read conflicts and evidence_pointer for counterparty risk; the allow, review or
  deny call is yours.
- A policy gateway (SINT style): read authorized_before_execution as a pre-execution input alongside your own
  identity, capability and constraint checks.
- A caller's own gateway: read authorized_before_execution before allowing the action to run, and read the
  posture (postureLine) to decide whether to require a human approval.

## Discovery and ordering interop (candidate_evidence.mjs)
For reputation-aware discovery (a2aproject/A2A#1631) and an ordering primitive such as ARBITER,
candidateEvidenceSet(task_id, candidates) returns a per-candidate verified bundle plus a run-record skeleton.
It decides nothing: permitted and order are left null, so the trust filter fills permitted and the orderer
fills order, while NENRIN supplies the verifiable material and an anchorable run record. No trust score is
computed. Runnable demo and checks: node candidate_evidence.test.mjs.

## Honest scope
v0 is a draft, not outsider-validated. The wall that no signature can cross is carried in does_not_establish on
every bundle: no executed action is proven to have occurred in the world, no reconciled outcome is proven to be
the real-world outcome, no witness is proven unaffiliated, and bound evidence is only confirmed when a lookup ran.

## Run
    node consume.test.mjs
