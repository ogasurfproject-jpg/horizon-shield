// seki_bodycap.test.mjs (2026-12-02, deploy order 3): a /report body over SEKI_BODY_MAX_BYTES for a store a SEKI door guards
// is answered 413 body_too_long before the door is asked and before anything is spent, and nothing is logged; a body at the
// limit goes on as before; a store the door does not guard is untouched. The ticket ledger is the real TicketLedgerDO over an
// in-memory SQL stub (as seki.test.mjs); the door, hs-pdf-gen and the ledger binding are stubs that count calls.
import worker from "../src/index.js";
import { TicketLedgerDO } from "../src/ticket_do.js";
import { SEKI_STORES, SEKI_BODY_MAX_BYTES, canonical } from "../src/seki.js";

var pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name + (detail === undefined ? "" : "   <<< " + JSON.stringify(detail).slice(0, 300))); } }

function sqlStub() {
  var bal = new Map(), seen = new Map();
  var none = { toArray() { return []; } };
  return { exec(q) {
    var args = Array.prototype.slice.call(arguments, 1), s = q.replace(/\s+/g, " ").trim();
    if (s.startsWith("CREATE TABLE")) return none;
    if (s.startsWith("SELECT tickets FROM bal WHERE store = ?")) return { toArray() { return bal.has(args[0]) ? [{ tickets: bal.get(args[0]) }] : []; } };
    if (s.startsWith("INSERT INTO bal")) { bal.set(args[0], args[1]); return none; }
    if (s.startsWith("SELECT store, delta, at FROM seen WHERE kind = ? AND ref = ?")) { var k = args[0] + "|" + args[1]; return { toArray() { return seen.has(k) ? [seen.get(k)] : []; } }; }
    if (s.startsWith("INSERT OR IGNORE INTO seen")) { var kk = args[0] + "|" + args[1]; if (!seen.has(kk)) seen.set(kk, { kind: args[0], ref: args[1], store: args[2], delta: args[3], at: args[4] }); return none; }
    if (s.indexOf("SUM(tickets)") > -1) { var sum = 0; bal.forEach(function (v) { sum += Number(v); }); return { toArray() { return [{ s: sum }]; } }; }
    if (s.startsWith("DELETE FROM seen")) return none;
    throw new Error("stub: unhandled SQL: " + s);
  } };
}

var SALT = "test-salt";
async function tok(store) {
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SALT), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("hs-gateway-store:" + store));
  return Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function j(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } }); }
function makeEnv() {
  var d = new TicketLedgerDO({ storage: { sql: sqlStub() } }, {});
  var c = { pdf: 0, door: 0, ledger: 0 };
  var env = {
    ADMIN_KEY: "test-admin",
    GATEWAY_STORE_SALT: SALT,
    TICKETS_DO: { idFromName: function () { return "v1"; }, get: function () { return { fetch: function (u, init) { return d.fetch(new Request(u, init)); } }; } },
    PDFGEN_SVC: { fetch: async function () { c.pdf++; return new Response("%PDF-1.7 stub", { headers: { "Content-Type": "application/pdf" } }); } },
    SEKI_SVC: { fetch: async function () { c.door++; return j({ applies: true, ok: true, decision: "admit", admission_sha256: "a".repeat(64), record_sha256: "b".repeat(64), published: { accepted: true } }); } },
    LEDGER_SVC: { fetch: async function () { c.ledger++; return j({ ok: true }); } }
  };
  return { env: env, c: c };
}
async function grant(env, store, n) { return (await worker.fetch(new Request("https://gw/admin/grant?store=" + store + "&tickets=" + n, { headers: { "X-Admin-Key": "test-admin" } }), env, {})).json(); }
async function balance(env, store) { return (await worker.fetch(new Request("https://gw/balance?store=" + store, { headers: { "x-store-token": await tok(store) } }), env, {})).json(); }
// body: a string; how: "length" (Content-Length set), "stream" (no Content-Length), "lie" (Content-Length 100, longer stream)
async function report(env, store, body, how, token) {
  var bytes = new TextEncoder().encode(body);
  var headers = { "Content-Type": "application/json", "x-store-token": token === undefined ? await tok(store) : token };
  var init = { method: "POST", headers: headers };
  if (how === "length") { headers["Content-Length"] = String(bytes.length); init.body = bytes; }
  else {
    if (how === "lie") headers["Content-Length"] = "100";
    init.body = new ReadableStream({ start(ctl) { for (var i = 0; i < bytes.length; i += 4096) ctl.enqueue(bytes.slice(i, i + 4096)); ctl.close(); } });
    init.duplex = "half";
  }
  return worker.fetch(new Request("https://gw/report?store=" + store + "&service=report", init), env, {});
}
var G = SEKI_STORES[0];
function guardedBody(note) { var P = { koji_type: "gaiheki_30tsubo", teiji_kingaku: 1200000, note: note }; return JSON.stringify(Object.assign({}, P, { seki: { action_request: { nonce: "11".repeat(16) }, presentation: [], content: P } })); }
// a guarded body of exactly n bytes (the note is in it twice, so the length moves by 2 for each character; a space at the end
// makes up the last byte)
function guardedOf(n) { var L = function (x) { return new TextEncoder().encode(x).length; }, b = guardedBody("x".repeat(Math.floor((n - L(guardedBody(""))) / 2))); return b + " ".repeat(n - L(b)); }   // JSON allows the space at the end

