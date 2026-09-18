// verify_run_record.mjs : offline check that the closed run record is consistent with the frozen fixture.
// Confirms: it pins the fixture by its actual sha256; permitted equals the fixture's reference-filter permitted;
// order is a permutation of permitted (the orderer ordered only what was permitted); the equivocation candidate
// is in neither; the order carries ARBITER attestation; and NENRIN records without ordering or scoring. Run: node verify_run_record.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 220))); if (!c) fail++; };
const fxUrl = new URL("./candidate_fixture.json", import.meta.url);
const fx = JSON.parse(readFileSync(fxUrl));
const rr = JSON.parse(readFileSync(new URL("./candidate_run_record.json", import.meta.url)));
const fxSha = createHash("sha256").update(readFileSync(fxUrl)).digest("hex");
const permitted = fx.reference_trust_filter.permitted;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

chk("run record pins the frozen fixture by its actual sha256", rr.frozen_input.fixture_sha256 === fxSha, "record=" + rr.frozen_input.fixture_sha256 + " actual=" + fxSha);
chk("run record task_id matches the fixture", rr.task_id === fx.task.task_id);
chk("run record permitted equals the fixture reference-filter permitted", JSON.stringify(rr.permitted) === JSON.stringify(permitted));
chk("order is a permutation of permitted (orders only what was permitted)", sameSet(rr.order, permitted));
chk("the equivocation candidate cand_charlie is in neither permitted nor order", !rr.permitted.includes("cand_charlie") && !rr.order.includes("cand_charlie"));
chk("order carries ARBITER attestation (input+response sha256, endpoint)", /^[0-9a-f]{64}$/.test(rr.order_by.arbiter_input_sha256) && /^[0-9a-f]{64}$/.test(rr.order_by.arbiter_response_sha256) && typeof rr.order_by.endpoint === "string");
chk("boundary states NENRIN neither ordered nor scored", /NENRIN/.test(rr.boundary) && rr.does_not_establish.some((s) => /order/.test(s)) && rr.does_not_establish.some((s) => /score/.test(s)));
chk("no em/en/bar dashes anywhere in the run record", !DASH.test(JSON.stringify(rr)));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin recorded result: order written unchanged from ARBITER over the trust-filter permitted set; NENRIN records, does not order or score; frozen input pinned by sha256; evidence -> permitted -> order -> recorded result complete)");
process.exit(fail ? 1 : 0);
