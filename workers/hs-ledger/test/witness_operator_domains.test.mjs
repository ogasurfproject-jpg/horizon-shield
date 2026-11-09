// test/witness_operator_domains.test.mjs
// 2026-11-08. POST /witness and this project's own domains (horizonshield.dev, the-horizons-innovation.com,
// ogasurfproject-jpg.github.io, oga-surf-project.workers.dev, and every name under them). A record whose witness.key_url
// is served from one of them is this project signing. Proves: (1) on a record that walked one of those names or the
// ledger (a FURUI day, or a walk of this project's own agents by base or by endpoint) it is refused as self_witness
// before the key is fetched, and nothing is stored or counted; upper case, a trailing dot and a port do not get around
// it; (2) on a record about anyone else it is kept (201, stored, batched) with counted false and count_reason "operator",
// takes no first-count slot, and a real outside witness of the same endpoint on the same day is still counted; the pool
// and the batch carry it as not counted; (3) a key from another domain about this project's agents is taken and counted
// as before; (4) look-alike names are not this project's; (5) the ledger's own host and this project's GitHub account
// stay refused for every record, as before; (6) records stored before the rule are read back and batched unchanged.
// Offline: fetch is stubbed and logged.
// Run: node test/witness_operator_domains.test.mjs   (in workers/hs-ledger)

import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger witness operator domains");
const ORIGIN = "https://ledger.horizonshield.dev";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const der = publicKey.export({ type: "spki", format: "der" });
const PUB = Buffer.from(der.subarray(der.length - 32)).toString("base64");
const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response(JSON.stringify({ public_key_ed25519_b64: PUB }), { status: 200, headers: { "content-type": "application/json" } });
};

const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
const H = (c) => c.repeat(64);
const DAY_SHA = H("7");
const furuiDay = (keyUrl, t) => ({
  schema: "jidec-path-v1", purpose: "furui-day-v0: 2026-11-06", walked_at: t, base: ORIGIN + "/furui-check-day/" + DAY_SHA,
  mode: "commitment", commitment: DAY_SHA, witness: { name: "w", vantage: "test", key_url: keyUrl },
  establishes: ["the witness recomputed the day"], does_not_establish: ["anything beyond the day"],
});
const tooshiDay = (keyUrl, t) => ({
  schema: "jidec-path-v1", purpose: "tooshi-day-v0: 2026-11-06", walked_at: t,
  base: "https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/tooshi/days/2026-11-06.json",
  mode: "commitment", commitment: DAY_SHA, witness: { name: "w", vantage: "test", key_url: keyUrl },
  establishes: ["the witness ran the day itself"], does_not_establish: ["anything beyond the day"],
});
// A conduct walk: base is the agent's origin, the purpose names the measured endpoint (the record's endpoint).
const walk = (base, endpoint, name = "w") => (keyUrl, t) => ({
  schema: "jidec-path-v1", purpose: "a2a-conduct-walk-v1: " + endpoint, walked_at: t, base,
  witness: { name, vantage: "test", key_url: keyUrl },
  nodes: [{ id: "n0", kind: "fetch", request: { url: base + "/.well-known/agent-card.json", method: "GET" }, response: { status: 200, body_sha256: H("a") } }],
  assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"] }],
  verdict: { ok: true, outcome: "PASS", n_pass: 1, n_total: 1 }, mode: "full",
  establishes: ["card fetched from " + base], does_not_establish: ["correctness of any response"],
});

let kvMock, env;
function reset() { kvMock = mockKV([["seq", "40"]]); env = { LEDGER: kvMock.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) }; fetched.length = 0; }
async function post(r) {
  const record_canonical = canon(r);
  const body = { record_canonical, public_key_ed25519_b64: PUB, signature_ed25519_b64: edSign(null, Buffer.from(record_canonical, "utf8"), privateKey).toString("base64") };
  const res = await worker.fetch(new Request(ORIGIN + "/witness", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body),
  }), env);
  return { status: res.status, j: await res.json() };
}
const show = (r) => JSON.stringify(r.j);
const keys = (p) => [...kvMock.store.keys()].filter((k) => k.startsWith(p)).length;
const stored = () => keys("wit:pending:") + keys("wit:cnt:") + keys("wit:count:") + keys("wit:dom:");
const getJ = async (path) => (await worker.fetch(new Request(ORIGIN + path), env)).json();
const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const R = "https://raw.githubusercontent.com/";
const OUTSIDE = walk("https://agent.example", "https://agent.example/a2a");

