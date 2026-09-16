# task-delegation-bind-v0 : Integration plan (番人 draft, 2026-09-16)

Goal: anchor NENRIN conduct evidence to an A2A Task id, so trust is "who did what on THIS delegated task,
observed by whom", not "this agent failed once". Machine check on 2026-09-16 confirmed task_id / taskId is
referenced ZERO times in HS code, so the anchor is net-new. Good news: no legacy to unwind. The other pieces
(witness, ledger, trust-signal, agreement) already exist, so the wiring is thin.

## Where task_id enters
- A2A v1.0 Task on HS's /a2a face (hs-mcp). A Task carries a literal `id` (tasks/get). The A2A spec says a client
  should verify the returned Task id equals the Task it created. HS must start reading and propagating that id.

## Five wiring points (existing component -> the small addition)
1. A2A face (hs-mcp /a2a, a2a-card-sign):
   Surface the Task `id`. The delegating party (hop.from) attaches an edge assertion: edge_sig over {task_id, hop}
   carried as a SIBLING A2A DataPart, the same carriage the AP2 fair-price attestation uses (the risk_data slot,
   validated 2026-09-16). The edge rides alongside the Task, never inside a party-signed cart/payload.
2. conduct_witness_mcp (workers/hs-ledger/nenrin/a2a-conduct-walk/conduct_witness_mcp.py, a2a_conduct_walk.py):
   When it observes a hop, emit a WitnessObservation { task_id, hop:{seq,from,to}, prev_evidence_id,
   conduct:{verdict,detail_ref}, witness_id, observed_at }, sign witness_sig with the witness key (a did:key,
   reuse or derive from the HS A2A card key), compute evidence_id via bind.mjs. R1 (witness != hop.from/to)
   is enforced at emit time.
3. Ledger (workers/hs-ledger/src/worker.js):
   Append the observation (existing NENRIN append/recompute). ADD a task_id index, e.g. key
   nenrin:task:{task_id}:{hop.seq}:{witness_id}, so hops are fetchable by task and prev_evidence_id can be chained
   (R3). No change to the existing content-addressing.
4. Agreement (hs-core-private/hs-agreement-intake, workers/hs-ledger/nenrin/agreement-v0):
   The bilateral Agreement pins the conduct hash at a hop: the canonical agreement references
   {task_id, hop.seq, evidence_id}. The pin is bound to a specific delegation point, not a whole agent.
5. trust-signal-v1 (workers/hs-ledger/nenrin/trust-signal-v1):
   Add a task_id query: GET /trust-signal?task_id=... returns the FULL witness set per hop, aggregated fail-closed
   via aggregateVerdict (R4). Disagreeing witnesses yield "disagreement", never the favorable verdict. The next
   agent reads this before connecting.

## Acceptance criteria (the v0 tests are the contract)
Live witness output must pass bind.mjs + sign.mjs verification on real records:
  R1 independence, R2 recompute, R3 chain continuity, R4 fail-closed aggregate, witness_sig, edge_sig.
bind_adversarial.test.mjs (12) and sign_adversarial.test.mjs (9) encode these; keep them green as the integration lands.

## Sequencing (deploy is TOshi's hand)
1. Harden the Agreement layer 🟡 -> ✅ (production intake in hs-agreement-intake). Design first, deploy by TOshi.
2. Wire the task_id anchor: conduct_witness_mcp emits signed observations, ledger task_id index, trust-signal query.
3. Compose A -> B -> C once single-hop is solid.

## Honest gaps and risks
- Operational witness independence: R1 is enforced in code, but in deployment the witness must actually be run by a
  party independent of the delegators. That is governance, not just code. A witness co-run by a delegator voids R1.
- To make R4 meaningful a hop needs more than one independent witness; a single witness is a single point of trust.
- A2A Task lifecycle is net-new on HS's /a2a face (task_id = 0 in code today). This is the real build cost, not the binding.
- Resolution choice: did:key (self-contained, no network) first; did:web (mcp.horizonshield.dev) later if needed.
- No external standard exists yet (checked 2026-09-16). Stay minimal and anchored on the real A2A Task id; align to a
  community convention if one emerges rather than hardening a private dialect.
