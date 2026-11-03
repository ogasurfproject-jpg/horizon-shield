// furui_read.mjs (hs-jidec-mcp 1.4.0): the checks behind nenrin_furui_day and nenrin_furui_leaf.
//
// A content check runner signs one envelope per check (furui-check-signed-v1) and, once a day, the RFC 6962 root of the
// day's envelopes (furui-check-day-v0). The ledger stores the day record by its sha256 and serves the runner's keys at
// /.well-known/furui-check-keys.json. The runner serves each envelope of a closed day with its audit path for 7 days.
// These functions recompute, from the bytes they are handed: the sha256 of the day record, its Ed25519 signature under
// the key the ledger lists, the leaf hash of an envelope, the envelope's signature, and the root its audit path rebuilds.
// They read fields only. An envelope carries no text (every value is a digest, a number, a boolean, null or a fixed word).
//
// The same rules as tools/tooshi/tooshi_daily.py (keep_problems, leaf_hash, root_from_path, envelope_message).

export const DAY_SCHEMA = "furui-check-day-v0";
export const ENVELOPE_SCHEMA = "furui-check-signed-v1";
const SAFE = 9007199254740991;
const H64 = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const sameKeys = (o, ks) => isObj(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...ks].sort());
const intOk = (x, lo = 0) => Number.isSafeInteger(x) && x >= lo;

// musubi-canonical-v0 for the closed values read here: keys sorted, no spaces, no float, keys printable ASCII.
export function canonical(v) {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isInteger(v) || Math.abs(v) > SAFE) throw new Error("not_canonical_number");
    return String(v);
  }
  if (typeof v === "string") {
    if (/[\uD800-\uDFFF]/.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))) throw new Error("lone_surrogate");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (isObj(v)) {
    return "{" + Object.keys(v).sort().map((k) => {
      if (!/^[\x20-\x7e]*$/.test(k)) throw new Error("not_canonical_key");
      return JSON.stringify(k) + ":" + canonical(v[k]);
    }).join(",") + "}";
  }
  throw new Error("not_canonical_value");
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? enc.encode(bytes) : bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
function b64(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; }
}

export async function ed25519Verify(pubB64, sigB64, msgBytes) {
  const pub = b64(pubB64), sig = b64(sigB64);
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, msgBytes);
  } catch { return false; }
}

export async function leafHash(envelope) { return sha256Hex(cat(new Uint8Array([0]), enc.encode(canonical(envelope)))); }
async function node(a, b) { return sha256Hex(cat(new Uint8Array([1]), fromHex(a), fromHex(b))); }
function split(n) { let k = 1; while (k * 2 < n) k *= 2; return k; }
// RFC 6962 2.1.1: the root that leaf m of n with this audit path rebuilds, or null.
export async function rootFromPath(leaf, m, n, path) {
  if (n === 1) return path.length ? null : leaf;
  if (!path.length) return null;
  const k = split(n), top = path[path.length - 1], rest = path.slice(0, -1);
  if (m < k) { const l = await rootFromPath(leaf, m, k, rest); return l === null ? null : node(l, top); }
  const r = await rootFromPath(leaf, m - k, n - k, rest); return r === null ? null : node(top, r);
}

const CHECK_KEYS = ["action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks", "nonce", "rules_sha256",
  "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"];
// null when the envelope has the closed shape the runner keeps; otherwise the first problem word.
export function envelopeProblem(e) {
  if (!sameKeys(e, ["check", "schema", "signatures", "signer"]) || e.schema !== ENVELOPE_SCHEMA) return "envelope_keys";
  const k = e.check;
  if (!sameKeys(k, CHECK_KEYS) || k.schema !== "furui-check-v1") return "check_keys";
  for (const f of ["input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"]) if (!(typeof k[f] === "string" && H64.test(k[f]))) return "check_" + f;
  for (const f of ["rules_sha256", "scope_sha256"]) if (k[f] !== null && !(typeof k[f] === "string" && H64.test(k[f]))) return "check_" + f;
  if (![null, "stop", "pass"].includes(k.decision)) return "check_decision";
  if (!Array.isArray(k.marks) || !k.marks.every((x) => typeof x === "string") || !["", "off_topic", "rule_conflict", "off_topic,rule_conflict"].includes(k.marks.join(","))) return "check_marks";
  if (typeof k.unread !== "boolean" || typeof k.answered !== "boolean") return "check_flags";
  if (!intOk(k.stage_reached) || k.stage_reached > 4 || !intOk(k.checked_at_height)) return "check_numbers";
  if (!(typeof k.nonce === "string" && /^(?:[0-9a-f]{32}|heartbeat-\d{4}-\d{2}-\d{2})$/.test(k.nonce))) return "check_nonce";
  if (!(typeof k.signed_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(k.signed_at))) return "check_signed_at";
  if (!sameKeys(e.signer, ["domain", "key_url"]) || typeof e.signer.domain !== "string" || typeof e.signer.key_url !== "string") return "signer";
  const g = Array.isArray(e.signatures) && e.signatures.length === 1 ? e.signatures[0] : null;
  if (!sameKeys(g, ["alg", "domain", "key_id", "sig"]) || g.alg !== "ed25519" || g.domain !== e.signer.domain || typeof g.key_id !== "string" || typeof g.sig !== "string") return "signature";
  return null;
}

