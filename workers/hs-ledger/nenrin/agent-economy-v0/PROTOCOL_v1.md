# agent-economy-v1 protocol (番人, 2026-09-21)

SPEC.md fixed the layer and the RDA object. SPEC_v1.md hardened the invariants and the numbers
and named the irreducible floor. This closes the design to a buildable closed pilot: the ordered
run of one task, how the RDA's four evidence refs bind to the layers that already exist, the RDA
lifecycle and its revocation, and the four invariants that SPEC_v1 named but did not yet make into
rules. The last section marks, honestly, what stays out until v2.

The pilot runs only over contracted principals. Identity (I1) and arm's-length customer (I3) hold
by agreement, so the two irreducible attacks (reciprocal collusion, off-ledger bribery) are out of
scope by construction, not by a claim to have solved them.

## 1. The run (the spine)

Actors: the customer (external, contracted, arm's-length), the connector(s), the executor, the
operator (Yakumo), the witness (drawn from the accredited ring), the issuer (deterministic), and
the escrow (an external PSP or escrow that is the party of record for money). Every step emits an
evidence artifact that a later step cites; the RDA is the terminal derivation and cites only what
earlier steps produced, each by a party that cannot also collect on it.

- S0 enrol (once, contractual). Each principal is a contracted party with a principal_id equal to
  its beneficial owner. FAIL-CLOSED: a task naming a principal not in the registry does not run.
- S1 pre-commit the recipe (job start, G3). recipe_id and recipe_committed_at are fixed and
  anchored before the customer identity and the outcome are known. Emits: a recipe commitment.
- S2 draw the witness (W1). The witness is drawn from the accredited ring by a task-deterministic
  rule (hash(task_id)), unchoosable by any paid party, exactly as TSUGI already draws unknown
  witnesses by lottery. Emits: a witness assignment. FAIL-CLOSED: a drawn witness equal to any
  from or to principal on the task is redrawn (W3).
- S3 fund the escrow (W2). The fixed verification fee is deposited into the external escrow at job
  start, by the customer or the operator. Emits: an escrow-funded marker. FAIL-CLOSED: no verdict
  is accepted and no RDA issues unless the escrow was funded at start.
- S4 execute. The work runs down the A2A delegation chain (task-delegation-bind-v0). Emits: the
  WitnessObservation chain (task_id, contiguous hops from seq 0).
- S5 verdict (W1, W2). The drawn witness observes and returns PASS or FAIL, and is paid from the
  escrow either way, independent of the verdict and of whether settlement ever happens. Emits: a
  signed witness verdict. FAIL-CLOSED: no verdict, no RDA (E8).
- S6 prove settlement (D3, G5). The external customer pays; the payer's principal or the PSP or
  escrow signs a receipt. Emits: settlement_ref, at a G5 tier. FAIL-CLOSED: a payee self-attested
  payment is inadmissible; without a Tier A settlement_ref, no RDA.
- S7 build and validate the RDA. The deterministic issuer computes the split from the evidence
  (recipe.mjs) and builds the record (rda.mjs), then validates fail-closed: all four evidence refs
  present, splits sum to 10000, nullifiers unspent, recipe committed before settlement, rda_id
  recomputes. Emits: the RDA. FAIL-CLOSED: any validation failure, no RDA.
- S8 anchor. The RDA canonical bytes are anchored into JIDEC like any record, and settlement_ref
  and agreement_ref are marked spent (G2).
- S9 settle. The parties settle on the external rail per the RDA's split. The network holds
  nothing (N1); the RDA is a statement of what is owed, never a transfer.

## 2. Evidence binding (what the four refs actually are)

The RDA carries four content hashes, each into a record that already exists and is anchored. The
RDA adds no authority; it cites.

- delegation_chain_ref -> the task-delegation-bind-v0 chain head evidence_id (task_id plus the
  contiguous hops). The roles are read off the chain: the executor is the to-principal of the
  terminal hop; a connector is the from-principal of a hop the evidence marks as a distinct
  discovery. The prior_count that G4 decays is the number of earlier settled tasks with the same
  connector-to-executor principal pair.
- agreement_ref -> the agreement-v0 canonical record (the settled terms). gross.amount and
  gross.currency are read from the agreement, not asserted by this layer.
- witness_set_ref -> the S5 verdict record, the drawn witness's signed observation for this
  task_id.
- settlement_ref -> the S6 receipt hash, admissible per G5.

## 3. RDA lifecycle and revocation (E9, D4)

States: PROPOSED (built, not anchored) -> ISSUED (validated and anchored) -> SETTLED (a downstream
settlement confirms funds moved) -> and, on later evidence, SUPERSEDED or DISPUTED.

- A revoking attestation is its own anchored record; its key is the prior rda_id, and it carries
  the new evidence (TSUGI recovery evidence, or an agreement dispute).
- Pre-settlement (ISSUED, not SETTLED): the revoke marks the RDA SUPERSEDED and voids the claim.
  No money has moved.
- Post-settlement (SETTLED): the revoke cannot un-move money (N1, E7). It records a DISPUTED marker
  plus the recovery evidence; any correction of funds is between the parties on the rail, not in
  this layer. An RDA is a claim about the evidence at issue time, never a final settlement.

## 4. The four rules SPEC_v1 named but did not specify

- G5 settlement admissibility, by independence signal.
  Tier A, admissible: a receipt signed by the external payer's principal key, or issued by a
  licensed PSP or escrow.
  Tier B, discounted and flagged: a bank reference or an on-chain transfer whose counterparty is
  KYC bound.
  Tier C, inadmissible: a raw self-custodial transfer, or a payee self-attestation.
  In the pilot only Tier A settles an RDA; B and C are recorded and flagged and do not settle.
- G6 aggregate connect governor. Beyond the per-task residual, a per-principal ledger tracks
  connect versus execute income over a rolling ninety days; a principal's total connect may not
  exceed its total execute over that window, and network-wide connect may not exceed a small fixed
  fraction of total gross. At issue time, a connect share that would breach the cap is refused and
  folded into execute. The per-task rule keeps any one task honest; this keeps the system from
  becoming connect-driven in aggregate, which is what the pyramid test actually measures.
- W2 escrow. A fixed verification fee is deposited at S3 into the external escrow and released to
  the drawn witness at S5 on PASS or FAIL alike. The escrow is external, never network-held (N1).
  Because the fee is neither verdict-contingent nor settlement-contingent, the witness has no
  yes-man incentive.
- I3 circularity. A settlement graph (payer principal -> paid principals) is maintained across
  tasks and cycle-detected; any task where value returns to a chain principal is flagged. In the
  pilot arm's-length is contractual (S0), so I3 is a monitor that catches a contract breach rather
  than the primary gate; it becomes the primary gate in v2, when principals are not pre-contracted.

## 5. The v2 boundary (named, deferred)

The closed pilot makes three things hold by contract. Opening the network to uncontracted
principals needs each as enforced code, and until then the pilot does not admit them:

- I1 principal KYC: a verified legal principal per agent, beneficial-owner distinctness enforced in
  code rather than by agreement.
- N1 no-custody architecture: the documented settlement-rail integration that proves the network
  never holds or moves funds, verifiable by an examiner.
- N2 separation of powers: issuer, witness-accreditor, operator and recipe-governance as distinct
  entities, with HORIZON SHIELD (verify and evidence) corporately and economically separate from
  Yakumo (operate).

Until v2 the pilot runs only over contracted principals where these hold by agreement, and the
irreducible floor from SPEC_v1 (reciprocal collusion between genuine distinct principals,
off-ledger bribery of an accredited witness) is out of scope by that construction rather than by a
claim to have closed it. The design is complete to the closed pilot; the open network is the next
version and is bounded here on purpose.
