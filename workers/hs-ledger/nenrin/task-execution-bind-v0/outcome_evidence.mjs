// outcome_evidence.mjs : outcome-evidence binding for task-execution-bind-v0.
//
// Moves an execution outcome from "the provider claims X" to "the provider commits, under its signature, to a
// pointer E in an independently verifiable system S, which anyone can check without the provider's help".
// The binding is cryptographic: evidence sits inside receipt.outcome, so receipt_id and provider_sig cover it
// (a mutated pointer breaks both). The ground-truth check of E in S is delegated to S itself. This module opens
// no socket and has no clock. An operator MAY inject lookup(evidence) -> { found, matches } to confirm E in S;
// the result says whether such a lookup ran, so a reader never mistakes "bound" for "confirmed".
//
// Honest line: binding proves WHAT the provider pointed at, not that the pointer resolves or that it says what
// the provider claims. Only the reader, or an injected lookup, can establish that, and the report states which.
const HEX64 = /^[0-9a-f]{64}$/;

// kinds v0 understands. ref format is checked; the system string names where a reader goes to check.
export const EVIDENCE_KINDS = {
  bitcoin_tx: { ref: HEX64, means: "a Bitcoin transaction id; a reader checks it on any node or explorer" },
  ledger_record: { ref: HEX64, means: "a content-addressed ledger record sha256; a reader fetches the bytes and recomputes" },
  document_sha256: { ref: HEX64, means: "sha256 of a document the reader can obtain and hash" },
  url_sha256: { ref: HEX64, means: "sha256 of the bytes served at a url the reader can fetch and hash" },
};

export function evidenceOf(receipt) {
  return receipt && receipt.outcome && receipt.outcome.evidence ? receipt.outcome.evidence : null;
}

// shape check only: known kind, ref matches the kind's format, non-empty system.
export function evidenceWellFormed(ev) {
  if (!ev || typeof ev !== "object") return { ok: false, reason: "evidence_not_object" };
  const k = EVIDENCE_KINDS[ev.kind];
  if (!k) return { ok: false, reason: "evidence_kind_unknown" };
  if (typeof ev.ref !== "string" || !k.ref.test(ev.ref)) return { ok: false, reason: "evidence_ref_malformed" };
  if (typeof ev.system !== "string" || ev.system.length === 0) return { ok: false, reason: "evidence_system_missing" };
  return { ok: true };
}

// verify the evidence bound to a receipt. lookup is optional and injected; when present it is called ONCE with
// the evidence object and must return { found: boolean, matches: boolean }. Any throw is treated as not confirmed.
// Returns { ok, reason, bound, checked_externally, external? }.
export function verifyEvidence(receipt, lookup) {
  const ev = evidenceOf(receipt);
  if (!ev) return { ok: true, reason: "no_evidence_bound", bound: false, checked_externally: false };
  const w = evidenceWellFormed(ev);
  if (!w.ok) return { ok: false, reason: w.reason, bound: true, checked_externally: false };
  if (typeof lookup !== "function") return { ok: true, reason: "evidence_bound_unchecked", bound: true, checked_externally: false };
  let ext;
  try { ext = lookup(ev); } catch (e) { ext = { found: false, matches: false, error: String(e && e.message || e) }; }
  const found = !!(ext && ext.found), matches = !!(ext && ext.matches);
  if (!found) return { ok: false, reason: "evidence_not_found", bound: true, checked_externally: true, external: { found, matches } };
  if (!matches) return { ok: false, reason: "evidence_does_not_match", bound: true, checked_externally: true, external: { found, matches } };
  return { ok: true, reason: "evidence_confirmed", bound: true, checked_externally: true, external: { found, matches } };
}
