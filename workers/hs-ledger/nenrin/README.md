# NENRIN : verifiable provenance for A2A agent tasks

NENRIN records, for one A2A task, who delegated what to whom, what was authorized, what was executed, what
outcome it bound to, and what independent witnesses observed, as a provenance graph you can re-verify yourself
with no trust in the operator. It returns evidence and its honest limits, never a trust score and never a
decision. Other trust or ordering engines read it as an evidence source.

## Start here: verify it yourself, in one file
sdk/nenrin_verify.mjs is a single file with zero dependencies. Copy it in, or install nenrin-verify from npm, and
check a NENRIN bundle offline:

    npx nenrin-verify bundle.json
    import { verifyProvenance, consumeEvidence } from "nenrin-verify";

See sdk/SDK.md for the read contract and sdk/nenrin_verify.test.mjs for the faithfulness proof (the single file
reproduces the original modules byte for byte).

## The layers (each stands on its own, each re-verifiable)
- task-delegation-bind-v0/ : third-party OBSERVATION of the delegation chain. R1 witness independence, R2
  recompute, R3 hop continuity, R4 disagreement preserved (never collapsed to the favorable verdict);
  witness_sig and edge_sig. Pinned implementation commit 4d7c9c270c2846465fafdea9833869c5660c4ae2.
- task-execution-bind-v0/ : caller and gateway ACTION and OUTCOME binding. E1 authorized-action match, E2
  outcome reconciliation (equivocation fail-closed), E3 grant binding; caller_sig and provider_sig; strict
  RFC3339 UTC window. outcome_evidence binds the outcome to an independently checkable pointer. preflight
  verifies a pre-execution intent as evidence, not a decision.
- provenance-v0/ : one verifier over observation, execution, evidence and digest linkage, with task identity and
  fail-closed refusals. consume projects it for a trust engine; candidate_evidence is the discovery and ordering
  interop; CONSUME.md is the read contract.
- agreement-v0/ : bilateral signed agreement records, anchored to Bitcoin through the JIDEC ledger.
- recovery-v0/ : TSUGI (継), proof of recovery. Drift witness over eight public surfaces (with baseline comparison),
  five hash-linked record types, closed repair catalog, operator-signed authorization (trust anchor /keys/operator.json),
  random re-verification witnesses drawn from a public pool with a Bitcoin block as seed, quorum in the verifier
  (JavaScript 0.3.0 and Python, byte-identical), reciprocal witness reply (conduct-v1.1 11.6) and pool builder.
  Two real incident chains (2026-09-20). The diagnosing agent is not in this tree by decision; its outputs are
  verified here like anyone else's.

## Honest scope
Signatures prove who asserted and the linkage, not that any assertion is true. There is no side-effect oracle:
no executed action is proven to have happened in the world, and R1 proves structural distinctness, not
unaffiliation. Verification is free and open by design; the trust comes from you checking, not from anyone paying.

## Cross-language and cross-file determinism
Python emitters and the JS verifier agree byte for byte on preimages and ids
(task-execution-bind-v0/exec_cross_lang_test.mjs, task-delegation-bind-v0/cross_lang_test.mjs), and the
single-file SDK reproduces the verifyProvenance report byte for byte against the original modules
(sdk/nenrin_verify.test.mjs).

## Free to verify, free to build on
The verifier, the spec, and every integration path are free and open, and stay that way. Reading a NENRIN bundle, re-verifying it offline, projecting it for a trust engine, and self-registering a server to be measured never require payment or permission from the operator: charging to check the operator's own work would defeat the whole design. HorizonShield sustains the project by operating the ledger, the anchoring, and the measurement services at scale, and none of that is required to use, verify, or build on NENRIN.
