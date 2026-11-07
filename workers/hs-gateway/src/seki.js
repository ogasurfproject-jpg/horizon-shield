// seki.js (hs-gateway): before a paid /report runs for a store a SEKI door guards, ask the door.
//
// SEKI (a2a-admission-v0) is the relying party's own door: an agent acting under a signed MUSUBI contract asks before
// it acts, and the door answers admit, escalate or refuse with a record it signs. The door's code is private and runs
// in its own worker (hs-seki-door), reached only through the service binding SEKI_SVC. What is public is the record:
// anyone checks it with admission_verify_v0 (pip install nenrin-verify) and settles the execution against it with
// settle v1.11 or v1.12 (workers/hs-ledger/nenrin/musubi-v0).
//
// What this file decides, and nothing more:
//   - which stores are guarded (SEKI_STORES). For those, a /report call runs only after the door said admit; every
//     other answer, and every failure to get an answer, is returned to the caller and nothing is spent (fail closed).
//   - the call as the door must see it: the service, the store, and the tickets the service costs (PRICES). The door
//     admits only a request signed for exactly that, so an admission for one service cannot carry another through.
//   - that the payload the door is shown is the payload that runs (2026-11-07, contentMatch below). The door reads
//     seki.content (and sends it to its content check where its policy requires the check); hs-pdf-gen is sent the
//     rest of the body. Before this, nothing compared the two, so a harmless seki.content could carry another payload
//     through. A guarded call runs only when canonical(the body without seki) equals canonical(seki.content); otherwise
//     the gateway answers 400 content_mismatch before the door is asked and before anything is spent.
// A store not in SEKI_STORES is untouched: the door is never asked and /report behaves as before.
// A guarded store is usable only through /report. MCP tools/call (gateway_ask) does not ask the door, so index.js refuses
// it for a guarded store before anything is called or spent, and the store token is never optional for a guarded store
// (audit 2026-10-10, F1 and F4).
//
// The first guarded store is a demonstration: The HORIZONs authorizes its own agent, at its own paid tool, so the
// records show the door working on a live paid path. It is not an outside party and is not counted as one.
export var SEKI_STORES = ["hs-seki-demo"];

// Tickets at a guarded store during the pilot (TOshi, 2026-10-10): the operator grants them free through /admin/grant and
// they carry no monetary value; no payment is taken for them. Commercial SEKI will be sold in US dollars and billed after
// use, decided but not built. Every guarded answer says which of the two it is, so a record of a spend is never read as a
// payment.
export var SEKI_TICKETS = {
  mode: "pilot",
  monetary_value: false,
  note: "During the pilot, tickets at a SEKI-guarded store are granted free by the operator and carry no monetary value. No payment is taken for them. Commercial SEKI will be priced in US dollars and billed after use."
};

// The ticket ledger keeps a store under safeStore(id) (tickets.js: characters outside [A-Za-z0-9._-] are dropped, 40 at
// most), so "hs-seki-demo!" spends from hs-seki-demo. The guard reads the id the same way, or such an alias would spend
// a guarded store's tickets without the door (review 2026-10-10).
export function ledgerStoreId(store) {
  return String(store == null ? "" : store).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
}
export function sekiGuarded(store) {
  return SEKI_STORES.indexOf(ledgerStoreId(store)) >= 0;
}

// The content match (2026-11-07). canonical() is the MUSUBI canonical form (musubi-v0/canonical_v0.mjs, the same bytes
// contract_v0.canonical gives in Python); the gateway is one bundle, so it keeps this small copy. Its rules, in short:
// object keys sorted by code point at every level and printable ASCII only; no whitespace outside strings; strings escape
// only '"', '\\' and U+0000..U+001F (short forms for \b \f \n \r \t) and a lone surrogate as \udxxx; numbers are integers
// within plus or minus (2^53 - 1), written in decimal (-0 is 0), and a fraction, NaN or Infinity has no canonical form;
// true, false, null as literals. A value with no canonical form throws, and the match then fails (fail closed): a payload
// whose meaning the door could not be shown exactly does not run at a guarded store.
var SAFE_INT = 9007199254740991;
function cstr(s) {
  var out = '"';
  for (var ch of s) {
    var c = ch.codePointAt(0);
    if (c >= 0xd800 && c <= 0xdfff) out += "\\u" + c.toString(16);
    else if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}
export function canonical(v) {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isInteger(v) || Math.abs(v) > SAFE_INT) throw new Error("no canonical form for the number " + String(v));
    return v === 0 ? "0" : String(v);
  }
  if (typeof v === "string") return cstr(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    var keys = Object.keys(v);
    for (var i = 0; i < keys.length; i++) {
      for (var j = 0; j < keys[i].length; j++) {
        var kc = keys[i].charCodeAt(j);
        if (kc < 0x20 || kc > 0x7e) throw new Error("a key is not printable ASCII");
      }
    }
    keys.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
    return "{" + keys.map(function (k) { return cstr(k) + ":" + canonical(v[k]); }).join(",") + "}";
  }
  throw new Error("no canonical form for " + typeof v);
}

