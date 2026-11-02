// furui_day.mjs: check one day of the content check runner, or one admissions[] line of a Resume. The JavaScript twin of
// the Python nenrin_verify.furui_day; both run ../furui-check-day-v0/verify_vectors.json and give the same verdicts.
//
//   nenrin-verify furui-day <day> --leaf <i>
//     1 envelope_shape   the envelope the runner serves has the closed shape (furui-check-signed-v1, no text field)
//     2 leaf_sha256      sha256(0x00 || musubi-canonical-v0(envelope)) is the leaf the runner names
//     3 audit_path       the RFC 6962 audit path rebuilds the root of the day record the ledger serves
//     4 signature        runner-1's Ed25519 signature on the day record, and on the envelope
//     5 runner_key       runner-1's key is in the ledger's /.well-known/furui-check-keys.json, inside from_height (and
//                        before revoked_height) for the heights of the record and of the envelope
//     6 bitcoin_anchor   the day record is listed in a ledger batch entry whose OpenTimestamps proof commits the entry's
//                        sha256 to a Bitcoin block header (not_yet before the batch or before the anchor)
//   nenrin-verify resume-admission <endpoint> <record_sha256>
//     1 resume, 2 admission_line, 3 admission_record, 4 ledger_batch, 5 bitcoin_anchor
//   nenrin-verify furui-vectors <vectors.json>
//
// Exit: 0 ok, 1 fail, 3 not_yet, 2 usage or network error. Network: GET only, only https://ledger.horizonshield.dev and
// https://furui.horizonshield.dev, no redirects. The Bitcoin block header is not fetched: the output names the height and
// the merkle root the proof commits to, to be compared with any copy of the Bitcoin chain.
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";

export const LEDGER = "https://ledger.horizonshield.dev";
export const FURUI = "https://furui.horizonshield.dev";
export const KEYS_URL = LEDGER + "/.well-known/furui-check-keys.json";
const SIGNER = { domain: "horizonshield.dev", key_url: KEYS_URL };
const ALLOWED_HOSTS = ["ledger.horizonshield.dev", "furui.horizonshield.dev"];
const SAFE = 9007199254740991;
const H64 = /^[0-9a-f]{64}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NONCE = /^(?:[0-9a-f]{32}|heartbeat-\d{4}-\d{2}-\d{2})$/;
const SIG88 = /^[A-Za-z0-9+/]{86}==$/;
const CHECK_KEYS = ["action_binding_digest", "answered", "checked_at_height", "contract_sha256", "decision", "input_commit", "marks",
  "nonce", "rules_sha256", "schema", "scope_sha256", "signed_at", "stage_reached", "trace_sha256", "unread"];
const DAY_KEYS = ["clock_skew", "day", "first_height", "last_height", "late", "leaf", "n", "publication", "root", "schema", "signatures", "signer", "tree"];
const DAY_LEAF = "sha256(0x00 || musubi-canonical-v0(envelope))";
const RESUME_ENVELOPE_KEYS = ["evaluated_at", "subject_responses", "not_counted", "scan", "recompute", "resume_sha256"];
const UNANCHORED = ["not_yet_anchored", "confirmed_without_block_time"];
const MARKS_OK = ['[]', '["off_topic"]', '["rule_conflict"]', '["off_topic","rule_conflict"]'];
export const CHECK_SCHEMA = "nenrin-furui-check-v1";
const DAY_STEPS = ["envelope_shape", "leaf_sha256", "audit_path", "signature", "runner_key", "bitcoin_anchor"];
const RESUME_STEPS = ["resume", "admission_line", "admission_record", "ledger_batch", "bitcoin_anchor"];

