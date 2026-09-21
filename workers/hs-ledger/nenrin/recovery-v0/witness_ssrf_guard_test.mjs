// RUN_ALL: suite
// witness_ssrf_guard の採点。network 無し (resolver は表を引く偽物)。
// 緑の意味: 内側の番地の表が正しく、名前が一つでも内側を指したら断り、pin 付き fetch が繋ぐ前に断る、それだけ。実 DNS と実 TLS は見とらん。
import { isBlockedIp, makeSafeLookup, resolveAllowed, makeSafeFetch } from "./witness_ssrf_guard.mjs";

let pass = 0, fail = 0; const results = [];
function t(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  <- " + String(detail).slice(0, 200))); }

// ---- 1. 番地の表 ----
const BLOCKED = [
  "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255",
  "0.0.0.0", "255.255.255.255", "224.0.0.1", "198.18.0.5", "192.0.0.9", "192.0.2.1", "198.51.100.7", "203.0.113.9",
  "::1", "::", "fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "64:ff9b::10.0.0.1", "2001:db8::1",
  "not-an-ip", "192.168.0.256", "1.2.3", "", "example.com",
];
const ALLOWED = [
  "1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "198.17.255.255", "198.20.0.1", "223.255.255.255",
  "2606:2800:220:1:248:1893:25c8:1946", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::8.8.8.8",
];
for (const ip of BLOCKED) t("blocked: " + JSON.stringify(ip), isBlockedIp(ip) === true);
for (const ip of ALLOWED) t("allowed: " + ip, isBlockedIp(ip) === false);

// ---- 2. resolve, refuse (偽の resolver) ----
const fakeDns = (table) => (host, opts, cb) => { const a = table[host]; if (!a) return cb(Object.assign(new Error("ENOTFOUND " + host), { code: "ENOTFOUND" })); cb(null, a.map((ip) => ({ address: ip, family: ip.includes(":") ? 6 : 4 }))); };
const table = {
  "mixed.test": ["1.1.1.1", "10.0.0.5"],
  "meta.test": ["169.254.169.254"],
  "loop.test": ["::ffff:127.0.0.1"],
  "good.test": ["1.1.1.1"],
  "v6good.test": ["2606:2800:220:1:248:1893:25c8:1946"],
  "two.test": ["1.1.1.1", "8.8.8.8"],
};
const lk = makeSafeLookup(fakeDns(table));
const lookupP = (h, o) => new Promise((res) => lk(h, o, (e, a, f) => res({ e, a, f })));
let r;
r = await lookupP("mixed.test", { all: true });   t("lookup: public and private mixed is refused (any blocked address refuses)", r.e && r.e.code === "EBLOCKED", JSON.stringify(r));
r = await lookupP("meta.test", { all: true });    t("lookup: metadata address is refused", r.e && r.e.code === "EBLOCKED");
r = await lookupP("loop.test", { all: true });    t("lookup: mapped loopback ::ffff:127.0.0.1 is refused", r.e && r.e.code === "EBLOCKED");
r = await lookupP("good.test", { all: true });    t("lookup: public address passes and is handed to the socket (all)", !r.e && r.a && r.a[0].address === "1.1.1.1", JSON.stringify(r));
r = await lookupP("good.test", {});               t("lookup: public address passes (single form: address, family)", !r.e && r.a === "1.1.1.1" && r.f === 4, JSON.stringify(r));
r = await lookupP("v6good.test", { all: true });  t("lookup: public IPv6 passes", !r.e && r.a && r.a[0].address.startsWith("2606:"));
r = await lookupP("nope.test", { all: true });    t("lookup: unresolvable name errors (fail closed)", !!r.e && r.e.code === "ENOTFOUND");
r = await lookupP("two.test", { all: true });     t("lookup: several public addresses all pass through", !r.e && r.a.length === 2);
r = await resolveAllowed("mixed.test", fakeDns(table));  t("resolveAllowed: declines and names the blocked address", !r.ok && /10\.0\.0\.5/.test(r.why), JSON.stringify(r));
r = await resolveAllowed("good.test", fakeDns(table));   t("resolveAllowed: passes a public name with its addresses", r.ok && r.addresses[0] === "1.1.1.1");
r = await resolveAllowed("nope.test", fakeDns(table));   t("resolveAllowed: unresolvable declines with the code", !r.ok && /ENOTFOUND/.test(r.why), JSON.stringify(r));

// ---- 3. pin (fetch が繋ぐ前に断る) ----
const sf = makeSafeFetch({ resolver: fakeDns(table), timeoutMs: 2000 });
const rejects = async (p) => { try { await p; return null; } catch (e) { return e; } };
let e;
e = await rejects(sf("https://meta.test/latest/meta-data/"));  t("safeFetch: a name resolving to metadata is refused at connect (EBLOCKED)", e && e.code === "EBLOCKED", e && e.message);
e = await rejects(sf("https://mixed.test/"));                   t("safeFetch: a name with one private address among public ones is refused", e && e.code === "EBLOCKED", e && e.message);
e = await rejects(sf("http://good.test/x"));                    t("safeFetch: plain http is refused (EPROTO)", e && e.code === "EPROTO", e && e.message);
e = await rejects(sf("https://good.test:8443/x"));              t("safeFetch: an explicit non-443 port is refused (EPORT)", e && e.code === "EPORT", e && e.message);
e = await rejects(sf("not a url"));                             t("safeFetch: a non-URL rejects", !!e);
e = await rejects(sf("https://nope.test/"));                    t("safeFetch: an unresolvable name rejects (ENOTFOUND)", e && e.code === "ENOTFOUND", e && e.message);
{ const ac = new AbortController(); ac.abort(); e = await rejects(sf("https://good.test/", { signal: ac.signal })); t("safeFetch: an already aborted signal rejects before any socket", !!e, e && e.message); }

console.log(results.join("\n"));
console.log("witness_ssrf_guard_test: " + pass + " / " + (pass + fail) + (fail ? "  FAIL" : "  ok"));
process.exit(fail ? 1 : 0);