// Keys served from this project's own domains: each of the four, names under them, and spellings that read to the same host.
const OUR_KEYS = [
  "https://horizonshield.dev/.well-known/nenrin-witness-key.json", "https://gate.horizonshield.dev/keys/witness.json", "https://a.b.horizonshield.dev/k.json",
  "https://the-horizons-innovation.com/k.json", "https://shield.the-horizons-innovation.com/k.json",
  "https://ogasurfproject-jpg.github.io/keys/witness.json", "https://x.ogasurfproject-jpg.github.io/k.json",
  "https://oga-surf-project.workers.dev/k.json", "https://hs-ledger.oga-surf-project.workers.dev/k.json",
  "https://HorizonShield.DEV/k.json", "https://horizonshield.dev./k.json", "https://gate.horizonshield.dev.:443/k.json",
  "https://horizonshield.dev:8443/k.json", "https://The-Horizons-Innovation.com/k.json", "https://OgaSurfProject-JPG.github.io/k.json",
  "https://Oga-Surf-Project.workers.dev./k.json",
];

// 1. This project's key on this project's own records: self_witness, before any fetch, nothing kept.
const OUR_RECORDS = [
  ["a FURUI day (base is the ledger)", furuiDay],
  ["a walk of horizonshield.dev by base and endpoint", walk("https://mcp.horizonshield.dev", "https://mcp.horizonshield.dev/a2a")],
  ["a walk of the-horizons-innovation.com by base", walk("https://shield.the-horizons-innovation.com", "https://agent.example/a2a")],
  ["a walk whose endpoint is on ogasurfproject-jpg.github.io", walk("https://agent.example", "https://ogasurfproject-jpg.github.io/a2a")],
  ["a walk of oga-surf-project.workers.dev by base", walk("https://hs-ledger.oga-surf-project.workers.dev", "https://hs-ledger.oga-surf-project.workers.dev/mcp")],
  ["a walk of the ledger's own host", walk(ORIGIN, ORIGIN + "/a2a")],
  ["a walk of an upper-case, trailing-dot spelling of the gate", walk("https://Gate.HorizonShield.dev.", "https://Gate.HorizonShield.dev./mcp")],
  ["a walk of an http base on this project's host", walk("http://mcp.horizonshield.dev", "http://mcp.horizonshield.dev/a2a")],
];
let nRefused = 0;
for (const u of OUR_KEYS) {
  for (const [kind, mk] of OUR_RECORDS) {
    reset();
    const r = await post(mk(u, NOW));
    nRefused++;
    chk("this project's key on this project's record refused as self_witness: " + kind + " " + u,
      r.status === 422 && r.j.reason_code === "self_witness" && fetched.length === 0 && stored() === 0, show(r) + " fetched " + fetched.length + " kept " + stored());
  }
}

// 2. This project's key on a record about someone else: kept, batched, never counted, no first-count slot.
const ABOUT_OTHERS = [
  ["an outside agent", OUTSIDE],
  ["an outside agent on a look-alike host", walk("https://evilhorizonshield.dev", "https://horizonshield.dev.evil.com/a2a")],
  ["a TOOSHI day (base is raw.githubusercontent.com, not one of the four domains)", tooshiDay],
];
let nOperator = 0;
for (const u of OUR_KEYS) {
  for (const [kind, mk] of ABOUT_OTHERS) {
    reset();
    const r = await post(mk(u, NOW));
    nOperator++;
    const s = r.status === 201 ? JSON.parse((await env.LEDGER.get("wit:pending:" + r.j.sha)) || "null") : null;
    chk("this project's key on a record about someone else kept, not counted, count_reason operator: " + kind + " " + u,
      r.status === 201 && r.j.signed === true && r.j.counted === false && r.j.count_reason === "operator" && fetched.length === 1 &&
      s && s.counted === false && s.count_reason === "operator" && keys("wit:cnt:") === 0 && keys("wit:pending:") === 1,
      show(r) + " cnt " + keys("wit:cnt:"));
  }
}

