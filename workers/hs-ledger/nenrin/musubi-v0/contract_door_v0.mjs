// The contract door in a second runtime: the twin of contract_v0.verify_contract, grant_type_problems and
// grant_subset.
//
// contract_v0.py is the reference. A JavaScript reader that checked only the two signatures would read a limit of the
// wrong type (grant.limits max_amount "100000") as no limit, where the Python door refuses the contract. So the whole
// door is restated in this file, function by function, and contract_door_check.py holds the two together: every
// contract in fixtures/contract_door/corpus.json must get the same verdict and the same refusal codes from both, and
// every pair of grants the same number of subset violations.
//
//   node contract_door_v0.mjs --parts corpus.json     prints {doors: [{verdict, refusals}], subsets: [n], payloads: [[code, ...]]} for the corpus
//
// What is compared and what is not. Verdict, refusal codes (in order) and the count of subset violations are compared.
// The wording of a refusal is the reference's and is not restated here.
//
// Inputs are plain JSON values as JSON.parse gives them. A number written 1.0 arrives as 1 here and as a float in
// the reference; the reference refuses it (non_integer_number), and here the signatures fail, because the bytes the
// parties signed spell it differently. Refused in both.
//
// Two habits of the reference that are kept on purpose, so that the two doors cannot be made to disagree:
//   - a value with a trailing newline ("<32 hex>\n") is refused. Until 2026-10-10 the reference read "$", which in
//     Python also matches before one final newline, and this file copied that; the reference now reads "\Z".
//   - an input the reference cannot read at all (it raises) is refused; here verifyContract never throws.
import { createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { canonical } from "./canonical_v0.mjs";
import { normDomain as normDomainStrict, hostOfHttps, underDomain, pyStrip, publicKeyProblem, OVERCLAIM } from "../agreement-v0/agreement_verify.mjs";

export const SCHEMA = "a2a-contract-v0";
export const LIMITS_NEED = "required_before_execution";
export const GRANT_KEYS = ["authorized_actions", "prohibited_actions", "conditional", "delegation", "data_access", "max_hops", "privacy",
  "revocation", "finality", "witnesses", "expiry_height", "ordering", "approval_policy", "limits", "payload_schema", "exposure"];
const REVOCATION_MODES = ["anchor", "delivery_ack"];
const REQUIRED_DNE = [["runtime enforcement", ["runtime", "enforce"]], ["HS does not judge liability", ["judge", "liability", "fault"]],
  ["deviation is provable, not prevented", ["deviat"]], ["not a legal contract", ["legal"]]];
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX8 = /^[0-9a-f]{8}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SAFE = 9007199254740991;

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const get = (o, k) => (isObj(o) && has(o, k) && o[k] !== undefined ? o[k] : null);
const isStr = (x) => typeof x === "string";
const int = (x) => (typeof x === "number" && Number.isInteger(x) ? x : null);
const strlist = (v) => Array.isArray(v) && v.every((x) => isStr(x) && x !== "");
const utf8 = (s) => Buffer.from(s, "utf8");
const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const same = (a, b) => canonicalOrNull(a) === canonicalOrNull(b);
function canonicalOrNull(v) { try { return canonical(v); } catch (_e) { return null; } }

// agreement_verify.mjs's normDomain, with the reference's label rule (no trailing newline since 2026-10-10).
function normDomain(d) {
  const strict = normDomainStrict(d);
  if (strict !== null || !isStr(d) || d === "") return strict;
  let s = pyStrip(d).toLowerCase();
  while (s.endsWith(".")) s = s.slice(0, -1);
  if (!s || /[/@: ]/.test(s)) return null;
  const labels = s.split(".");
  return labels.length >= 2 && labels.every((lab) => lab && LABEL.test(lab)) ? s : null;
}

function b64Raw(s, n) {
  if (!isStr(s) || s === "" || !B64.test(s) || s.length % 4 !== 0) return null;
  const b = Buffer.from(s, "base64");
  return b.length === n && b.toString("base64") === s ? b : null;
}

// true, false, or null when the key or the signature is unusable: agreement_verify.py's ed25519_verify.
function ed25519Check(pubB64, sigB64, message) {
  const pk = b64Raw(pubB64, 32), sig = b64Raw(sigB64, 64);
  if (!pk || !sig) return null;
  if (publicKeyProblem(new Uint8Array(pk)) !== null) return null;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pk.toString("base64url") }, format: "jwk" });
    return edVerify(null, message, key, sig) === true;
  } catch (_e) { return null; }
}

