// test/furui_check_day.test.mjs
// furui-check-day-v0 (a content check runner's signed daily root) and the Résumé's agreements[], on the LIVE worker
// (src/worker.js) with the real AgreementDedupeDO behind a mock Durable Object namespace and a mock KV, and the intake
// module itself with a keys document that lists a key made here. No network.
//
// Run: node test/furui_check_day.test.mjs
import crypto from "node:crypto";
import { loadWorker, loadWorkerModule, mockKV } from "./load.mjs";
import { AgreementDedupeDO, doStore } from "../nenrin/agreement-v0/agreement_intake.mjs";
import { handleFuruiDayIntake, handleFuruiDayGet, FURUI_DAY_SCHEMA } from "../nenrin/furui-check-day-v0/furui_check_day_intake.mjs";
import { FURUI_CHECK_KEYS } from "../nenrin/furui-check-day-v0/furui_check_keys.mjs";
import { canonicalUtf8 } from "../nenrin/agreement-v0/agreement_canonical.mjs";

const ORIGIN = "https://ledger.horizonshield.dev";
const KEY_URL = ORIGIN + "/.well-known/furui-check-keys.json";
const worker = await loadWorker("src/worker.js");
const { FuruiDayIntake } = await loadWorkerModule("src/worker.js");
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + JSON.stringify(detail).slice(0, 600) : "")); } };

function fakeState() {
  const map = new Map(); let chain = Promise.resolve();
  return { storage: { get: async (k) => (map.has(k) ? map.get(k) : undefined), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } },
           blockConcurrencyWhile: (fn) => { const r = chain.then(() => fn()); chain = r.catch(() => {}); return r; } };
}
function mockDO() {
  const insts = new Map();
  return { idFromName: (name) => name, get: (id) => { if (!insts.has(id)) insts.set(id, new AgreementDedupeDO(fakeState())); const d = insts.get(id); return { fetch: (u, init) => d.fetch(new Request(u, init)) }; } };
}
globalThis.fetch = async () => new Response("not found", { status: 404 });
let kv, env;
function reset(extra) { kv = mockKV([["seq", "40"], ...(extra || [])]); env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64), AGREEMENT_DEDUPE_DO: mockDO() }; }
const call = async (method, p, body, headers) => {
  const r = await worker.fetch(new Request(ORIGIN + p, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: () => {} });
  let j = null; try { j = await r.json(); } catch (_e) {}
  return { status: r.status, j };
};

// a runner key made here, and a day record signed with it
const kp = crypto.generateKeyPairSync("ed25519");
const pub = kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
const other = crypto.generateKeyPairSync("ed25519");
const DOC = { schema: "furui-check-keys-v0", use: "furui-check", keys: [{ key_id: "runner-1", public_key_ed25519_b64: pub, from_height: 974000, revoked_height: null }] };
function dayRecord(over, key) {
  const r = Object.assign({ schema: FURUI_DAY_SCHEMA, day: "2026-11-02", signer: { domain: "horizonshield.dev", key_url: KEY_URL }, n: 12,
    tree: "rfc6962-sha256", leaf: "sha256(0x00 || musubi-canonical-v0(envelope))", root: "ab".repeat(32), first_height: 974100, last_height: 974240,
    late: 0, clock_skew: 0, publication: "public" }, over || {});
  const sig = crypto.sign(null, Buffer.from(FURUI_DAY_SCHEMA + "\n" + canonicalUtf8(r), "utf8"), (key || kp).privateKey).toString("base64");
  return canonicalUtf8(Object.assign({}, r, { signatures: [{ alg: "ed25519", domain: r.signer.domain, key_id: "runner-1", sig }] }));
}
const post = (text) => new Request(ORIGIN + "/furui-check-day", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ record_canonical: text }) });
const deps = (doc) => ({ keysDoc: doc, ledgerKeyUrl: KEY_URL, store: doStore(env), now: () => "2026-11-03T00:10:00.000Z", origin: ORIGIN });

// ---- the live worker: the routes, and the empty keys document fails closed ----
reset();
let r = await call("GET", "/.well-known/furui-check-keys.json");
t("GET /.well-known/furui-check-keys.json: the keys document the worker carries (empty until the runner's key is made)", r.status === 200 && r.j.use === "furui-check" && Array.isArray(r.j.keys) && JSON.stringify(r.j) === JSON.stringify(FURUI_CHECK_KEYS), r);
r = await call("GET", "/furui-check-day");
t("GET /furui-check-day: the self description names the schema, the 00:30 batch and what it does not do", r.status === 200 && r.j.schema === FURUI_DAY_SCHEMA && /00:30/.test(r.j.what_this_does) && r.j.what_this_does_not_do.length === 2, r);
r = await call("POST", "/furui-check-day", { record_canonical: dayRecord() });
const LIVE_EXPECT = FURUI_CHECK_KEYS.keys.length ? "bad_signature" : "key_not_listed";
t("POST /furui-check-day with a key made here (not the listed one, or none listed): 422 " + LIVE_EXPECT + ", nothing stored, nothing queued", r.status === 422 && r.j.refusals[0] === LIVE_EXPECT && (await call("GET", "/agreement/pending")).j.count === 0, r);

