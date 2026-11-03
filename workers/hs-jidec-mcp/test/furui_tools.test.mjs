// node test/furui_tools.test.mjs : the 1.4.0 tools (nenrin_admission, nenrin_agreement, nenrin_furui_day, nenrin_furui_leaf)
// against a mock ledger and a mock runner (no network). The day record and the envelopes are signed here with a key made
// here, listed in a mock keys document, and the audit paths are built here (RFC 6962 2.1.1), apart from the code under test.
import crypto from "node:crypto";
import worker from "../src/worker.js";
import { canonical, rootFromPath } from "../src/furui_read.mjs";

let n = 0, bad = 0;
const ok = (c, m, d) => { if (c) { n++; return; } bad++; console.error("FAIL:", m, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const LEDGER = "https://ledger.horizonshield.dev", KEYS_URL = LEDGER + "/.well-known/furui-check-keys.json";

// ---- a key, envelopes, a tree, a day record ----
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const pubB64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const other = crypto.generateKeyPairSync("ed25519");
const sign = (msg, k) => crypto.sign(null, Buffer.from(msg, "utf8"), k || privateKey).toString("base64");
const signer = { domain: "horizonshield.dev", key_url: KEYS_URL };
function envelope(i, over) {
  const check = { schema: "furui-check-v1", action_binding_digest: sha("a" + i), answered: true, checked_at_height: 972000 + i, contract_sha256: sha("c"),
    decision: "pass", input_commit: sha("i" + i), marks: [], nonce: sha("n" + i).slice(0, 32), rules_sha256: sha("r"), scope_sha256: sha("s"),
    signed_at: "2026-11-03T03:47:0" + (i % 10) + ".000Z", stage_reached: 4, trace_sha256: sha("t" + i), unread: false, ...(over || {}) };
  const e = { schema: "furui-check-signed-v1", check, signer };
  return { ...e, signatures: [{ alg: "ed25519", domain: "horizonshield.dev", key_id: "runner-1", sig: sign("furui-check-signed-v1\n" + canonical(e)) }] };
}
const leafOf = (e) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(canonical(e), "utf8")]));
const nodeOf = (a, b) => sha(Buffer.concat([Buffer.from([1]), Buffer.from(a, "hex"), Buffer.from(b, "hex")]));
const k2 = (m) => { let k = 1; while (k * 2 < m) k *= 2; return k; };
const mth = (L) => (L.length === 1 ? L[0] : nodeOf(mth(L.slice(0, k2(L.length))), mth(L.slice(k2(L.length)))));
function path(m, L) {
  if (L.length === 1) return [];
  const k = k2(L.length);
  return m < k ? [...path(m, L.slice(0, k)), mth(L.slice(k))] : [...path(m - k, L.slice(k)), mth(L.slice(0, k))];
}
const DAY = "2026-11-03", N = 5;
const envs = Array.from({ length: N }, (_, i) => envelope(i));
const leaves = envs.map(leafOf);
const root = mth(leaves);
const rec = { schema: "furui-check-day-v0", clock_skew: 0, day: DAY, first_height: 972000, last_height: 972004, late: 0, leaf: "sha256(0x00 || musubi-canonical-v0(envelope))",
  n: N, publication: "public", root, signer, tree: "rfc6962-sha256" };
const recSigned = { ...rec, signatures: [{ alg: "ed25519", domain: "horizonshield.dev", key_id: "runner-1", sig: sign("furui-check-day-v0\n" + canonical(rec)) }] };
const rc = canonical(recSigned), rsha = sha(rc);
// a second day whose record is signed by a key the ledger does not list
const rec2 = { ...rec, day: "2026-11-02" };
const rc2 = canonical({ ...rec2, signatures: [{ alg: "ed25519", domain: "horizonshield.dev", key_id: "runner-1", sig: sign("furui-check-day-v0\n" + canonical(rec2), other.privateKey) }] });
const rsha2 = sha(rc2);

for (let i = 0; i < N; i++) ok((await rootFromPath(leaves[i], i, N, path(i, leaves))) === root, "rootFromPath rebuilds the root from leaf " + i);
ok((await rootFromPath(leaves[1], 0, N, path(0, leaves))) === null || (await rootFromPath(leaves[1], 0, N, path(0, leaves))) !== root, "a wrong leaf does not rebuild the root");