ok("SEKI_BODY_MAX_BYTES is 65536", SEKI_BODY_MAX_BYTES === 65536, SEKI_BODY_MAX_BYTES);
var logs = [], keep = console.log;
async function quiet(f) { logs = []; console.log = function () { logs.push([...arguments].join(" ")); }; try { return await f(); } finally { console.log = keep; } }

for (var [name, how, n] of [["declared over the limit (65537 bytes, Content-Length)", "length", 65537], ["streamed over the limit with no Content-Length (70000 bytes)", "stream", 70000], ["a Content-Length of 100 over a 70000 byte stream", "lie", 70000], ["far over the limit (1 MB)", "length", 1 << 20]]) {
  console.log("[" + name + "]");
  var e = makeEnv(); await grant(e.env, G, 100);
  var before = (await balance(e.env, G)).tickets;
  var body = "{\"note\":\"" + "x".repeat(n - 11) + "\"}";
  var r = await quiet(function () { return report(e.env, G, body, how); });
  var b = await r.json();
  ok("413 body_too_long, max_bytes 65536, spent 0", r.status === 413 && b.error === "body_too_long" && b.max_bytes === 65536 && b.spent === 0 && b.ok === false, [r.status, b]);
  ok("the door, hs-pdf-gen and the ledger binding were not called", e.c.door === 0 && e.c.pdf === 0 && e.c.ledger === 0, e.c);
  ok("no X-Tickets-Spent, no X-Seki header, and the balance is what it was (" + before + ")", r.headers.get("X-Tickets-Spent") === null && r.headers.get("X-Seki-Decision") === null && (await balance(e.env, G)).tickets === before);
  ok("nothing was logged", logs.length === 0, logs);
}

console.log("[characters are counted as bytes: 30000 kanji are 90000 bytes]");
var e2 = makeEnv(); await grant(e2.env, G, 100);
var r2 = await quiet(function () { return report(e2.env, G, guardedBody("漢".repeat(30000)), "length"); });
ok("413 body_too_long, the door not asked", r2.status === 413 && (await r2.json()).error === "body_too_long" && e2.c.door === 0, [r2.status, e2.c]);

console.log("[a body of exactly 65536 bytes goes on as before]");
var at = guardedOf(65536);
ok("the body is 65536 bytes and the payload is seki.content", new TextEncoder().encode(at).length === 65536 && (function () { var p = JSON.parse(at), s = p.seki; delete p.seki; return canonical(p) === canonical(s.content); })(), new TextEncoder().encode(at).length);
var e3 = makeEnv(); await grant(e3.env, G, 100);
var b3 = (await balance(e3.env, G)).tickets;
var r3 = await quiet(function () { return report(e3.env, G, at, "stream"); });
ok("200 with the PDF, the door asked once, hs-pdf-gen called once", r3.status === 200 && e3.c.door === 1 && e3.c.pdf === 1, [r3.status, e3.c, r3.status === 200 ? null : await r3.text()]);
ok("the tickets went down by the report's price", (await balance(e3.env, G)).tickets < b3);
var e3b = makeEnv(); await grant(e3b.env, G, 100);
var r3b = await quiet(function () { return report(e3b.env, G, guardedOf(65537), "length"); });
ok("one byte more (65537) is 413", r3b.status === 413 && e3b.c.door === 0, [r3b.status, e3b.c]);

console.log("[an ordinary guarded call (a 9000 character note) still reaches the door]");
var e4 = makeEnv(); await grant(e4.env, G, 100);
var r4 = await quiet(function () { return report(e4.env, G, guardedBody("x".repeat(9000)), "length"); });
ok("the door was asked (its own 8192 byte content limit is the door's to answer)", e4.c.door === 1 && r4.status === 200, [r4.status, e4.c]);

console.log("[the store token is still asked first]");
var e5 = makeEnv();
var r5 = await quiet(function () { return report(e5.env, G, "{\"note\":\"" + "x".repeat(70000) + "\"}", "length", "bad"); });
ok("a wrong token with a long body is 401 invalid_store_token, nothing called", r5.status === 401 && (await r5.json()).error === "invalid_store_token" && e5.c.door === 0 && e5.c.pdf === 0, r5.status);

console.log("[a store the door does not guard is untouched]");
var U = "hs-partner-002";
var e6 = makeEnv(); await grant(e6.env, U, 100);
var r6 = await quiet(function () { return report(e6.env, U, JSON.stringify({ koji_type: "gaiheki_30tsubo", note: "x".repeat(70000) }), "length"); });
ok("a 70000 byte body to an unguarded store goes to hs-pdf-gen as before, the door not asked", r6.status === 200 && e6.c.pdf === 1 && e6.c.door === 0, [r6.status, e6.c]);

console.log("[GET /health]");
var h = await (await worker.fetch(new Request("https://gw/health"), makeEnv().env, {})).json();
ok("/health says seki_body_max_bytes 65536 next to seki_content_match true", h.seki_body_max_bytes === 65536 && h.seki_content_match === true, [h.seki_body_max_bytes, h.seki_content_match]);

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (seki_bodycap)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (seki_bodycap: a guarded /report body over 65536 bytes is 413 before the door; nothing spent, called or logged)");
