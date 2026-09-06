// test/witness_v11.test.mjs
// conduct-v1.1 intake red team (ops/conduct_v1_1_draft_20260907.md, sections 2 to 4 and 8).
// Every vector below is a refusal or a separation, never a pass that the v1 code would not have given.
// Run: node test/witness_v11.test.mjs   (offline; fetch is replaced for key_url lookups)

import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger witness v1.1");
const ORIGIN = "https://ledger.horizonshield.dev";

// A domain key for the witness, and a second one for a key_url that serves a different key.
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const raw = der.subarray(der.length - 32);
  return { privateKey, pub_b64: Buffer.from(raw).toString("base64") };
}
const W = keypair();      // the honest witness, served at https://witness.example/.well-known/nenrin-witness-key.json
const OTHER = keypair();  // some other key
const KEYS_SERVED = new Map([
  ["https://witness.example/.well-known/nenrin-witness-key.json", W.pub_b64],
  ["https://mismatch.example/key.json", OTHER.pub_b64],
  ["https://mcp.horizonshield.dev/key.json", W.pub_b64],
]);
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u === "https://dark.example/key.json") throw new Error("connect timeout");
  if (KEYS_SERVED.has(u)) return new Response(JSON.stringify({ public_key_ed25519_b64: KEYS_SERVED.get(u) }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("nope", { status: 404 });
};

const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
const SHA = "a".repeat(64);
function walk(over = {}) {
  const base = {
    schema: "jidec-path-v1", purpose: "a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp",
    walked_at: "2026-09-07T01:00:00Z", base: "https://mcp.horizonshield.dev",
    witness: { name: "Test Witness", vantage: "test" },
    nodes: [{ id: "n0", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/.well-known/agent-card.json", method: "GET" }, response: { status: 200, body_sha256: SHA } }],
    assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"] }],
    verdict: { ok: true, outcome: "PASS", n_pass: 1, n_total: 1 },
  };
  return { ...base, ...over };
}
const v11 = (over = {}) => walk({
  mode: "full",
  establishes: ["card fetched from https://mcp.horizonshield.dev at 2026-09-07T01:00:00Z"],
  does_not_establish: ["correctness or quality of any response", "truth of the compensation declaration", "identity of the witness beyond the name given"],
  ...over,
});

let kvMock = mockKV([["seq", "40"]]);
let env = { LEDGER: kvMock.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
function reset() { kvMock = mockKV([["seq", "40"]]); env = { LEDGER: kvMock.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) }; }

async function post(rec, opts = {}) {
  const record_canonical = typeof rec === "string" ? rec : canon(rec);
  const body = { record_canonical };
  if (opts.key) {
    body.public_key_ed25519_b64 = opts.key.pub_b64;
    body.signature_ed25519_b64 = edSign(null, Buffer.from(record_canonical, "utf8"), opts.key.privateKey).toString("base64");
  }
  if (opts.badsig) { body.public_key_ed25519_b64 = W.pub_b64; body.signature_ed25519_b64 = Buffer.alloc(64, 7).toString("base64"); }
  const res = await worker.fetch(new Request(ORIGIN + "/witness", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": opts.ip || "203.0.113.7" }, body: JSON.stringify(body),
  }), env);
  return { status: res.status, j: await res.json() };
}

// 1. v1 record (no mode) still accepted, read as full, counted.
reset();
let r = await post(walk());
chk("v1 record (no mode) accepted as before", r.status === 201 && r.j.mode === "full" && r.j.counted === true, JSON.stringify(r.j));

// 2. v1.1 record with both disclaimers accepted.
r = await post(v11());
chk("v1.1 full record with establishes and does_not_establish accepted", r.status === 201 && r.j.mode === "full", JSON.stringify(r.j));

// 3. disclaimer dropped: still schema-valid as v1, refused as v1.1 (the founding witness's vector).
const dropped = v11(); delete dropped.does_not_establish;
r = await post(dropped);
chk("v1.1 record without does_not_establish refused: disclaimer_missing", r.status === 422 && r.j.reason_code === "disclaimer_missing", JSON.stringify(r.j));

// 4. disclaimer emptied.
r = await post(v11({ does_not_establish: [] }));
chk("v1.1 record with empty does_not_establish refused", r.status === 422 && r.j.reason_code === "disclaimer_missing", JSON.stringify(r.j));
r = await post(v11({ does_not_establish: ["  "] }));
chk("v1.1 record with blank does_not_establish refused", r.status === 422 && r.j.reason_code === "disclaimer_missing", JSON.stringify(r.j));
r = await post(v11({ establishes: [] }));
chk("v1.1 record with empty establishes refused", r.status === 422 && r.j.reason_code === "disclaimer_missing", JSON.stringify(r.j));

// 5. bad mode.
r = await post(v11({ mode: "secret" }));
chk("unknown mode refused: bad_mode", r.status === 422 && r.j.reason_code === "bad_mode", JSON.stringify(r.j));

// 6. hash-only: a path leaks the tool; the origin does not.
r = await post(v11({ mode: "hash-only", walked_at: "2026-09-07T01:01:00Z", nodes: [{ id: "n3", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/mcp", method: "REDACTED" }, response: { status: 200, body_sha256: SHA } }] }));
chk("hash-only with a path in request.url refused: path_leaks_tool", r.status === 422 && r.j.reason_code === "path_leaks_tool", JSON.stringify(r.j));
r = await post(v11({ mode: "hash-only", walked_at: "2026-09-07T01:01:00Z", nodes: [{ id: "n3", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/", method: "POST" }, response: { status: 200, body_sha256: SHA } }] }));
chk("hash-only with a real method refused: path_leaks_tool", r.status === 422 && r.j.reason_code === "path_leaks_tool", JSON.stringify(r.j));
r = await post(v11({ mode: "hash-only", walked_at: "2026-09-07T01:01:00Z", nodes: [{ id: "n3", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/", method: "REDACTED" }, response: { status: 200, body_sha256: SHA } }],
  does_not_establish: ["correctness or quality of any response", "truth of the compensation declaration", "which tool or method was called", "identity of the witness beyond the name given"] }));
chk("hash-only with origin only and REDACTED method accepted", r.status === 201 && r.j.mode === "hash-only", JSON.stringify(r.j));

// 7. commitment mode.
const cm = v11({ mode: "commitment", walked_at: "2026-09-07T01:02:00Z" }); delete cm.nodes; delete cm.assertions; delete cm.verdict;
r = await post(cm);
chk("commitment mode without commitment refused: bad_commitment", r.status === 422 && r.j.reason_code === "bad_commitment", JSON.stringify(r.j));
r = await post({ ...cm, commitment: "b".repeat(64) });
chk("commitment mode with a 64 hex commitment accepted without nodes", r.status === 201 && r.j.mode === "commitment", JSON.stringify(r.j));

// 8. key_url without a signature binds nothing.
r = await post(v11({ walked_at: "2026-09-07T01:03:00Z", witness: { name: "Test Witness", vantage: "test", key_url: "https://witness.example/.well-known/nenrin-witness-key.json" } }));
chk("key_url on an unsigned record refused: bad_key_url", r.status === 422 && r.j.reason_code === "bad_key_url", JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T01:03:00Z", witness: { name: "Test Witness", vantage: "test", key_url: "http://witness.example/key.json" } }), { key: W });
chk("http key_url refused: bad_key_url", r.status === 422 && r.j.reason_code === "bad_key_url", JSON.stringify(r.j));

// 9. self witness: key served from the walked agent's own domain.
r = await post(v11({ walked_at: "2026-09-07T01:04:00Z", witness: { name: "Self", vantage: "test", key_url: "https://mcp.horizonshield.dev/key.json" } }), { key: W });
chk("key_url under the walked agent's domain refused: self_witness", r.status === 422 && r.j.reason_code === "self_witness", JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T01:04:00Z", witness: { name: "Ledger", vantage: "test", key_url: "https://ledger.horizonshield.dev/key.json" } }), { key: W });
chk("key_url under the ledger's own domain refused: self_witness", r.status === 422 && r.j.reason_code === "self_witness", JSON.stringify(r.j));

// 10. domain binding: match, mismatch, dark.
r = await post(v11({ walked_at: "2026-09-07T01:05:00Z", witness: { name: "Witness Example", vantage: "test", key_url: "https://witness.example/.well-known/nenrin-witness-key.json" } }), { key: W });
chk("signed record with matching key_url accepted with signed_domain", r.status === 201 && r.j.signed === true && r.j.signed_domain === "witness.example", JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T01:06:00Z", witness: { name: "Witness Example", vantage: "test", key_url: "https://mismatch.example/key.json" } }), { key: W });
chk("signed record whose key_url serves another key refused: key_url_mismatch", r.status === 422 && r.j.reason_code === "key_url_mismatch", JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T01:07:00Z", witness: { name: "Witness Example", vantage: "test", key_url: "https://dark.example/key.json" } }), { key: W });
chk("signed record whose key_url is unreachable answered 503, not stored", r.status === 503 && r.j.reason_code === "key_url_unreachable", JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T01:08:00Z" }), { badsig: true });
chk("bad signature still refused: signature_invalid", r.status === 422 && r.j.reason_code === "signature_invalid", JSON.stringify(r.j));

// 11. counting: same identity, same endpoint, same day: second stored, not counted.
reset();
r = await post(v11({ walked_at: "2026-09-07T02:00:00Z", witness: { name: "Repeat", vantage: "a" } }), { ip: "198.51.100.1" });
const first = r;
r = await post(v11({ walked_at: "2026-09-07T02:00:01Z", witness: { name: "Repeat", vantage: "a" } }), { ip: "198.51.100.1" });
chk("first record of the day counted, second from the same name for the same endpoint stored but not counted",
  first.j.counted === true && r.status === 201 && r.j.counted === false && /same witness/.test(r.j.count_reason), JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T02:00:02Z", purpose: "a2a-conduct-walk-v1: https://jidec.horizonshield.dev/mcp", base: "https://jidec.horizonshield.dev", witness: { name: "Repeat", vantage: "a" } }), { ip: "198.51.100.1" });
chk("same name, different endpoint, same day: counted", r.status === 201 && r.j.counted === true, JSON.stringify(r.j));
const pend = await (await worker.fetch(new Request(ORIGIN + "/witness/pending"), env)).json();
chk("/witness/pending shows stored, counted and stored_not_counted", pend.count === 3 && pend.counted === 2 && pend.stored_not_counted === 1, JSON.stringify({ c: pend.count, k: pend.counted, s: pend.stored_not_counted }));

// 12. lanes: five unsigned from one address, the sixth refused; a domain-signed record from the same address is not.
reset();
let last;
for (let i = 0; i < 5; i++) last = await post(v11({ walked_at: `2026-09-07T03:00:0${i}Z`, witness: { name: "Flood " + i, vantage: "x" } }), { ip: "192.0.2.9" });
chk("five unsigned records from one address accepted", last.status === 201, JSON.stringify(last.j));
r = await post(v11({ walked_at: "2026-09-07T03:00:05Z", witness: { name: "Flood 5", vantage: "x" } }), { ip: "192.0.2.9" });
chk("sixth unsigned record from the same address refused: daily_per_ip_cap_reached", r.status === 429 && r.j.error === "daily_per_ip_cap_reached", JSON.stringify(r.j));
r = await post(v11({ walked_at: "2026-09-07T03:00:06Z", witness: { name: "Witness Example", vantage: "x", key_url: "https://witness.example/.well-known/nenrin-witness-key.json" } }), { key: W, ip: "192.0.2.9" });
chk("domain-signed record from the capped address accepted on the domain lane", r.status === 201 && r.j.signed_domain === "witness.example", JSON.stringify(r.j));
const p2 = await (await worker.fetch(new Request(ORIGIN + "/witness/pending"), env)).json();
chk("pending distinguishes signed_domain per record", p2.pending.filter((x) => x.signed_domain === "witness.example").length === 1 && p2.pending.filter((x) => x.signed_domain === null).length === 5, JSON.stringify(p2.pending.map((x) => x.signed_domain)));

// 13. batch bytes: v1 records produce exactly the v1 batch record shape; v1.1 fields appear only when set.
reset();
await post(walk({ walked_at: "2026-09-07T04:00:00Z", witness: { name: "Plain", vantage: "p" } }), { ip: "192.0.2.10" });
await post(v11({ walked_at: "2026-09-07T04:00:01Z", witness: { name: "Witness Example", vantage: "x", key_url: "https://witness.example/.well-known/nenrin-witness-key.json" } }), { key: W, ip: "192.0.2.10" });
await post(v11({ walked_at: "2026-09-07T04:00:02Z", witness: { name: "Witness Example", vantage: "x", key_url: "https://witness.example/.well-known/nenrin-witness-key.json" } }), { key: W, ip: "192.0.2.10" });
await worker.scheduled({}, env, {});
const e41 = JSON.parse(kvMock.store.get("entry:41"));
const batch = JSON.parse(e41.record_canonical);
const plain = batch.records.find((x) => x.witness_name === "Plain");
const signedRecs = batch.records.filter((x) => x.witness_name === "Witness Example");
chk("batch: a v1 record carries exactly the v1 keys", plain && Object.keys(plain).join(",") === "sha,purpose,witness_name,vantage,signed", JSON.stringify(plain));
chk("batch: domain-signed records carry signed_domain, and the second carries counted:false", signedRecs.length === 2 && signedRecs.every((x) => x.signed_domain === "witness.example") && signedRecs.filter((x) => x.counted === false).length === 1, JSON.stringify(signedRecs));

// 14. self description states the v1.1 rules and refusals.
const desc = await (await worker.fetch(new Request(ORIGIN + "/witness"), env)).json();
chk("GET /witness states caps, lanes and the v1.1 refusal codes", desc.limits_stated_not_hidden.daily_per_domain === 50 && desc.limits_stated_not_hidden.daily_global === 500 && Array.isArray(desc.conduct_v1_1.refusals) && desc.conduct_v1_1.refusals.includes("disclaimer_missing") && desc.conduct_v1_1.refusals.includes("self_witness"), JSON.stringify(desc.conduct_v1_1 && desc.conduct_v1_1.refusals));
chk("GET /witness says what acceptance does not establish", typeof desc.conduct_v1_1.not_established === "string" && /does not prove/.test(desc.conduct_v1_1.not_established), desc.conduct_v1_1.not_established);

process.exit(chk.done() ? 1 : 0);
