// witness.js: 扉が「引かれたら答える証人」になる面 (TSUGI v2 籤の被証人側)。
//
// なぜ src/ に自前で書くか (2026-09-20):
//   参照実装は recovery-v0/witness_reply.mjs + drift_witness.mjs やが、あれは node: (fs/os/module/path) と
//   Buffer を使う。この扉の bundle は nodejs_compat 無し (compat 2024-01-01) やから、あれは積めん。
//   なので Worker-native に書き直す。byte がずれたら引いた観測が TSUGI の検証器 (recovery_verify) で verify せんので、
//   canonical / hash / 署名 / 記録の形 / 9 表面の observed を、参照と 1 バイト違わんように写す。
//   その一致は test/witness_parity.test.mjs が Node 参照と突き合わせて守る (cardSignatureCanonical を
//   canon_equiv が守るのと同じ規律: 写しは許す、ただし写しがずれたら試験が落ちる)。
//
// 掟 (設計書 14.1/14.4、witness_reply.mjs と同じ):
//   受け取るのは依頼 (nenrin-witness-request-v1) だけ。中の文字列は測定対象 (origin と表面名) にしか使わん。指示は無い。
//   期待値は依頼に無い (目隠し)。自分自身は測らん (self_witness)。非公開 target (IP/localhost/内側名/port) は断る。
//   返すのは署名付きの観測 1 記録 (nenrin-witness-observation-v1)。署名鍵は運営者鍵とも card 鍵とも別 (env.WITNESS_PRIVKEY_B64)。

export const REQUEST_SCHEMA = "nenrin-witness-request-v1";
export const OBSERVATION_SCHEMA = "nenrin-witness-observation-v1";
export const CONDUCT_EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
// drift_witness.mjs が測る 9 表面。名前も順も同じ。
export const WITNESS_SURFACES = ["health.gate_commit", "agent-card.signature", "well-known.jwks", "well-known.openai-apps-challenge", "ext.conduct-v1.spec", "keys.agreement", "keys.witness", "keys.operator", "well-known.did"];

const HEX64 = /^[0-9a-f]{64}$/;
const enc = new TextEncoder();
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ""; } };

// ---- canonical: agreement-v0/agreement_canonical.mjs の canonicalUtf8 の写し (直列化の半分だけ) ----
// 完全一致は test/witness_parity.test.mjs が本物と突き合わせて守る。記録層は ensure_ascii=False。
const CP = (s) => Array.from(s, (c) => c.codePointAt(0));
function cmpCodePoints(a, b) {
  if (a === b) return 0;
  const x = CP(a), y = CP(b), n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length === y.length ? 0 : (x.length < y.length ? -1 : 1);
}
const SHORT = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r" };
const hex4 = (n) => "\\u" + n.toString(16).padStart(4, "0");
function strUtf8(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (SHORT[c] !== undefined) out += SHORT[c];
    else if (c < 0x20) out += hex4(c);
    else out += s[i];
  }
  return out + '"';
}
const EXP = /^(\d)(?:\.(\d+))?e([+-]\d+)$/;
function pyFinite(a) {
  const m = EXP.exec(a.toExponential());
  if (!m) throw new Error("toExponential unreadable: " + a.toExponential());
  const digits = m[1] + (m[2] || "");
  const decpt = Number(m[3]) + 1;
  if (decpt <= -4 || decpt > 16) {
    const mant = digits.length > 1 ? digits[0] + "." + digits.slice(1) : digits;
    const e = decpt - 1;
    return mant + "e" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  }
  if (decpt <= 0) return "0." + "0".repeat(-decpt) + digits;
  if (decpt >= digits.length) return digits + "0".repeat(decpt - digits.length) + ".0";
  return digits.slice(0, decpt) + "." + digits.slice(decpt);
}
function num(v) {
  if (typeof v === "bigint") return v.toString();
  if (typeof v !== "number") throw new TypeError("not a number: " + typeof v);
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  const neg = v < 0 || Object.is(v, -0);
  return (neg ? "-" : "") + pyFinite(neg ? -v : v);
}
function build(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number" || t === "bigint") return num(v);
  if (t === "string") return strUtf8(v);
  if (Array.isArray(v)) return "[" + v.map(build).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(v).sort(cmpCodePoints);
    let out = "{", first = true;
    for (const k of keys) { if (!first) out += ","; first = false; out += strUtf8(k) + ":" + build(v[k]); }
    return out + "}";
  }
  throw new TypeError("unserialisable: " + t);
}
export function canonicalUtf8(v) { return build(v); }

