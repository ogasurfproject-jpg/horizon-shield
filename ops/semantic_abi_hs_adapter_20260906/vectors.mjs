import { PAIR } from "../../runner/src/evaluate.mjs";

// REAL vectors for HORIZON SHIELD's content_addressed_decision_commitment relation, the analogue of
// relation 1 (reject/evidence_against != reject/insufficient_evidence) for a verdict that is
// content-addressed and Bitcoin-anchored rather than signed. Pinned against the public git history
// of github.com/ogasurfproject-jpg/horizon-shield, workers/hs-verify-gate/src/worker.js:
//   8a370fca (before) -> 3077a482 patch52 (fix) -> 522d4208 patch53 -> f8a3f719 (main, 2026-09-06).
// See vendor/hs_gate_record_commitment.py for the provenance header and the exact lines replayed.
//
// The oracle is the fixed, version-independent truth about each pair. "A" is a genuine 522 from the
// target's edge (evidence against reachability); "B" is the gate's own probe path failing to reach
// itself (insufficient evidence about anything). The claims differ, so the pair is VIOLATED whatever
// code processes it. What the backend grades is whether HORIZON SHIELD's commitment OBSERVES that.
//
// Every vector names its scope. "record" compares record_sha256 over the full record bytes. "status_label"
// compares the one-word status field alone, which is what the register page, the state enum and the
// NENRIN ring's instants_by_status count actually consume. The two scopes are reported separately on
// purpose: a distinction that survives in the bytes and dies in the label is a finding, not a pass.
export const VECTORS = [
  { id: "hs-pre-patch52-self-held", relation: "content_addressed_decision_commitment", oracle: PAIR.VIOLATED,
    mode: "pre_patch52", scope: "record",
    fixture: "REAL historical replay (8a370fca): the gate probing itself in the daily cron had no relay path, the edge answered 522, and 522 is gatewayish, so the instrument's own failure was classified transport:true. Same bytes and same record_sha256 as a genuine outage of the target. The gate published this about itself every day at 03:00 JST until patch52" },
  { id: "hs-post-patch52-adversarial", relation: "content_addressed_decision_commitment", oracle: PAIR.VIOLATED,
    mode: "post_patch52", scope: "record",
    fixture: "REAL replay of the fix (3077a482): a self-probe with no relay path now throws and is classified gate_side:true, measured:false; the record reads reachable:null with a measurement_note, and its record_sha256 differs from the genuine-outage record" },
  { id: "hs-post-patch52-clean", relation: "content_addressed_decision_commitment", oracle: PAIR.PRESERVED,
    mode: "post_patch52_clean", scope: "record",
    fixture: "control: the same genuine 522 observed twice; identical records, identical hashes. A backend that reports these apart is inventing distinctions" },
  { id: "hs-post-patch52-status-label", relation: "content_addressed_decision_commitment", oracle: PAIR.VIOLATED,
    mode: "post_patch52", scope: "status_label",
    fixture: "CURRENT finding, not historical: after the fix both records still carry status:held. The distinction lives in reachable (false vs null), not in the status word. Anything that reads only the label, including the ring's instants_by_status, cannot tell an unreachable target from a failed instrument" },
  { id: "hs-determinism-record-scope", relation: "content_addressed_decision_commitment", oracle: PAIR.VIOLATED,
    mode: "determinism", scope: "record",
    fixture: "determinism not measured (no owner consent to call a tool) vs determinism measured and failed. At record scope the bytes and hashes differ: measured:false is inside the commitment" },
  { id: "hs-determinism-status-label", relation: "content_addressed_decision_commitment", oracle: PAIR.VIOLATED,
    mode: "determinism", scope: "status_label",
    fixture: "CURRENT finding: both records read status:pending. The ring counts them under one key and keeps the unmeasured count only as prose in its limits sentence (\"unmeasured is not failed\"). This is the p001 row of the paper's Table 1: pending 26, every one for want of consent. Ring v2 needs a counted field for it" },
];
