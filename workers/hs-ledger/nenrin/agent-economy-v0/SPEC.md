# agent-economy-v0 (番人 draft, 2026-09-21)

The third layer. NENRIN records evidence, TSUGI proves recovery, and this layer routes
revenue: when a real external job completes and is verified, it derives who is owed what
from the same evidence chain, and signs that derivation. It moves no money and mints no
hierarchy. "AI版MLM" was the seed; this is deliberately not one, and the invariants below
are what make it not one.

## Layer boundary (what this layer may and may not touch)
- Reads: the NENRIN task evidence (task-delegation-bind-v0 WitnessObservation chain), the
  agreement record (agreement-v0, the settled terms), and the witness set (verification).
- Writes: exactly one object, the Revenue Distribution Attestation (RDA), carried as a
  sibling record. It never writes back into the evidence chain it reads. Derivation, not authority.
- Never: holds funds, transmits funds, executes a payout, or creates a standing relationship
  between agents. Settlement happens on external rails; this layer only says what is owed and why.

## Anchor
- The unit is one completed external job, identified by its A2A Task id (same anchor as
  task-delegation-bind-v0; HS holds no authority over it, it is asserted by the A2A layer).
- "Completed and paid" is asserted by evidence outside this layer (the agreement's settlement
  fact plus the witness verdict), never by this layer and never by a party who is owed a share.

## Record (RevenueDistributionAttestation)
    { task_id,
      evidence: { delegation_chain_ref, agreement_ref, witness_set_ref, settlement_ref },
      gross:    { amount, currency, external_customer_ref, settled: true },
      splits:   [ { agent_id, role, basis_ref, share_bps } ],   // role: execute | connect | verify | operate
      derivation: { recipe_ref, inputs_sha256 },
      issuer, issued_at, rda_id }
- rda_id = SHA-256(canonical(record without rda_id)). Anyone recomputes; no trust in the issuer.
- sum(share_bps) = 10000. The split is a pure function of the referenced evidence; the recipe
  (recipe_ref) is public, so anyone recomputes the same split from the same inputs.
- Same carriage as the AP2 fair-price attestation and the delegation evidence: content hash,
  public recompute, sibling record. Nothing new is introduced into the trust model.

## Invariants (the moat: what makes this not an MLM)
- E1 no work, no money. A split entry exists only when gross.settled is true against a real
  external customer AND the witness set verifies the execution. Bringing an agent in, by
  itself, earns zero. (FTC: the harm is reward tilted toward recruitment over real sales;
  here recruitment pays nothing by construction.)
- E2 per-task, no downline. One RDA distributes ONE task's gross among the agents evidenced on
  THAT task. No agent earns from another agent's future tasks. There is no persistent hierarchy
  to pay upstream; each task's graph is rebuilt from its own evidence and is then finished.
- E3 role, not position. Every share is justified by an evidenced role performed on this task
  (execute / connect / verify / operate), carried in basis_ref. "Upstream of X" is not a role
  and earns nothing. A connect share requires the delegation-chain hop that actually made the
  connection; being early in the chain is not enough.
- E4 bounded connection depth. Connect shares are limited to the hops the evidence shows added
  a distinct discovery or connection to THIS job, capped at a fixed value (D2). A chain padded
  with pass-through hops does not multiply referral fees; a hop that added nothing gets nothing.
- E5 independence of the verify fee. The verify share goes to a witness independent of the paid
  parties (reuses task-delegation R1: witness_id differs from hop.from and hop.to). A party
  cannot pay itself a verification fee.
- E6 the verifier is paid for verification, never for the verdict. HORIZON SHIELD may charge a
  fee for verification work it actually performs (the estimate diagnosis is exactly this, a paid
  service), but the fee is fixed for the work and independent of the verdict: it is the same
  whether the verified thing passes or fails, it is never paid by the party under evaluation to
  buy the outcome, and it is never a percentage of gross that grows when a particular party is
  steered work. HS takes no connect or referral share and no outcome-contingent cut. The operate
  role (running the network) is a distinct, disclosed fee and belongs to a distinct entity, 八工門
  (Yakumo Co.), walled off from Yakumo's contractor-directory "no referral fee" stance (separate
  product, separate disclosed policy). Neutrality is not "HS earns nothing"; it is "HS pay never
  depends on the verdict or on steering business to anyone."
- E7 no custody. The RDA states amounts and bases; it never holds or moves them. No wallet, no
  escrow held by this layer, no payout trigger. Settlement is external and out of scope in v0.
- E8 fail-closed. Missing settlement, a missing witness verdict, a broken delegation chain, or
  splits that do not sum to 10000 yield NO attestation, never a favorable guess.
- E9 revocable on later evidence. If the job is later shown fraudulent (TSUGI recovery evidence,
  or an agreement dispute), the RDA is superseded by a revoking attestation that references it.
  An RDA is a claim about the evidence at issue time, not a final settlement.

## Out of scope for v0 (honest line)
- Actual settlement or payout. This layer emits an attestation; who pays whom, on what rail
  (party-to-party, PSP, escrow), is not decided here.
- Proof that the external customer paid. v0 consumes settlement_ref as an input; how that fact
  is itself attested (a payment-receipt attestation) is a v1 decision (D3).
- Tax, licensing, and money-transmission posture per jurisdiction. E7 keeps this layer out of
  custody so it stays an evidence service and not a transmitter, but the operating entity's
  posture is a business and legal decision, not a code one.
- Any token, points balance, or standing account.

## How it reuses what already exists
- Delegation chain: task-delegation-bind-v0 WitnessObservation (task_id + hop + prev_evidence_id).
  The RDA's connect and execute roles read straight off it.
- Agreement: the agreement-v0 canonical record supplies the settled terms and the gross figure.
- Witness / verification: the same witness set that verifies conduct supplies the verify role and
  its E5 independence.
- Conduct compensation: the A2A Conduct Extension already declares who compensates whom; the RDA
  is the settled, per-task realization of that declared intent, not a new promise.
- Anchoring: RDA canonical bytes anchor into JIDEC exactly like any other record.

## Decision points for v1 (決めどころ)
- D1 the split recipe. Fixed bps per role, or negotiated in the agreement and merely verified
  here? v0 leaves recipe_ref abstract; v1 fixes at least one concrete recipe and tests it. The
  recipe must keep the verify fee flat for the work rather than a share of gross, so E6 holds:
  a verify cut that scales with gross drifts back toward outcome-linked pay.
- D2 the connection-depth cap (the E4 value) and how a "distinct connection" is evidenced.
- D3 settlement_ref: what counts as proof the customer paid, and who attests it.
- D4 revocation and clawback mechanics (E9): supersede-only, or a signed reversal, and its window.
- D5 operator-fee disclosure: where and how 八工門's operate share is published so E6 holds.

## What an RDA does not establish
- That anyone was actually paid. It states what is owed on the evidence; it is not a receipt.
- That the split is fair in the moral sense. It is faithful to the recipe and the evidence, no
  more. A wrong recipe yields a wrong-but-faithful split; the recipe is the thing to argue about.
- That the external job was legitimate beyond what the witness verified. Verification has a
  scope; E9 exists because issue-time evidence can be overturned.