// The key listed for use furui-check under key_id whose heights cover [first, last], or the reason there is none.
export function listedKey(keysDoc, keyId, first, last) {
  const list = isObj(keysDoc) && keysDoc.use === "furui-check" && Array.isArray(keysDoc.keys) ? keysDoc.keys : [];
  const k = list.find((x) => isObj(x) && x.key_id === keyId);
  if (!k) return { why: "key_not_listed" };
  if (typeof k.from_height === "number" && first < k.from_height) return { why: "key_not_yet_valid" };
  if (typeof k.revoked_height === "number" && last >= k.revoked_height) return { why: "key_revoked" };
  return { key: k.public_key_ed25519_b64 };
}

// The checks of a day record as the ledger serves it ({canonical_sha256, record_canonical, status, ...}) under the keys
// document the ledger serves. Returns { checks, record } where record is the parsed day record or null.
export async function dayChecks(sha, served, keysDoc) {
  const checks = { bytes_hash_to_the_sha: false, closed_shape: false, key_listed: false, signature_valid: false, anchored: false };
  const rc = served && typeof served.record_canonical === "string" ? served.record_canonical : null;
  if (rc === null) return { checks, record: null, problem: "no_record_canonical" };
  checks.bytes_hash_to_the_sha = (await sha256Hex(rc)) === sha;
  let r; try { r = JSON.parse(rc); } catch { return { checks, record: null, problem: "unparseable" }; }
  let again = null; try { again = canonical(r); } catch { again = null; }
  const sg = isObj(r) && Array.isArray(r.signatures) && r.signatures.length === 1 ? r.signatures[0] : null;
  checks.closed_shape = again === rc && isObj(r) && r.schema === DAY_SCHEMA && typeof r.day === "string" && intOk(r.n, 1) && typeof r.root === "string" && H64.test(r.root)
    && intOk(r.first_height) && intOk(r.last_height) && r.first_height <= r.last_height && sameKeys(sg, ["alg", "domain", "key_id", "sig"]) && sg.alg === "ed25519";
  if (!checks.closed_shape) return { checks, record: isObj(r) ? r : null, problem: "not_the_closed_shape" };
  const lk = listedKey(keysDoc, sg.key_id, r.first_height, r.last_height);
  checks.key_listed = !!lk.key;
  if (lk.key) {
    const bare = Object.fromEntries(Object.entries(r).filter(([k]) => k !== "signatures"));
    checks.signature_valid = await ed25519Verify(lk.key, sg.sig, enc.encode(DAY_SCHEMA + "\n" + canonical(bare)));
  }
  checks.anchored = served.status === "anchored" && Number.isInteger(served.ledger_entry);
  return { checks, record: r, problem: lk.key ? null : lk.why };
}

// The checks of one leaf as the runner serves it, against the day record the ledger serves and the key it lists.
export async function leafChecks(leafDoc, day, dayRecordSha, keysDoc, keysUrl) {
  const checks = { closed_envelope: false, signer_names_the_ledger_keys: false, leaf_is_the_envelope: false, envelope_sha_is_the_envelope: false, path_rebuilds_the_root: false,
    root_is_the_ledger_record: false, envelope_signature_valid: false };
  const e = leafDoc && leafDoc.envelope;
  checks.closed_envelope = envelopeProblem(e) === null;
  if (!checks.closed_envelope) return { checks, problem: "envelope_shape:" + envelopeProblem(e) };
  checks.signer_names_the_ledger_keys = e.signer.key_url === keysUrl;
  const lh = await leafHash(e);
  checks.leaf_is_the_envelope = leafDoc.leaf_sha256 === lh;
  checks.envelope_sha_is_the_envelope = leafDoc.envelope_sha256 === (await sha256Hex(canonical(e)));
  const pr = leafDoc.proof;
  const pathOk = leafDoc.proof_kind === "rfc6962-audit-path" && Array.isArray(pr) && pr.every((x) => typeof x === "string" && H64.test(x)) && intOk(leafDoc.index) && intOk(leafDoc.n, 1);
  const rebuilt = pathOk ? await rootFromPath(lh, leafDoc.index, leafDoc.n, pr) : null;
  checks.path_rebuilds_the_root = rebuilt !== null && rebuilt === leafDoc.root;
  checks.root_is_the_ledger_record = !!day && rebuilt !== null && rebuilt === day.root && leafDoc.n === day.n && leafDoc.day === day.day
    && !!leafDoc.day_record && leafDoc.day_record.ledger_canonical_sha256 === dayRecordSha;
  const g = e.signatures[0];
  const lk = listedKey(keysDoc, g.key_id, e.check.checked_at_height, e.check.checked_at_height);
  if (lk.key) checks.envelope_signature_valid = await ed25519Verify(lk.key, g.sig, enc.encode(ENVELOPE_SCHEMA + "\n" + canonical({ schema: e.schema, check: e.check, signer: e.signer })));
  return { checks, problem: lk.key ? null : lk.why };
}
