// test/furui_check_day_runner.test.mjs
// furui-check-day-intake 0.3.0: a day record may name its runner with runner_id, and the keys document lists runner-2.
// A record without runner_id is runner-1's and is read as before 0.3.0 (the real record of 2026-11-04, signed by the
// real runner-1 key, is accepted with the same sha and the same day mark); a runner-2 record is accepted on the same day
// as runner-1's; a record whose key_id and runner_id do not name the same keys entry is refused. Keys made here, the real
// record from tools/tooshi/tooshi_real_20261106.json, the live worker behind a mock KV and Durable Object. No network.
//
// Run: node test/furui_check_day_runner.test.mjs
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { loadWorker, mockKV } from "./load.mjs";
import { AgreementDedupeDO, doStore } from "../nenrin/agreement-v0/agreement_intake.mjs";
import { handleFuruiDayIntake, FURUI_DAY_SCHEMA, FURUI_DAY_INTAKE_VERSION, runnerOf } from "../nenrin/furui-check-day-v0/furui_check_day_intake.mjs";
import { FURUI_CHECK_KEYS } from "../nenrin/furui-check-day-v0/furui_check_keys.mjs";
import { canonicalUtf8 } from "../nenrin/agreement-v0/agreement_canonical.mjs";

const ORIGIN = "https://ledger.horizonshield.dev";
const KEY_URL = ORIGIN + "/.well-known/furui-check-keys.json";
const worker = await loadWorker("src/worker.js");
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
let env;
const reset = () => { env = { LEDGER: mockKV([["seq", "40"]]).binding, LEDGER_ADMIN_TOKEN: "t".repeat(64), AGREEMENT_DEDUPE_DO: mockDO() }; };
const call = async (method, p) => {
  const r = await worker.fetch(new Request(ORIGIN + p, { method, headers: { "cf-connecting-ip": "203.0.113.9" } }), env, { waitUntil: () => {} });
  let j = null; try { j = await r.json(); } catch (_e) {}
  return { status: r.status, j };
};
const post = (text) => new Request(ORIGIN + "/furui-check-day", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ record_canonical: text }) });
const deps = (doc) => ({ keysDoc: doc, ledgerKeyUrl: KEY_URL, store: doStore(env), now: () => "2026-11-08T00:10:00.000Z", origin: ORIGIN });
const take = (r) => ({ status: r.status, verdict: r.body.verdict || null, sha: r.body.canonical_sha256 || null, refusals: r.body.refusals || null, error: r.body.error || null, dedup: r.body.dedup || false, same_root: r.body.same_root || false });
const pubOf = (kp) => kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

// ---- the keys document the worker carries ----
const RUNNER1_ROW = { key_id: "runner-1", public_key_ed25519_b64: "OwaxB47EcLw8lxVBl3BeSjUKUbEAsdXuVW1wFOWHzYc=", from_height: 0, revoked_height: null };
const ks = FURUI_CHECK_KEYS.keys;
t("the keys document lists two keys, runner-1 then runner-2, for furui-check", FURUI_CHECK_KEYS.schema === "furui-check-keys-v0" && FURUI_CHECK_KEYS.use === "furui-check" && ks.length === 2 && ks[0].key_id === "runner-1" && ks[1].key_id === "runner-2", ks);
t("runner-1's entry is byte for byte the one served before (no runner_id)", JSON.stringify(ks[0]) === JSON.stringify(RUNNER1_ROW), ks[0]);
const p2 = ks[1] && ks[1].public_key_ed25519_b64;
const p2raw = typeof p2 === "string" && /^[A-Za-z0-9+/]{43}=$/.test(p2) ? Buffer.from(p2, "base64") : null;
t("runner-2's entry: runner_id runner-2, a 32 byte Ed25519 public half in base64 other than runner-1's, from height 0, not revoked",
  ks[1] && JSON.stringify(Object.keys(ks[1])) === JSON.stringify(["key_id", "runner_id", "public_key_ed25519_b64", "from_height", "revoked_height"]) && ks[1].runner_id === "runner-2"
  && p2raw !== null && p2raw.length === 32 && p2raw.toString("base64") === p2 && p2 !== RUNNER1_ROW.public_key_ed25519_b64 && ks[1].from_height === 0 && ks[1].revoked_height === null, ks[1]);