// ---- grant.payload_schema (payload-schema-v0) and grant.exposure (2026-11-09): contract_v0.payload_schema_problem,
// open_fields, payload_schema_within and payload_problems ----
export const PAYLOAD_SCHEMA = "payload-schema-v0";
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TOKEN = /^[A-Za-z0-9._-]+$/;
const FIELD_KEYS = { enum: [["type", "values", "required"], ["values_from"]], integer: [["type", "min", "max", "required"], []],
  token: [["type", "max_chars", "required"], []], text: [["type", "max_chars", "required"], []] };
const MAX_CHARS = { token: 256, text: 65536 };
const OPEN_TYPES = ["text"];
const chars = (s) => [...s].length;
const keysAre = (o, need, may = []) => need.every((k) => has(o, k)) && Object.keys(o).every((k) => need.includes(k) || may.includes(k));

function fieldOk(f) {
  if (!isObj(f) || !isStr(get(f, "type")) || !has(FIELD_KEYS, f.type)) return false;
  const [need, may] = FIELD_KEYS[f.type];
  if (!keysAre(f, need, may) || typeof f.required !== "boolean") return false;
  if (f.type === "enum") {
    const v = f.values;
    if (!(Array.isArray(v) && v.length >= 1 && v.length <= 1024 && v.every((x) => isStr(x) && x !== "") && new Set(v).size === v.length)) return false;
    if (has(f, "values_from")) {
      const s = f.values_from;
      if (!(isObj(s) && keysAre(s, ["path", "sha256", "pointer"]) && isStr(s.path) && s.path !== "" && isStr(s.sha256) && HEX64.test(s.sha256)
        && isStr(s.pointer) && s.pointer !== "")) return false;
    }
    return true;
  }
  if (f.type === "integer") return int(f.min) !== null && int(f.max) !== null && f.min <= f.max;
  return int(f.max_chars) !== null && f.max_chars >= 1 && f.max_chars <= MAX_CHARS[f.type];
}

// true when s is a payload-schema-v0 object
export function payloadSchemaOk(s) {
  if (!isObj(s) || !keysAre(s, ["schema", "fields", "other_fields"])) return false;
  if (s.schema !== PAYLOAD_SCHEMA || s.other_fields !== "refuse") return false;
  const fs = s.fields;
  if (!isObj(fs) || Object.keys(fs).length < 1 || Object.keys(fs).length > 64) return false;
  return Object.keys(fs).every((n) => FIELD_NAME.test(n) && fieldOk(fs[n]));
}

// the names of the fields that carry free text, ascending
export const openFields = (s) => Object.keys(s.fields).filter((n) => OPEN_TYPES.includes(s.fields[n].type)).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

// true when every payload the schema c accepts, the schema p accepts too (both well formed)
export function payloadSchemaWithin(c, p) {
  const cf = c.fields, pf = p.fields;
  if (Object.keys(cf).some((n) => !has(pf, n))) return false;
  for (const n of Object.keys(pf)) if (pf[n].required && !(has(cf, n) && cf[n].required)) return false;
  for (const n of Object.keys(cf)) {
    const x = cf[n], y = pf[n];
    if (x.type !== y.type) return false;
    if (x.type === "enum" && x.values.some((v) => !y.values.includes(v))) return false;
    if (x.type === "integer" && !(y.min <= x.min && x.max <= y.max)) return false;
    if (has(MAX_CHARS, x.type) && x.max_chars > y.max_chars) return false;
  }
  return true;
}

function valueOk(f, v) {
  if (f.type === "enum") return isStr(v) && f.values.includes(v);
  if (f.type === "integer") return int(v) !== null && f.min <= v && v <= f.max;
  if (f.type === "token") return isStr(v) && chars(v) <= f.max_chars && TOKEN.test(v);
  return isStr(v) && chars(v) <= f.max_chars;
}