// 3. It does not stop a real outside witness of the same endpoint on the same day from being counted, in either order,
// and a second record from this project stays "operator", not "same witness".
const OTHER_KEY = "https://witness.example/.well-known/nenrin-witness-key.json";
reset();
let r1 = await post(OUTSIDE("https://gate.horizonshield.dev/keys/witness.json", NOW));
let r2 = await post(walk("https://agent.example", "https://agent.example/a2a", "w2")("https://gate.horizonshield.dev/keys/witness.json", NOW));
let r3 = await post(OUTSIDE(OTHER_KEY, NOW));
let r4 = await post(walk("https://agent.example", "https://agent.example/a2a", "w2")(OTHER_KEY, NOW));
chk("this project first, twice: both kept as operator", r1.j.count_reason === "operator" && r1.j.counted === false && r2.status === 201 && r2.j.count_reason === "operator", show(r1) + " " + show(r2));
chk("then an outside witness of the same endpoint the same day is counted", r3.status === 201 && r3.j.counted === true && r3.j.count_reason === null, show(r3));
chk("and its second record that day is the usual same-witness case", r4.status === 201 && r4.j.counted === false && /same witness/.test(r4.j.count_reason || ""), show(r4));
chk("one first-count slot taken, by the outside witness", keys("wit:cnt:") === 1, String(keys("wit:cnt:")));
let pool = await getJ("/witness/pending");
chk("the pool lists all four and counts only the outside witness's first", pool.count === 4 && pool.counted === 1 && pool.stored_not_counted === 3 &&
  pool.pending.filter((x) => x.signed_domain === "gate.horizonshield.dev").every((x) => x.counted === false), JSON.stringify(pool).slice(0, 400));
chk("GET /witness/{sha} reads the operator record back with count_reason operator", (await getJ("/witness/" + r1.j.sha)).count_reason === "operator", "");
let a = await worker.fetch(new Request(ORIGIN + "/witness/anchor", { method: "POST", headers: { "x-ledger-key": "t".repeat(64) } }), env, { waitUntil() {} });
let aj = await a.json();
let n = Number(await env.LEDGER.get("seq"));
let entry = JSON.parse((await env.LEDGER.get("entry:" + n)) || (await env.LEDGER.get("e:" + n)) || "null");
let batch = entry ? JSON.parse(String(entry.record_canonical || entry.claim || "{}")) : {};
const inBatch = (sha) => (batch.records || []).find((x) => x.sha === sha) || {};
chk("the batch carries the operator records as counted false and the outside first without the field",
  a.status === 201 && aj.anchored === 4 && inBatch(r1.j.sha).counted === false && inBatch(r2.j.sha).counted === false &&
  !("counted" in inBatch(r3.j.sha)) && inBatch(r4.j.sha).counted === false, a.status + " " + JSON.stringify(batch).slice(0, 500));
const anch = await getJ("/witness/" + r1.j.sha);
chk("after the batch the operator record reads back anchored with count_reason operator", anch.status === "anchored" && anch.record.count_reason === "operator" && anch.record.counted === false, JSON.stringify(anch).slice(0, 300));

reset();
r3 = await post(OUTSIDE(OTHER_KEY, NOW));
r1 = await post(OUTSIDE("https://ogasurfproject-jpg.github.io/keys/witness.json", NOW));
r4 = await post(walk("https://agent.example", "https://agent.example/a2a", "w2")(OTHER_KEY, NOW));
chk("outside witness first: counted; this project after it: operator; the outside witness's second: same witness",
  r3.j.counted === true && r1.j.count_reason === "operator" && /same witness/.test(r4.j.count_reason || ""), show(r3) + " " + show(r1) + " " + show(r4));

