// Signature layer for task-execution-bind-v0. Two Ed25519 detached signatures, two jobs:
//   caller_sig   : the caller signs canonical(grantPreimage). The authorization is ATTRIBUTABLE to the caller.
//   provider_sig : the provider signs canonical(receiptPreimage), which INCLUDES grant_ref, so the receipt is
//                  bound to that specific grant and attributable to the provider (non-repudiable).
// Wire form in production is a detached JWS (EdDSA); DIDs resolve to the public key (did:key is self-contained,
// no network). Here a resolver id -> publicKey stands in for DID resolution, exactly as in sign.mjs.
// Honest line: signatures prove WHO asserted, not that the assertion is TRUE.
import { sign as nodeSign, verify as nodeVerify, generateKeyPairSync } from "node:crypto";
import { canonical } from "../task-delegation-bind-v0/bind.mjs";
import { grantPreimage, receiptPreimage, receiptId } from "./bind_exec.mjs";

export function newAgentKey() { return generateKeyPairSync("ed25519"); } // { publicKey, privateKey } KeyObjects

export function signGrant(g, callerPriv) {
  const sig = nodeSign(null, Buffer.from(canonical(grantPreimage(g)), "utf8"), callerPriv);
  return Object.assign({}, g, { caller_sig: sig.toString("base64") });
}
export function signReceipt(r, providerPriv) {
  const sig = nodeSign(null, Buffer.from(canonical(receiptPreimage(r)), "utf8"), providerPriv);
  return Object.assign({}, r, { provider_sig: sig.toString("base64") });
}
export function verifyGrantSig(g, callerPub) {
  if (typeof g.caller_sig !== "string" || !callerPub) return false;
  try { return nodeVerify(null, Buffer.from(canonical(grantPreimage(g)), "utf8"), callerPub, Buffer.from(g.caller_sig, "base64")); }
  catch (e) { return false; }
}
export function verifyReceiptSig(r, providerPub) {
  if (typeof r.provider_sig !== "string" || !providerPub) return false;
  try { return nodeVerify(null, Buffer.from(canonical(receiptPreimage(r)), "utf8"), providerPub, Buffer.from(r.provider_sig, "base64")); }
  catch (e) { return false; }
}
// signed pair verify: caller authorized (caller_sig) + provider receipted (provider_sig). resolve: id -> publicKey.
export function verifySignedExecution(g, r, resolve) {
  if (!verifyGrantSig(g, resolve(g.caller_id))) return { ok: false, reason: "caller_sig_invalid" };
  if (!verifyReceiptSig(r, resolve(r.provider_id))) return { ok: false, reason: "provider_sig_invalid" };
  return { ok: true };
}
// Attributable reconciliation, scoped to the executor the grant AUTHORIZED. A receipt counts only if it
// references this grant_ref, recomputes, declares provider_id === authorizedProvider, AND carries a valid
// provider_sig from that provider's key. This closes both forge-a-second-receipt griefing paths: a stranger
// signing under its own id is not the authorized executor (provider_id mismatch), and a stranger impersonating
// the executor's id fails the signature check against the real key. Genuine equivocation (the authorized
// executor itself signing two conflicting outcomes for one grant_ref) is surfaced fail-closed, never laundered.
export function reconcileSigned(receipts, grant_ref, authorizedProvider, resolve) {
  if (authorizedProvider == null) return { status: "no_authorized_provider" }; // open grants are not reconcilable; name the executor
  const authentic = receipts.filter((r) =>
    r.grant_ref === grant_ref &&
    r.provider_id === authorizedProvider &&
    r.receipt_id === receiptId(r) &&
    verifyReceiptSig(r, resolve(authorizedProvider)));
  const ids = [...new Set(authentic.map((r) => r.receipt_id))];
  if (ids.length === 0) return { status: "no_authentic_receipt" };
  if (ids.length > 1) return { status: "equivocation", receipt_ids: ids, provider_id: authorizedProvider };
  return { status: "reconciled", receipt_id: ids[0], outcome: authentic[0].outcome };
}