let p2ok = false; try { crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), p2raw]), format: "der", type: "spki" }); p2ok = true; } catch (_e) { p2ok = false; }
t("runner-2's public half loads as an Ed25519 public key", p2ok);
const tooshi5 = ks.filter((x) => x && x.key_id === "runner-1" && x.revoked_height === null).map((x) => x.public_key_ed25519_b64);
t("the reading of TOOSHI 5 and runner_key (key_id runner-1, not revoked) still finds the one runner-1 key", tooshi5.length === 1 && tooshi5[0] === RUNNER1_ROW.public_key_ed25519_b64, tooshi5);
t("runnerOf: an entry or record without runner_id is runner-1's", runnerOf(ks[0]) === "runner-1" && runnerOf(ks[1]) === "runner-2" && runnerOf({}) === "runner-1");

// ---- the real record of 2026-11-04 (runner-1, no runner_id): the same answer under the keys with runner-2 ----
const real = JSON.parse(readFileSync(new URL("../../../tools/tooshi/tooshi_real_20261106.json", import.meta.url), "utf8")).rec_1104;
const REAL_SHA = "6f5e159978013f77515097a0efc3cc138303392b15b91105ee0aaa7c3a346f47";
t("the real record's bytes hash to " + REAL_SHA.slice(0, 8) + " and carry no runner_id", sha(real.record_canonical) === REAL_SHA && !("runner_id" in JSON.parse(real.record_canonical)));
const OLD_DOC = { schema: "furui-check-keys-v0", use: "furui-check", keys: [RUNNER1_ROW] };
reset();
let a = await handleFuruiDayIntake(post(real.record_canonical), deps(OLD_DOC));
reset();
let b = await handleFuruiDayIntake(post(real.record_canonical), deps(FURUI_CHECK_KEYS));
t("the real record under runner-1's key alone and under the keys with runner-2: 201 accepted, the same sha", a.status === 201 && b.status === 201 && JSON.stringify(take(a)) === JSON.stringify(take(b)) && b.body.canonical_sha256 === REAL_SHA, { a: take(a), b: take(b) });
const mark0 = sha("furui-check-day mark\nhorizonshield.dev\n2026-11-04");
const m = await doStore(env).getAccepted(mark0);
t("the real record holds the day mark of 0.2.0 (domain and day, no runner)", m && m.day_of === REAL_SHA, m);
t("the report names runner-1 and the intake 0.3.0", b.body.report.runner_id === "runner-1" && b.body.report.verifier_version === FURUI_DAY_INTAKE_VERSION && FURUI_DAY_INTAKE_VERSION === "furui-check-day-intake 0.3.0", b.body.report);
const stored = await doStore(env).getAccepted(REAL_SHA);
t("the stored bytes are the record's bytes, unchanged", stored && stored.record_canonical === real.record_canonical);

// ---- runner-1 and runner-2 with keys made here ----
const k1 = crypto.generateKeyPairSync("ed25519"), k2 = crypto.generateKeyPairSync("ed25519");
const ROW1 = { key_id: "runner-1", public_key_ed25519_b64: pubOf(k1), from_height: 0, revoked_height: null };
const ROW2 = { key_id: "runner-2", runner_id: "runner-2", public_key_ed25519_b64: pubOf(k2), from_height: 0, revoked_height: null };
const DOC1 = { schema: "furui-check-keys-v0", use: "furui-check", keys: [ROW1] };
const DOC2 = { schema: "furui-check-keys-v0", use: "furui-check", keys: [ROW1, ROW2] };
function rec(over, kid, key) {
  const r = Object.assign({ schema: FURUI_DAY_SCHEMA, day: "2026-11-09", signer: { domain: "horizonshield.dev", key_url: KEY_URL }, n: 3,
    tree: "rfc6962-sha256", leaf: "sha256(0x00 || musubi-canonical-v0(envelope))", root: "ab".repeat(32), first_height: 974900, last_height: 974950,
    late: 0, clock_skew: 0, publication: "public" }, over || {});
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  const sig = crypto.sign(null, Buffer.from(FURUI_DAY_SCHEMA + "\n" + canonicalUtf8(r), "utf8"), key.privateKey).toString("base64");
  return canonicalUtf8(Object.assign({}, r, { signatures: [{ alg: "ed25519", domain: r.signer.domain, key_id: kid, sig }] }));
}
const r1 = (over) => rec(over, "runner-1", k1);
const r2 = (over) => rec(Object.assign({ runner_id: "runner-2" }, over || {}), "runner-2", k2);