export class NetError extends Error {}
class Bad extends Error {}
const BAD = Symbol("not json");

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isInt = (x, lo = 0) => typeof x === "number" && Number.isSafeInteger(x) && x >= lo;
const isStr = (x) => typeof x === "string";
const marksOk = (m) => Array.isArray(m) && m.every(isStr) && MARKS_OK.includes(JSON.stringify(m));
const keysAre = (o, ks) => isObj(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(ks.slice().sort());
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const get = (o, k) => (isObj(o) && has(o, k) ? o[k] : undefined);
const enc = new TextEncoder();
const u8 = (x) => (typeof x === "string" ? enc.encode(x) : x);
export const sha = (x) => createHash("sha256").update(u8(x)).digest("hex");

export function parseJson(bytes) {
  let t;
  try { t = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch (e) { throw new Bad("utf8"); }
  try { return JSON.parse(t); } catch (e) { throw new Bad("json"); }
}

// musubi-canonical-v0: keys sorted, no whitespace, non-ASCII raw; floats, unsafe integers, keys that are not printable ASCII
// and lone surrogates are refused.
export function canonical(v) {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isSafeInteger(v)) throw new Bad("number"); return JSON.stringify(v); }
  if (typeof v === "string") {
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < v.length && v.charCodeAt(i + 1) >= 0xdc00 && v.charCodeAt(i + 1) <= 0xdfff) { i++; continue; }
      if (c >= 0xd800 && c <= 0xdfff) throw new Bad("lone surrogate");
    }
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (isObj(v)) {
    const ks = Object.keys(v);
    for (const k of ks) if (!/^[\x20-\x7e]*$/.test(k)) throw new Bad("key");
    ks.sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  throw new Bad("type");
}

function realDay(s) {
  const m = isStr(s) ? DAY.exec(s) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return +m[1] >= 1 && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function b64(s, n) {
  if (!isStr(s) || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) return null;
  const b = Buffer.from(s, "base64");
  return b.length === n && b.toString("base64") === s ? b : null;
}

export function ed25519Verify(pub, msg, sig) {
  try {
    const k = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pub).toString("base64url") }, format: "jwk" });
    return edVerify(null, Buffer.from(msg), k, Buffer.from(sig)) === true;
  } catch (e) { return false; }
}

export function envelopeProblem(e) {
  if (!keysAre(e, ["check", "schema", "signatures", "signer"]) || e.schema !== "furui-check-signed-v1") return "envelope_keys";
  const c = e.check;
  if (!keysAre(c, CHECK_KEYS) || c.schema !== "furui-check-v1") return "check_keys";
  for (const k of ["input_commit", "action_binding_digest", "contract_sha256", "trace_sha256"]) if (!(isStr(c[k]) && H64.test(c[k]))) return "check_" + k;
  for (const k of ["rules_sha256", "scope_sha256"]) if (c[k] !== null && !(isStr(c[k]) && H64.test(c[k]))) return "check_" + k;
  if (!(c.decision === null || c.decision === "stop" || c.decision === "pass")) return "check_decision";
  if (!marksOk(c.marks)) return "check_marks";
  if (typeof c.unread !== "boolean" || typeof c.answered !== "boolean") return "check_flags";
  if (!isInt(c.stage_reached) || c.stage_reached > 4) return "check_stage_reached";
  if (!isInt(c.checked_at_height)) return "check_height";
  if (!(isStr(c.nonce) && NONCE.test(c.nonce))) return "check_nonce";
  if (!(isStr(c.signed_at) && ISO_MS.test(c.signed_at))) return "check_signed_at";
  if (!keysAre(e.signer, ["domain", "key_url"]) || e.signer.domain !== SIGNER.domain || e.signer.key_url !== SIGNER.key_url) return "signer";
  if (!Array.isArray(e.signatures) || e.signatures.length !== 1) return "signatures";
  const g = e.signatures[0];
  if (!keysAre(g, ["alg", "domain", "key_id", "sig"]) || g.alg !== "ed25519" || g.domain !== SIGNER.domain || g.key_id !== "runner-1" || !(isStr(g.sig) && SIG88.test(g.sig))) return "signature";
  return null;
}

