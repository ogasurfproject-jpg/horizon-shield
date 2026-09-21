# agent-economy-v1 (番人, hardened after red-team, 2026-09-21)

This supersedes the v0 decision points (D1 to D5 in SPEC.md) with a decided, attacked design.
It was hardened against two independent adversarial passes, one economic / game-theoretic and
one legal / structural.

What the red-team established, in one paragraph. The cryptography is sound and beside the point.
rda_id = SHA256(canonical bytes) guarantees derivation integrity (the split matches the
evidence); it says nothing about evidence authenticity (that the evidence reflects real,
independent economic activity). A fully valid, fully signed RDA can attest to a wholly fake
economy. Every invariant that tests identifier-distinctness (E4, E5, E6) is defeated by sybils
for free, because one operator hands out distinct IDs like candy. The system's whole honesty
reduces to one external anchor, settlement_ref, and that anchor proves only that money moved
between two wallets, not that the payer is independent of the payee. The hardening below makes
the evidence sybil-resistant, non-replayable, and non-monetizable, and closes every seam that
can be closed from inside the network. One seam cannot be closed from inside; it is stated in
the open at the end, because it bounds what this layer may claim.

## The decided recipe (numbers)

- The RDA split covers three on-ledger roles and sums to 10000 bps of gross:
  - operate = 300 bps (Yakumo, disclosed).
  - connect = a pool of at most 500 bps, first-contact-only and decaying (G4), split among at
    most N = 2 evidenced discovery hops, diluting never multiplying (E4).
  - execute = the RESIDUAL, 10000 minus connect minus operate, so at least 9200 bps.
    Making execute the residual guarantees sum = 10000 (E8 by construction) and makes
    execute-dominance structural rather than a checked ratio.
- verify is NOT in the split. It is a flat fee, funded into escrow at job start, paid to the
  lottery witness on PASS or FAIL alike, independent of the verdict and of whether settlement
  ever happens (W2). This is the single most important number change: a verify fee carved from
  gross-on-success makes every witness a yes-man, because no settlement means no RDA means the
  witness is paid nothing. Job-start escrow decouples the witness from the outcome entirely.

## Invariants kept from v0

E1 no reward without a settled payment from a genuine external customer AND independent
verification. Recruiting an agent, alone, earns zero. E2 per-task, no standing downline. E3
role not position. E7 no custody. E8 fail-closed. E9 revocable on later evidence. E6 the
verifier is paid for verification work, never for the verdict (as revised). E4 and E5 are kept
but re-based onto beneficial owner, not agent_id, by I1 below; on agent_id alone they are
cosmetic. E10 (execute exceeds the sum of connect) is now automatic from the residual and does
no independent work; the aggregate governor G6 is what actually resists connect-dominance.

## Hardening: identity (the load-bearing repair)

- I1 principal-level identity. Every agent is bound to a verified legal principal (KYC at the
  principal, not the agent). Every distinctness test in the whole spec is on the beneficial
  owner, not the agent_id. Roles sharing a principal earn zero on the extra roles and merge into
  execute. Without this, I3, E4, E5 and E6 are unenforceable and sybils win for free.
- I2 no consideration to earn. Becoming an earning agent costs nothing: no buy-in, no stake, no
  bond, no pay-to-list as a condition of earning connect or execute. Money may be charged to the
  customer, or as the verdict-independent verification fee, never to participants for the chance
  to earn from introductions. This is the firewall against endless-chain / chain-referral
  statutes, which can attach per se the moment consideration-to-join meets referral compensation,
  real service or not.
- I3 genuine external customer. The payer is a principal not identical to, controlled by, or a
  common-principal sybil of any paid party; not itself earning connect or operate on the job;
  paying for use of the deliverable. Circularity detection runs on the settlement graph; a
  captive-customer finding voids the RDA under E9. "External" as "not an agent_id on the task" is
  not enough; it must be beneficial-owner arm's-length.

## Hardening: witness integrity

- W1 lottery assignment. The witness is drawn by the existing TSUGI lottery (籤) over an
  accredited set, by a task-deterministic rule, and is unchoosable and uncontrollable by any
  paid party. The house already selects unknown witnesses this way; this invariant just forbids
  a paid party from ever selecting its own.
- W2 outcome-independent pay. The witness is paid from a job-start escrow, on PASS or FAIL
  alike, independent of the verdict and of settlement. No settlement-contingent witness pay.
- W3 independence (E5, re-based on I1): the witness principal differs from the from and to
  principals of every hop it observes.