// runner-1's records: the same answers under runner-1's key alone and under the keys with runner-2
const cases1 = [
  ["a record", r1()], ["the same bytes again", r1()], ["another root, same day", r1({ root: "cd".repeat(32) })], ["the same root, other heights", r1({ last_height: 974951 })],
  ["the next day", r1({ day: "2026-11-10" })], ["signed by runner-2's key", rec({ day: "2026-11-11" }, "runner-1", k2)], ["below from_height", r1({ day: "2026-11-12", first_height: -1 })],
  ["an extra field", r1({ day: "2026-11-13", note: "x" })], ["not public", r1({ day: "2026-11-14", publication: "private" })],
];
reset(); const o1 = []; for (const [, x] of cases1) o1.push(take(await handleFuruiDayIntake(post(x), deps(DOC1))));
reset(); const o2 = []; for (const [, x] of cases1) o2.push(take(await handleFuruiDayIntake(post(x), deps(DOC2))));
for (let i = 0; i < cases1.length; i++) t("runner-1, " + cases1[i][0] + ": the same answer with or without runner-2 listed (" + o1[i].status + ")", JSON.stringify(o1[i]) === JSON.stringify(o2[i]), { without: o1[i], with: o2[i] });
t("runner-1's answers are the ones of 0.2.0: 201, 200 dedup, 422 day_already_recorded, 200 same_root, 201, bad_signature, malformed, malformed, publication_not_public",
  JSON.stringify(o2.map((x) => x.status)) === JSON.stringify([201, 200, 422, 200, 201, 422, 422, 422, 422]) && o2[2].refusals[0] === "day_already_recorded" && o2[3].same_root === true
  && o2[5].refusals[0] === "bad_signature" && o2[6].refusals[0] === "malformed" && o2[7].refusals[0] === "malformed" && o2[8].refusals[0] === "publication_not_public", o2);

// runner-2 next to runner-1 on the same day (the store of the DOC2 run above still holds runner-1's 2026-11-09)
let r = await handleFuruiDayIntake(post(r2()), deps(DOC2));
t("runner-2's record for the day runner-1 already holds: 201 (one record a day per runner)", r.status === 201 && r.body.canonical_sha256 === sha(r2()) && r.body.report.runner_id === "runner-2", r.body);
const mark2 = await doStore(env).getAccepted(sha("furui-check-day mark\nhorizonshield.dev\n2026-11-09\nrunner-2"));
t("runner-2's day mark is domain, day and runner; runner-1's mark still names runner-1's record", mark2 && mark2.day_of === sha(r2())
  && (await doStore(env).getAccepted(sha("furui-check-day mark\nhorizonshield.dev\n2026-11-09"))).day_of === sha(r1()), mark2);
r = await handleFuruiDayIntake(post(r2()), deps(DOC2));
t("runner-2, the same bytes again: 200 dedup", r.status === 200 && r.body.dedup === true, r.body);
r = await handleFuruiDayIntake(post(r2({ root: "ef".repeat(32) })), deps(DOC2));
t("runner-2, another root the same day: 422 day_already_recorded naming runner-2's first record", r.status === 422 && r.body.refusals[0] === "day_already_recorded" && r.body.first_canonical_sha256 === sha(r2()), r.body);
r = await handleFuruiDayIntake(post(r2({ last_height: 974999 })), deps(DOC2));
t("runner-2, the same root with other heights: 200 same_root, runner-2's first sha", r.status === 200 && r.body.same_root === true && r.body.canonical_sha256 === sha(r2()), r.body);
r = await handleFuruiDayIntake(post(r1({ root: "ef".repeat(32) })), deps(DOC2));
t("runner-1, another root the same day after runner-2 wrote: still day_already_recorded naming runner-1's record", r.status === 422 && r.body.first_canonical_sha256 === sha(r1()), r.body);
r = await handleFuruiDayIntake(post(r2()), deps(DOC1));
t("runner-2's record while the keys list runner-1 alone: 422 key_not_listed", r.status === 422 && r.body.refusals[0] === "key_not_listed", r.body);