// ---- mocks ----
const keysDoc = { schema: "furui-check-keys-v0", use: "furui-check", keys: [{ key_id: "runner-1", public_key_ed25519_b64: pubB64, from_height: 0, revoked_height: null }] };
const A = "ab".repeat(32), G = "cd".repeat(32);
const ledger = {
  [ "/admission/" + A ]: [200, { canonical_sha256: A, record_canonical: "{}", status: "anchored", ledger_entry: 240 }],
  [ "/agreement/" + G ]: [200, { canonical_sha256: G, record_canonical: "{}", status: "pending_anchor", ledger_entry: null }],
  [ "/furui-check-day/" + rsha ]: [200, { canonical_sha256: rsha, record_canonical: rc, status: "anchored", ledger_entry: 241 }],
  [ "/furui-check-day/" + rsha2 ]: [200, { canonical_sha256: rsha2, record_canonical: rc2, status: "pending_anchor", ledger_entry: null }],
  "/.well-known/furui-check-keys.json": [200, keysDoc],
};
const runner = {
  [ "/furui/day/" + DAY + "/status" ]: [200, { day: DAY, checks: N, status: { state: "accepted", n: N, root, record_sha256: rsha, ledger_canonical_sha256: rsha } }],
  "/furui/day/2026-11-01/status": [200, { day: "2026-11-01", checks: 0, status: null }],
  "/furui/day/2026-10-20/leaf/0": [410, { error: "gone", day: "2026-10-20" }],
  "/furui/day/2026-11-04/leaf/0": [404, { error: "day_open", day: "2026-11-04" }],
  "/furui/day/2026-11-05/status": [503, "upstream"],
};
for (let i = 0; i < N; i++) runner["/furui/day/" + DAY + "/leaf/" + i] = [200, { day: DAY, index: i, n: N, root, leaf_sha256: leaves[i], envelope_sha256: sha(canonical(envs[i])),
  envelope: envs[i], proof: path(i, leaves), proof_kind: "rfc6962-audit-path", day_record: { state: "accepted", ledger_canonical_sha256: rsha }, kept_until: "2026-11-10" }];
