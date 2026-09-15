// usage_networks.test.mjs (2026-09-15): distinct requester networks per day on /usage.
//
// What it proves: the three measuring faces (POST /check, POST /a2a, MCP check_conformance) count
// one mark per (day, network) where a network is an IPv4 /24 or IPv6 /48; read-only faces do not
// count; a request without cf-connecting-ip is not counted; no IP or prefix ever lands in KV
// (keys or values); the day's figure is a running one and the previous day gets frozen by the
// cron before its marks expire; a counting failure never touches the answer of the face itself.
// What it does not prove: real KV consistency, real TTL expiry, the salt race at the day boundary.
// Offline. fetch is stubbed to fail so /check and the MCP tool answer without the network.
// Run: node test/usage_networks.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";

const FORBIDDEN = new RegExp("[" + [0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D, 0x2500].map((c) => String.fromCharCode(c)).join("") + "]");
let fails = 0, n = 0;
const t = (ok, msg, extra) => { n++; console.log((ok ? "ok   " : "FAIL ") + n + ". " + msg + (ok ? "" : ("   " + (extra || "")))); if (!ok) fails++; };

// KV mock with list (prefix, cursor ignored: everything at once) and a raw view of the store.
function kv() {
  const store = new Map();
  const api = {
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
  return api;
}
// ctx that lets the test wait for the counting work the worker put behind the response.
function ctx() { const ps = []; return { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => {})); }, drain: () => Promise.all(ps) }; }

globalThis.fetch = async () => { throw new Error("offline test: no network"); };

