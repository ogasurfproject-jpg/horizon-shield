// recompute.js
//
// Two read only primitives for the MCP Conduct Register.
//
//   recomputeHandler(body)   Derive which canonicalization reproduces a claimed SHA-256,
//                            from outside, without asking the party that published it.
//   verifyEventHandler(body) Recompute a NIP-01 event id and verify its BIP340 Schnorr
//                            signature locally, and report which named fields sit inside
//                            the signed bytes rather than beside them.
//
// Both are pure computation. Neither writes anything. Neither contacts any host.
// Neither ranks, recommends, or compares any server against any other.
//
// A hash that could not be reproduced is reported as not reproduced, together with the
// number of combinations tried and the space they covered. It is never reported as invalid.
//
// No dependencies. Web Crypto for SHA-256, BigInt for the curve.

const MAX_CANDIDATES = 8192;

// ---------------------------------------------------------------- JSON writing
//
// A configurable serializer is used instead of JSON.stringify so that layouts other
// runtimes emit can be reproduced exactly, and so the caller is told precisely which
// layout matched.

const SHORT = { '"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

function quote(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (SHORT[ch] !== undefined) out += SHORT[ch];
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

function num(n) {
  if (!Number.isFinite(n)) return "null";
  if (Object.is(n, -0)) return "-0";
  return String(n);
}

// Sorting is by UTF-16 code unit, which is what RFC 8785 specifies and what the default
// Array.prototype.sort does. Python's sort_keys orders by Unicode code point. The two
// differ only for keys above the basic multilingual plane.
function keysOf(o, sort) {
  const ks = Object.keys(o);
  return sort ? ks.slice().sort() : ks;
}

// style: { kind: "compact", item, colon } or { kind: "indent", n }
function write(v, style, sort, level) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") return num(v);
  if (t === "string") return quote(v);

  const indent = style.kind === "indent";
  const pad = indent ? "\n" + " ".repeat(style.n * (level + 1)) : "";
  const close = indent ? "\n" + " ".repeat(style.n * level) : "";
  const item = indent ? "," : style.item;
  const colon = indent ? ": " : style.colon;

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const parts = v.map((x) => write(x, style, sort, level + 1));
    return "[" + pad + parts.join(item + pad) + close + "]";
  }
  if (t === "object") {
    const ks = keysOf(v, sort);
    if (ks.length === 0) return "{}";
    const parts = ks.map((k) => quote(k) + colon + write(v[k], style, sort, level + 1));
    return "{" + pad + parts.join(item + pad) + close + "}";
  }
  return "null";
}

const LAYOUTS = [
  { id: "compact",        style: { kind: "compact", item: ",",  colon: ":"  }, note: "separators (',',':')"   },
  { id: "spaced",         style: { kind: "compact", item: ", ", colon: ": " }, note: "separators (', ',': ')" },
  { id: "comma_tight",    style: { kind: "compact", item: ",",  colon: ": " }, note: "separators (',',': ')"  },
  { id: "space_colon",    style: { kind: "compact", item: ", ", colon: ":"  }, note: "separators (', ',':')"  },
  { id: "indent2",        style: { kind: "indent", n: 2 },                     note: "indent 2"               },
  { id: "indent4",        style: { kind: "indent", n: 4 },                     note: "indent 4"               },
];

// ---------------------------------------------------------------- text transforms
//
// These act on the finished text. Every character they touch can only occur inside a
// string literal, so structure is never affected.

function asciiEscape(t) {
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    out += c < 128 ? t[i] : "\\u" + c.toString(16).padStart(4, "0");
  }
  return out;
}
const slashEscape = (t) => t.split("/").join("\\/");
const htmlEscape = (t) =>
  t.split("<").join("\\u003c").split(">").join("\\u003e").split("&").join("\\u0026");

// ---------------------------------------------------------------- hashing

const enc = new TextEncoder();

async function sha256hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const sha256text = (t) => sha256hex(enc.encode(t));

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);

// ---------------------------------------------------------------- subjects

const NOTE_KEYS = ["recompute_note", "recompute", "note", "_note", "how_to_verify", "howto", "verify_how"];

function without(obj, keys) {
  const out = {};
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out[k] = obj[k];
  return out;
}