// key_id and runner_id that do not name the same entry
const refuse = async (name, text, code, doc) => {
  const rr = await handleFuruiDayIntake(post(text), deps(doc || DOC2));
  t(name + ": 422 " + code, rr.status === 422 && (rr.body.refusals || [rr.body.error]).includes(code), rr.body);
};
await refuse("key_id runner-2 without runner_id (read as runner-1)", rec({ day: "2026-11-20" }, "runner-2", k2), "key_not_listed_for_this_runner");
await refuse("runner_id runner-2 with key_id runner-1", rec({ day: "2026-11-21", runner_id: "runner-2" }, "runner-1", k1), "key_not_listed_for_this_runner");
await refuse("runner_id runner-1 with key_id runner-2", rec({ day: "2026-11-22", runner_id: "runner-1" }, "runner-2", k2), "key_not_listed_for_this_runner");
await refuse("runner_id runner-3 with key_id runner-2", rec({ day: "2026-11-23", runner_id: "runner-3" }, "runner-2", k2), "key_not_listed_for_this_runner");
await refuse("runner-2's names, signed by runner-1's key", rec({ day: "2026-11-24", runner_id: "runner-2" }, "runner-2", k1), "bad_signature");
for (const [i, bad] of [["r2", 1], ["runner-01", 2], ["", 3], ["runner-2 ", 4], ["Runner-2", 5]]) await refuse("runner_id " + JSON.stringify(bad), rec({ day: "2026-12-0" + i, runner_id: bad }, "runner-2", k2), "malformed");
await refuse("runner_id not a string", rec({ day: "2026-12-06", runner_id: 2 }, "runner-2", k2), "malformed");
await refuse("runner_id null", rec({ day: "2026-12-07", runner_id: null }, "runner-2", k2), "malformed");
await refuse("runner-2 revoked before the last height", r2({ day: "2026-12-08" }), "key_revoked", { ...DOC2, keys: [ROW1, { ...ROW2, revoked_height: 974920 }] });
await refuse("runner-2 not yet valid at the first height", r2({ day: "2026-12-09" }), "key_not_yet_valid", { ...DOC2, keys: [ROW1, { ...ROW2, from_height: 975000 }] });
await refuse("runner-2's key listed under key_id runner-2 but without runner_id (an entry for runner-1)", r2({ day: "2026-12-10" }), "key_not_listed_for_this_runner", { ...DOC2, keys: [ROW1, { key_id: "runner-2", public_key_ed25519_b64: pubOf(k2), from_height: 0, revoked_height: null }] });

// runner_id "runner-1" written out: accepted, and counted on runner-1's day mark
reset();
r = await handleFuruiDayIntake(post(r1({ day: "2026-12-20" })), deps(DOC2));
const e1 = await handleFuruiDayIntake(post(rec({ day: "2026-12-20", runner_id: "runner-1", root: "12".repeat(32) }, "runner-1", k1)), deps(DOC2));
const e2 = await handleFuruiDayIntake(post(rec({ day: "2026-12-21", runner_id: "runner-1" }, "runner-1", k1)), deps(DOC2));
t("runner_id runner-1 written out is runner-1: another root on the day of runner-1's record is day_already_recorded, and on its own day it is 201",
  r.status === 201 && e1.status === 422 && e1.body.refusals[0] === "day_already_recorded" && e2.status === 201 && e2.body.report.runner_id === "runner-1", { r: take(r), e1: take(e1), e2: take(e2) });

// ---- the live worker ----
reset();
let w = await call("GET", "/.well-known/furui-check-keys.json");
t("GET /.well-known/furui-check-keys.json serves the two keys, runner-1's entry first and unchanged", w.status === 200 && JSON.stringify(w.j) === JSON.stringify(FURUI_CHECK_KEYS) && JSON.stringify(w.j.keys[0]) === JSON.stringify(RUNNER1_ROW), w.j);
w = await call("GET", "/furui-check-day");
t("GET /furui-check-day names runner_id and the intake 0.3.0", w.status === 200 && typeof w.j.runner_id === "string" && /runner-1/.test(w.j.runner_id) && /runner-2/.test(w.j.runner_id) && w.j.intake === "furui-check-day-intake 0.3.0", w.j);
t("the self description has no dash characters", !/[\u2012-\u2015]/.test(JSON.stringify(w.j)));

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (furui-check-day runner_id and the runner-2 key)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (furui-check-day runner_id and the runner-2 key)");