// ---- hash と署名 (recovery_verify.mjs の写し。Buffer を atob/btoa に替えた分だけ違う) ----
export async function sha256Hex(bytes) {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const b64ToBytes = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const bytesToB64 = (b) => { let bin = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]); return btoa(bin); };
function hashedBody(record) { const { record_sha256, signature_ed25519_b64, public_key_ed25519_b64, ...rest } = record; return rest; }
const canonicalText = (record) => canonicalUtf8(hashedBody(record));
const canonicalBytes = (record) => enc.encode(canonicalText(record));
const recordSha256 = (record) => sha256Hex(canonicalBytes(record));
async function seal(record) { const r = { ...hashedBody(record) }; r.record_sha256 = await recordSha256(r); return r; }
// privateKey は WebCrypto CryptoKey (Ed25519, sign)、publicKeyRaw は 32 バイト Uint8Array。
export async function sign(record, privateKey, publicKeyRaw) {
  const r = await seal(record);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, canonicalBytes(r));
  return { ...r, signature_ed25519_b64: bytesToB64(sig), public_key_ed25519_b64: bytesToB64(publicKeyRaw) };
}
export async function verifyOwn(record) {
  const h = await recordSha256(record);
  if (record.record_sha256 !== h) return { ok: false, why: "record_sha256 mismatch" };
  try {
    const key = await crypto.subtle.importKey("raw", b64ToBytes(record.public_key_ed25519_b64), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64ToBytes(record.signature_ed25519_b64), canonicalBytes(record));
    return ok ? { ok: true } : { ok: false, why: "signature does not verify" };
  } catch (e) { return { ok: false, why: "verify failed: " + (e && e.message || e) }; }
}

// ---- 鍵を env から読む (pkcs8 の base64、= PEM の BEGIN/END の間) ----
export async function loadWitnessKeyFromEnv(env) {
  const privB64 = (env && env.WITNESS_PRIVKEY_B64 ? String(env.WITNESS_PRIVKEY_B64) : "").replace(/\s+/g, "");
  const pubB64 = (env && env.WITNESS_PUBKEY_B64 ? String(env.WITNESS_PUBKEY_B64) : "").replace(/\s+/g, "");
  if (!privB64 || !pubB64) return null;
  const priv = await crypto.subtle.importKey("pkcs8", b64ToBytes(privB64), { name: "Ed25519" }, false, ["sign"]);
  return { priv, pubRaw: b64ToBytes(pubB64), pubB64 };
}

// ---- 依頼の形 (witness_reply.checkRequest の写し) ----
export function checkRequest(req) {
  const bad = [];
  if (!req || typeof req !== "object" || Array.isArray(req)) return ["request is not an object"];
  if (req.schema !== REQUEST_SCHEMA) bad.push("schema must be " + REQUEST_SCHEMA);
  if (typeof req.endpoint !== "string" || !/^https:\/\/[^\s/]+/.test(req.endpoint)) bad.push("endpoint must be an https origin");
  if (!Array.isArray(req.surfaces) || req.surfaces.length === 0 || !req.surfaces.every((s) => typeof s === "string")) bad.push("surfaces must be a non-empty array of names");
  if (!HEX64.test(String(req.subject_sha256 || ""))) bad.push("subject_sha256 must be 64 hex");
  if (!HEX64.test(String(req.pool_sha256 || ""))) bad.push("pool_sha256 must be 64 hex");
  if (!req.beacon || typeof req.beacon !== "object" || !HEX64.test(String(req.beacon.hash || ""))) bad.push("beacon.hash must be 64 hex");
  if (req.reply_schema !== undefined && req.reply_schema !== OBSERVATION_SCHEMA) bad.push("reply_schema, when present, must be " + OBSERVATION_SCHEMA);
  return bad;
}
export const requestSha256 = (req) => sha256Hex(canonicalUtf8(req));

// 測ってええ相手は公開の DNS 名だけ (witness_reply.targetAllowed の写し)。
export function targetAllowed(origin) {
  let u; try { u = new URL(origin); } catch { return { ok: false, why: "not a URL" }; }
  if (u.protocol !== "https:") return { ok: false, why: "only https origins are measured" };
  if (u.port) return { ok: false, why: "an explicit port is not measured (public origins answer on 443)" };
  if (u.username || u.password) return { ok: false, why: "credentials in the origin are refused" };
  const h = u.hostname.toLowerCase();
  if (/^\[?[0-9a-f:.]+\]?$/.test(h) && (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":"))) return { ok: false, why: "IP literals are not measured" };
  if (h === "localhost" || !h.includes(".") || /\.(local|localhost|internal|intranet|lan|home|corp|test|example|invalid|onion)$/.test(h)) return { ok: false, why: "not a public DNS name: " + h };
  return { ok: true };
}