function buildSubjects(obj, claimed) {
  const subs = [{ id: "as given", value: obj }];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    // the field that holds the claimed hash, if it is sitting in the object itself
    const holder = Object.keys(obj).filter((k) => obj[k] === claimed);
    if (holder.length) {
      subs.push({ id: "minus " + holder.join(" and "), value: without(obj, holder) });
      const both = holder.concat(NOTE_KEYS.filter((k) => k in obj));
      if (both.length > holder.length)
        subs.push({ id: "minus " + both.join(" and "), value: without(obj, both) });
    }
    const notes = NOTE_KEYS.filter((k) => k in obj);
    if (notes.length && !holder.length)
      subs.push({ id: "minus " + notes.join(" and "), value: without(obj, notes) });

    // a single obvious payload wrapper
    for (const k of ["record", "payload", "content", "data", "body", "claim"]) {
      const v = obj[k];
      if (v && typeof v === "object") subs.push({ id: "the " + k + " object", value: v });
      else if (typeof v === "string") {
        try {
          const p = JSON.parse(v);
          if (p && typeof p === "object") subs.push({ id: "the " + k + " string parsed", value: p });
        } catch (e) { /* not JSON, leave it */ }
      }
    }
  }
  return subs.slice(0, 8);
}

// ---------------------------------------------------------------- hex collection

function collectHex(o, path, out) {
  if (out.length > 24) return;
  if (o && typeof o === "object") {
    if (Array.isArray(o)) o.forEach((v, i) => collectHex(v, path + "[" + i + "]", out));
    else for (const k of Object.keys(o)) collectHex(o[k], path + "/" + k, out);
  } else if (isHex64(o)) {
    if (!out.some((x) => x.value === o)) out.push({ path: path, value: o });
  }
}

// ---------------------------------------------------------------- the search

const JCS_NOTE =
  "RFC 8785 JCS means sorted keys, separators (',',':'), raw UTF-8 with no \\uXXXX escaping of " +
  "non ASCII, and no trailing newline.";

function isJcs(v) {
  return v.layout === "compact" && v.sorted && !v.ascii && !v.slash && !v.html && !v.newline;
}

function expressionFor(v, subjectId) {
  const bits = [];
  bits.push(v.sorted ? "keys sorted" : "keys in given order");
  bits.push(LAYOUTS.find((l) => l.id === v.layout).note);
  bits.push(v.ascii ? "non ASCII escaped as \\uXXXX" : "raw UTF-8");
  if (v.slash) bits.push("forward slashes escaped as \\/");
  if (v.html) bits.push("< > & escaped as \\u003c \\u003e \\u0026");
  bits.push(v.newline ? "one trailing newline" : "no trailing newline");
  return "sha256 over " + subjectId + ", serialized with " + bits.join(", ");
}

function pythonFor(v, subjectId) {
  if (v.slash || v.html || v.layout === "space_colon" || v.layout === "comma_tight")
    return "no single line json.dumps equivalent, see the expression";
  const sep =
    v.layout === "compact" ? "separators=(',',':'), " :
    v.layout === "spaced" ? "" :
    v.layout === "indent2" ? "indent=2, " :
    v.layout === "indent4" ? "indent=4, " : "";
  const nl = v.newline ? ' + "\\n"' : "";
  return (
    "hashlib.sha256((json.dumps(obj, " + sep +
    "sort_keys=" + (v.sorted ? "True" : "False") + ", " +
    "ensure_ascii=" + (v.ascii ? "True" : "False") + ")" + nl +
    ').encode("utf-8")).hexdigest()   # obj = ' + subjectId
  );
}