// contract_v0.payload_problems: the codes under which grant.payload_schema[action] refuses this payload, ascending; [] when
// it fits or when the grant sets no schema for the action
export function payloadProblems(contract, action, payload) {
  const g = isObj(contract) && isObj(get(contract, "grant")) ? contract.grant : {};
  const ps = get(g, "payload_schema");
  if (ps === null) return [];
  if (isObj(ps) && !has(ps, action)) return [];
  const s = isObj(ps) ? get(ps, action) : null;
  if (!payloadSchemaOk(s)) return ["payload_schema_unreadable"];
  if (!isObj(payload)) return ["payload_not_object"];
  const out = new Set(), fs = s.fields;
  if (Object.keys(payload).some((n) => !has(fs, n))) out.add("payload_field_unknown");
  for (const n of Object.keys(fs)) {
    if (!has(payload, n)) { if (fs[n].required) out.add("payload_field_missing"); }
    else if (!valueOk(fs[n], payload[n])) out.add("payload_field_value");
  }
  return [...out].sort();
}

function bitsToTarget(bits) {
  const exp = bits >>> 24, mant = bits & 0x007fffff;
  if (bits & 0x00800000 || mant === 0) return null;
  return exp >= 3 ? BigInt(mant) * (1n << BigInt(8 * (exp - 3))) : BigInt(mant) >> BigInt(8 * (3 - exp));
}
function targetOf(fin) {
  const s = get(fin, "max_target_bits");
  return isStr(s) && HEX8.test(s) ? bitsToTarget(parseInt(s, 16)) : null;
}