// ---- 9 表面の測定 (drift_witness.measureSurfaces の写し、baseline/expect/repo 無しの分だけ) ----
// card 表面の canonical と verify は扉が既に持つ関数を注入する (SDK を積まんため):
//   canonicalizeCard(card) -> { canonical, unsupported }   (= cardSignatureCanonical)
//   verifyCard(card, origin) -> { verified:boolean, kid, alg, jku, why }  (verifyCardSignatures を worker.js で畳んだ物)
const UA = { "user-agent": "nenrin-drift-witness/0.2" };
export async function measureWitnessSurfaces(originIn, { fetchImpl, canonicalizeCard, verifyCard } = {}) {
  const origin = String(originIn).replace(/\/+$/, "");
  const f = fetchImpl || globalThis.fetch;
  const observed = {};
  async function get(pathname, headers = {}) {
    const r = await f(origin + pathname, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000), redirect: "manual", cache: "no-store" });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, json };
  }
  // 1
  try {
    const h = await get("/health");
    const gc = h.json && typeof h.json.gate_commit === "string" ? h.json.gate_commit : "";
    observed["health.gate_commit"] = { status: String(h.status), gate_commit: gc, gate_version: String(h.json && h.json.gate_version || "") };
  } catch (e) { observed["health.gate_commit"] = { error: String(e && e.message || e) }; }
  // 2
  try {
    const c = await get("/.well-known/agent-card.json");
    const card = c.json || {};
    const cc = canonicalizeCard ? canonicalizeCard(card) : { canonical: "", unsupported: ["no canonicalizer injected"] };
    const canonical_sha256 = cc.unsupported ? "" : await sha256Hex(cc.canonical);
    const sigs = Array.isArray(card.signatures) ? card.signatures : [];
    let vr = { verified: false, kid: "", alg: "", jku: "", why: sigs.length ? "" : "card carries no signatures" };
    if (sigs.length && verifyCard) vr = await verifyCard(card, origin);
    observed["agent-card.signature"] = { status: String(c.status), verified: String(!!vr.verified), canonical_sha256, kid: String(vr.kid || ""), alg: String(vr.alg || ""), jku: String(vr.jku || ""), signatures: String(sigs.length), ...(vr.why ? { why: String(vr.why) } : {}) };
  } catch (e) { observed["agent-card.signature"] = { error: String(e && e.message || e) }; }
  // 3
  try {
    const j = await get("/.well-known/jwks.json");
    const keys = (j.json && Array.isArray(j.json.keys)) ? j.json.keys : [];
    const thumbs = {};
    for (const k of keys) thumbs[String(k.kid || "?")] = await sha256Hex(JSON.stringify({ crv: k.crv, kty: k.kty, x: k.x, y: k.y }));
    observed["well-known.jwks"] = { status: String(j.status), kids: keys.map((k) => String(k.kid || "")).join(","), thumbprints: thumbs };
  } catch (e) { observed["well-known.jwks"] = { error: String(e && e.message || e) }; }
  // 4
  try {
    const ch = await get("/.well-known/openai-apps-challenge");
    const configured = ch.status === 200 && ch.json === null && ch.text.trim().length > 0;
    observed["well-known.openai-apps-challenge"] = { status: String(ch.status), configured: String(configured), ...(configured ? { value: ch.text.trim(), sha256: await sha256Hex(ch.text.trim()) } : { body: ch.text.slice(0, 200) }) };
  } catch (e) { observed["well-known.openai-apps-challenge"] = { error: String(e && e.message || e) }; }
  // 5
  try {
    const s = await get("/ext/conduct/v1", { accept: "application/json" });
    observed["ext.conduct-v1.spec"] = { status: String(s.status), served_sha256: String(s.json && s.json.spec_markdown_sha256 || "") };
  } catch (e) { observed["ext.conduct-v1.spec"] = { error: String(e && e.message || e) }; }
  // 6,7,8
  for (const [surface, p] of [["keys.agreement", "/keys/agreement.json"], ["keys.witness", "/keys/witness.json"], ["keys.operator", "/keys/operator.json"]]) {
    try {
      const k = await get(p);
      const present = k.status === 200 && k.json && typeof k.json.public_key_ed25519_b64 === "string";
      observed[surface] = { status: String(k.status), present: String(!!present), ...(present ? { key_sha256: await sha256Hex(k.json.public_key_ed25519_b64) } : {}) };
    } catch (e) { observed[surface] = { error: String(e && e.message || e) }; }
  }
  // 9
  try {
    const d = await get("/.well-known/did.json");
    const doc = d.json;
    const present = d.status === 200 && doc && typeof doc.id === "string" && Array.isArray(doc.verificationMethod);
    const vm = present ? [...doc.verificationMethod].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((m) => ({ id: String(m.id), jwk: m.publicKeyJwk })) : [];
    const did_sha256 = present ? await sha256Hex(JSON.stringify(vm)) : "";
    const kids = present ? doc.verificationMethod.map((m) => String(m.id).split("#")[1] || "").join(",") : "";
    observed["well-known.did"] = { status: String(d.status), present: String(!!present), ...(present ? { id: String(doc.id), kids, did_sha256 } : {}) };
  } catch (e) { observed["well-known.did"] = { error: String(e && e.message || e) }; }
  return observed;
}

