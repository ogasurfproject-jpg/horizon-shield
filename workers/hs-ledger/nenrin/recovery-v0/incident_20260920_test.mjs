// RUN_ALL: suite
// 実事件 2 (2026-09-20、card の署名切れ) の連鎖 12 記録が、運営者鍵の strict で通り、籤の定足数を問われたら正直に落ちるか。
// 緑の意味: この file の bytes が今も再計算でき、鍵で閉じた許可の連鎖として通る、それだけ。事件が二度と起きんことは言わん (card_signature test がそれを塞ぐ)。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyChain, recordSha256 } from "./recovery_verify.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const f = JSON.parse(readFileSync(path.join(HERE, "incident_20260920_resign_chain.json"), "utf8"));
let pass = 0, fail = 0; const out = [];
const t = (n, ok, d) => { ok ? pass++ : fail++; out.push((ok ? "  ok   " : "  FAIL ") + n + (ok || !d ? "" : "  <- " + d)); };
const codes = (r) => r.refusals.map((x) => x.code);
t("12 records: 8 drift, proposal, authorization, execution, verify", f.records.length === 12 && f.records.filter((r) => r.schema === "nenrin-drift-record-v1").length === 8);
for (const r of f.records) t("record_sha256 recomputes: " + r.schema + " " + r.record_sha256.slice(0, 8), (await recordSha256(r)) === r.record_sha256);
const strict = await verifyChain(f.records, { operatorKeys: [f.operator_public_key_ed25519_b64] });
t("strict (operator key): the chain verifies, complete, 8 drift records open the segment", strict.ok && strict.segment.complete && strict.segment.drifts.length === 8, JSON.stringify(strict.refusals));
t("strict with a wrong operator key -> authorization_untrusted_key", codes(await verifyChain(f.records, { operatorKeys: ["AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="] })).includes("authorization_untrusted_key"));
t("the authorization is signed and names the proposal", !!f.records[9].signature_ed25519_b64 && f.records[9].proposal_sha256 === f.records[8].record_sha256 && f.records[9].decision === "approved");
t("the proposal is resign_agent_card and rejected redeploy_pinned", f.records[8].primitive === "resign_agent_card" && f.records[8].rejected.some((x) => x.primitive === "redeploy_pinned"));
t("execution happened before the authorization expired", f.records[10].recorded_at < f.records[9].expires_at);
const pool = JSON.parse(readFileSync(path.join(HERE, "witness_pool.json"), "utf8"));
t("asked for a witness quorum, the record says honestly it drew nobody -> witness_quorum_short", codes(await verifyChain(f.records, { operatorKeys: [f.operator_public_key_ed25519_b64], witnessQuorum: { q: 1, pool } })).includes("witness_quorum_short"));
t("verify: recovered true, the card verified, gate_commit is the pinned 3244494bfc14", f.records[11].recovered === true && f.records[11].observed["agent-card.signature"].verified === "true" && f.records[11].observed["health.gate_commit"].gate_commit === "3244494bfc14");
console.log(out.join("\n"));
console.log("=== " + pass + " / " + (pass + fail) + " 合格 (incident 2026-09-20: 署名切れ、鍵で閉じた連鎖) ===");
process.exit(fail ? 1 : 0);