// Whether the payload that will run (the body without its seki member) is the payload the door is shown (seki.content),
// compared as canonical bytes, so key order and spacing do not matter and every value does. { ok: true } or
// { ok: false, why }. Never throws.
export function contentMatch(payload) {
  var sk = payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "seki") ? payload.seki : undefined;
  if (!sk || typeof sk !== "object" || Array.isArray(sk) || !Object.prototype.hasOwnProperty.call(sk, "content")) {
    return { ok: false, why: "a guarded store runs a payload only when seki.content carries it; seki.content is missing; nothing was spent" };
  }
  var rest = {};
  Object.keys(payload).forEach(function (k) { if (k !== "seki") rest[k] = payload[k]; });
  var a, b;
  try { a = canonical(rest); b = canonical(sk.content); } catch (e) {
    return { ok: false, why: "the payload or seki.content has no canonical form (" + String(e && e.message || e) + "); nothing was spent" };
  }
  if (a !== b) return { ok: false, why: "the payload (the body without seki) is not seki.content, the payload the door is shown; nothing was spent" };
  return { ok: true };
}

function closed(status, error, why) {
  return { ok: false, status: status, content_type: "application/json", body: { ok: false, error: error, why: why, spent: 0 } };
}

// The door's answer for one call. Never throws; anything but an admit from the door is { ok: false, status, body }.
export async function sekiAsk(env, store, service, amount, submission) {
  if (!env || !env.SEKI_SVC || typeof env.SEKI_SVC.fetch !== "function") {
    return closed(503, "seki_door_unavailable", "this store is guarded by a SEKI door and the door is not bound here; nothing was spent");
  }
  var out = null;
  try {
    var r = await env.SEKI_SVC.fetch("https://seki.internal/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: store, service: service, amount: amount, submission: submission === undefined ? null : submission })
    });
    out = await r.json();
  } catch (e) {
    return closed(503, "seki_door_unreachable", "the door did not answer (" + String(e && e.message || e) + "); nothing was spent");
  }
  if (!out || typeof out !== "object" || out.applies !== true) {
    return closed(503, "seki_door_does_not_hold_this_store", "the gateway guards this store and the door does not; nothing was spent");
  }
  if (out.ok === true && out.decision === "admit" && typeof out.admission_sha256 === "string") return out;
  return {
    ok: false,
    status: Number.isInteger(out.status) && out.status >= 400 ? out.status : 403,
    content_type: typeof out.content_type === "string" ? out.content_type : "application/problem+json",
    body: out.body && typeof out.body === "object" ? out.body : { ok: false, error: "seki_not_admitted" },
    decision: out.decision || null,
    admission_sha256: out.admission_sha256 || null,
    record_sha256: out.record_sha256 || null,
    published: out.published || null
  };
}

// Headers the gateway adds to a guarded call's answer, so the agent can name the admission in its execution record.
export function sekiHeaders(out) {
  if (!out) return {};
  var h = { "X-Seki-Decision": String(out.decision || ""), "X-Seki-Tickets": SEKI_TICKETS.mode + "; no monetary value" };
  if (out.admission_sha256) h["X-Seki-Admission-Sha256"] = out.admission_sha256;
  if (out.record_sha256) h["X-Seki-Record-Sha256"] = out.record_sha256;
  if (out.published) h["X-Seki-Published"] = out.published.accepted ? "accepted" : "pending";
  return h;
}

// GET /seki (what the door admits under) and GET /seki/record/<sha256> (a record it published), passed through.
export async function sekiRead(env, path) {
  if (!env || !env.SEKI_SVC || typeof env.SEKI_SVC.fetch !== "function") return null;
  var inner = path === "/seki" ? "/policy" : (/^\/seki\/record\/[0-9a-f]{64}$/.test(path) ? path.slice(5) : null);
  if (!inner) return null;
  try {
    var r = await env.SEKI_SVC.fetch("https://seki.internal" + inner, { method: "GET" });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 503, text: JSON.stringify({ error: "seki_door_unreachable" }) };
  }
}