// ---- the type door: the number of problems contract_v0.grant_type_problems reports ----
export function grantTypeProblems(grant) {
  let n = 0;
  const bad = () => { n += 1; };
  for (const k of ["authorized_actions", "prohibited_actions", "data_access"]) if (get(grant, k) !== null && !strlist(get(grant, k))) bad();
  for (const k of ["max_hops", "expiry_height"]) { const v = get(grant, k); if (v !== null && (int(v) === null || v < 0)) bad(); }
  const d = get(grant, "delegation");
  if (d !== null) {
    if (!isObj(d) || Object.keys(d).some((k) => k !== "allowed")) bad();
    else if (!strlist(get(d, "allowed"))) bad();
  }
  const c = get(grant, "conditional");
  if (c !== null) {
    if (!Array.isArray(c) || !c.every(isObj)) bad();
    else {
      const acts = c.map((x) => get(x, "action"));
      if (!acts.every((a) => isStr(a) && a !== "")) bad();
      else if (new Set(acts).size !== acts.length) bad();
      for (const x of c) if (has(x, "requires") && !isStr(x.requires)) bad();
    }
  }
  const f = get(grant, "finality");
  if (f !== null) {
    if (!isObj(f) || Object.keys(f).some((k) => !["depth", "max_target_bits"].includes(k))) bad();
    else {
      if (has(f, "depth") && (int(f.depth) === null || f.depth < 1)) bad();
      if (has(f, "max_target_bits")) {
        const s = f.max_target_bits;
        const t = isStr(s) && HEX8.test(s) ? bitsToTarget(parseInt(s, 16)) : null;
        if (t === null || t === 0n) bad();
      }
    }
  }
  const w = get(grant, "witnesses");
  if (w !== null) {
    if (!Array.isArray(w) || !w.every(isObj)) bad();
    else for (const x of w) if (!(isStr(get(x, "name")) && x.name !== "") || b64Raw(get(x, "public_key_ed25519_b64"), 32) === null) bad();
  }
  const pv = get(grant, "privacy");
  if (pv !== null && !(isStr(pv) && pv !== "")) bad();
  const o = get(grant, "ordering");
  if (o !== null) {
    if (!isObj(o) || Object.keys(o).some((k) => k !== "same_height")) bad();
    else if (get(o, "same_height") !== null && !isStr(o.same_height)) bad();
  }
  const ap = get(grant, "approval_policy");
  if (ap !== null) {
    if (!isObj(ap) || Object.keys(ap).some((k) => !["allow_unscoped", "approvers"].includes(k))) bad();
    else {
      if (has(ap, "allow_unscoped") && typeof ap.allow_unscoped !== "boolean") bad();
      if (has(ap, "approvers")) {
        const apv = ap.approvers;
        const cond = new Set((Array.isArray(get(grant, "conditional")) ? grant.conditional : []).filter(isObj).map((x) => get(x, "action")));
        if (!(Array.isArray(apv) && apv.length >= 1 && apv.length <= 16 && apv.every(isObj))) bad();
        else {
          const names = new Set(), keys = new Set();
          for (const x of apv) {
            if (Object.keys(x).some((k) => !["name", "public_key_ed25519_b64", "actions"].includes(k))) bad();
            if (!(isStr(get(x, "name")) && x.name !== "") || b64Raw(get(x, "public_key_ed25519_b64"), 32) === null) { bad(); continue; }
            if (names.has(x.name) || keys.has(x.public_key_ed25519_b64)) bad();
            names.add(x.name); keys.add(x.public_key_ed25519_b64);
            const acts = get(x, "actions");
            if (!(Array.isArray(acts) && acts.length && acts.every((a) => isStr(a) && a !== "") && new Set(acts).size === acts.length)) bad();
            else if (acts.some((a) => !cond.has(a))) bad();
          }
        }
      }
    }
  }
  const lm = get(grant, "limits");
  if (lm !== null) {
    if (!isObj(lm)) bad();
    else {
      const named = new Set(Array.isArray(get(grant, "authorized_actions")) ? grant.authorized_actions.filter(isStr) : []);
      for (const x of Array.isArray(get(grant, "conditional")) ? grant.conditional : []) if (isObj(x) && isStr(get(x, "action"))) named.add(x.action);
      for (const a of Object.keys(lm)) {
        const x = lm[a];
        if (a === "") bad();
        else if (!named.has(a)) bad();
        if (!isObj(x) || Object.keys(x).length !== 2 || !has(x, "max_amount") || !has(x, "unit")) { bad(); continue; }
        if (int(x.max_amount) === null || x.max_amount < 1) bad();
        if (!(isStr(x.unit) && x.unit !== "")) bad();
      }
    }
  }
  const named = new Set(Array.isArray(get(grant, "authorized_actions")) ? grant.authorized_actions.filter(isStr) : []);
  for (const x of Array.isArray(get(grant, "conditional")) ? grant.conditional : []) if (isObj(x) && isStr(get(x, "action"))) named.add(x.action);
  const ps = get(grant, "payload_schema");
  if (ps !== null) {
    if (!isObj(ps)) bad();
    else for (const a of Object.keys(ps)) {
      if (a === "" || !named.has(a)) bad();
      if (!payloadSchemaOk(ps[a])) bad();
    }
  }
  const ex = get(grant, "exposure");
  if (ex !== null) {
    if (!isObj(ex)) bad();
    else for (const a of Object.keys(ex)) {
      if (a === "" || !named.has(a)) bad();
      const x = ex[a];
      if (!(isObj(x) && keysAre(x, ["window_blocks", "max_acts"]) && int(x.window_blocks) !== null && x.window_blocks >= 1 && x.window_blocks <= 4320
        && int(x.max_acts) !== null && x.max_acts >= 1 && x.max_acts <= 100000)) bad();
    }
  }
  const rv = get(grant, "revocation");
  if (isObj(rv)) {
    if (Object.keys(rv).some((k) => !["effective_at", "ack_window"].includes(k))) bad();
    if (has(rv, "ack_window") && (int(rv.ack_window) === null || rv.ack_window < 1)) bad();
  }
  return n;
}