// 4. Another domain's key on this project's records and on outside records: taken and counted as before. The first five
// are the domains of the witnesses whose signed records the ledger holds; the rest are names that only look like ours.
const THEIRS = [
  ["https://pipavlo82.github.io/keys/witness.json", "pipavlo82.github.io"],
  ["https://kuangmi-bit.github.io/.well-known/nenrin-witness-key.json", "kuangmi-bit.github.io"],
  ["https://api.babyblueviper.com/.well-known/nenrin-witness-key.json", "api.babyblueviper.com"],
  ["https://ovaic.org/.well-known/nenrin-witness-key.json", "ovaic.org"],
  ["https://invinoveritas.dev/.well-known/nenrin-witness-key.json", "invinoveritas.dev"],
  ["https://evilhorizonshield.dev/k.json", "evilhorizonshield.dev"],
  ["https://horizonshield.dev.evil.com/k.json", "horizonshield.dev.evil.com"],
  ["https://horizonshield.devs/k.json", "horizonshield.devs"],
  ["https://my-the-horizons-innovation.com/k.json", "my-the-horizons-innovation.com"],
  ["https://the-horizons-innovation.co/k.json", "the-horizons-innovation.co"],
  ["https://ogasurfproject-jpg-fan.github.io/k.json", "ogasurfproject-jpg-fan.github.io"],
  ["https://ogasurfproject.github.io/k.json", "ogasurfproject.github.io"],
  ["https://evil-oga-surf-project.workers.dev/k.json", "evil-oga-surf-project.workers.dev"],
  ["https://oga-surf-project.workers.dev.evil.com/k.json", "oga-surf-project.workers.dev.evil.com"],
];
const THEIR_RECORDS = [
  ["a FURUI day", furuiDay],
  ["a TOOSHI day", tooshiDay],
  ["a walk of mcp.horizonshield.dev", walk("https://mcp.horizonshield.dev", "https://mcp.horizonshield.dev/a2a")],
  ["a walk of ogasurfproject-jpg.github.io", walk("https://ogasurfproject-jpg.github.io", "https://ogasurfproject-jpg.github.io/a2a")],
  ["an outside agent", OUTSIDE],
];
let nTaken = 0;
for (const [u, dom] of THEIRS) {
  for (const [kind, mk] of THEIR_RECORDS) {
    reset();
    const r = await post(mk(u, NOW));
    nTaken++;
    chk("another domain taken and counted as before: " + kind + " " + u + " as " + dom,
      r.status === 201 && r.j.signed === true && r.j.signed_domain === dom && r.j.counted === true && r.j.count_reason === null && fetched.length === 1, show(r));
  }
}

// 5. The rules that were there before stay unconditional: the ledger's own host as key host, and this project's GitHub
// account, are refused on every record, about this project or not. Another GitHub account keeps its rules.
for (const u of ["https://ledger.horizonshield.dev/witness-key.json", R + "ogasurfproject-jpg/horizon-shield/main/witness.json", R + "OgaSurfProject-JPG/x/refs/heads/main/k.json"]) {
  for (const [kind, mk] of [["a FURUI day", furuiDay], ["a TOOSHI day", tooshiDay], ["an outside agent", OUTSIDE]]) {
    reset();
    const r = await post(mk(u, NOW));
    chk("refused as before, whatever the record: " + kind + " " + u, r.status === 422 && r.j.reason_code === "self_witness" && fetched.length === 0 && stored() === 0, show(r));
  }
}
for (const u of [R + "alice/keys/main/witness.json", R + "kuangmi-bit/nenrin-key/refs/heads/main/witness-key.json"]) {
  const owner = u.slice(R.length).split("/")[0];
  for (const [kind, mk] of [["a FURUI day", furuiDay], ["a TOOSHI day", tooshiDay], ["an outside agent", OUTSIDE]]) {
    reset();
    const r = await post(mk(u, NOW));
    if (kind === "a TOOSHI day") chk("raw.githubusercontent.com on a TOOSHI day: self_witness by the walked host, as before: " + u, r.status === 422 && r.j.reason_code === "self_witness", show(r));
    else chk("raw.githubusercontent.com, another account, taken and counted as github.com/" + owner + ": " + kind, r.status === 201 && r.j.signed_domain === "github.com/" + owner && r.j.counted === true, show(r));
  }
}

