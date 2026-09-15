// test/witness_networks.test.mjs (2026-09-15)
// Distinct submitter networks per day on GET /witness (distinct_submitter_networks).
// Proves: POST /witness and POST /a2a leave one mark per (UTC day, network: IPv4 /24 or IPv6 /48);
// GET faces and requests without cf-connecting-ip leave none; no address or prefix lands in KV;
// the report counts today live and freezes yesterday; the 00:30 UTC schedule freezes yesterday too;
// a broken KV never changes the answer of the face itself. Does not prove real TTL expiry or KV
// consistency. Offline: fetch is stubbed (anchorWitnessPool's OTS side is not exercised).
// Run: node test/witness_networks.test.mjs   (in workers/hs-ledger)

import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger witness networks");
const ORIGIN = "https://ledger.horizonshield.dev";
const FORBIDDEN = new RegExp("[" + [0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D, 0x2500].map((c) => String.fromCharCode(c)).join("") + "]");
globalThis.fetch = async () => { throw new Error("offline test: no network"); };

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const canon = (o) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
const SHA = "a".repeat(64);
const walk = () => ({
  schema: "jidec-path-v1", purpose: "a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp",
  walked_at: "2026-09-15T01:00:00Z", base: "https://mcp.horizonshield.dev",
  witness: { name: "Net Test Witness", vantage: "test" },
  nodes: [{ id: "n0", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/.well-known/agent-card.json", method: "GET" }, response: { status: 200, body_sha256: SHA } }],
  assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"] }],
  verdict: { ok: true, outcome: "PASS", n_pass: 1, n_total: 1 },
});

let kvMock = mockKV([["seq", "40"]]);
let env = { LEDGER: kvMock.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
function ctx() { const ps = []; return { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => {})); }, drain: () => Promise.all(ps) }; }
async function hit(path, method, body, ip) {
  const c = ctx();
  const headers = { "content-type": "application/json" };
  if (ip) headers["cf-connecting-ip"] = ip;
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body }), env, c);
  await c.drain();
  return res;
}
const postWitness = (ip, salt) => hit("/witness", "POST", JSON.stringify({ record_canonical: canon({ ...walk(), walked_at: "2026-09-15T01:00:" + String(salt || 0).padStart(2, "0") + "Z" }) }), ip);
const postA2A = (ip) => hit("/a2a", "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "hello" }] } } }), ip);
const marks = (face) => [...kvMock.store.keys()].filter((k) => k.startsWith("wit:net:" + today + ":" + face + ":")).length;

// 1. POST /witness marks the network; the same /24 stays one.
let r = await postWitness("203.0.113.7", 1);
chk("POST /witness answers (201 or a stated refusal, never a 5xx)", r.status < 500, String(r.status));
chk("first network: all 1, witness 1", marks("all") === 1 && marks("witness") === 1, marks("all") + "/" + marks("witness"));
await postWitness("203.0.113.200", 2);
chk("same /24 stays 1", marks("all") === 1, String(marks("all")));
await postWitness("198.51.100.9", 3);
chk("a second /24 makes 2", marks("all") === 2, String(marks("all")));
await postWitness("2001:db8:1::1", 4);
await postWitness("2001:db8:1:ffff::9", 5);
chk("one IPv6 /48 makes 3, not 4", marks("all") === 3, String(marks("all")));

// 2. POST /a2a counts; GET faces and header-less requests do not.
r = await postA2A("192.0.2.5");
chk("POST /a2a answers", r.status === 200, String(r.status));
chk("a2a from a new network: all 4, a2a 1", marks("all") === 4 && marks("a2a") === 1, marks("all") + "/" + marks("a2a"));
await hit("/witness", "GET", undefined, "198.18.0.1");
await hit("/witness/pending", "GET", undefined, "198.18.1.1");
await hit("/health", "GET", undefined, "198.18.2.1");
await hit("/a2a", "GET", undefined, "198.18.3.1");
chk("GET faces do not count", marks("all") === 4, String(marks("all")));
await postWitness(null, 6);
await postWitness("::ffff:203.0.113.7", 7);
chk("no header / IPv4-mapped: not counted", marks("all") === 4, String(marks("all")));

// 3. Nothing identifying in KV.
const dump = [...kvMock.store.entries()].map(([k, v]) => k + "=" + v).join("\n");
// The pending records themselves carry no address; the only 203.0.113 in the store would be a leak.
chk("no address or prefix in any KV key or value", !/203\.0\.113|198\.51\.100|192\.0\.2|2001:db8|2001:0db8/i.test(dump));
chk("marks are hashes under a face", [...kvMock.store.keys()].filter((k) => k.startsWith("wit:net:")).every((k) => /^wit:net:\d{4}-\d{2}-\d{2}:(all|witness|a2a):[0-9a-f]{32}$/.test(k)));
chk("the existing per-address lane and pool are untouched in shape", [...kvMock.store.keys()].some((k) => k.startsWith("wit:ip:")) && [...kvMock.store.keys()].some((k) => k.startsWith("wit:pending:")));

// 4. GET /witness carries the report.
r = await hit("/witness", "GET", undefined, null);
const d = await r.json();
chk("GET /witness still describes the intake", r.status === 200 && typeof d.how_to_submit === "string" && d.limits_stated_not_hidden);
const net = d.distinct_submitter_networks;
chk("distinct_submitter_networks present", !!net && net.counting_since === "2026-09-15" && net.faces && net.faces.witness === "POST /witness");
const d0 = net && net.by_day && net.by_day[0];
chk("today: 4 networks so_far, witness 3, a2a 1", !!d0 && d0.day === today && d0.state === "so_far" && d0.networks === 4 && d0.by_face.witness === 3 && d0.by_face.a2a === 1, JSON.stringify(d0));
const d1 = net && net.by_day && net.by_day[1];
if (yesterday >= "2026-09-15") chk("yesterday frozen at 0 when read", !!d1 && d1.state === "frozen" && d1.networks === 0, JSON.stringify(d1));
else chk("yesterday predates counting_since: null (first day only)", !!d1 && d1.state === "not_counted_yet" && d1.networks === null, JSON.stringify(d1));
chk("says not people, no IP stored", /Not people/.test(net.what_this_is_not) && /No IP address is stored/.test(net.privacy));
chk("no forbidden dashes", !FORBIDDEN.test(JSON.stringify(d)));

// 5. Read a day later: today is frozen at 4, the new day starts at 0.
{
  const realNow = Date.now;
  Date.now = () => realNow() + 86400000;
  try {
    const rr = await hit("/witness", "GET", undefined, null);
    const dd = await rr.json();
    const y = dd.distinct_submitter_networks.by_day[1];
    chk("a day later: today frozen at 4", !!y && y.day === today && y.state === "frozen" && y.networks === 4, JSON.stringify(y));
    chk("the new day starts at 0", dd.distinct_submitter_networks.by_day[0].networks === 0, JSON.stringify(dd.distinct_submitter_networks.by_day[0]));
  } finally { Date.now = realNow; }
  chk("frozen row stored", !!kvMock.store.get("wit:netcount:" + today));
}

// 6. The schedule freezes yesterday on its own, and never recomputes a frozen day.
{
  const kv2 = mockKV([["seq", "40"]]);
  const env2 = { LEDGER: kv2.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
  await kv2.binding.put("wit:net:" + yesterday + ":all:" + "ab".repeat(16), "1");
  await kv2.binding.put("wit:net:" + yesterday + ":witness:" + "ab".repeat(16), "1");
  await kv2.binding.put("wit:net:" + yesterday + ":all:" + "cd".repeat(16), "1");
  await kv2.binding.put("wit:net:" + yesterday + ":a2a:" + "cd".repeat(16), "1");
  try { await worker.scheduled({ cron: "30 0 * * *" }, env2, ctx()); } catch (_e) { /* the pool side may fail offline; freeze must not depend on it */ }
  const f = JSON.parse(kv2.store.get("wit:netcount:" + yesterday) || "null");
  chk("scheduled froze yesterday: 2 networks, witness 1, a2a 1", !!f && f.networks === 2 && f.by_face.witness === 1 && f.by_face.a2a === 1, JSON.stringify(f));
  await kv2.binding.put("wit:net:" + yesterday + ":all:" + "ef".repeat(16), "1");
  try { await worker.scheduled({ cron: "30 0 * * *" }, env2, ctx()); } catch (_e) { /* same */ }
  const f2 = JSON.parse(kv2.store.get("wit:netcount:" + yesterday) || "null");
  chk("a frozen day is not recomputed", !!f2 && f2.networks === 2, JSON.stringify(f2));
}

// 7. A broken KV never changes the face's answer.
{
  const bad = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); }, list: async () => { throw new Error("kv down"); }, delete: async () => {} };
  const env3 = { LEDGER: bad, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
  const c = ctx();
  const rr = await worker.fetch(new Request(ORIGIN + "/a2a", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "hello" }] } } }) }), env3, c);
  await c.drain();
  chk("/a2a answers 200 while the counter's KV is down", rr.status === 200, String(rr.status));
  const g = await worker.fetch(new Request(ORIGIN + "/witness"), env3, ctx());
  const gj = await g.json().catch(() => null);
  chk("GET /witness says unreadable, not zero, when KV is down", g.status === 200 && gj && gj.distinct_submitter_networks && (gj.distinct_submitter_networks.error === "unreadable" || (gj.distinct_submitter_networks.by_day && gj.distinct_submitter_networks.by_day[0].state === "unreadable")), gj && JSON.stringify(gj.distinct_submitter_networks).slice(0, 200));
}

process.exit(chk.done() ? 1 : 0);