// ---- the rate limit: 10 a day from one network, then 429 before anything is parsed ----
reset();
let codes = [];
for (let i = 0; i < 11; i++) codes.push((await call("POST", "/furui-check-day", { record_canonical: "{}" })).status);
t("POST /furui-check-day: 10 from one network are read (422 here), the 11th is 429", codes.slice(0, 10).every((c) => c === 422) && codes[10] === 429, codes);
r = await call("POST", "/furui-check-day", { record_canonical: "{}" }, { "cf-connecting-ip": "198.51.100.7" });
t("another network is not held by the first one's count", r.status === 422, r);

// ---- the intake with a keys document that lists the runner's key ----
reset();
const good = dayRecord();
r = await handleFuruiDayIntake(post(good), deps(DOC));
t("a day record signed by the listed key: 201, pending_anchor", r.status === 201 && r.body.status === "pending_anchor" && r.body.canonical_sha256 === sha(good), r.body);
r = await handleFuruiDayIntake(post(good), deps(DOC));
t("the same bytes again: 200, dedup", r.status === 200 && r.body.dedup === true, r.body);
r = await handleFuruiDayIntake(post(dayRecord({ root: "cd".repeat(32) })), deps(DOC));
t("another record for the same runner and day: 422 day_already_recorded", r.status === 422 && r.body.refusals[0] === "day_already_recorded" && r.body.first_canonical_sha256 === sha(good), r.body);
r = await handleFuruiDayIntake(post(dayRecord({ last_height: 974241, late: 1 })), deps(DOC));
t("another record for the same day with the same root (sent again, other heights): 200, same_root, the first sha, nothing stored", r.status === 200 && r.body.same_root === true && r.body.dedup === true && r.body.canonical_sha256 === sha(good)
  && (await doStore(env).getAccepted(sha(dayRecord({ last_height: 974241, late: 1 })))) == null, r.body);
r = await handleFuruiDayIntake(post(good), deps(DOC));
t("the first bytes once more after that: still 200 dedup with the same sha", r.status === 200 && r.body.dedup === true && r.body.canonical_sha256 === sha(good), r.body);
r = await handleFuruiDayIntake(post(dayRecord({ day: "2026-11-03" })), deps(DOC));
t("the next day: 201", r.status === 201, r.body);
const refuse = async (name, text, code, doc) => {
  const rr = await handleFuruiDayIntake(post(text), deps(doc || DOC));
  t(name + ": 422 " + code, rr.status === 422 && (rr.body.refusals || [rr.body.error]).includes(code), rr.body);
};
await refuse("signed by another key", dayRecord({ day: "2026-11-04" }, other), "bad_signature");
await refuse("a key not yet valid at the first height", dayRecord({ day: "2026-11-05", first_height: 973000 }), "key_not_yet_valid");
await refuse("a key revoked before the last height", dayRecord({ day: "2026-11-06" }), "key_revoked",
  { ...DOC, keys: [{ ...DOC.keys[0], revoked_height: 974200 }] });
await refuse("a key_url other than the ledger's fixed path", dayRecord({ day: "2026-11-07", signer: { domain: "horizonshield.dev", key_url: "https://horizonshield.dev/k.json" } }), "key_url_not_the_ledgers");
await refuse("a key_url off the signer's domain", dayRecord({ day: "2026-11-08", signer: { domain: "example.org", key_url: KEY_URL } }), "signer_not_on_own_domain");
await refuse("n of 0 (an empty day is not written)", dayRecord({ day: "2026-11-09", n: 0 }), "malformed");
await refuse("a day that is not a date", dayRecord({ day: "2026-02-30" }), "malformed");
await refuse("first height above the last", dayRecord({ day: "2026-11-10", first_height: 974300 }), "malformed");
await refuse("no consent to publication", dayRecord({ day: "2026-11-11", publication: "private" }), "publication_not_public");
await refuse("an extra field", dayRecord({ day: "2026-11-12", note: "x" }), "malformed");
const loose = JSON.stringify(JSON.parse(dayRecord({ day: "2026-11-13" })), null, 1);
r = await handleFuruiDayIntake(post(loose), deps(DOC));
t("bytes that are not canonical: 422 not_canonical", r.status === 422 && r.body.error === "not_canonical", r.body);
r = await handleFuruiDayGet(sha(good), { store: doStore(env), origin: ORIGIN });
t("GET by sha: the exact bytes", r.status === 200 && r.body.record_canonical === good, r.body);
r = await call("GET", "/furui-check-day/" + sha(good));
t("the worker's GET /furui-check-day/{sha} serves it too", r.status === 200 && r.j.record_canonical === good, r);
t("the worker's GET /admission/{sha of a day record}: 404", (await call("GET", "/admission/" + sha(good))).status === 404);

