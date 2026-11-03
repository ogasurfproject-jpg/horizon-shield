// intake_rows.mjs (2026-11-03): the Résumé's agreements[] for the rows of the agreement intake (agreement.horizonshield.dev).
//
// A nenrin-agreement-batch-v1 entry written by the agreement intake names each record as {sha, kind, schema, parties,
// bytes_url[, contract_sha256]} and keeps the bytes at the intake, not in this ledger. The rows of this ledger's own pool
// carry canonical_sha256 instead and are read as before; nothing here touches them.
//
// For each intake row of kind "contract" (a2a-contract-v0, MUSUBI terms both parties signed) or "agreement" whose listed
// parties name the endpoint's host (or its parent domain), the same two hops as the ledger's own agreements:
//   1. the bytes, fetched from the intake by its fixed path, carry the digest the batch names them by:
//        contract   contract_sha256 = sha256("a2a-contract-v0\n" + canonical record without its signatures)
//        agreement  sha256 of the bytes
//      and the parties in those bytes name the host;
//   2. the batch is an anchored ledger entry.
// A row that fails a hop is listed in not_counted with the reason; none is dropped without a word. Execution rows are
// evidence under a contract, not agreements, and are not read here.
import { parseStrict, canonicalUtf8 } from "../agreement-v0/agreement_canonical.mjs";

export const INTAKE_ORIGIN = "https://agreement.horizonshield.dev";
export const CONTRACT_CONTEXT = "a2a-contract-v0\n";
export const INTAKE_KINDS = { contract: "/contract/", agreement: "/agreement/" };
const H64 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 262144;

export async function contractSha256(record, sha256hex) {
  const body = {};
  for (const k of Object.keys(record)) if (k !== "signatures") body[k] = record[k];
  return (await sha256hex(CONTRACT_CONTEXT + canonicalUtf8(body))).toLowerCase();
}

const covers = (host, d) => host === d || host.endsWith("." + d);
function partyDomains(rec) {
  return rec && Array.isArray(rec.parties) ? rec.parties.map((x) => {
    if (!x || typeof x !== "object") return null;
    if (typeof x.domain === "string") return x.domain.toLowerCase();
    try { return new URL(x.key_url).hostname.toLowerCase(); } catch { return null; }
  }).filter(Boolean) : [];
}

// fetchBytes(url) -> { ok: true, text } | { ok: false, detail }. Through the service binding in the worker.
export async function intakeAgreementRows(records, o) {
  const { n, host, anchored, anchorWhy, otsStatus, fetchBytes, sha256hex } = o;
  const lines = [], not_counted = [];
  const rows = (Array.isArray(records) ? records : []).map((r, idx) => [r, idx])
    .filter(([r]) => r && typeof r === "object" && typeof r.sha === "string" && typeof r.canonical_sha256 !== "string" && Object.hasOwn(INTAKE_KINDS, r.kind));
  for (const [r, idx] of rows) {
    const sha = r.sha.toLowerCase(), kind = r.kind;
    const listed = Array.isArray(r.parties) ? r.parties.filter((d) => typeof d === "string").map((d) => d.toLowerCase()) : null;
    if (listed && !listed.some((d) => covers(host, d))) continue; // not this endpoint's record
    const url = INTAKE_ORIGIN + INTAKE_KINDS[kind] + sha;
    const nc = (why, extra) => not_counted.push(Object.assign({ n, record_sha256: sha }, extra || {}, { why, kind, url }));
    if (!H64.test(sha)) { nc("intake_row_sha_is_not_64_hex"); continue; }
    if (r.bytes_url !== url) { nc("intake_row_bytes_url_is_not_the_intake", { detail: typeof r.bytes_url === "string" ? r.bytes_url.slice(0, 200) : null }); continue; }
    let got;
    try { got = await fetchBytes(url); } catch { got = { ok: false, detail: "fetch_failed" }; }
    if (!got || !got.ok || typeof got.text !== "string") { nc("intake_bytes_unavailable", { detail: (got && got.detail) || null }); continue; }
    if (got.text.length > MAX_BYTES) { nc("intake_bytes_unavailable", { detail: "too_large" }); continue; }
    let rec = null;
    try { rec = parseStrict(got.text); } catch { rec = null; }
    if (kind === "contract") {
      let c = null;
      try { c = rec && typeof rec === "object" && rec.schema === "a2a-contract-v0" ? await contractSha256(rec, sha256hex) : null; } catch { c = null; }
      if (c !== sha) { nc("contract_bytes_do_not_match_the_contract_sha256"); continue; }
    } else if ((await sha256hex(got.text)).toLowerCase() !== sha) { nc("agreement_bytes_do_not_hash_to_the_listed_sha"); continue; }
    if (!partyDomains(rec).some((d) => covers(host, d))) { nc("record_parties_do_not_name_this_host"); continue; }
    if (!anchored) { nc(anchorWhy, { ots_status: otsStatus }); continue; }
    lines.push({ record_sha256: sha, source_ledger_n: n, _k: [n, idx] });
  }
  return { lines, not_counted };
}
