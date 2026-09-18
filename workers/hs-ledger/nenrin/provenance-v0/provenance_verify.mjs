// nenrin-provenance-verify-v0 : one verifier over the whole provenance graph of one A2A task.
//
// It composes three layers that each stand on their own and imports their pinned primitives unchanged:
//   task-delegation-bind-v0 : third-party OBSERVATION of the delegation chain (R1..R4, witness_sig, edge_sig)
//   task-execution-bind-v0  : caller/gateway ACTION + OUTCOME binding (E1..E3, caller_sig, provider_sig)
//   outcome_evidence        : the outcome's commitment to an independently checkable pointer
// and adds the cross-layer checks no single layer can make: task identity across every record, and the
// digest-bound linkage from an observation to the reconciled receipt. It opens no socket and has no clock.
// Key resolution (resolve) and evidence confirmation (lookup) are injected, exactly like the layers below.
//
// Report shape mirrors a2a-agreement-verify-v0: verdict, refusals, findings, establishes, does_not_establish.
// Fail-closed for readers: a refused report establishes nothing; disagreement and equivocation are surfaced,
// never collapsed into the favorable outcome. The wall that no signature can cross (no side-effect oracle) is
// written into does_not_establish on every report, accepted or refused.
import { evidenceId, verifyObservation, chainContinuous, aggregateVerdict } from "../task-delegation-bind-v0/bind.mjs";
import { verifySigned as verifyObservationSigned } from "../task-delegation-bind-v0/sign.mjs";
import { receiptId, verifyExecution, reconcileOutcome } from "../task-execution-bind-v0/bind_exec.mjs";
import { verifySignedExecution, reconcileSigned } from "../task-execution-bind-v0/sign_exec.mjs";
import { verifyEvidence } from "../task-execution-bind-v0/outcome_evidence.mjs";
import { verifyPreflight, verifyIntentSig, intentMatchesReceipt } from "../task-execution-bind-v0/preflight.mjs";

export const VERIFIER_VERSION = "0.1.0";
export const LINK_PREFIX = "nenrin-exec://";

// R3 generalized to a SET with possibly several witnesses per hop: seqs contiguous from 0, every root has a
// null prev, and every non-root prev_evidence_id resolves to SOME presented observation of the prior hop.
// With exactly one witness per hop this is the pinned chainContinuous, and provenance_adversarial asserts that.
export function chainContinuousSet(observations) {
  const bySeq = new Map();
  for (const o of observations) {
    const s = o && o.hop ? o.hop.seq : undefined;
    if (!bySeq.has(s)) bySeq.set(s, []);
    bySeq.get(s).push(o);
  }
  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  for (let i = 0; i < seqs.length; i++) if (seqs[i] !== i) return { ok: false, reason: "seq_gap", at: i };
  for (const s of seqs) {
    for (const o of bySeq.get(s)) {
      if (s === 0) { if (o.prev_evidence_id !== null) return { ok: false, reason: "root_prev_not_null", at: 0 }; }
      else {
        const prior = new Set(bySeq.get(s - 1).map(evidenceId));
        if (!prior.has(o.prev_evidence_id)) return { ok: false, reason: "broken_link", at: s };
      }
    }
  }
  return { ok: true };
}