export const envelopeMessage = (e) => enc.encode("furui-check-signed-v1\n" + canonical({ schema: e.schema, check: e.check, signer: e.signer }));
export function dayMessage(r) {
  const o = {};
  for (const k of Object.keys(r)) if (k !== "signatures") o[k] = r[k];
  return enc.encode("furui-check-day-v0\n" + canonical(o));
}

function dayRecordProblem(r) {
  if (!keysAre(r, DAY_KEYS) || r.schema !== "furui-check-day-v0") return "day_record_shape";
  const s = r.signer;
  const ok = realDay(r.day) && keysAre(s, ["domain", "key_url"]) && isStr(s.domain) && s.domain.length > 0 && isStr(s.key_url) && isInt(r.n, 1)
    && r.tree === "rfc6962-sha256" && r.leaf === DAY_LEAF && isStr(r.root) && H64.test(r.root) && isInt(r.first_height) && isInt(r.last_height)
    && r.first_height <= r.last_height && isInt(r.late) && isInt(r.clock_skew) && r.publication === "public" && Array.isArray(r.signatures) && r.signatures.length === 1;
  if (!ok) return "day_record_shape";
  const g = r.signatures[0];
  if (!(keysAre(g, ["alg", "domain", "key_id", "sig"]) && g.alg === "ed25519" && g.domain === s.domain && isStr(g.key_id) && isStr(g.sig))) return "day_record_shape";
  return null;
}

// ---- RFC 6962 ----
const node = (a, b) => sha(Buffer.concat([Buffer.from([1]), Buffer.from(a, "hex"), Buffer.from(b, "hex")]));
export const leafHash = (env) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(canonical(env), "utf8")]));
function split(n) { let k = 1; while (k * 2 < n) k *= 2; return k; }
export function rootFromPath(leaf, m, n, path) {
  if (n === 1) return path.length === 0 ? leaf : null;
  if (path.length === 0) return null;
  const k = split(n), top = path[path.length - 1], rest = path.slice(0, -1);
  if (m < k) { const l = rootFromPath(leaf, m, k, rest); return l === null ? null : node(l, top); }
  const r = rootFromPath(leaf, m - k, n - k, rest);
  return r === null ? null : node(top, r);
}

// ---- OpenTimestamps: sha256, append and prepend, to the Bitcoin attestations ----
const OTS_MAGIC = Buffer.from("004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294", "hex");
const OTS_BITCOIN = "0588960d73d71901";
const OTS_PENDING = "83dfe30d2ef90c8e";
export function otsParse(buf) {
  const b = Buffer.from(buf);
  let pos = 0, steps = 0, pending = 0;
  const btc = [];
  const rd = (n) => { if (pos + n > b.length) throw new Bad("ots_truncated"); const v = b.subarray(pos, pos + n); pos += n; return v; };
  const varuint = () => {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const c = rd(1)[0];
      v += (c & 0x7f) * 2 ** (7 * i);
      if (!(c & 0x80)) { if (v > SAFE) throw new Bad("ots_varuint"); return v; }
    }
    throw new Bad("ots_varuint");
  };
  const varbytes = (mx) => { const n = varuint(); if (n > mx) throw new Bad("ots_too_long"); return rd(n); };
  if (!rd(OTS_MAGIC.length).equals(OTS_MAGIC) || varuint() !== 1 || rd(1)[0] !== 0x08) throw new Bad("ots_header");
  const digest = Buffer.from(rd(32));
  const item = (tag, msg, depth) => {
    if (tag === 0) {
      const t = rd(8).toString("hex");
      const payload = varbytes(8192);
      if (t === OTS_BITCOIN) {
        let v = 0, i = 0, done = false;
        while (i < payload.length && i < 8) {
          const c = payload[i];
          v += (c & 0x7f) * 2 ** (7 * i);
          i++;
          if (!(c & 0x80)) { done = true; break; }
        }
        if (!done || i !== payload.length || v > SAFE || msg.length !== 32) throw new Bad("ots_attestation");
        btc.push([v, Buffer.from(msg).reverse().toString("hex")]);
      } else if (t === OTS_PENDING) pending++;
      return;
    }
    steps++;
    if (steps > 10000 || depth > 256) throw new Bad("ots_too_deep");
    let nxt;
    if (tag === 0x08) nxt = createHash("sha256").update(msg).digest();
    else if (tag === 0xf0) nxt = Buffer.concat([msg, varbytes(4096)]);
    else if (tag === 0xf1) { const p = varbytes(4096); nxt = Buffer.concat([p, msg]); }
    else throw new Bad("ots_unsupported_op");
    if (nxt.length > 4096) throw new Bad("ots_too_long");
    stamp(nxt, depth + 1);
  };
  const stamp = (msg, depth) => {
    let tag = rd(1)[0];
    while (tag === 0xff) { item(rd(1)[0], msg, depth); tag = rd(1)[0]; }
    item(tag, msg, depth);
  };
  stamp(digest, 0);
  if (pos !== b.length) throw new Bad("ots_trailing");
  return { digest: digest.toString("hex"), bitcoin: btc, pending };
}