async function searchSerializations(subjects, claimed, budget) {
  const hits = [];
  let tried = 0;
  for (const sub of subjects) {
    for (const layout of LAYOUTS) {
      for (const sorted of [false, true]) {
        let base;
        try {
          base = write(sub.value, layout.style, sorted, 0);
        } catch (e) {
          continue;
        }
        for (const ascii of [false, true]) {
          const a = ascii ? asciiEscape(base) : base;
          for (const slash of [false, true]) {
            const b = slash ? slashEscape(a) : a;
            for (const html of [false, true]) {
              const c = html ? htmlEscape(b) : b;
              for (const newline of [false, true]) {
                if (tried >= budget) return { hits, tried, exhausted: false };
                const text = newline ? c + "\n" : c;
                tried++;
                const h = await sha256text(text);
                if (h === claimed) {
                  const v = { layout: layout.id, sorted, ascii, slash, html, newline };
                  hits.push({
                    kind: "serialization",
                    subject: sub.id,
                    expression: expressionFor(v, sub.id),
                    python: pythonFor(v, sub.id),
                    bytes: text.length,
                    matches_rfc8785_jcs: isJcs(v),
                    flags: v,
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return { hits, tried, exhausted: true };
}

const PAIR_SEPS = ["", "|", ":", "-", "/", ",", "\n", " "];

async function searchPairs(obj, claimed, budget, alreadyTried) {
  const hex = [];
  collectHex(obj, "", hex);
  const hits = [];
  let tried = 0;
  for (const a of hex) {
    for (const b of hex) {
      if (a.value === b.value) continue;
      for (const sep of PAIR_SEPS) {
        if (alreadyTried + tried >= budget) return { hits, tried, hexCount: hex.length, exhausted: false };
        tried++;
        const h = await sha256text(a.value + sep + b.value);
        if (h === claimed)
          hits.push({
            kind: "pair",
            expression:
              'sha256( hex text of ' + a.path + ' + "' + (sep === "\n" ? "\\n" : sep) +
              '" + hex text of ' + b.path + " )",
            python:
              'hashlib.sha256((a + "' + (sep === "\n" ? "\\n" : sep) + '" + b).encode()).hexdigest()' +
              "   # a = " + a.path + ", b = " + b.path,
            matches_rfc8785_jcs: null,
          });
      }
      if (alreadyTried + tried >= budget) return { hits, tried, hexCount: hex.length, exhausted: false };
      tried++;
      const hb = await sha256hex(concatBytes(hexToBytes(a.value), hexToBytes(b.value)));
      if (hb === claimed)
        hits.push({
          kind: "pair",
          expression: "sha256( decoded bytes of " + a.path + " followed by decoded bytes of " + b.path + " )",
          python:
            "hashlib.sha256(bytes.fromhex(a) + bytes.fromhex(b)).hexdigest()   # a = " +
            a.path + ", b = " + b.path,
          matches_rfc8785_jcs: null,
        });
    }
  }
  return { hits, tried, hexCount: hex.length, exhausted: true };
}

const RECOMPUTE_LIMITS = [
  "Numbers are compared after JSON parsing, so a value published as 1.0 is reproduced as 1. " +
    "A hash taken over text that distinguishes those two will not be found here.",
  "Key ordering is compared by UTF-16 code unit. A producer that sorts by Unicode code point " +
    "differs only for keys above the basic multilingual plane.",
  "Only SHA-256 is tried. Keyed constructions such as HMAC are not, because the key is not public.",
  "A hash that is not reproduced here may still be correct. It may use a serialization outside " +
    "this space, an input that was never published, or a secret. Absence of a match is reported " +
    "as absence, not as a failure of the hash.",
];

export async function recomputeHandler(body) {
  const obj = body && (body.object !== undefined ? body.object : body.record);
  if (obj === undefined || obj === null || typeof obj !== "object")
    return {
      status: 400,
      body: {
        error: "Send an object to hash.",
        expected: { object: "the JSON object as published", claimed: "optional 64 character sha256 hex" },
      },
    };

  const claimed = typeof body.claimed === "string" ? body.claimed.trim().toLowerCase() : null;
  if (claimed !== null && !HEX64.test(claimed))
    return { status: 400, body: { error: "claimed must be 64 lowercase hex characters, or omitted." } };

  const budget = Math.min(Number(body.max_candidates) || MAX_CANDIDATES, MAX_CANDIDATES);
  const subjects = buildSubjects(obj, claimed);

  // No claimed hash: return the canonical forms so the caller can hold their own copy.
  if (claimed === null) {
    const forms = {};
    for (const layout of ["compact"]) {
      const l = LAYOUTS.find((x) => x.id === layout);
      const jcs = write(obj, l.style, true, 0);
      forms.rfc8785_jcs = { note: JCS_NOTE, bytes: enc.encode(jcs).length, sha256: await sha256text(jcs) };
      const asgiven = write(obj, l.style, false, 0);
      forms.compact_given_order = { bytes: enc.encode(asgiven).length, sha256: await sha256text(asgiven) };
      const escaped = asciiEscape(jcs);
      forms.jcs_but_non_ascii_escaped = {
        note: "Sorted and compact, but non ASCII written as \\uXXXX. This is not JCS.",
        bytes: enc.encode(escaped).length,
        sha256: await sha256text(escaped),
      };
    }
    return {
      status: 200,
      body: {
        mode: "canonicalize",
        purpose:
          "Return the canonical bytes and their SHA-256 so a reading can be held by someone " +
          "who does not operate the source. Two separately held records disagree if one side changes.",
        forms,
        limits: RECOMPUTE_LIMITS,
      },
    };
  }

  const ser = await searchSerializations(subjects, claimed, budget);
  const pair = await searchPairs(obj, claimed, budget, ser.tried);
  const hits = ser.hits.concat(pair.hits);
  const tried = ser.tried + pair.tried;

  const out = {
    mode: "verify",
    claimed,
    reproduced: hits.length > 0,
    candidates_tried: tried,
    space_searched: {
      subjects: subjects.map((s) => s.id),
      layouts: LAYOUTS.map((l) => l.note),
      key_order: ["as given", "sorted by UTF-16 code unit"],
      non_ascii: ["raw UTF-8", "escaped as \\uXXXX"],
      slash: ["as is", "escaped as \\/"],
      html_chars: ["as is", "< > & escaped as \\u003c \\u003e \\u0026"],
      trailing_newline: ["absent", "present"],
      pair_construction: {
        note: "sha256 over two 64 hex values joined by a separator, both orders, as text and as decoded bytes",
        separators: PAIR_SEPS.map((s) => (s === "\n" ? "\\n" : s === "" ? "(none)" : s)),
        hex_values_found: pair.hexCount,
      },
      fully_enumerated: ser.exhausted && pair.exhausted,
    },
    limits: RECOMPUTE_LIMITS,
  };

  if (hits.length) {
    out.recipes = hits;
    const jcsHits = hits.filter((h) => h.matches_rfc8785_jcs === true);
    const nonJcs = hits.filter((h) => h.matches_rfc8785_jcs === false);
    out.canonicalization_note =
      jcsHits.length
        ? "At least one recipe that reproduces this hash is RFC 8785 JCS. " + JCS_NOTE
        : nonJcs.length
        ? "No recipe that reproduces this hash is RFC 8785 JCS. " +
          "If the publisher documents JCS, the documented form and the issued hash disagree. " + JCS_NOTE
        : "This hash was reproduced by joining published hex values rather than by serializing an object.";
  } else {
    out.not_reproduced_means = [
      "The serialization is outside the space listed above.",
      "The hashed input contains something that was not published.",
      "The construction is keyed, for example HMAC.",
      "The algorithm is not SHA-256.",
    ];
    out.what_this_is_not =
      "This is not a finding that the hash is wrong. It is a record that " + tried +
      " combinations were tried and none matched.";
  }
  return { status: 200, body: out };
}

// ---------------------------------------------------------------- BIP340 over secp256k1
//
// Written out rather than imported, so that a caller checking a signature is not also
// trusting a dependency they did not read.

const CURVE_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}
function powm(b, e, m) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a, m) => powm(mod(a, m), m - 2n, m);

function ptAdd(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (a[0] === b[0] && mod(a[1] + b[1], CURVE_P) === 0n) return null;
  const lam =
    a[0] === b[0] && a[1] === b[1]
      ? mod(3n * a[0] * a[0] * inv(2n * a[1], CURVE_P), CURVE_P)
      : mod((b[1] - a[1]) * inv(b[0] - a[0], CURVE_P), CURVE_P);
  const x = mod(lam * lam - a[0] - b[0], CURVE_P);
  return [x, mod(lam * (a[0] - x) - a[1], CURVE_P)];
}
function ptMul(p, k) {
  let r = null;
  while (k > 0n) {
    if (k & 1n) r = ptAdd(r, p);
    p = ptAdd(p, p);
    k >>= 1n;
  }
  return r;
}
function liftX(x) {
  if (x >= CURVE_P) return null;
  const ysq = mod(x * x * x + 7n, CURVE_P);
  const y = powm(ysq, (CURVE_P + 1n) / 4n, CURVE_P);
  if (powm(y, 2n, CURVE_P) !== ysq) return null;
  return [x, y % 2n === 0n ? y : CURVE_P - y];
}
async function taggedHash(tag, bytes) {
  const t = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(tag)));
  const m = new Uint8Array(t.length * 2 + bytes.length);
  m.set(t, 0);
  m.set(t, t.length);
  m.set(bytes, t.length * 2);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", m));
}
const bytesToBig = (b) => BigInt("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join(""));

async function schnorrVerify(msg32, pub32, sig64) {
  const P = liftX(bytesToBig(pub32));
  if (P === null) return { ok: false, why: "public key is not on the curve" };
  const r = bytesToBig(sig64.slice(0, 32));
  const s = bytesToBig(sig64.slice(32, 64));
  if (r >= CURVE_P) return { ok: false, why: "r is not less than the field size" };
  if (s >= CURVE_N) return { ok: false, why: "s is not less than the group order" };
  const chal = new Uint8Array(96);
  chal.set(sig64.slice(0, 32), 0);
  chal.set(pub32, 32);
  chal.set(msg32, 64);
  const e = mod(bytesToBig(await taggedHash("BIP0340/challenge", chal)), CURVE_N);
  const R = ptAdd(ptMul([GX, GY], s), ptMul(P, CURVE_N - e));
  if (R === null) return { ok: false, why: "R is the point at infinity" };
  if (R[1] % 2n !== 0n) return { ok: false, why: "R has an odd y coordinate" };
  if (R[0] !== r) return { ok: false, why: "R.x does not equal r" };
  return { ok: true, why: "valid" };
}

// ---------------------------------------------------------------- NIP-01 event

function findKeyPath(o, name, path) {
  if (o && typeof o === "object") {
    if (!Array.isArray(o)) {
      for (const k of Object.keys(o)) {
        if (k === name) return { path: path + "/" + k, value: o[k] };
        const r = findKeyPath(o[k], name, path + "/" + k);
        if (r) return r;
      }
    } else {
      for (let i = 0; i < o.length; i++) {
        const r = findKeyPath(o[i], name, path + "[" + i + "]");
        if (r) return r;
      }
    }
  }
  return null;
}

const EVENT_LIMITS = [
  "A valid signature shows that the holder of the key signed these bytes. It does not make the bytes true.",
  "It does not show that any configuration named inside the content is the one that produced the result.",
  "It does not show that the issuer's infrastructure ran what was sent to it.",
  "It does not establish precedence. A signature carries the time the signer wrote, not an independent clock.",
];

export async function verifyEventHandler(body) {
  const e = body && (body.event || body);
  const need = ["id", "pubkey", "created_at", "kind", "tags", "content", "sig"];
  const missing = need.filter((k) => e === null || typeof e !== "object" || e[k] === undefined);
  if (missing.length)
    return {
      status: 400,
      body: {
        error: "Send a complete signed NIP-01 event.",
        missing,
        note:
          "Some verification endpoints return the decoded payload without the signed event. " +
          "The raw event, including sig, tags, kind and created_at, is what makes an independent " +
          "check possible. Public relays serve it by id.",
      },
    };

  const serial = [0, e.pubkey, e.created_at, e.kind, e.tags, e.content];
  const compact = { kind: "compact", item: ",", colon: ":" };
  const raw = write(serial, compact, false, 0);
  const escaped = asciiEscape(raw);
  const hRaw = await sha256text(raw);
  const hEsc = await sha256text(escaped);

  let idMatch = null;
  if (hRaw === e.id) idMatch = "raw UTF-8";
  else if (hEsc === e.id) idMatch = "non ASCII escaped as \\uXXXX";

  let sig = { ok: null, why: "not attempted" };
  if (/^[0-9a-f]{128}$/i.test(String(e.sig)) && /^[0-9a-f]{64}$/i.test(String(e.pubkey)) && /^[0-9a-f]{64}$/i.test(String(e.id))) {
    try {
      sig = await schnorrVerify(hexToBytes(e.id.toLowerCase()), hexToBytes(e.pubkey.toLowerCase()), hexToBytes(e.sig.toLowerCase()));
    } catch (err) {
      sig = { ok: null, why: "could not be computed" };
    }
  } else {
    sig = { ok: null, why: "id, pubkey or sig is not the expected hex length" };
  }

  // which named fields sit inside the signed bytes
  let parsed = null;
  try {
    parsed = typeof e.content === "string" ? JSON.parse(e.content) : e.content;
  } catch (err) {
    parsed = null;
  }
  const asked = Array.isArray(body.assert_inside) ? body.assert_inside.slice(0, 24) : [];
  const inside = {};
  // 2026-08-19 patch40. Reported by Federico Blanco Sanchez-Llanos.
  // The id preimage is [0,pubkey,created_at,kind,tags,content], so tags sit inside the signed
  // bytes exactly as much as content does. This used to walk content only and then report the field
  // as absent from the signed bytes, which is a claim about absence made without having looked.
  // Now both are walked and the answer says which one carried the field.
  const findInTags = (tags, name) => {
    if (!Array.isArray(tags)) return null;
    for (let i = 0; i < tags.length; i++) {
      const row = tags[i];
      if (!Array.isArray(row) || !row.length) continue;
      if (String(row[0]) === name) {
        return { path: "tags[" + i + "][0]", value: row.length === 2 ? row[1] : row.slice(1), carrier: "tags" };
      }
    }
    for (let i = 0; i < tags.length; i++) {
      const r = findKeyPath(tags[i], name, "tags[" + i + "]");
      if (r) return { path: r.path, value: r.value, carrier: "tags" };
    }
    return null;
  };
  for (const name of asked) {
    const inContent = parsed ? findKeyPath(parsed, String(name), "content") : null;
    const hit = inContent
      ? { path: inContent.path, value: inContent.value, carrier: "content" }
      : findInTags(e.tags, String(name));
    inside[name] = hit
      ? {
          found_at: hit.path,
          carried_by: hit.carrier,
          value: hit.value,
          inside_signed_bytes:
            idMatch !== null && sig.ok === true
              ? true
              : idMatch !== null
              ? "the " + hit.carrier + " is inside the id, but the signature was not verified here"
              : "not determined, because the id could not be recomputed",
        }
      : {
          found_at: null,
          carried_by: null,
          inside_signed_bytes: false,
          means: "not found in content and not found in tags. Both are inside the signed bytes, so it is carried by neither.",
          searched: ["content", "tags"],
        };
  }

  return {
    status: 200,
    body: {
      event_id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      created_at: e.created_at,
      id_recomputed: idMatch !== null,
      id_serialization: idMatch,
      id_recomputed_value: idMatch !== null ? e.id : hRaw,
      signature_valid: sig.ok,
      signature_note: sig.why,
      verified_by: "this endpoint, from the curve parameters, with no library and no network call",
      content_keys: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : null,
      fields_inside_signed_bytes: asked.length ? inside : undefined,
      how_to_repeat:
        "Recompute sha256 over the compact JSON array [0,pubkey,created_at,kind,tags,content] and " +
        "verify the BIP340 signature over that 32 byte id against the public key. Nothing here has " +
        "to be taken on trust.",
      what_this_does_not_prove: EVENT_LIMITS,
    },
  };
}

// ---------------------------------------------------------------- usage

export const RECOMPUTE_USAGE = {
  route: "POST /recompute",
  purpose:
    "Given a published JSON object and a hash somebody claims was taken over it, work out which " +
    "canonicalization reproduces that hash, without asking the party that published it.",
  send: {
    object: "the JSON object as published",
    claimed: "optional. 64 hex characters. Omit it to receive canonical forms and their hashes instead.",
    max_candidates: "optional. Upper bound on combinations tried. Default and maximum " + MAX_CANDIDATES + ".",
  },
  returns:
    "Whether it was reproduced, every recipe that reproduced it, whether that recipe is RFC 8785 JCS, " +
    "how many combinations were tried, and the exact space they covered. A hash that was not " +
    "reproduced is reported as not reproduced, never as invalid.",
  reads_nothing: "No host is contacted. Nothing is stored. The object is not retained after the response.",
};

export const VERIFY_EVENT_USAGE = {
  route: "POST /verify-event",
  purpose:
    "Recompute a NIP-01 event id and verify its BIP340 Schnorr signature here, so that neither the " +
    "issuer's own verification endpoint nor any library has to be trusted.",
  send: {
    event: "a complete signed event with id, pubkey, created_at, kind, tags, content and sig",
    assert_inside:
      "optional list of field names. Both content and tags are searched, because both are inside the " +
      "id preimage [0,pubkey,created_at,kind,tags,content]. For each name the answer says whether it " +
      "sits inside the signed bytes or beside them, and which of the two carried it.",
  },
  returns:
    "Whether the id recomputes, whether the signature verifies, and for each named field whether it " +
    "is inside the signature.",
  reads_nothing: "No host is contacted. Nothing is stored.",
};