// ---- the day record rides the ledger's daily batch at 00:30 UTC (the public pool) ----
r = await call("GET", "/agreement/pending");
t("the pending pool lists the two day records by schema", r.status === 200 && (r.j.pending || []).filter((x) => x.record_schema === FURUI_DAY_SCHEMA).length === 2, r.j);
r = await call("POST", "/agreement/anchor", undefined, { "x-ledger-key": "t".repeat(64) });
t("the batch anchors the pool", r.status === 201 && r.j.anchored === 2, r);
const n = r.j.n;
const entry = JSON.parse(await kv.binding.get("entry:" + n));
const batch = JSON.parse(entry.record_canonical);
t("the batch entry lists the day records with record_schema furui-check-day-v0", batch.schema === "nenrin-agreement-batch-v1" && batch.records.filter((x) => x.record_schema === FURUI_DAY_SCHEMA).length === 2, batch);
r = await call("GET", "/furui-check-day/" + sha(good));
t("after the batch the day record reads anchored, with its ledger entry", r.status === 200 && r.j.status === "anchored" && r.j.ledger_entry === n, r.j);

// ---- the Résumé's agreements[] ----
const EP = "https://shop.example.org/mcp";
function agreementStored(parties, tamper) {
  const rec = { schema: "a2a-agreement-v1.1", agreement_id: "x".repeat(8) + parties.join(","), parties: parties.map((d, i) => ({ role: i ? "contractor" : "principal", domain: d, key_url: "https://" + d + "/keys/agreement.json" })), publication: "public" };
  const rc = canonicalUtf8(rec);
  return { canonical_sha256: sha(rc), record_canonical: tamper ? rc + " " : rc, report: { record_schema: "a2a-agreement-v1.1", verdict: "accepted" } };
}
function agreementBatch(n, items, { ots_status = "confirmed", bitcoin_block = 974000 + n, block_time = "2026-11-01T01:00:00Z" } = {}) {
  const b = { schema: "nenrin-agreement-batch-v1", anchored_at: "2026-11-01T00:30:00Z", count: items.length,
    records: [...items].sort((a, c) => (a.canonical_sha256 < c.canonical_sha256 ? -1 : 1)).map((s) => ({ canonical_sha256: s.canonical_sha256, record_schema: s.report.record_schema, verdict: "accepted", verifier_version: "x" })) };
  const rc = JSON.stringify(b);
  return { n, work: "NENRIN agreement batch", claim_sha256: sha(rc), record_canonical: rc, schema: "v0-plain", ots_status, bitcoin_block, block_time };
}
const mine1 = agreementStored(["shop.example.org", "buyer.example.net"]);
const mine2 = agreementStored(["buyer.example.net", "example.org"]);
const theirs = agreementStored(["a.example.com", "b.example.com"]);
const tampered = agreementStored(["shop.example.org", "c.example.com"], true);
const pendingMine = agreementStored(["shop.example.org", "d.example.com"]);
const admissionRow = { canonical_sha256: "ef".repeat(32), record_canonical: "{}", report: { record_schema: "a2a-admission-v0" } };
const e1 = agreementBatch(3, [mine1, theirs, admissionRow]);
const e2 = agreementBatch(5, [mine2, tampered]);
const e3 = agreementBatch(7, [pendingMine], { ots_status: "pending", bitcoin_block: null, block_time: null });
const put = [["seq", "7"], ["entry:3", JSON.stringify(e1)], ["entry:5", JSON.stringify(e2)], ["entry:7", JSON.stringify(e3)]];
for (const [s, nn] of [[mine1, 3], [theirs, 3], [admissionRow, 3], [mine2, 5], [tampered, 5], [pendingMine, 7]]) put.push(["agr:anchored:" + s.canonical_sha256, JSON.stringify({ n: nn, stored: s })]);
reset(put); kv.binding.put("seq", "7");
r = await call("GET", "/resume?endpoint=" + encodeURIComponent(EP));
const ag = r.j && r.j.agreements;
t("GET /resume: agreements[] lists the anchored agreements a party on the endpoint's host (or its parent domain) signed, by ledger entry", r.status === 200 && Array.isArray(ag)
  && JSON.stringify(ag) === JSON.stringify([{ record_sha256: mine1.canonical_sha256, ledger_n: 3 }, { record_sha256: mine2.canonical_sha256, ledger_n: 5 }]), r.j && { agreements: ag, not_counted: r.j.not_counted });