// ---- delegation: the number of violations contract_v0.grant_subset reports (0 means the child is within the parent) ----
export function grantSubset(child, parent) {
  const P = isObj(parent) ? parent : {}, C = isObj(child) ? child : {};
  let v = grantTypeProblems(P) + grantTypeProblems(C);
  if (v) return v;
  const list = (g, k) => (Array.isArray(get(g, k)) ? g[k] : []);
  const pa = new Set(list(P, "authorized_actions")), ca = new Set(list(C, "authorized_actions"));
  for (const a of ca) if (!pa.has(a)) v += 1;
  const cp = new Set(list(C, "prohibited_actions"));
  for (const a of list(P, "prohibited_actions")) if (!cp.has(a)) v += 1;
  const pd = new Set(list(P, "data_access"));
  for (const d of list(C, "data_access")) if (!pd.has(d)) v += 1;
  const ph = int(get(P, "max_hops")), ch = int(get(C, "max_hops"));
  if (ph !== null && (ch === null || ch > ph - 1)) v += 1;
  const dels = (g) => new Set(isObj(get(g, "delegation")) && Array.isArray(get(g.delegation, "allowed")) ? g.delegation.allowed : []);
  const pdl = dels(P), cdl = dels(C);
  for (const d of cdl) if (!pdl.has(d)) v += 1;
  const conds = (g) => new Map(list(g, "conditional").filter(isObj).map((c) => [get(c, "action"), get(c, "requires")]));
  const pc = conds(P), cc = conds(C);
  for (const [a, req] of pc) {
    if (cp.has(a) || (!ca.has(a) && !cc.has(a))) continue;
    if (!cc.has(a) || cc.get(a) !== req) v += 1;
  }
  for (const a of cc.keys()) if (!pa.has(a) && !pc.has(a)) v += 1;
  const pe = int(get(P, "expiry_height")), ce = int(get(C, "expiry_height"));
  if (pe !== null && (ce === null || ce > pe)) v += 1;
  const pr = isObj(get(P, "revocation")) ? P.revocation : null, cr = isObj(get(C, "revocation")) ? C.revocation : null;
  if (pr !== null) {
    const pm = get(pr, "effective_at"), cm = get(cr, "effective_at");
    if (cr === null || cm === null) v += 1;
    else if (!REVOCATION_MODES.includes(pm)) v += 1;
    else if (!REVOCATION_MODES.includes(cm)) v += 1;
    else if (pm === "anchor" && cm !== "anchor") v += 1;
    else if (pm === "delivery_ack" && cm === "delivery_ack") {
      const pw = int(get(pr, "ack_window")), cw = int(get(cr, "ack_window"));
      if (pw !== null && (cw === null || cw > pw)) v += 1;
    }
  }
  const pf = isObj(get(P, "finality")) ? P.finality : null, cf = isObj(get(C, "finality")) ? C.finality : null;
  if (pf !== null) {
    if (cf === null) v += 1;
    else {
      const pdp = int(get(pf, "depth")), cdp = int(get(cf, "depth"));
      if (pdp !== null && (cdp === null || cdp < pdp)) v += 1;
      const pt = targetOf(pf), ct = targetOf(cf);
      if (pt !== null && (ct === null || ct > pt)) v += 1;
    }
  }
  const wk = (g) => new Set(list(g, "witnesses").filter(isObj).map((w) => get(w, "public_key_ed25519_b64")).filter(isStr));
  const pwk = wk(P), cwk = wk(C);
  if (pwk.size) {
    if (!cwk.size) v += 1;
    else for (const k of pwk) if (!cwk.has(k)) v += 1;
  }
  for (const k of ["privacy", "ordering"]) {
    if (get(P, k) !== null && (get(C, k) === null || !same(C[k], P[k]))) v += 1;
  }
  const pl = isObj(get(P, "limits")) ? P.limits : {}, cl = isObj(get(C, "limits")) ? C.limits : {};
  for (const a of Object.keys(pl)) {
    if (cp.has(a) || (!ca.has(a) && !cc.has(a))) continue;
    if (!has(cl, a) || cl[a].unit !== pl[a].unit || cl[a].max_amount > pl[a].max_amount) v += 1;
  }
  const psp = isObj(get(P, "payload_schema")) ? P.payload_schema : {}, psc = isObj(get(C, "payload_schema")) ? C.payload_schema : {};
  for (const a of Object.keys(psp)) {
    if (cp.has(a) || (!ca.has(a) && !cc.has(a))) continue;
    if (!has(psc, a) || !payloadSchemaWithin(psc[a], psp[a])) v += 1;
  }
  const exp = isObj(get(P, "exposure")) ? P.exposure : {}, exc = isObj(get(C, "exposure")) ? C.exposure : {};
  for (const a of Object.keys(exp)) {
    if (cp.has(a) || (!ca.has(a) && !cc.has(a))) continue;
    if (!has(exc, a) || !(exc[a].max_acts <= exp[a].max_acts && exc[a].window_blocks >= exp[a].window_blocks)) v += 1;
  }
  const pap = isObj(get(P, "approval_policy")) ? P.approval_policy : {}, cap = isObj(get(C, "approval_policy")) ? C.approval_policy : {};
  if (get(cap, "allow_unscoped") === true && get(pap, "allow_unscoped") !== true) v += 1;
  const norm = (a) => (Array.isArray(get(a, "approvers")) ? a.approvers.map(canonical).sort() : []);
  if (JSON.stringify(norm(pap)) !== JSON.stringify(norm(cap))) v += 1;
  return v;
}

