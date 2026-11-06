#!/usr/bin/env node
// verify_answer.mjs: what a reader repeats on an answer of the refund sandbox door, without the door.
//
//   node verify_answer.mjs <answer.json> <admission-door.json>
//
// <answer.json> is one answer of POST /sandbox/refund/admit, or of /replay (then every result in it). <admission-door.json>
// is the door's key document (GET /sandbox/refund/keys/admission-door.json, or the copy you keep). For each answer it
// checks that the signed records are canonical text, that their bytes hash to the sha256 the answer states, that each
// signature verifies under that key, that admission_ref is the sha256 of the committed record's JCS, and that the
// a2a-admission-v0 record is accepted by the public verifier (admission_verify_v0.mjs) under the sandbox contract.
// It prints one line per answer and exits 0 only when every check holds.
import { readFileSync } from "node:fs";
import { answerProblems, CONTRACT } from "./refund_door_v0.mjs";
import { ed25519Verify } from "../musubi-v0/clause_eval_v0.mjs";
import { verifyAdmissionText } from "../musubi-v0/admission_verify_v0.mjs";
import { parseStrict } from "../agreement-v0/agreement_canonical.mjs";
import { CONTRACT_TEXT } from "./sandbox_contract.mjs";

export function verifyAnswers(answer, keyDoc) {
  const pub = keyDoc.public_key_ed25519_b64;
  const list = Array.isArray(answer.results) ? answer.results : [answer];
  const contract = parseStrict(CONTRACT_TEXT);
  return list.map((a, i) => {
    const p = answerProblems(a, pub, ed25519Verify);
    if (keyDoc.role !== "admission-door") p.push("key: role is not admission-door");
    if (typeof a.a2a_admission === "string") {
      const v = verifyAdmissionText(a.a2a_admission, pub, contract);
      if (v.verdict !== "accepted") p.push("a2a_admission: admission_verify_v0 " + v.refusals.join(","));
    }
    const m = typeof a.mapping === "string" ? JSON.parse(a.mapping) : null;
    return { i, disposition: a.disposition, code: a.code || null, operation_id: m ? m.operation_id : null, admission_ref: a.admission_ref || (m && m.original_admission_ref) || null,
      admission_sha256: a.admission_sha256 || null, mapping_sha256: a.mapping_sha256 || null, schema: m ? m.schema : null, problems: p };
  });
}

if (process.argv[1] && import.meta.url.endsWith("/verify_answer.mjs") && process.argv[1].endsWith("verify_answer.mjs")) {
  const [ap, kp] = process.argv.slice(2);
  if (!ap || !kp) { console.log("usage: node verify_answer.mjs <answer.json> <admission-door.json>"); process.exit(2); }
  const rows = verifyAnswers(JSON.parse(readFileSync(ap, "utf8")), JSON.parse(readFileSync(kp, "utf8")));
  let bad = 0;
  for (const r of rows) {
    if (r.problems.length) bad++;
    console.log((r.problems.length ? "NG " : "OK ") + [r.i, r.disposition, r.code || "-", r.operation_id || "-", r.admission_ref || "-", "a2a " + (r.admission_sha256 || "-"), "mapping " + (r.mapping_sha256 || "-"), r.schema].join(" ")
      + (r.problems.length ? "  " + r.problems.join("; ") : ""));
  }
  console.log(bad === 0 ? "VERIFY_ANSWER_OK " + rows.length + " answers, contract " + CONTRACT.contract_id + ", key " + JSON.parse(readFileSync(kp, "utf8")).key_id : "VERIFY_ANSWER_NG " + bad + " of " + rows.length);
  process.exit(bad === 0 ? 0 : 1);
}