const seen = [];
const svc = (table, origin) => ({ fetch: async (req) => {
  const u = new URL(req.url); seen.push(origin + u.pathname);
  if (u.origin !== origin) return new Response("wrong origin", { status: 599 });
  const [st, body] = table[u.pathname + u.search] || [404, { error: "not_found" }];
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: st });
} });
const env = { LEDGER_SVC: svc(ledger, LEDGER), RUNNER_SVC: svc(runner, "https://furui.horizonshield.dev") };
async function rpc(method, params) {
  const r = await worker.fetch(new Request("https://jidec.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
  return (await r.json()).result;
}
const call = (name, args) => rpc("tools/call", { name, arguments: args || {} });

// ---- listing ----
const init = await rpc("initialize", {});
ok(init.serverInfo.version === "1.4.0", "initialize says 1.4.0", init.serverInfo);
ok(/nenrin_admission/.test(init.instructions) && /nenrin_furui_leaf/.test(init.instructions) && /admissions\[\]/.test(init.instructions), "instructions name the new tools and admissions[]");
const list = (await rpc("tools/list", {})).tools;
for (const t of ["nenrin_admission", "nenrin_agreement", "nenrin_furui_day", "nenrin_furui_leaf"]) ok(list.some((x) => x.name === t), "listed: " + t);
ok(list.every((t) => t.annotations.readOnlyHint === true && t.outputSchema && t.inputSchema), "every tool read-only with schemas");
ok(/admissions\[\]/.test(list.find((t) => t.name === "nenrin_resume").description), "nenrin_resume's description names admissions[]");
ok(/admissions\[\]/.test(list.find((t) => t.name === "nenrin_admission").description), "nenrin_admission's description names admissions[]");
ok(list.length === 13, "13 tools", list.length);
const health = await (await worker.fetch(new Request("https://jidec.horizonshield.dev/health"), env)).json();
ok(health.version === "1.4.0" && health.tools.includes("nenrin_furui_leaf"), "health names 1.4.0 and the tools");

// ---- admission and agreement ----
let r = await call("nenrin_admission", { sha256: A.toUpperCase() });
ok(!r.isError && r.structuredContent.lookup === "ok" && r.structuredContent.ledger_entry === 240 && r.structuredContent.source_url === LEDGER + "/admission/" + A, "admission by sha, case folded", r);
r = await call("nenrin_agreement", { sha256: G });
ok(!r.isError && r.structuredContent.status === "pending_anchor", "agreement by sha", r);
r = await call("nenrin_admission", { sha256: "ef".repeat(32) });
ok(!r.isError && r.structuredContent.lookup === "absent", "an unknown admission is absent, not an error", r);
r = await call("nenrin_admission", { sha256: "xyz" });
ok(r.isError, "a bad sha is refused");

// ---- day record ----
r = await call("nenrin_furui_day", { sha256: rsha });
let s = r.structuredContent;
ok(!r.isError && s.lookup === "ok" && s.all_hold === true && s.checks.anchored === true && s.ledger_entry === 241 && s.root === root && s.n === N, "the day record by sha: every check holds", s);
r = await call("nenrin_furui_day", { day: DAY });
s = r.structuredContent;
ok(!r.isError && s.canonical_sha256 === rsha && s.all_hold === true && s.runner_status.checks === N, "the day record by day, through the runner's status", s);
r = await call("nenrin_furui_day", { sha256: rsha2 });
s = r.structuredContent;
ok(!r.isError && s.all_hold === false && s.checks.key_listed === true && s.checks.signature_valid === false && s.checks.bytes_hash_to_the_sha === true, "a record signed by an unlisted key: the signature check fails", s);
const tampered = rc.replace('"late":0', '"late":1');
ledger["/furui-check-day/" + rsha][1] = { canonical_sha256: rsha, record_canonical: tampered, status: "anchored", ledger_entry: 241 };
r = await call("nenrin_furui_day", { sha256: rsha });
s = r.structuredContent;
ok(s.all_hold === false && s.checks.bytes_hash_to_the_sha === false && s.checks.signature_valid === false, "bytes changed after signing: the hash and the signature checks fail", s);
ledger["/furui-check-day/" + rsha][1] = { canonical_sha256: rsha, record_canonical: rc, status: "anchored", ledger_entry: 241 };
r = await call("nenrin_furui_day", { day: "2026-11-01" });
ok(!r.isError && r.structuredContent.lookup === "absent", "a day with no record is absent", r);
r = await call("nenrin_furui_day", { day: "2026-11-05" });
ok(r.isError && /NOT a statement/.test(r.content[0].text), "a runner that does not answer is an error, never absent", r);
r = await call("nenrin_furui_day", { day: "2026-02-30" });
ok(r.isError, "an unreal day is refused");
r = await call("nenrin_furui_day", {});
ok(r.isError, "neither sha nor day is refused");

// ---- leaves ----
for (const i of [0, 3, N - 1]) {
  r = await call("nenrin_furui_leaf", { day: DAY, index: i });
  s = r.structuredContent;
  ok(!r.isError && s.lookup === "ok" && s.all_hold === true && Object.values(s.checks).every((v) => v === true) && s.day_record.canonical_sha256 === rsha, "leaf " + i + ": every check holds", s && s.checks);
}
ok(seen.includes("https://furui.horizonshield.dev/furui/day/" + DAY + "/leaf/3"), "the leaf is read from the runner's public host");
const L1 = runner["/furui/day/" + DAY + "/leaf/1"][1];
runner["/furui/day/" + DAY + "/leaf/1"][1] = { ...L1, proof: [...L1.proof.slice(0, -1), "00".repeat(32)] };
r = await call("nenrin_furui_leaf", { day: DAY, index: 1 });
ok(r.structuredContent.all_hold === false && r.structuredContent.checks.path_rebuilds_the_root === false, "a wrong audit path is caught", r.structuredContent.checks);
runner["/furui/day/" + DAY + "/leaf/1"][1] = { ...L1, envelope: { ...L1.envelope, check: { ...L1.envelope.check, decision: "stop" } } };
r = await call("nenrin_furui_leaf", { day: DAY, index: 1 });
ok(r.structuredContent.all_hold === false && r.structuredContent.checks.leaf_is_the_envelope === false && r.structuredContent.checks.envelope_signature_valid === false, "an envelope changed after signing is caught", r.structuredContent.checks);
runner["/furui/day/" + DAY + "/leaf/1"][1] = { ...L1, envelope: { ...L1.envelope, check: { ...L1.envelope.check, note: "free text" } } };
r = await call("nenrin_furui_leaf", { day: DAY, index: 1 });
ok(r.structuredContent.all_hold === false && r.structuredContent.checks.closed_envelope === false, "an envelope with a field outside the closed shape is caught", r.structuredContent);
runner["/furui/day/" + DAY + "/leaf/1"][1] = L1;
r = await call("nenrin_furui_leaf", { day: "2026-10-20", index: 0 });
ok(!r.isError && r.structuredContent.lookup === "absent" && r.structuredContent.gone === true, "a day past its 7 days is absent and gone", r);
r = await call("nenrin_furui_leaf", { day: "2026-11-04", index: 0 });
ok(!r.isError && r.structuredContent.lookup === "absent" && r.structuredContent.runner_says === "day_open", "an open day is absent with the runner's word", r);
r = await call("nenrin_furui_leaf", { day: DAY, index: -1 });
ok(r.isError, "a negative index is refused");

console.log("");
if (bad) { console.log("FAIL " + bad + " of " + (n + bad) + " (hs-jidec-mcp 1.4.0 tools)"); process.exit(1); }
console.log("PASS " + n + "/" + n + " (hs-jidec-mcp 1.4.0 tools)");