function scan(root, onNumber, onKey) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === "number") onNumber(node);
    else if (Array.isArray(node)) for (const x of node) stack.push(x);
    else if (isObj(node)) for (const k of Object.keys(node)) { onKey(k); stack.push(node[k]); }
  }
}

export const contractSigningBytes = (c) => Buffer.concat([utf8(SCHEMA + "\n"), utf8(canonical(body(c, ["signatures"])))]);

// {verdict: "accepted" | "refused", refusals: [code, ...]} in the order the reference reports them.
export function verifyContract(record, parent = null) {
  try { return door(record, parent); } catch (_e) { return { verdict: "refused", refusals: ["unreadable"] }; }
}

function door(record, parent) {
  const refusals = [];
  const refuse = (code) => refusals.push(code);
  const out = () => ({ verdict: refusals.length ? "refused" : "accepted", refusals });
  if (!isObj(record) || get(record, "schema") !== SCHEMA) { refuse("bad_schema"); return out(); }
  for (const f of ["contract_id", "nonce"]) if (!(isStr(get(record, f)) && HEX32.test(record[f]))) refuse("bad_field");
  const parties = get(record, "parties");
  if (!Array.isArray(parties) || parties.length !== 2) { refuse("bad_parties"); return out(); }
  if (!parties.every(isObj)) throw new Error("a party is not an object");
  const roles = parties.map((p) => get(p, "role"));
  if (!roles.every(isStr)) throw new Error("a role is not a string");
  if (JSON.stringify([...roles].sort()) !== JSON.stringify(["contractor", "principal"])) refuse("bad_roles");
  const doms = [];
  for (const p of parties) {
    const d = normDomain(get(p, "domain"));
    if (!d) { refuse("bad_domain"); continue; }
    doms.push(d);
    if (!hostOfHttps(get(p, "key_url"))) refuse("bad_key_url");
    if (b64Raw(get(p, "public_key_ed25519_b64"), 32) === null) refuse("bad_public_key");
  }
  if (new Set(doms).size < 2) refuse("self_contract");
  const task = get(record, "task");
  if (!isObj(task) || !isStr(get(task, "purpose")) || task.purpose === "") refuse("bad_task");
  if (task !== null && !isObj(task) && task !== false && task !== 0 && task !== "" && !(Array.isArray(task) && !task.length)) throw new Error("task is not an object");
  if (isObj(task) && Object.keys(task).length && get(task, "payload_digest") !== null && !(isStr(task.payload_digest) && HEX64.test(task.payload_digest))) refuse("bad_payload_digest");
  const grant = get(record, "grant");
  if (!isObj(grant)) refuse("bad_grant");
  else {
    if (Object.keys(grant).some((k) => !GRANT_KEYS.includes(k))) refuse("grant_key_unknown");
    for (const k of ["authorized_actions", "prohibited_actions"]) if (!Array.isArray(get(grant, k))) refuse("bad_grant");
    for (let i = grantTypeProblems(grant); i > 0; i--) refuse("grant_type");
    if (strlist(get(grant, "authorized_actions")) && strlist(get(grant, "prohibited_actions"))) {
      const pro = new Set(grant.prohibited_actions);
      if (grant.authorized_actions.some((a) => pro.has(a))) refuse("grant_contradiction");
    }
    const rv = get(grant, "revocation");
    if (rv !== null) {
      if (!isObj(rv)) refuse("bad_revocation");
      else if (!REVOCATION_MODES.includes(get(rv, "effective_at"))) refuse("revocation_mode_unknown");
    }
    if (get(grant, "limits") !== null) {
      const rq = get(record, "requirements");
      if (!(isObj(rq) && get(rq, "admission") === LIMITS_NEED)) refuse("limits_need_admission");
    }
    for (const k of ["payload_schema", "exposure"]) {
      if (get(grant, k) !== null) {
        const rq = get(record, "requirements");
        if (!(isObj(rq) && get(rq, "admission") === LIMITS_NEED)) refuse(k + "_needs_admission");
      }
    }
  }
  const pc = get(record, "parent_contract");
  if (pc !== null) {
    if (!(isObj(pc) && isStr(get(pc, "contract_id")))) refuse("bad_parent");
    else if (parent !== null) {
      if (get(parent, "contract_id") !== pc.contract_id) refuse("parent_mismatch");
      else for (let i = grantSubset(isObj(grant) ? grant : {}, isObj(get(parent, "grant")) ? parent.grant : {}); i > 0; i--) refuse("grant_escalation");
    }
  }
  const numbers = [], keys = [];
  scan(record, (x) => { if (!Number.isInteger(x)) numbers.push("non_integer_number"); else if (Math.abs(x) > SAFE) numbers.push("unsafe_number"); },
    (k) => { if (![...k].every((ch) => ch.length === 1 && ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e)) keys.push("key_not_printable_ascii"); });
  for (const c of numbers) refuse(c);
  for (const c of keys) refuse(c);
  const est = get(record, "establishes"), dne = get(record, "does_not_establish");
  if (!Array.isArray(est) || !est.length) refuse("establishes_missing");
  else for (const line of est) if (isStr(line)) for (const [rx] of OVERCLAIM) if (new RegExp(rx.source, "iu").test(line)) refuse("overclaim");
  if (!Array.isArray(dne) || !dne.length) refuse("dne_missing");
  else {
    const low = dne.filter(isStr).map((x) => x.toLowerCase());
    for (const [, kws] of REQUIRED_DNE) if (!low.some((line) => kws.some((k) => line.includes(k)))) refuse("dne_incomplete");
  }
  const sigs = get(record, "signatures");
  if (!Array.isArray(sigs)) { refuse("bad_signatures"); return out(); }
  const msg = contractSigningBytes(record);
  const pin = new Map(parties.map((p) => [normDomain(get(p, "domain")), get(p, "public_key_ed25519_b64")]));
  const signed = new Set();
  for (const s of sigs) {
    if (!isObj(s)) continue;
    const d = normDomain(get(s, "domain"));
    if (!pin.has(d)) { refuse("stranger_signature"); continue; }
    const ok = ed25519Check(pin.get(d), get(s, "signature"), msg);
    if (ok === true) signed.add(d);
    else refuse(ok === false ? "bad_signature" : "unusable_signature");
  }
  for (const d of pin.keys()) if (!signed.has(d)) refuse("one_sided");
  return out();
}