export function verifyProvenance(input) {
  const task_id = input && input.task_id;
  const observations = Array.isArray(input.observations) ? input.observations : [];
  const grant = input.grant || null;
  const primaryReceipt = input.receipt || null;
  const receipts = Array.isArray(input.receipts) && input.receipts.length ? input.receipts : (primaryReceipt ? [primaryReceipt] : []);
  const resolve = typeof input.resolve === "function" ? input.resolve : () => null;
  const lookup = typeof input.lookup === "function" ? input.lookup : null;
  const requireSigs = input.require_signatures !== false;
  const intent = input.intent || null;

  const refusals = [], findings = [];
  const refuse = (code, why, extra) => refusals.push(Object.assign({ code, why }, extra || {}));
  const note = (code, why, extra) => findings.push(Object.assign({ code, why }, extra || {}));
  const layers = { identity: null, delegation: null, execution: null, preflight: null, evidence: null, linkage: null };

  // ---- 0. task identity across every presented record ----
  if (typeof task_id !== "string" || task_id.length === 0) refuse("task_id_missing", "input.task_id must be a non-empty string");
  const idChecks = [];
  observations.forEach((o, i) => idChecks.push({ record: "observation[" + i + "]", id: o && o.task_id }));
  if (grant) idChecks.push({ record: "grant", id: grant.task_id });
  if (intent) idChecks.push({ record: "intent", id: intent.task_id });
  receipts.forEach((r, i) => idChecks.push({ record: "receipt[" + i + "]", id: r && r.task_id }));
  const mismatched = idChecks.filter((c) => c.id !== task_id).map((c) => c.record);
  layers.identity = { records: idChecks.length, mismatched };
  if (mismatched.length) refuse("task_id_mismatch", "every record must carry the task_id under verification", { records: mismatched });

  // ---- 1. delegation layer (observation) ----
  if (observations.length === 0) {
    layers.delegation = { present: false };
    note("no_delegation_observations", "no third-party observation of the delegation chain was presented; the execution layer is verified on its own");
  } else {
    const per = observations.map((o, i) => {
      const v = verifyObservation(o);
      const s = requireSigs ? verifyObservationSigned(o, resolve) : { ok: true, reason: "signatures_not_required" };
      return { index: i, seq: o.hop && o.hop.seq, witness_id: o.witness_id, ok: v.ok && s.ok, reason: v.ok ? (s.ok ? "ok" : s.reason) : v.reason };
    });
    per.filter((p) => !p.ok).forEach((p) => refuse("delegation_observation_invalid", "an observation failed R1/R2 or its signatures", { index: p.index, seq: p.seq, reason: p.reason }));
    const chain = chainContinuousSet(observations);
    if (!chain.ok) refuse("delegation_chain_broken", "hop continuity (R3) does not hold over the presented set", { reason: chain.reason, at: chain.at });
    const bySeq = new Map();
    for (const o of observations) { const s = o.hop && o.hop.seq; if (!bySeq.has(s)) bySeq.set(s, []); bySeq.get(s).push(o); }
    const hop_verdicts = [...bySeq.keys()].sort((a, b) => a - b).map((s) => ({ seq: s, verdict: aggregateVerdict(bySeq.get(s)), witnesses: bySeq.get(s).map((o) => o.witness_id) }));
    hop_verdicts.filter((h) => h.verdict === "disagreement").forEach((h) => note("witness_disagreement", "witnesses of one hop disagree; the aggregate is disagreement, not the favorable verdict (R4)", { seq: h.seq, witnesses: h.witnesses }));
    layers.delegation = { present: true, observations: per, chain, hop_verdicts };
  }

  // ---- 2. execution layer (grant + receipt) ----
  let reconciledReceipt = null;
  if (!grant && receipts.length === 0) {
    layers.execution = { present: false };
    note("no_execution_records", "no grant/receipt pair was presented; the delegation layer is verified on its own");
  } else if (!grant || receipts.length === 0) {
    layers.execution = { present: true, complete: false };
    refuse("execution_incomplete_pair", "a grant and at least one receipt are both required to verify execution");
  } else {
    const primary = primaryReceipt || receipts[0];
    const ve = verifyExecution(grant, primary);
    ve.findings.forEach((f) => note(f.code, f.why));
    if (!ve.ok) refuse("execution_invalid", "the grant/receipt pair failed recompute, binding, window or E1", { reason: ve.reason });
    let sigs = { ok: true, reason: "signatures_not_required" };
    if (requireSigs) { sigs = verifySignedExecution(grant, primary, resolve); if (!sigs.ok) refuse("execution_signature_invalid", "caller_sig or provider_sig does not verify", { reason: sigs.reason }); }
    const rec = requireSigs ? reconcileSigned(receipts, grant.grant_ref, grant.provider_id, resolve) : reconcileOutcome(receipts, grant.grant_ref);
    if (rec.status === "equivocation") refuse("execution_equivocation", "the authorized provider signed conflicting outcomes for one grant; no single outcome can be established (E2, fail-closed)", { receipt_ids: rec.receipt_ids });
    else if (rec.status !== "reconciled") refuse("execution_unreconciled", "no authentic receipt reconciles this grant", { status: rec.status });
    else reconciledReceipt = receipts.find((r) => r.receipt_id === rec.receipt_id) || primary;
    layers.execution = { present: true, complete: true, pair: ve.reason, signatures: sigs.reason, reconciliation: rec.status, receipt_id: rec.receipt_id || null, outcome: rec.outcome || null };
  }

  // ---- 2b. preflight layer (pre-execution intent), when an intent is presented ----
  if (!intent) {
    layers.preflight = { present: false };
  } else if (!grant) {
    layers.preflight = { present: true, complete: false };
    refuse("preflight_without_grant", "an intent was presented without a grant; a pre-execution declaration can only be checked against the grant it references");
  } else {
    const pf = verifyPreflight(grant, intent);
    pf.findings.forEach((f) => note(f.code, f.why));
    if (!pf.ok) refuse("preflight_invalid", "the pre-execution intent is not authorized by the grant", { reason: pf.reason });
    let isig = { ok: true, reason: "signatures_not_required" };
    if (requireSigs) { const ok = verifyIntentSig(intent, resolve(intent.provider_id)); isig = { ok, reason: ok ? "intent_sig_valid" : "intent_sig_invalid" }; if (!ok) refuse("preflight_signature_invalid", "the intent signature does not verify", { reason: isig.reason }); }
    let declared_matches_executed = null;
    // Under a fixed-action grant, declared == executed is IMPLIED once preflight (declared == grant action) and
    // execution E1 (executed == grant action) both pass, so a divergence here always coincides with a
    // preflight_invalid or execution_invalid refusal already raised. We therefore record it as a framing note,
    // not an independent refusal, so the report never double-counts nor overclaims a distinct catch. The real,
    // non-redundant value of the intent is temporal: a signed pre-execution PROMISE, checkable before the receipt exists.
    if (reconciledReceipt) { declared_matches_executed = intentMatchesReceipt(intent, reconciledReceipt); if (!declared_matches_executed) note("declared_executed_divergence", "the pre-execution declaration and the executed action differ; the individual preflight or execution refusal above is the operative one"); }
    layers.preflight = { present: true, complete: true, status: pf.reason, signature: isig.reason, declared_matches_executed };
  }

  // ---- 3. evidence layer (on the reconciled receipt) ----
  const evReceipt = reconciledReceipt || primaryReceipt || receipts[0] || null;
  if (evReceipt) {
    const vev = verifyEvidence(evReceipt, lookup);
    layers.evidence = { bound: vev.bound, checked_externally: vev.checked_externally, result: vev.reason, external: vev.external || null };
    if (!vev.ok) refuse("evidence_invalid", "the outcome's evidence pointer is malformed or was not confirmed by the injected lookup", { reason: vev.reason });
    else if (vev.bound && !vev.checked_externally) note("evidence_bound_unchecked", "the provider committed to an evidence pointer but no external lookup ran; a reader must check it in the named system");
    else if (!vev.bound) note("no_evidence_bound", "the outcome carries no independently checkable pointer; it rests on the provider's signed claim alone");
  } else {
    layers.evidence = { bound: false, checked_externally: false, result: "no_receipt", external: null };
  }

  // ---- 4. linkage (digest-bound carriage from observation to the reconciled receipt) ----
  if (observations.length && reconciledReceipt) {
    const rid = receiptId(reconciledReceipt);
    let links = 0; const bad = [];
    observations.forEach((o, i) => {
      const ref = o && o.conduct ? o.conduct.detail_ref : null;
      if (typeof ref === "string" && ref.startsWith(LINK_PREFIX)) { links++; const named = ref.slice(LINK_PREFIX.length); if (named !== rid) bad.push({ index: i, seq: o.hop && o.hop.seq, named }); }
    });
    layers.linkage = { links, mismatched: bad.length };
    if (bad.length) refuse("linkage_receipt_mismatch", "an observation names an execution receipt by digest that is not the reconciled receipt", { records: bad });
    if (links === 0) note("no_digest_link", "no observation names the execution receipt by digest; the layers verify independently but are not linked");
  } else {
    layers.linkage = { links: 0, mismatched: 0 };
  }

  // ---- 5. verdict and honest scope ----
  const verdict = refusals.length ? "refused" : "accepted";
  const establishes = [];
  if (verdict === "accepted") {
    establishes.push("every presented record carries task_id " + task_id + " (" + idChecks.length + " records)");
    if (layers.delegation.present) {
      establishes.push("each of " + observations.length + " observations recomputes (R2) with a witness structurally distinct from both hop parties (R1)");
      establishes.push("the hop chain is contiguous from seq 0 and every prev_evidence_id resolves to a presented prior-hop observation (R3)");
      establishes.push("per-hop verdicts are aggregated over the full witness set, fail-closed; any disagreement is surfaced in layers.delegation.hop_verdicts, never collapsed (R4)");
      if (requireSigs) establishes.push("each observation carries a valid witness signature and a valid delegator edge signature against the resolved keys");
    }
    if (layers.execution.present) {
      establishes.push("the provider's signed executed_action equals the caller's signed authorization, byte for byte (E1)");
      establishes.push("the receipt hash-references this grant and comes from the executor the grant authorized (E3)");
      establishes.push("executed_at is a strict RFC3339 UTC instant inside the grant window");
      establishes.push("exactly one authentic outcome reconciles for this grant (E2)");
      if (requireSigs) establishes.push("caller_sig and provider_sig verify against the resolved keys");
    }
    if (layers.preflight && layers.preflight.present && layers.preflight.complete) {
      establishes.push("the provider declared its action before execution and that declaration equals the caller authorization (preflight): the action was authorized before it ran");
      if (layers.preflight.declared_matches_executed === true) establishes.push("declared equals authorized equals executed: the pre-execution intent, the grant and the reconciled receipt carry the same action byte for byte");
    }
    if (layers.evidence.bound) {
      const ev = evReceipt.outcome.evidence;
      if (layers.evidence.checked_externally) establishes.push("the outcome's evidence pointer " + ev.kind + ":" + ev.ref + " in " + ev.system + " was confirmed by the injected lookup");
      else establishes.push("the provider committed, under its signature, to evidence pointer " + ev.kind + ":" + ev.ref + " in " + ev.system + "; a reader can check it there without the provider");
    }
    if (layers.linkage.links > 0) establishes.push(layers.linkage.links + " observation(s) name the reconciled receipt by digest and the digest recomputes");
  } else {
    establishes.push("nothing: see refusals");
  }
  const does_not_establish = [
    "that any executed action occurred in the world: E1 compares the provider's signed claim to the caller's signed authorization and has no side-effect oracle",
    "that the reconciled outcome is the real-world outcome: E2 proves recoverability and surfaces equivocation, it does not prove truth",
    "that any witness is unaffiliated with the parties: R1 proves structural distinctness, not independence",
    "that bound evidence exists in its system or says what the provider claims, unless layers.evidence.checked_externally is true, and even then only what the injected lookup reported",
    "anything about time beyond the record contents: this verifier has no clock and saw no anchor; a Bitcoin anchor, if one exists, bounds the records separately",
    "that this is the only provenance these parties produced for this task_id",
  ];
  return {
    schema: "nenrin-provenance-verify-v0", verifier_version: VERIFIER_VERSION, task_id, verdict, refusals, findings, layers, establishes, does_not_establish,
    recompute: {
      offline: "this verifier opens no socket and has no clock; run it yourself on the same records and do not take this operator's word",
      layers: ["../task-delegation-bind-v0/bind.mjs + sign.mjs (R1..R4, witness_sig, edge_sig)", "../task-execution-bind-v0/bind_exec.mjs + sign_exec.mjs (E1..E3, caller_sig, provider_sig)", "../task-execution-bind-v0/outcome_evidence.mjs (evidence pointer shape and optional lookup)"],
      cross_layer: ["every record must carry the same task_id", "an observation's detail_ref nenrin-exec://<receipt_id> must equal receiptId(reconciled receipt)", "if an intent is present, its proposed_action must equal the grant action (preflight) and the reconciled receipt executed_action (declared equals authorized equals executed)"],
    },
  };
}