## Hardening: anti-gaming

- G1 verify unit per distinct external settlement, not per RDA. Sub-jobs under one payment
  collapse to one verification unit, so a real engagement cannot be fragmented into many RDAs to
  farm the flat verify fee.
- G2 nullifiers. settlement_ref, agreement_ref and the witness verdict are single-use; the
  issuer keeps a spent-set. One payment settles at most one task. Closes replay.
- G3 pre-commit. recipe_ref and the split policy are committed and witnessed at job start,
  before customer identity and outcome are known. Post-hoc recipe selection is inadmissible;
  issued_at and inputs_sha256 must prove the pre-settlement commit.
- G4 anti-downline decay. The connect share decays toward zero on repeated
  connector-to-executor pairings; full connect is paid only for the first establishment of a new
  agent relationship. Recurring connect between the same pair is a downline override in all but
  name, and this is the invariant that kills it.
- G5 tiered settlement admissibility. settlement_ref is admissible in proportion to its
  independence signal: a KYC PSP or escrow with a payer-side signature is admissible; a raw
  self-custodial wallet transfer, which carries no independence signal, is inadmissible or
  heavily discounted and flagged.
- G6 aggregate connect governor. On top of the per-task residual, total connect share is capped
  network-wide and per principal, so the system cannot become connect-driven in aggregate even
  while every single task passes locally. The pyramid test looks at what drives the money across
  the system, not at any one org chart.

## Hardening: structural neutrality and no-custody

- N1 absolute no-custody. No operator float, omnibus account, netting, or key control; the RDA
  is a non-transferable data record, never a bearer, redeemable, or tradable instrument.
  Settlement runs only through a licensed PSP or escrow that is the regulated party of record.
  The architecture is documented so an examiner can verify it. Any one of these tipping acts
  turns the operator into an unlicensed money transmitter (federal MSB plus fifty-state MTL) and,
  if the RDA is tokenized, drags in securities scrutiny.
- N2 separation of powers. The issuer (deterministic, cannot alter splits), the
  witness-accreditor, the operator (Yakumo), and the recipe governance are separated; HORIZON
  SHIELD (verification and evidence) is corporately and economically separate from Yakumo
  (operate), and the relationship is published. Disclosure of the operate fee is necessary but,
  without real separation, an independent verifier controlled by the operator is cosmetic.
- N3 non-monetizable track record. A verified-job history is non-transferable and carries no
  in-network financial weight: not collateral, not a multiplier, not sellable. This removes the
  payoff that makes a self-funded wash worth its PSP fees.
- N4 no earnings claims. No income representations to prospective principals without
  Business-Opportunity-Rule-grade substantiation (a real distribution of actual outcomes).

## The irreducible gap (the honest floor)

Two attacks survive every in-band fix, and the spec states them rather than hiding them.

First, reciprocal collusion between genuinely KYC-distinct principals: Mallory's customer pays
Bob's agents, Bob's customer pays Mallory's agents, each job real and padded, counterparties
rotated. Beneficial-owner distinctness (I1) passes because they are distinct; cycle detection
(I3, G6) catches naive rings but not sophisticated ones that pad real jobs and rotate. Second,
off-ledger bribery of an accredited lottery witness: with W1 and W2 the on-ledger fee is clean,
so a ring pays the witness outside the ledger, invisible to it.

Both require out-of-network ground truth, whether an independent beneficiary actually exists and
benefits, which the network by design cannot see. So the guarantee this layer makes is bounded
and exact: a split is arithmetically honest given its evidence, and the evidence is
sybil-resistant, non-replayable and non-monetizable. It does NOT guarantee that a payment
represents real value delivered to an economically independent beneficiary. That is where a
patient, well-capitalized adversary lives, and it is the ceiling on what the network may claim.

## What this means for building v1

The layer is buildable and the "structurally not an MLM, not money transmission" claim is
defensible, but only if I1 (principal KYC), I2 (no consideration to earn), W2 (escrow witness
pay) and N1 (absolute no-custody) are structural and enforced, not policy. Two of them, identity
and escrow, push beyond pure evidence-derivation and are real added scope.

Recommended path: ship v1 as a CLOSED PILOT over known, contracted principals, where I1 and I3
are guaranteed by contract and the wash and collusion seams are out of scope by construction.
That proves the mechanism, the recipe and the attestation end-to-end before the identity and
anti-sybil machinery needed to open it to the public exists. Opening the network is a later
version and does not gate the pilot.