// each party's key_url is https on the party's own domain or a subdomain of it (the rule a relying party's door applies to a party's key_url)
export function keyOnOwnDomain(party) {
  const d = get(party, "domain");
  const m = isStr(get(party, "key_url")) ? /^https:\/\/([A-Za-z0-9.-]+)(?::\p{Nd}+)?\//u.exec(party.key_url) : null;
  const h = m ? m[1].toLowerCase() : null;
  return isStr(d) && d !== "" && h !== null && (h === d.toLowerCase() || h.endsWith("." + d.toLowerCase()));
}

export { underDomain };

let isMain = false;
try { isMain = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch (_e) {}
if (isMain) {
  const i = process.argv.indexOf("--parts");
  if (i < 0) { console.error("usage: node contract_door_v0.mjs --parts corpus.json"); process.exit(1); }
  const inp = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
  process.stdout.write(JSON.stringify({
    doors: (inp.doors || []).map((x) => verifyContract(x.contract, x.parent ?? null)),
    subsets: (inp.subsets || []).map((x) => { try { return grantSubset(x.child, x.parent); } catch (_e) { return -1; } }),
    payloads: (inp.payloads || []).map((x) => { try { return payloadProblems(x.contract, x.action, x.payload); } catch (_e) { return ["unreadable"]; } }) }) + "\n");
}
