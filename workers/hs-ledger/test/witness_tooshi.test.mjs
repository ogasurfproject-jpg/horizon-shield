// test/witness_tooshi.test.mjs (2026-11-03)
// A TOOSHI witness (tools/tooshi/tooshi_daily.py --witness) files its day_sha256 at POST /witness as an unsigned
// jidec-path-v1 commitment record, with no key. Proves: the record the tool makes is accepted as it is (201, mode
// commitment, unsigned, counted); the same bytes again are a dedup; a second record from the same name for the same day
// is stored, not counted; the networks of accepted TOOSHI records are counted under by_face.tooshi of
// distinct_submitter_networks, a refused record and an ordinary walk leave no tooshi mark, and the witness face counts
// every POST as before; the pool and the record read back carry the commitment. The records are fixed bytes made by
// tooshi_daily.py's witness_record (test/witness_tooshi.fixture.json). Offline: fetch is stubbed.
// Does not prove the 00:30 UTC batch or the Bitcoin stamp of these records.
// Run: node test/witness_tooshi.test.mjs   (in workers/hs-ledger)

import { readFileSync } from "node:fs";
import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger tooshi witness");
const ORIGIN = "https://ledger.horizonshield.dev";
globalThis.fetch = async () => { throw new Error("offline test: no network"); };
const FX = JSON.parse(readFileSync(new URL("./witness_tooshi.fixture.json", import.meta.url), "utf8"));
const today = new Date().toISOString().slice(0, 10);

const kvMock = mockKV([["seq", "40"]]);
const env = { LEDGER: kvMock.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
function ctx() { const ps = []; return { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => {})); }, drain: () => Promise.all(ps) }; }
async function hit(path, method, body, ip) {
  const c = ctx();
  const headers = { "content-type": "application/json" };
  if (ip) headers["cf-connecting-ip"] = ip;
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body }), env, c);
  await c.drain();
  return res;
}
const post = (rc, ip) => hit("/witness", "POST", JSON.stringify({ record_canonical: rc }), ip);
const marks = (face) => [...kvMock.store.keys()].filter((k) => k.startsWith("wit:net:" + today + ":" + face + ":")).length;

let r = await post(FX.a, "203.0.113.7");
let j = await r.json();
chk("the tool's record is accepted as it is: 201, commitment, unsigned, counted", r.status === 201 && j.mode === "commitment" && j.signed === false && j.counted === true, r.status + " " + JSON.stringify(j).slice(0, 200));
const shaA = j.sha;
chk("first TOOSHI network: tooshi 1, witness 1", marks("tooshi") === 1 && marks("witness") === 1, marks("tooshi") + "/" + marks("witness"));

r = await post(FX.a, "203.0.113.7"); j = await r.json();
chk("the same bytes again: dedup, nothing new", r.status === 200 && j.dedup === true && marks("tooshi") === 1, r.status + " " + JSON.stringify(j));

r = await post(FX.b, "203.0.113.7"); j = await r.json();
chk("the same name, the same day, another run: stored, not counted", r.status === 201 && j.counted === false && /same witness/.test(j.count_reason || ""), r.status + " " + JSON.stringify(j).slice(0, 200));

r = await post(FX.c, "198.51.100.9"); j = await r.json();
chk("another name from another network: counted, tooshi 2", r.status === 201 && j.counted === true && marks("tooshi") === 2, r.status + " " + marks("tooshi"));

const broken = JSON.parse(FX.c); delete broken.does_not_establish;
const brokenRc = JSON.stringify(Object.fromEntries(Object.keys(broken).sort().map((k) => [k, broken[k]])));
r = await post(brokenRc, "192.0.2.5"); j = await r.json();
chk("a TOOSHI record without does_not_establish is refused (422 disclaimer_missing)", r.status === 422 && j.reason_code === "disclaimer_missing", r.status + " " + JSON.stringify(j));
chk("the refused record: the witness face counts the POST, tooshi does not", marks("witness") === 3 && marks("tooshi") === 2, marks("witness") + "/" + marks("tooshi"));

const odd = JSON.parse(FX.c); odd.purpose = "tooshi-day-v0: " + odd.tooshi.day + " and more"; odd.witness = { name: "odd", vantage: "x" };
const oddRc = JSON.stringify(Object.fromEntries(Object.keys(odd).sort().map((k) => [k, odd[k]])));
r = await post(oddRc, "198.18.0.1");
chk("a purpose that only starts like tooshi-day-v0 is accepted as an ordinary record, not marked tooshi", r.status === 201 && marks("tooshi") === 2, r.status + " " + marks("tooshi"));

r = await hit("/witness", "GET", undefined, null); j = await r.json();
const net = j.distinct_submitter_networks;
chk("GET /witness names the tooshi face", net && net.faces && /tooshi-day-v0/.test(net.faces.tooshi || ""), JSON.stringify(net && net.faces));
chk("today's row: networks 4 (all), witness 4, tooshi 2", net.by_day[0].networks === 4 && net.by_day[0].by_face.witness === 4 && net.by_day[0].by_face.tooshi === 2, JSON.stringify(net.by_day[0]));

r = await hit("/witness/pending", "GET", undefined, null); j = await r.json();
const tp = j.pending.filter((x) => /^tooshi-day-v0: \d{4}-\d{2}-\d{2}$/.test(x.purpose));
chk("the pool lists the three TOOSHI records, two counted, mode commitment", tp.length === 3 && tp.filter((x) => x.counted).length === 2 && tp.every((x) => x.mode === "commitment"), JSON.stringify(tp));

r = await hit("/witness/" + shaA, "GET", undefined, null); j = await r.json();
const rec = JSON.parse(j.record_canonical);
chk("the record read back carries the day_sha256 as its commitment", j.status === "pending" && rec.commitment === FX.day_sha256 && rec.tooshi.day_sha256 === FX.day_sha256, JSON.stringify(j).slice(0, 200));
chk("no address or prefix in any KV key or value", !/203\.0\.113|198\.51\.100|192\.0\.2|198\.18\./.test([...kvMock.store.entries()].map(([k, v]) => k + "=" + v).join("\n")));

process.exit(chk.done() ? 1 : 0);