// 6. Records stored before the rule (as the ledger holds two signed by gate.horizonshield.dev about api.babyblueviper.com,
// entries 45 and 47, counted true) are read back and batched unchanged: the rule is applied at POST only.
reset();
const old = {
  sha: H("6"), record_canonical: "{}", signed: true, public_key_ed25519_b64: PUB, signature_ed25519_b64: "sig",
  signed_domain: "gate.horizonshield.dev", key_url: "https://gate.horizonshield.dev/keys/witness.json",
  mode: "full", v11: true, disclaimer_present: true, endpoint: "https://api.babyblueviper.com", counted: true, count_reason: null,
  purpose: "a2a-conduct-walk-v1: https://api.babyblueviper.com", witness_name: "HORIZON SHIELD", vantage: "test", submitted_at: "2026-09-16T10:00:00.000Z",
};
await env.LEDGER.put("wit:pending:" + old.sha, JSON.stringify(old));
let g = await getJ("/witness/" + old.sha);
chk("a record stored before the rule reads back exactly as stored", JSON.stringify(g) === JSON.stringify({ status: "pending", ...old, responses: g.responses }) && g.counted === true, JSON.stringify(g).slice(0, 300));
pool = await getJ("/witness/pending");
chk("the pool lists it as counted, with its signed_domain", pool.count === 1 && pool.counted === 1 && pool.pending[0].sha === old.sha && pool.pending[0].counted === true && pool.pending[0].signed_domain === "gate.horizonshield.dev", JSON.stringify(pool).slice(0, 300));
a = await worker.fetch(new Request(ORIGIN + "/witness/anchor", { method: "POST", headers: { "x-ledger-key": "t".repeat(64) } }), env, { waitUntil() {} });
aj = await a.json();
n = Number(await env.LEDGER.get("seq"));
entry = JSON.parse((await env.LEDGER.get("entry:" + n)) || (await env.LEDGER.get("e:" + n)) || "null");
const batchText = entry ? String(entry.record_canonical || entry.claim || "") : "";
chk("the daily batch carries it as before: signed_domain, no counted field",
  a.status === 201 && aj.anchored === 1 && batchText.includes('{"sha":"' + old.sha + '","purpose":"a2a-conduct-walk-v1: https://api.babyblueviper.com","witness_name":"HORIZON SHIELD","vantage":"test","signed":true,"signed_domain":"gate.horizonshield.dev"}'),
  a.status + " " + batchText.slice(0, 400));
g = await getJ("/witness/" + old.sha);
chk("after the batch it reads back anchored, the stored record unchanged", g.status === "anchored" && JSON.stringify(g.record) === JSON.stringify(old), JSON.stringify(g).slice(0, 300));

// 7. GET /witness states the rule.
const info = JSON.stringify(await getJ("/witness"));
chk("GET /witness names the four domains and both outcomes",
  info.includes("horizonshield.dev, the-horizons-innovation.com, ogasurfproject-jpg.github.io, oga-surf-project.workers.dev and every name under them") &&
  info.includes("count_reason: operator"), "");

chk("the cases ran: " + nRefused + " refused, " + nOperator + " operator, " + nTaken + " taken",
  OUR_KEYS.length === 16 && nRefused === 16 * 8 && nOperator === 16 * 3 && nTaken === 14 * 5);
process.exit(chk.done() ? 1 : 0);