const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "t", GATE_COMMIT: "local" };
const ORIGIN = "https://gate.horizonshield.dev";
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function hit(path, opts, ip) {
  const c = ctx();
  const headers = Object.assign({ "content-type": "application/json" }, (opts && opts.headers) || {});
  if (ip) headers["cf-connecting-ip"] = ip;
  const r = await worker.fetch(new Request(ORIGIN + path, { method: (opts && opts.method) || "GET", headers, body: opts && opts.body }), env, c);
  await c.drain();
  return r;
}
const check = (ip) => hit("/check", { method: "POST", body: JSON.stringify({ endpoint: "https://open.redteam.invalid/mcp" }) }, ip);
const a2a = (ip) => hit("/a2a", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "https://open.redteam.invalid/mcp" }] } } }) }, ip);
const mcp = (name, ip) => hit("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: name === "check_conformance" ? { endpoint: "https://open.redteam.invalid/mcp" } : {} } }) }, ip);
const marks = (face) => [...env.HS_VERIFY_KV.store.keys()].filter((k) => k.startsWith("usage:net:" + today + ":" + face + ":")).length;

// ---- 1. /check counts one mark per /24 -----------------------------------------------------------
let r = await check("203.0.113.7");
t(r.status === 200 || r.status === 500, "/check still answers with the network stubbed away", String(r.status));
t(marks("all") === 1 && marks("check") === 1, "first network from /check: all 1, check 1", marks("all") + "/" + marks("check"));
await check("203.0.113.99");
t(marks("all") === 1, "same /24 again is still 1 (a busy operator stays one network)", String(marks("all")));
await check("203.0.113.7");
t(marks("all") === 1, "same address again is still 1", String(marks("all")));
await check("198.51.100.1");
t(marks("all") === 2 && marks("check") === 2, "a different /24 is 2", marks("all") + "/" + marks("check"));

// ---- 2. IPv6 counts per /48 -----------------------------------------------------------------------
await check("2001:db8:abcd::1");
await check("2001:db8:abcd:ffff:1:2:3:4");
t(marks("all") === 3, "two IPv6 addresses in one /48 are one network", String(marks("all")));
await check("2001:DB8:BEEF::1");
t(marks("all") === 4, "another /48 is another network (case does not split it)", String(marks("all")));
await check("2001:db8:abcd::1%eth0");
t(marks("all") === 4, "a zone id does not make a new network", String(marks("all")));

// ---- 3. no header, malformed header: not counted, face still answers -------------------------------
await check(null);
t(marks("all") === 4, "no cf-connecting-ip: not counted", String(marks("all")));
await check("not-an-address");
await check("::ffff:203.0.113.7");
t(marks("all") === 4, "malformed and IPv4-mapped addresses are dropped, not guessed", String(marks("all")));

// ---- 4. faces: a2a and mcp count, read-only faces do not ----------------------------------------------
r = await a2a("203.0.113.7");
t(r.status === 200, "/a2a answers", String(r.status));
t(marks("all") === 4 && marks("a2a") === 1, "a2a from a known network: all stays 4, a2a 1", marks("all") + "/" + marks("a2a"));
r = await mcp("check_conformance", "192.0.2.1");
t(r.status === 200, "MCP check_conformance answers", String(r.status));
t(marks("all") === 5 && marks("mcp") === 1, "MCP check_conformance from a new network: all 5, mcp 1", marks("all") + "/" + marks("mcp"));
await mcp("get_conditions", "198.18.0.1");
await hit("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }, "198.18.1.1");
t(marks("all") === 5, "get_conditions and tools/list do not count", String(marks("all")));
await hit("/spec", {}, "198.18.2.1");
await hit("/is-verified?endpoint=" + encodeURIComponent("https://open.redteam.invalid/mcp"), {}, "198.18.3.1");
await hit("/usage", {}, "198.18.4.1");
await hit("/a2a", {}, "198.18.5.1");
t(marks("all") === 5, "/spec, /is-verified, /usage and GET /a2a do not count", String(marks("all")));

// ---- 5. nothing identifying in KV ----------------------------------------------------------------
const dump = [...env.HS_VERIFY_KV.store.entries()].map(([k, v]) => k + "=" + v).join("\n");
t(!/203\.0\.113|198\.51\.100|192\.0\.2|2001:db8|2001:0db8|abcd|beef/i.test(dump), "no address or prefix appears in any KV key or value");
const salt = env.HS_VERIFY_KV.store.get("usage:netsalt:" + today);
t(typeof salt === "string" && /^[0-9a-f]{32}$/.test(salt), "the day's salt exists and is 32 hex", String(salt));
const markKeys = [...env.HS_VERIFY_KV.store.keys()].filter((k) => k.startsWith("usage:net:" + today + ":"));
t(markKeys.every((k) => /^usage:net:\d{4}-\d{2}-\d{2}:(all|check|a2a|mcp):[0-9a-f]{32}$/.test(k)), "marks are 32-hex hashes under a face", markKeys[0]);

// ---- 6. /usage reports the day, freezes yesterday, keeps the old fields ------------------------------
r = await hit("/usage", {}, null);
const u = await r.json();
t(r.status === 200 && u.totals && typeof u.totals.external_checks === "number", "/usage keeps its original fields");
const net = u.distinct_requester_networks;
t(!!net && net.counting_since === "2026-09-15" && net.faces && net.faces.mcp, "distinct_requester_networks block present with faces");
const d0 = net && net.by_day && net.by_day[0];
t(!!d0 && d0.day === today && d0.state === "so_far" && d0.networks === 5, "today is a running figure of 5", JSON.stringify(d0));
t(!!d0 && d0.by_face && d0.by_face.check === 4 && d0.by_face.a2a === 1 && d0.by_face.mcp === 1, "by_face check 4 / a2a 1 / mcp 1", JSON.stringify(d0 && d0.by_face));
const d1 = net && net.by_day && net.by_day[1];
if (yesterday >= "2026-09-15") {
  t(!!d1 && d1.day === yesterday && d1.state === "frozen" && d1.networks === 0, "yesterday (no marks) is frozen at 0 when read", JSON.stringify(d1));
  t(!!env.HS_VERIFY_KV.store.get("usage:netcount:" + yesterday), "the frozen count for yesterday is stored");
} else {
  // Only on the first day of counting: yesterday predates counting_since and must say so, not 0.
  t(!!d1 && d1.day === yesterday && d1.state === "not_counted_yet" && d1.networks === null, "yesterday predates counting_since: null, not_counted_yet (first day only)", JSON.stringify(d1));
  t(!env.HS_VERIFY_KV.store.get("usage:netcount:" + yesterday), "nothing frozen for a day before counting_since (first day only)");
}
const dOld = net && net.by_day && net.by_day.find((x) => x.day < "2026-09-15");
t(!dOld || (dOld.networks === null && dOld.state === "not_counted_yet"), "days before counting_since are null, not zero", JSON.stringify(dOld));
t(/Not people/.test(net.what_this_is_not) && /No IP address is stored/.test(net.privacy), "the block says what it is not and what it does not store");
t(!FORBIDDEN.test(JSON.stringify(u)), "no forbidden dashes in /usage");

// ---- 6b. reading /usage tomorrow freezes today's figure (marks still alive, count fixed) -------------------
{
  const realNow = Date.now;
  Date.now = () => realNow() + 86400000;
  try {
    const rr = await hit("/usage", {}, null);
    const uu = await rr.json();
    const y = uu.distinct_requester_networks.by_day[1];
    t(!!y && y.day === today && y.state === "frozen" && y.networks === 5 && y.by_face.check === 4, "read a day later: today is frozen at 5", JSON.stringify(y));
    const t0 = uu.distinct_requester_networks.by_day[0];
    t(!!t0 && t0.state === "so_far" && t0.networks === 0, "the new day starts at 0 (a new salt, no carry over)", JSON.stringify(t0));
  } finally { Date.now = realNow; }
  const fz = await env.HS_VERIFY_KV.get("usage:netcount:" + today, "json");
  t(!!fz && fz.networks === 5 && typeof fz.frozen_at === "string", "the frozen row for today is stored with frozen_at", JSON.stringify(fz));
}

// ---- 7. the cron freezes yesterday even when /usage was never read ---------------------------------------
const env2 = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "t", GATE_COMMIT: "local" };
await env2.HS_VERIFY_KV.put("usage:net:" + yesterday + ":all:" + "ab".repeat(16), "1");
await env2.HS_VERIFY_KV.put("usage:net:" + yesterday + ":check:" + "ab".repeat(16), "1");
await env2.HS_VERIFY_KV.put("usage:net:" + yesterday + ":all:" + "cd".repeat(16), "1");
await env2.HS_VERIFY_KV.put("usage:net:" + yesterday + ":a2a:" + "cd".repeat(16), "1");
const c2 = ctx();
try { await worker.scheduled({ cron: "0 18 * * *" }, env2, c2); } catch (_e) { /* the sweep itself may fail offline; the freeze must not depend on it */ }
await c2.drain();
const frozen = await env2.HS_VERIFY_KV.get("usage:netcount:" + yesterday, "json");
t(!!frozen && frozen.networks === 2 && frozen.by_face.check === 1 && frozen.by_face.a2a === 1 && frozen.by_face.mcp === 0, "scheduled froze yesterday: 2 networks, check 1, a2a 1, mcp 0", JSON.stringify(frozen));
await env2.HS_VERIFY_KV.put("usage:net:" + yesterday + ":all:" + "ef".repeat(16), "1");
const c3 = ctx();
try { await worker.scheduled({ cron: "0 18 * * *" }, env2, c3); } catch (_e) { /* same */ }
await c3.drain();
const frozen2 = await env2.HS_VERIFY_KV.get("usage:netcount:" + yesterday, "json");
t(!!frozen2 && frozen2.networks === 2, "a frozen day is not recomputed (first freeze wins)", JSON.stringify(frozen2));

// ---- 8. a broken KV never touches the face's answer -----------------------------------------------------
const env3 = { HS_VERIFY_KV: Object.assign(kv(), { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); }, list: async () => { throw new Error("kv down"); } }), SWEEP_TOKEN: "t", GATE_COMMIT: "local" };
const c4 = ctx();
const r4 = await worker.fetch(new Request(ORIGIN + "/a2a", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "https://open.redteam.invalid/mcp" }] } } }) }), env3, c4);
await c4.drain();
t(r4.status === 200, "/a2a answers 200 while the counter's KV is down", String(r4.status));
const r5 = await worker.fetch(new Request(ORIGIN + "/usage"), env3, ctx());
const u5 = await r5.json().catch(() => null);
t(r5.status === 200 && u5 && u5.distinct_requester_networks && u5.distinct_requester_networks.by_day[0].state === "unreadable", "/usage says unreadable, not zero, when KV is down", u5 && JSON.stringify(u5.distinct_requester_networks && u5.distinct_requester_networks.by_day[0]));

console.log("");
console.log(fails === 0 ? ("=== " + n + " / " + n + " 合格 (usage_networks) ===") : ("=== " + (n - fails) + " / " + n + " 通過、" + fails + " 不合格 (usage_networks) ==="));
process.exit(fails === 0 ? 0 : 1);
