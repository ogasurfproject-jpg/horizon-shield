# Task-delegation binding (task-delegation-bind-v0)

Binds an A2A Task to the conduct evidence of the delegated work, so an agent choosing among many servers can read what a delegated task actually did, observed by someone other than the two parties, and pin that exact evidence into an agreement. Aligned to the A2A Task id (`a2a.task.id`) and A2A issues #1769, #2103 (W3C traceparent and the `a2a.task.id` semantic attribute) and #2121 (cross agent budget propagation).

Everything here is public and recomputable. You fetch the bytes, you recompute the hash, you verify the signatures. No trust in the operator.

## The observation

A `WitnessObservation` records one hop of a delegated task, as seen by a witness:

```
{
  "task_id": "<the A2A Task id>",
  "hop": { "seq": 0, "from": "<did:key of the delegating party>", "to": "<the delegated-to agent>" },
  "prev_evidence_id": "<evidence_id of hop seq-1, or null at seq 0>",
  "conduct": { "verdict": "PASS" | "FAIL" | "...", "detail_ref": null },
  "witness_id": "<did:key of the witness>",
  "observed_at": "<iso8601>",
  "evidence_id": "<sha256 over canonical(observation minus derived fields)>",
  "witness_sig": "<Ed25519 by the witness over canonical(preimage)>",
  "edge_sig": "<Ed25519 by hop.from over canonical({task_id, hop})>"
}
```

`evidence_id` is content addressing: sha256 of the canonical form of the observation with the derived fields (`evidence_id`, `witness_sig`, `edge_sig`) removed. The canonical form is a simplified JCS (recursive key sort, no whitespace) and is byte identical across the JavaScript ledger face and the Python producer, proved by a cross language conformance test in this directory.

## Invariants

- R1 independence: the witness is not either party of the hop (`witness_id != hop.from` and `!= hop.to`), by key. This is a fact about keys, not a claim of operator independence: a self witness, where one operator holds both a hop key and the witness key, still satisfies R1 and says so in the trust signal.
- R2 recompute: the stored `evidence_id` must equal the recomputed hash, or the observation is refused.
- R3 chain: within a task, hop `seq` runs 0,1,2,... and each `prev_evidence_id` equals the `evidence_id` of the previous hop, or the chain is reported broken.
- R4 non suppression: when witnesses of one hop disagree, the aggregate verdict is `disagreement`, never the favorable one. Disagreement is preserved, never resolved.

## Signatures

Both signatures are Ed25519 and both keys live inside the `did:key` identifiers (base58btc, multicodec `ed25519-pub`), so verification needs no network and no registry.

- `witness_sig`: the witness signs `canonical(preimage(observation))`. The verdict is attributable and non repudiable.
- `edge_sig`: `hop.from` signs `canonical({task_id, hop})`. The delegation edge is party attested.

A present but invalid signature is refused (422). An absent signature is accepted (unsigned, content only). Signatures prove who asserted the observation and who attested the edge, not that the assertion is true.

## Anchoring

Each accepted observation is enqueued and bundled daily into a `nenrin-task-witness-batch-v1` ledger entry whose hash fixes the existence time of every observation listed, timestamped to Bitcoin via OpenTimestamps, like every other NENRIN ring. The observation bytes stay served by the ledger.

## Endpoints

- `POST /witness/task` : submit an observation. R1 and R2 are enforced; present signatures are verified.
- `GET  /witness/task?task_id=<id>` (optional `&hop=<seq>`) : the full witness set per hop, the R4 aggregate verdict, the R3 chain check, per hop attribution counts, and the anchoring policy.
- `GET  /trust-signal?task_id=<id>` : the same as a consumable signal. Counts and verdicts only, never a numeric score. Adverse hops are named. `witness_distinct_from_parties` states R1 by key; the `independence` note states plainly that operator independence is not attested.
- `GET  /witness/task/evidence/<evidence_id>` : one observation with its anchor status (found, attribution, `ledger_entry`, Bitcoin), for a consumer that pins a specific evidence_id.

## Pinning evidence into an agreement

An `a2a-agreement` record may carry an optional top level field:

```
"task_delegation": { "task_id": "<id>", "bindings": [ { "hop": 0, "evidence_id": "<64 hex>" } ] }
```

Because the agreement verifier folds every non signature key into the bytes both parties sign, this field is party attested with no change to the verifier. The agreement intake confirms each pinned `evidence_id` against `GET /witness/task/evidence/<id>`: that it exists (a pin naming no observation is a claim, not evidence), that its `task_id` and `hop` match the pin (a real observation about another task cannot back this one), its attribution, and whether it sits in a Bitcoin anchored batch. This is recorded as a finding beside the verifier report; it never changes the verdict and never emits a score.

## The loop

Discover a server, read conduct the server did not write, choose, delegate a task, the task is witnessed, the evidence accumulates bound to the task id, and the next agent chooses on it. This directory is the ledger face and producer; the walk that binds is in `../a2a-conduct-walk` (run it with `--bind-task`).