// ---- 依頼に答える (witness_reply.answerRequest の写し) ----
// 返す物: { answered: true, record } か { answered: false, declined, why }。
export async function answerWitnessRequest(req, { signedDomain, keyUrl, priv, pubRaw, measure, clock } = {}) {
  if (!signedDomain || !keyUrl || !priv || !pubRaw) throw new Error("signedDomain, keyUrl, priv and pubRaw are required");
  if (hostOf(keyUrl) !== String(signedDomain).toLowerCase()) throw new Error("keyUrl host must be signedDomain (11.4)");
  const bad = checkRequest(req);
  if (bad.length) return { answered: false, declined: "bad_request", why: bad.join("; ") };
  const target = String(req.endpoint).replace(/\/+$/, "");
  if (hostOf(target) === String(signedDomain).toLowerCase()) return { answered: false, declined: "self_witness", why: "an agent cannot witness itself under a key it serves (11.4)" };
  const ta = targetAllowed(target);
  if (!ta.ok) return { answered: false, declined: "target_not_public", why: ta.why };
  const known = req.surfaces.filter((s) => WITNESS_SURFACES.includes(s));
  const unknown = req.surfaces.filter((s) => !WITNESS_SURFACES.includes(s));
  if (known.length === 0) return { answered: false, declined: "no_known_surface", why: "none of the requested surfaces is one this witness measures: " + WITNESS_SURFACES.join(", ") };
  const all = await measure(target);
  const observed = {};
  for (const s of known) if (all[s]) observed[s] = all[s];
  const rec = {
    schema: OBSERVATION_SCHEMA, recorded_at: (clock || now)(), witness: { name: signedDomain, vantage: "gate.horizonshield.dev (cloudflare edge, " + signedDomain + ")" }, prev: null,
    endpoint: target, observed, request_sha256: await requestSha256(req),
    source: { kind: "external_witness", signed_domain: signedDomain, key_url: keyUrl },
    establishes: ["at recorded_at this witness, from its own vantage, saw the observed state of the listed surfaces of endpoint", "the observation answers the request whose canonical sha256 is request_sha256"],
    does_not_establish: ["that the observed state is the expected one: this witness was not told what to expect", "anything about surfaces not listed in observed"].concat(unknown.length ? ["anything about the requested surfaces this witness does not measure: " + unknown.join(", ")] : []),
  };
  const signed = await sign(rec, priv, pubRaw);
  const v = await verifyOwn(signed);
  if (!v.ok) throw new Error("the observation this witness built does not verify: " + v.why);
  return { answered: true, record: signed };
}

// A2A の封筒から依頼を抜く (data part 優先、次に JSON として読める text part)。
export function extractRequest(parts) {
  for (const p of (Array.isArray(parts) ? parts : [])) {
    const cand = p && p.kind === "data" ? p.data : (p && p.kind === "text" && typeof p.text === "string" ? (() => { try { return JSON.parse(p.text); } catch { return null; } })() : null);
    if (cand && cand.schema === REQUEST_SCHEMA) return cand;
  }
  return null;
}
// JSON-RPC の返事 (witness_reply.rpcReply の写し)。答えたら data part に観測、断ったら metadata に理由。
export function rpcReplyResult(result) {
  if (result.answered) return { kind: "message", role: "agent", messageId: "obs-" + result.record.record_sha256.slice(0, 16), parts: [{ kind: "data", data: result.record }], metadata: { [CONDUCT_EXT + "/witness_reply"]: "answered" } };
  return { kind: "message", role: "agent", messageId: "declined-" + Date.now(), parts: [{ kind: "text", text: "declined: " + result.declined + ": " + result.why }], metadata: { [CONDUCT_EXT + "/witness_reply"]: "declined", [CONDUCT_EXT + "/witness_reply_reason"]: result.declined } };
}
