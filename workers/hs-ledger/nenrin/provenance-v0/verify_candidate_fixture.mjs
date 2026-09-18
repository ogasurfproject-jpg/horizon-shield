// verify_candidate_fixture.mjs : offline verifier for candidate_fixture.json.
// Resolves every did:key from the identifier itself (no network, no key server), re-runs nenrin-candidate-evidence-v0
// from the embedded records, re-applies the reference trust filter, and checks the recorded candidate set and the
// permitted set match. It confirms the boundary: NENRIN evidence carries the conflicts and leaves permitted and
// order null; the reference filter produces permitted; order stays null for ARBITER. Run: node verify_candidate_fixture.mjs
import { readFileSync } from "node:fs";
import { publicKeyFromDidKey } from "../task-delegation-bind-v0/verify_fixture.mjs";
import { candidateEvidenceSet } from "./candidate_evidence.mjs";
import { referenceTrustFilter } from "./reference_trust_filter.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 220))); if (!c) fail++; };
function allKeys(o, acc = new Set()) { if (o && typeof o === "object") { if (Array.isArray(o)) o.forEach((x) => allKeys(x, acc)); else for (const k of Object.keys(o)) { acc.add(k); allKeys(o[k], acc); } } return acc; }

const fx = JSON.parse(readFileSync(new URL("./candidate_fixture.json", import.meta.url)));
const resolve = (id) => publicKeyFromDidKey(id);

const cands = fx.candidates.map((c) => ({ candidate_id: c.candidate_id, records: Object.assign({}, c.records, { resolve }) }));
const set = candidateEvidenceSet(fx.task.task_id, cands);
const byId = Object.fromEntries(set.candidates.map((c) => [c.candidate_id, c]));

chk("every candidate id is a did:key that resolves to an Ed25519 key with no network", fx.candidates.every((c) => { try { return !!resolve(c.records.grant.caller_id) && !!resolve(c.records.grant.provider_id); } catch (e) { return false; } }));
chk("candidate evidence recomputes from the embedded records and matches the recorded set", JSON.stringify(set.candidates) === JSON.stringify(fx.candidate_evidence_set.candidates), "recomputed set differs");
chk("NENRIN evidence leaves permitted null and order null (it decides nothing)", set.run_record.permitted === null && set.run_record.order === null);

const filt = referenceTrustFilter(set);
chk("the reference trust filter recomputes the same permitted set the fixture records", JSON.stringify(filt.permitted) === JSON.stringify(fx.run_record.permitted), JSON.stringify(filt.permitted) + " vs " + JSON.stringify(fx.run_record.permitted));
chk("the fixture carries a finite permitted set and leaves order null for ARBITER", Array.isArray(fx.run_record.permitted) && fx.run_record.order === null);

chk("the witness-disagreement candidate is carried INTO permitted with its disagreement still surfaced", fx.run_record.permitted.some((id) => byId[id] && byId[id].disagreement_hops > 0), "no permitted candidate carries a disagreement");
chk("the provider-equivocation candidate is verified false and fail-closed out of permitted", set.candidates.some((c) => c.equivocations > 0 && c.verified === false) && !fx.run_record.permitted.some((id) => byId[id] && byId[id].equivocations > 0));

const forbidden = ["score", "trust_score", "allow", "deny", "decision", "recommendation"];
const ks = allKeys(fx.candidate_evidence_set);
chk("NENRIN evidence contains no score/allow/deny/decision/recommendation key", forbidden.every((k) => !ks.has(k)), [...ks].filter((k) => forbidden.includes(k)).join(","));
chk("no em/en/bar dashes anywhere in the fixture", !DASH.test(JSON.stringify(fx)));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin-candidate-fixture-v0: real multi-candidate state, did:key offline-verifiable; NENRIN carries the conflicts and decides nothing; the reference filter produces permitted; order left for ARBITER)");
process.exit(fail ? 1 : 0);