// ---- fetching ----
export const encComponent = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export async function httpGet(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw new NetError("not a URL: " + url); }
  if (u.protocol !== "https:" || !ALLOWED_HOSTS.includes(u.hostname) || (u.port !== "" && u.port !== "443")) throw new NetError("not an allowed URL: " + url);
  try {
    const r = await fetch(url, { method: "GET", redirect: "manual", headers: { "user-agent": "nenrin-verify-furui/1", accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    return [r.status, new Uint8Array(await r.arrayBuffer())];
  } catch (e) { throw new NetError(url + ": " + (e && e.message)); }
}

class Run {
  constructor(get, names) { this.get = get; this.names = names; this.steps = []; this.facts = {}; }
  async getj(url) {
    const [s, b] = await this.get(url);
    let v;
    try { v = parseJson(b); } catch (e) { v = BAD; }
    return [s, v];
  }
  put(state, code = null) { this.steps.push({ step: this.steps.length + 1, name: this.names[this.steps.length], state, code }); }
  result(command, args) {
    while (this.steps.length < this.names.length) this.put("skipped");
    const st = this.steps.map((x) => x.state);
    const verdict = st.includes("fail") ? "fail" : st.includes("not_yet") ? "not_yet" : "ok";
    const f = this.steps.find((x) => x.state === "fail" || x.state === "not_yet");
    return { schema: CHECK_SCHEMA, command, args, verdict, first_not_ok: f ? f.step : null, steps: this.steps, facts: this.facts };
  }
}

async function anchor(run, n, recordSha, recordSchema, needBlockTime) {
  const [s, e] = await run.getj(LEDGER + "/ledger/" + n + "?format=json");
  if (s !== 200 || !isObj(e)) return ["batch", "fail", s !== 200 ? "entry_http_" + s : "entry_not_json"];
  const rc = e.record_canonical;
  if (!isStr(rc) || get(e, "claim_sha256") !== sha(rc)) return ["batch", "fail", "entry_bytes_do_not_hash_to_claim"];
  let bt = null;
  try { bt = parseJson(rc); } catch (x) { bt = null; }
  const rows = isObj(bt) && bt.schema === "nenrin-agreement-batch-v1" ? bt.records : undefined;
  if (!Array.isArray(rows) || !rows.some((r) => isObj(r) && r.canonical_sha256 === recordSha && r.record_schema === recordSchema)) return ["batch", "fail", "record_not_in_entry"];
  run.facts.ledger_entry = n;
  const bb = get(e, "bitcoin_block");
  if (get(e, "ots_status") !== "confirmed" || !isInt(bb, 1) || (needBlockTime && !truthy(get(e, "block_time")))) return ["anchor", "not_yet", "ots_not_confirmed"];
  const [os, ob] = await run.get(LEDGER + "/ledger/" + n + "/ots");
  if (os !== 200) return ["anchor", "fail", "ots_http_" + os];
  let p;
  try { p = otsParse(ob); } catch (x) { if (x instanceof Bad) return ["anchor", "fail", "ots_parse"]; throw x; }
  if (p.digest !== e.claim_sha256) return ["anchor", "fail", "ots_digest_is_not_the_entry"];
  if (!p.bitcoin.length) return ["anchor", "fail", "ots_no_bitcoin_attestation"];
  const hit = p.bitcoin.filter(([h]) => h === bb);
  if (!hit.length) return ["anchor", "fail", "ots_height_is_not_the_entry_block"];
  run.facts.bitcoin_block = bb;
  run.facts.merkle_root = hit[0][1];
  return ["anchor", "ok", null];
}
// Python truthiness of a JSON value, so that both ports read block_time the same way
const truthy = (v) => !(v === undefined || v === null || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0));

export async function furuiDay(day, leaf, getf = httpGet) {
  const run = new Run(getf, DAY_STEPS);
  run.facts = { day, leaf, record_sha256: null, n: null, root: null, ledger_entry: null, bitcoin_block: null, merkle_root: null };
  const args = { day, leaf };
  const done = () => run.result("furui-day", args);
  // 1 envelope_shape
  const [s, a] = await run.getj(FURUI + "/furui/day/" + day + "/leaf/" + leaf);
  if (s === 404 && isObj(a) && a.error === "day_open") {
    const [ss, st] = await run.getj(FURUI + "/furui/day/" + day + "/status");
    const v = ss === 200 && isObj(st) && st.day === day ? get(st, "status") : undefined;
    if (isObj(v) && v.state === "empty") run.put("fail", "day_closed_empty"); else run.put("not_yet", "day_open");
    return done();
  }
  if (s !== 200) { run.put("fail", "leaf_http_" + s); return done(); }
  if (!isObj(a)) { run.put("fail", "leaf_not_json"); return done(); }
  if (get(a, "day") !== day || !isInt(get(a, "index")) || a.index !== leaf) { run.put("fail", "leaf_is_another_day_or_index"); return done(); }
  const env = get(a, "envelope");
  let p = envelopeProblem(env);
  if (p) { run.put("fail", "envelope_shape:" + p); return done(); }
  let envc;
  try { envc = canonical(env); } catch (x) { run.put("fail", "envelope_shape:not_canonical"); return done(); }
  run.put("ok");
  // 2 leaf_sha256
  const lh = sha(Buffer.concat([Buffer.from([0]), Buffer.from(envc, "utf8")]));
  if (get(a, "leaf_sha256") !== lh) { run.put("fail", "leaf_sha256_is_not_the_envelope"); return done(); }
  if (get(a, "envelope_sha256") !== sha(envc)) { run.put("fail", "envelope_sha256_is_not_the_envelope"); return done(); }
  run.put("ok");
  // 3 audit_path, against the day record the ledger serves
  const dr = get(a, "day_record");
  if (!isObj(dr) || !isStr(get(dr, "state"))) { run.put("fail", "no_day_record"); return done(); }
  if (dr.state !== "accepted") { run.put("not_yet", "day_record_not_accepted"); return done(); }
  const rs = get(dr, "ledger_canonical_sha256");
  if (!(isStr(rs) && H64.test(rs))) { run.put("fail", "no_day_record"); return done(); }
  const [ls, lr] = await run.getj(LEDGER + "/furui-check-day/" + rs);
  if (ls !== 200 || !isObj(lr)) { run.put("fail", ls !== 200 ? "day_record_http_" + ls : "day_record_not_json"); return done(); }
  const rc = get(lr, "record_canonical");
  if (!isStr(rc) || sha(rc) !== rs) { run.put("fail", "day_record_bytes_do_not_hash_to_sha"); return done(); }
  let rec;
  try { rec = parseJson(rc); if (canonical(rec) !== rc) throw new Bad("not canonical"); } catch (x) { run.put("fail", "day_record_not_canonical"); return done(); }
  p = dayRecordProblem(rec);
  if (p) { run.put("fail", p); return done(); }
  if (rec.day !== day) { run.put("fail", "day_record_is_another_day"); return done(); }
  Object.assign(run.facts, { record_sha256: rs, n: rec.n, root: rec.root });
  if (!isInt(get(a, "n")) || a.n !== rec.n || get(a, "root") !== rec.root) { run.put("fail", "n_or_root_differs_from_the_ledger_record"); return done(); }
  const pr = get(a, "proof");
  if (get(a, "proof_kind") !== "rfc6962-audit-path" || !Array.isArray(pr) || !pr.every((x) => isStr(x) && H64.test(x)) || pr.length > 64) { run.put("fail", "proof_shape"); return done(); }
  if (!(leaf < rec.n) || rootFromPath(lh, leaf, rec.n, pr) !== rec.root) { run.put("fail", "proof_does_not_rebuild_the_root"); return done(); }
  run.put("ok");
  // 4 signature, with the key the ledger lists under the record's key_id (5 says whether that key may sign here)
  const [ks, kd] = await run.getj(KEYS_URL);
  const kid = rec.signatures[0].key_id;
  const klist = ks === 200 && isObj(kd) && kd.use === "furui-check" && Array.isArray(kd.keys) ? kd.keys : null;
  const k = (klist || []).find((x) => isObj(x) && x.key_id === kid) || null;
  const pub = k ? b64(get(k, "public_key_ed25519_b64"), 32) : null;
  if (pub === null) run.put("skipped", "no_listed_key");
  else {
    const rsig = b64(rec.signatures[0].sig, 64);
    if (rsig === null || !ed25519Verify(pub, dayMessage(rec), rsig)) { run.put("fail", "day_record_signature"); return done(); }
    if (!ed25519Verify(pub, envelopeMessage(env), Buffer.from(env.signatures[0].sig, "base64"))) { run.put("fail", "envelope_signature"); return done(); }
    run.put("ok");
  }
  // 5 runner_key
  if (ks !== 200 || !isObj(kd)) { run.put("fail", ks !== 200 ? "keys_http_" + ks : "keys_not_json"); return done(); }
  if (klist === null) { run.put("fail", "keys_not_furui_check"); return done(); }
  if (rec.signer.domain !== SIGNER.domain || rec.signer.key_url !== SIGNER.key_url) { run.put("fail", "signer_is_not_the_ledger_keys"); return done(); }
  if (kid !== "runner-1") { run.put("fail", "key_id_is_not_runner_1"); return done(); }
  if (k === null) { run.put("fail", "key_not_listed"); return done(); }
  if (pub === null) { run.put("fail", "key_not_32_bytes"); return done(); }
  const fh = get(k, "from_height"), rh = get(k, "revoked_height");
  if (!isInt(fh) || !(rh === null || rh === undefined || isInt(rh))) { run.put("fail", "key_heights_shape"); return done(); }
  const hh = env.check.checked_at_height;
  if (rec.first_height < fh || hh < fh) { run.put("fail", "key_not_yet_valid"); return done(); }
  if (rh !== null && rh !== undefined && (rec.last_height >= rh || hh >= rh)) { run.put("fail", "key_revoked"); return done(); }
  run.put("ok");
  // 6 bitcoin_anchor
  if (get(lr, "status") !== "anchored" || !isInt(get(lr, "ledger_entry"), 1)) { run.put("not_yet", "not_in_an_anchored_batch_yet"); return done(); }
  const [, state, code] = await anchor(run, lr.ledger_entry, rs, "furui-check-day-v0", false);
  run.put(state, code);
  return done();
}

function hostOf(endpoint) {
  try { const h = new URL(endpoint).hostname; return h ? h.toLowerCase() : null; } catch (e) { return null; }
}

function lineClosed(ln) {
  const c = get(ln, "content");
  return keysAre(ln, ["content", "decision", "ledger_n", "record_sha256", "revoked"]) && isInt(ln.ledger_n, 1)
    && ["admit", "escalate", "refuse"].includes(ln.decision) && typeof ln.revoked === "boolean"
    && (c === null || (keysAre(c, ["checked", "decision", "marks", "rules_sha256"]) && typeof c.checked === "boolean"
      && (c.decision === null || c.decision === "stop" || c.decision === "pass")
      && marksOk(c.marks)
      && (c.rules_sha256 === null || (isStr(c.rules_sha256) && H64.test(c.rules_sha256)))));
}

export async function resumeAdmission(endpoint, recordSha, getf = httpGet) {
  const run = new Run(getf, RESUME_STEPS);
  run.facts = { endpoint, record_sha256: recordSha, resume_sha256: null, ledger_entry: null, bitcoin_block: null, merkle_root: null };
  const args = { endpoint, record_sha256: recordSha };
  const done = () => run.result("resume-admission", args);
  // 1 resume
  const [s, r] = await run.getj(LEDGER + "/resume?endpoint=" + encComponent(endpoint));
  if (s !== 200 || !isObj(r)) { run.put("fail", s !== 200 ? "resume_http_" + s : "resume_not_json"); return done(); }
  if (r.schema !== "nenrin-resume-v1") { run.put("fail", "resume_schema"); return done(); }
  if (get(r, "measured_endpoint") !== endpoint) { run.put("fail", "resume_is_another_endpoint"); return done(); }
  let body = null;
  try { const o = {}; for (const k of Object.keys(r)) if (!RESUME_ENVELOPE_KEYS.includes(k)) o[k] = r[k]; body = canonical(o); } catch (x) { body = null; }
  if (body === null || get(r, "resume_sha256") !== sha(body)) { run.put("fail", "resume_sha256_does_not_recompute"); return done(); }
  run.facts.resume_sha256 = r.resume_sha256;
  run.put("ok");
  // 2 admission_line
  const adm = get(r, "admissions");
  if (!Array.isArray(adm)) { run.put("fail", "no_admissions_list"); return done(); }
  const lines = adm.filter((x) => isObj(x) && x.record_sha256 === recordSha);
  if (!lines.length) {
    const nc = get(r, "not_counted");
    const hold = (Array.isArray(nc) ? nc : []).filter((x) => isObj(x) && x.record_sha256 === recordSha && x.kind === "admission");
    if (hold.some((x) => UNANCHORED.includes(x.why))) run.put("not_yet", "not_anchored_yet"); else run.put("fail", "not_listed");
    return done();
  }
  if (lines.length > 1) { run.put("fail", "listed_twice"); return done(); }
  const ln = lines[0];
  if (!lineClosed(ln)) { run.put("fail", "line_not_closed"); return done(); }
  run.put("ok");
  // 3 admission_record
  const [as, st] = await run.getj(LEDGER + "/admission/" + recordSha);
  if (as !== 200 || !isObj(st)) { run.put("fail", as !== 200 ? "admission_http_" + as : "admission_not_json"); return done(); }
  const rc = get(st, "record_canonical");
  if (!isStr(rc) || sha(rc) !== recordSha) { run.put("fail", "admission_bytes_do_not_hash_to_sha"); return done(); }
  let rec = null;
  try { rec = parseJson(rc); } catch (x) { rec = null; }
  if (!isObj(rec) || rec.schema !== "a2a-admission-v0") { run.put("fail", "admission_schema"); return done(); }
  const rp = get(rec, "relying_party");
  const rpd = isObj(rp) && isStr(rp.domain) ? rp.domain.toLowerCase() : null;
  const h = hostOf(endpoint);
  if (!rpd || !h || !(h === rpd || h.endsWith("." + rpd))) { run.put("fail", "relying_party_is_not_the_endpoint_host"); return done(); }
  if (get(rec, "decision") !== ln.decision) { run.put("fail", "decision_differs"); return done(); }
  const rules = get(rec, "rules");
  const cb = isObj(rules) && rules.version === "0.4" && isObj(get(rec, "content")) ? rec.content : null;
  const want = cb === null ? null : { checked: get(cb, "checked") ?? null, decision: get(cb, "decision") ?? null, marks: get(cb, "marks") ?? null, rules_sha256: get(cb, "rules_sha256") ?? null };
  let same;
  try { same = (want === null && ln.content === null) || (want !== null && ln.content !== null && canonical(want) === canonical(ln.content)); } catch (x) { same = false; }
  if (!same) { run.put("fail", "content_differs"); return done(); }
  run.put("ok");
  // 4 ledger_batch, 5 bitcoin_anchor
  let [part, state, code] = await anchor(run, ln.ledger_n, recordSha, "a2a-admission-v0", true);
  if (part === "batch") { run.put(state, code); return done(); }
  run.put("ok");
  if (state === "not_yet") { state = "fail"; code = "entry_listed_by_the_resume_is_not_anchored"; }
  run.put(state, code);
  return done();
}

// ---- vectors and the CLI ----
export function worldGet(world) {
  return async (url) => {
    const w = has(world, url) ? world[url] : undefined;
    if (w === undefined) return [404, enc.encode('{"error":"not_found"}')];
    if (has(w, "body_b64")) return [w.status, new Uint8Array(Buffer.from(w.body_b64, "base64"))];
    return [w.status, enc.encode(w.body)];
  };
}
export const summary = (res) => ({ verdict: res.verdict, steps: res.steps.map((x) => [x.step, x.state, x.code]), facts: res.facts });
export async function runCase(c) {
  if (c.command === "ots-parse") {
    try { const p = otsParse(Buffer.from(c.args.body_b64, "base64")); return { digest: p.digest, bitcoin: p.bitcoin, pending: p.pending }; } catch (e) { if (e instanceof Bad) return { error: e.message }; throw e; }
  }
  const g = worldGet(c.world);
  if (c.command === "furui-day") return summary(await furuiDay(c.args.day, c.args.leaf, g));
  return summary(await resumeAdmission(c.args.endpoint, c.args.record_sha256, g));
}
export async function runVectors(path, out = (l) => process.stdout.write(l + "\n")) {
  const doc = parseJson(readFileSync(path));
  let ok = 0;
  for (const c of doc.cases) {
    const got = await runCase(c);
    const same = has(c, "expect") && canonical(got) === canonical(c.expect);
    ok += same ? 1 : 0;
    out(canonical({ got, name: c.name, same }));
  }
  out(ok + "/" + doc.cases.length + " furui vectors give the expected verdict (javascript)");
  return ok === doc.cases.length ? 0 : 1;
}

const USAGE = "usage: nenrin-verify furui-day <YYYY-MM-DD> --leaf <i>\n       nenrin-verify resume-admission <https endpoint> <record_sha256>\n       nenrin-verify furui-vectors <vectors.json>";
const EXIT = { ok: 0, fail: 1, not_yet: 3 };
export const FURUI_COMMANDS = ["furui-day", "resume-admission", "furui-vectors"];

// argv without node and the script: returns the exit code
export async function furuiMain(argv) {
  let res;
  try {
    if (argv.length === 4 && argv[0] === "furui-day" && argv[2] === "--leaf" && realDay(argv[1]) && /^(0|[1-9]\d{0,8})$/.test(argv[3])) res = await furuiDay(argv[1], Number(argv[3]));
    else if (argv.length === 3 && argv[0] === "resume-admission" && /^https:\/\/\S+$/.test(argv[1]) && H64.test(argv[2]) && hostOf(argv[1])) res = await resumeAdmission(argv[1], argv[2]);
    else if (argv.length === 2 && argv[0] === "furui-vectors") return await runVectors(argv[1]);
    else { process.stderr.write(USAGE + "\n"); return 2; }
  } catch (e) {
    if (e instanceof NetError) { process.stderr.write("nenrin-verify: network: " + e.message + "\n"); return 2; }
    throw e;
  }
  process.stdout.write(JSON.stringify(sortDeep(res), null, 2) + "\n");
  return EXIT[res.verdict];
}
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortDeep(v[k]); return o; }
  return v;
}