const nc = (r.j && r.j.not_counted) || [];
t("an agreement whose stored bytes do not hash to the listed sha is not counted, and says why", nc.some((x) => x.record_sha256 === tampered.canonical_sha256 && x.why === "agreement_bytes_do_not_hash_to_the_listed_sha"), nc);
t("an agreement in a batch not yet anchored is not counted (not_yet_anchored)", nc.some((x) => x.record_sha256 === pendingMine.canonical_sha256 && x.why === "not_yet_anchored"), nc);
t("another host's agreement and the admission row in the same batch are not listed", !JSON.stringify(ag || []).includes(theirs.canonical_sha256) && !JSON.stringify(ag || []).includes(admissionRow.canonical_sha256));
r = await call("GET", "/resume?endpoint=" + encodeURIComponent("https://nobody.example/mcp"));
t("an endpoint with no agreement: agreements[] empty, as before", r.status === 200 && Array.isArray(r.j.agreements) && r.j.agreements.length === 0, r.j);

// ---- the runner's way in (baton5): the named entrypoint FuruiDayIntake, outside the public caps, with every check ----
const today = new Date().toISOString().slice(0, 10);
reset([["fcd:count:" + today, "50"]]);
r = await call("POST", "/furui-check-day", { record_canonical: dayRecord() });
t("the public POST after the day's 50: 429 daily_global_cap_reached", r.status === 429 && r.j.error === "daily_global_cap_reached", r);
const ep = new FuruiDayIntake({ waitUntil: () => {} }, env);
let er = await ep.submit(dayRecord());
t("the entrypoint after the day's 50: not 429; it reaches the checks (422 " + LIVE_EXPECT + ")", er.status === 422 && er.body.refusals[0] === LIVE_EXPECT, er);
t("the entrypoint does not count: the day's global count is still 50", kv.store.get("fcd:count:" + today) === "50");
reset();
for (let i = 0; i < 10; i++) await call("POST", "/furui-check-day", { record_canonical: "{}" });
r = await call("POST", "/furui-check-day", { record_canonical: "{}" });
const ep2 = new FuruiDayIntake({ waitUntil: () => {} }, env);
const er2 = await ep2.submit("{}");
t("after one network's 10 the public POST is 429, and the entrypoint still reads the record (422 malformed, not 429)", r.status === 429 && er2.status === 422 && er2.body.refusals[0] === "malformed", { r, er2 });
t("the entrypoint refuses a non string (400)", (await ep2.submit({ record_canonical: "x" })).status === 400);
const saved = FURUI_CHECK_KEYS.keys.splice(0);
FURUI_CHECK_KEYS.keys.push(DOC.keys[0]);
try {
  reset([["fcd:count:" + today, "50"]]);
  const e3 = new FuruiDayIntake({ waitUntil: () => {} }, env);
  const g1 = await e3.submit(good), g2 = await e3.submit(good), g3 = await e3.submit(dayRecord({ last_height: 974241 })), g4 = await e3.submit(dayRecord({ root: "ef".repeat(32) }));
  t("the entrypoint with the key listed: 201 and queued for the 00:30 batch, though the public caps are spent", g1.status === 201 && g1.body.canonical_sha256 === sha(good) && (await call("GET", "/agreement/pending")).j.count === 1, { g1, pending: (await call("GET", "/agreement/pending")).j });
  t("the same bytes through the entrypoint again: 200 dedup; the same root with other heights: 200 same_root; one record for the day", g2.status === 200 && g2.body.dedup === true && g3.status === 200 && g3.body.same_root === true && g3.body.canonical_sha256 === sha(good) && (await call("GET", "/agreement/pending")).j.count === 1, { g2, g3 });
  t("another root for the day through the entrypoint: 422 day_already_recorded", g4.status === 422 && g4.body.refusals[0] === "day_already_recorded", g4);
  r = await call("GET", "/furui-check-day/" + sha(good));
  t("the record that came through the entrypoint is served by its sha on the public read", r.status === 200 && r.j.record_canonical === good, r);
} finally { FURUI_CHECK_KEYS.keys.splice(0); FURUI_CHECK_KEYS.keys.push(...saved); }
r = await call("GET", "/furui-check-day");
t("the self description says the same day again is 200 and that the runner's entrypoint is not in the public caps", /200/.test(r.j.same_day_again) && /FuruiDayIntake/.test(r.j.caps), r.j);

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (furui-check-day and the Résumé's agreements on the live worker)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (furui-check-day and the Résumé's agreements on the live worker)");
