// RUN_ALL: suite
// recovery-v0 の採点。fixture が通る、通ったら次に、壊した物が必ず落ちる (mutation)。
// 緑の意味: この file が書いた変異が全部拒否された、それだけ。書いてへん変異は見とらん。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyRecord, verifyChain, seal, sign, recordSha256, canonicalText } from "./recovery_verify.mjs";
import { validate, SCHEMAS } from "./recovery_schema.mjs";
import { buildFixture, render, FIXTURE_FILE } from "./recovery_fixture_build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const results = [];
function t(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  <- " + detail)); }
const clone = (x) => JSON.parse(JSON.stringify(x));
const codes = (r) => r.refusals.map((x) => x.code);
const has = (r, code) => codes(r).includes(code);

// ---- 1. fixture ----
const fileText = readFileSync(path.join(HERE, FIXTURE_FILE), "utf8");
const fx = JSON.parse(fileText);
const chain = await verifyChain(fx);
t("fixture: 7 records verify as one complete segment", chain.ok && chain.segment && chain.segment.complete && fx.length === 7, JSON.stringify(chain.refusals));
t("fixture: three drift records open the segment", chain.ok && chain.segment.drifts.length === 3);
for (let i = 0; i < fx.length; i++) {
  const h = await recordSha256(fx[i]);
  t("fixture: record[" + i + "] " + fx[i].schema + " record_sha256 recomputes", h === fx[i].record_sha256, h + " vs " + fx[i].record_sha256);
}
const rebuilt = render(await buildFixture());
t("fixture: rebuilding from code gives the same bytes as the file (drift guard)", rebuilt === fileText, "run: node recovery_fixture_build.mjs");

// ---- 2. canonical / hash ----
{
  const a = await seal({ ...fx[0] }); const b = await seal({ ...fx[0] });
  t("seal is deterministic", a.record_sha256 === b.record_sha256);
  const swapped = {}; for (const k of Object.keys(fx[0]).reverse()) swapped[k] = fx[0][k];
  t("key order does not change the hash", (await recordSha256(swapped)) === fx[0].record_sha256);
  t("canonical: keys sorted at every level, compact separators", canonicalText({ b: "x", a: { d: "y", c: "z" }, list: ["q", { z: "1", y: "2" }] }) === '{"a":{"c":"z","d":"y"},"b":"x","list":["q",{"y":"2","z":"1"}]}');
}

// ---- 3. single-record mutations ----
{
  const m = clone(fx[3]); m.diagnosis = m.diagnosis + " ";
  t("mutation: one byte in diagnosis -> hash_mismatch", has(await verifyRecord(m), "hash_mismatch"));
  const m2 = clone(fx[3]); delete m2.establishes;
  t("mutation: establishes removed -> disclaimer_missing", has(await verifyRecord(m2), "disclaimer_missing"));
  const m3 = clone(fx[3]); m3.does_not_establish = [];
  t("mutation: does_not_establish emptied -> disclaimer_missing", has(await verifyRecord(m3), "disclaimer_missing"));
  const m4 = clone(fx[3]); m4.primitive = "rm_rf_root";
  t("mutation: primitive outside the catalog -> primitive_not_in_catalog", has(await verifyRecord(m4), "primitive_not_in_catalog"));
  const m5 = clone(fx[0]); m5.observed.count = 3;
  t("mutation: a JSON number inside a record -> number_in_record (v0 rule)", has(await verifyRecord(m5), "number_in_record"));
  const m6 = clone(fx[0]); m6.prev = fx[1].record_sha256;
  t("mutation: drift with non-null prev -> bad_prev", has(await verifyRecord(m6), "bad_prev"));
  const m7 = clone(fx[4]); m7.prev = fx[2].record_sha256;
  t("mutation: authorization.prev != proposal_sha256 -> prev_mismatch", has(await verifyRecord(m7), "prev_mismatch"));
  const m8 = clone(fx[6]); m8.recorded_at = "2026-09-20 08:02";
  t("mutation: recorded_at not ISO Z -> bad_recorded_at", has(await verifyRecord(m8), "bad_recorded_at"));
  t("validate on a non-object -> not_object", validate("x").some((r) => r.code === "not_object"));
}

// ---- 4. chain mutations ----
{
  const c1 = clone(fx); c1[5] = await seal({ ...c1[5], prev: fx[3].record_sha256, authorization_sha256: fx[3].record_sha256 });
  const r1 = await verifyChain(c1);
  t("chain: execution re-pointed at the proposal -> chain_broken or ref_mismatch", ["chain_broken", "ref_mismatch"].some((k) => has(r1, k)));
  const c2 = clone(fx); [c2[4], c2[5]] = [c2[5], c2[4]];
  t("chain: execution before authorization -> bad_order", has(await verifyChain(c2), "bad_order"));
  const c3 = clone(fx); c3[4] = await seal({ ...c3[4], decision: "refused" });
  c3[5] = await seal({ ...c3[5], prev: c3[4].record_sha256, authorization_sha256: c3[4].record_sha256 });
  c3[6] = await seal({ ...c3[6], prev: c3[5].record_sha256, execution_sha256: c3[5].record_sha256 });
  t("chain: execution after a refused authorization -> unauthorized_execution", has(await verifyChain(c3), "unauthorized_execution"));
  const c4 = clone(fx); c4[3] = await seal({ ...c4[3], drift_sha256: [...c4[3].drift_sha256, "0".repeat(64)] });
  c4[4] = await seal({ ...c4[4], prev: c4[3].record_sha256, proposal_sha256: c4[3].record_sha256 });
  c4[5] = await seal({ ...c4[5], prev: c4[4].record_sha256, authorization_sha256: c4[4].record_sha256 });
  c4[6] = await seal({ ...c4[6], prev: c4[5].record_sha256, execution_sha256: c4[5].record_sha256 });
  t("chain: proposal citing a drift outside the segment -> unknown_drift", has(await verifyChain(c4), "unknown_drift"));
  const c5 = clone(fx); c5[5] = await seal({ ...c5[5], primitive: "rotate_credential" });
  c5[6] = await seal({ ...c5[6], prev: c5[5].record_sha256, execution_sha256: c5[5].record_sha256 });
  t("chain: execution primitive != proposal primitive -> primitive_mismatch", has(await verifyChain(c5), "primitive_mismatch"));
  const c6 = clone(fx); const ea = clone(c6[6].expected_after); ea["health.gate_commit"].gate_commit = "deadbeef0000";
  c6[6] = await seal({ ...c6[6], expected_after: ea });
  t("chain: verify.expected_after moved after authorization -> expected_after_drift", has(await verifyChain(c6), "expected_after_drift"));
  const c7 = clone(fx); const ob = clone(c7[6].observed); delete ob["well-known.openai-apps-challenge"];
  c7[6] = await seal({ ...c7[6], observed: ob });
  t("chain: recovered:true with a surface unobserved -> recovered_unobserved", has(await verifyChain(c7), "recovered_unobserved"));
  t("chain: no records -> empty_chain", has(await verifyChain([]), "empty_chain"));
  t("chain: starting with a proposal -> no_drift", has(await verifyChain(fx.slice(3)), "no_drift"));
  const partial = await verifyChain(fx.slice(0, 4));
  t("chain: drift + proposal only is a valid incomplete segment", partial.ok && partial.segment.complete === false, JSON.stringify(partial.refusals));
}

// ---- 5. Ed25519 ----
{
  const kp = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", kp.publicKey));
  const signed = await sign(fx[0], kp.privateKey, pubRaw);
  t("signed record verifies", (await verifyRecord(signed)).ok);
  const tam = clone(signed); tam.surface = "health.gate_commit ";
  const rt = await verifyRecord(tam);
  t("tampered signed record is refused (hash_mismatch first)", !rt.ok && (has(rt, "hash_mismatch") || has(rt, "bad_signature")));
  const resealed = await seal(tam); resealed.signature_ed25519_b64 = signed.signature_ed25519_b64; resealed.public_key_ed25519_b64 = signed.public_key_ed25519_b64;
  t("re-sealed record with the old signature -> bad_signature", has(await verifyRecord(resealed), "bad_signature"));
  const other = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const otherPub = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", other.publicKey));
  const wrongKey = { ...signed, public_key_ed25519_b64: Buffer.from(otherPub).toString("base64") };
  t("signature checked against another key -> bad_signature", has(await verifyRecord(wrongKey), "bad_signature"));
}

console.log(results.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (recovery-v0: " + FIXTURE_FILE + " と変異 " + (pass + fail - 12) + " 件) ===");
if (fail) { console.log("この赤は、書いた変異のどれかが通ってしもた、という意味や。通った変異は穴や。"); process.exit(1); }
