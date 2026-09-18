// Faithfulness + CLI test for the single-file SDK nenrin_verify.mjs.
// Runs identical inputs through the SDK and the pinned repo modules and asserts byte-identical outputs, then
// runs the CLI on a real did:key bundle offline. If these pass, the bundle is a faithful copy of the sources.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { evidenceId as repoEid } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef as repoGref, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { verifyProvenance as repoVP } from "../provenance-v0/provenance_verify.mjs";
import { consumeEvidence as repoConsume } from "../provenance-v0/consume.mjs";
import { didKeyEncode, rawFromKeyObject } from "../task-delegation-bind-v0/verify_fixture.mjs";
import { verifyProvenance as sdkVP, consumeEvidence as sdkConsume, evidenceId as sdkEid, grantRef as sdkGref, publicKeyFromDidKey, didKeyResolver } from "./nenrin_verify.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D) + "]");
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + String(x).slice(0, 200))); if (!c) fail++; };

const T = "task_sdk_1", NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z";
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };
const K = {}; for (const n of ["A", "B", "C", "W1", "W2"]) K[n] = newAgentKey();
const did = (n) => didKeyEncode(rawFromKeyObject(K[n].publicKey));
const idOf = {}; for (const n of ["A", "B", "C", "W1", "W2"]) idOf[n] = did(n);
const resolve = didKeyResolver;

const grant = (() => { const g = { schema: "task-execution-bind-v0/grant", task_id: T, action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, caller_id: idOf.A, provider_id: idOf.B, nonce: "n1", not_before: NB, not_after: NA }; g.grant_ref = repoGref(g); return signGrant(g, K.A.privateKey); })();
const receipt = (() => { const r = { schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: grant.grant_ref, executed_action: { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" }, outcome: { status: "completed", result_sha256: "sha_res_1", evidence: GOODEV }, provider_id: idOf.B, executed_at: IN }; r.receipt_id = receiptId(r); return signReceipt(r, K.B.privateKey); })();
const mkObs = (o) => { const obs = { task_id: T, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN }; obs.evidence_id = repoEid(obs); return signEdge(signObservation(obs, K[o.wk].privateKey), K[o.fk].privateKey); };
const h0 = mkObs({ seq: 0, from: idOf.A, to: idOf.B, witness: idOf.W1, wk: "W1", fk: "A", verdict: "pass", detail_ref: "nenrin-exec://" + receipt.receipt_id });
const h1 = mkObs({ seq: 1, from: idOf.B, to: idOf.C, witness: idOf.W2, wk: "W2", fk: "B", verdict: "pass", prev: h0.evidence_id });
const input = { task_id: T, observations: [h0, h1], grant, receipt, resolve };

// ---- faithfulness: SDK output must equal repo output byte for byte ----
chk("pure hashes agree (evidenceId, grantRef)", sdkEid(h0) === repoEid(h0) && sdkGref(grant) === repoGref(grant));
const rRepo = repoVP(input), rSdk = sdkVP(input);
chk("both verifiers accept the same signed graph", rRepo.verdict === "accepted" && rSdk.verdict === "accepted", rSdk.verdict + " " + JSON.stringify(rSdk.refusals));
chk("verifyProvenance report is byte-identical (SDK == repo)", JSON.stringify(rSdk) === JSON.stringify(rRepo));
chk("consumeEvidence projection is byte-identical (SDK == repo)", JSON.stringify(sdkConsume(input)) === JSON.stringify(repoConsume(input)));

// ---- did:key resolution works offline in the SDK ----
chk("SDK resolves a did:key to a usable public key", !!publicKeyFromDidKey(idOf.W1) && didKeyResolver("did:key:zNotValid") === null);

// ---- tamper is still caught by the SDK alone ----
const tampered = Object.assign({}, receipt, { outcome: Object.assign({}, receipt.outcome, { status: "failed" }) });
const rTamper = sdkVP({ ...input, receipt: tampered, receipts: [tampered] });
chk("SDK alone refuses a tampered receipt", rTamper.verdict === "refused");

// ---- CLI: verify a real did:key bundle offline, exit 0, says accepted ----
const { resolve: _r, ...bundle } = input;
const bpath = new URL("./_sdk_smoke_bundle.gen.json", import.meta.url);
writeFileSync(bpath, JSON.stringify(bundle));
let cliOut = "", cliCode = 0;
try { cliOut = execFileSync("node", [new URL("./nenrin_verify.mjs", import.meta.url).pathname, bpath.pathname], { encoding: "utf8" }); }
catch (e) { cliCode = e.status || 1; cliOut = String(e.stdout || "") + String(e.stderr || ""); }
chk("CLI verifies the bundle offline, exit 0, verdict accepted", cliCode === 0 && /"verdict":\s*"accepted"/.test(cliOut), "code=" + cliCode);

chk("no em/en/bar dashes in SDK report", !DASH.test(JSON.stringify(rSdk)));

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS (nenrin_verify.mjs: single-file SDK is a faithful copy and verifies offline)");
process.exit(fail ? 1 : 0);
