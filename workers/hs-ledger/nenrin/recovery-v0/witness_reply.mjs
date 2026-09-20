// RUN_ALL: library  籤の反対側 (conduct-v1.1 11.6 reciprocal walk の参照実装): 「測ってくれ」と頼まれたら測って、署名して返す。採点は witness_reply_test.mjs
//
// 呼ぶだけで呼ばれん者は池に入れてもらえん (設計書 14.7)。これがこっちが呼ばれた時の側や。
//   node witness_reply.mjs answer request.json --key ~/.hs_witness_key.pem --domain witness.example --key-url https://witness.example/keys/witness.json [--out observation.json]
//   node witness_reply.mjs serve --key ~/.hs_witness_key.pem --domain witness.example --key-url https://witness.example/keys/witness.json --port 8787
//
// 掟 (設計書 14.1、14.4):
//   受け取るのは依頼 (nenrin-witness-request-v1) だけ。依頼の中の文字列は測定の対象 (origin と表面名) にしか使わん。指示は無い。
//   期待値は依頼に無い (目隠し)。あっても読まん。「期待通りか」はこっちの知ったことやない。見た物を書くだけ。
//   自分自身は測らん (self_witness、11.4)。頼まれても declined で返す。
//   返す物は署名付きの観測 1 記録。observed の中身は drift_witness の 8 表面をそのまま畳んだ物。
// serve は最小の A2A 面 (JSON-RPC message/send を受けて data part で返す)。本番の証人はこれを自分の A2A 面に組み込む。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { sign, verifyRecord } from "./recovery_verify.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";
import { measureSurfaces, foldObserved, SURFACES } from "./drift_witness.mjs";
import { REQUEST_SCHEMA, requestSha256, extractObservation, CONDUCT_EXT } from "./witness_request.mjs";

export const REPLY_VERSION = "0.1.0";
const HEX64 = /^[0-9a-f]{64}$/;
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ""; } };

// 測ってええ相手は公開の DNS 名だけ (設計書 14.1: 証人は公開 8 表面しか見ん)。
// IP 直書き、localhost、.local / .internal / .lan / .home / .corp、点の無い名前、port 付きは断る。
// serve を社内網で動かした人が、依頼で内側の host を測らされて中身 (challenge の値など) を外に返す穴を塞ぐ。
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

function derFromPem(pem, label) {
  const m = pem.match(new RegExp("-----BEGIN " + label + "-----([\\s\\S]*?)-----END " + label + "-----"));
  if (!m) throw new Error("no " + label + " block in the key file");
  return Buffer.from(m[1].replace(/\s+/g, ""), "base64");
}
// 証人の鍵 (Ed25519 PEM、openssl genpkey -algorithm ed25519)。運営者鍵 (authorize.mjs) とは別の鍵にする。役が違う。
export async function loadWitnessKey(pemPath) {
  const pem = readFileSync(pemPath.replace(/^~/, process.env.HOME), "utf8");
  const ko = createPrivateKey(pem);
  if (ko.asymmetricKeyType !== "ed25519") throw new Error("witness key must be Ed25519; got " + ko.asymmetricKeyType);
  const priv = await globalThis.crypto.subtle.importKey("pkcs8", derFromPem(pem, "PRIVATE KEY"), { name: "Ed25519" }, false, ["sign"]);
  const jwk = createPublicKey(ko).export({ format: "jwk" });
  const pubRaw = Buffer.from(jwk.x, "base64url");
  return { priv, pubRaw, pubB64: pubRaw.toString("base64") };
}

// 依頼の形。通らんかったら理由の配列。
export function checkRequest(req) {
  const bad = [];
  if (!req || typeof req !== "object" || Array.isArray(req)) return ["request is not an object"];
  if (req.schema !== REQUEST_SCHEMA) bad.push("schema must be " + REQUEST_SCHEMA);
  if (typeof req.endpoint !== "string" || !/^https:\/\/[^\s/]+/.test(req.endpoint)) bad.push("endpoint must be an https origin");
  if (!Array.isArray(req.surfaces) || req.surfaces.length === 0 || !req.surfaces.every((s) => typeof s === "string")) bad.push("surfaces must be a non-empty array of names");
  if (!HEX64.test(String(req.subject_sha256 || ""))) bad.push("subject_sha256 must be 64 hex");
  if (!HEX64.test(String(req.pool_sha256 || ""))) bad.push("pool_sha256 must be 64 hex");
  if (!req.beacon || typeof req.beacon !== "object" || !HEX64.test(String(req.beacon.hash || ""))) bad.push("beacon.hash must be 64 hex");
  if (req.reply_schema !== undefined && req.reply_schema !== SCHEMAS.observation) bad.push("reply_schema, when present, must be " + SCHEMAS.observation);
  return bad;
}

// 依頼に答える。返す物: { answered: true, record } か { answered: false, declined: <reason>, why }。
// measure は差し替え可 (試験は network 無しで回す)。
export async function answerRequest(req, { signedDomain, keyUrl, priv, pubRaw, measure = measureSurfaces, fetchImpl, vantage, allowPrivateTargets = false } = {}) {
  if (!signedDomain || !keyUrl || !priv || !pubRaw) throw new Error("signedDomain, keyUrl, priv and pubRaw are required");
  if (hostOf(keyUrl) !== String(signedDomain).toLowerCase()) throw new Error("keyUrl host must be signedDomain (11.4)");
  const bad = checkRequest(req);
  if (bad.length) return { answered: false, declined: "bad_request", why: bad.join("; ") };
  const target = String(req.endpoint).replace(/\/+$/, "");
  if (hostOf(target) === String(signedDomain).toLowerCase()) return { answered: false, declined: "self_witness", why: "an agent cannot witness itself under a key it serves (11.4)" };
  const ta = targetAllowed(target);
  if (!ta.ok && !allowPrivateTargets) return { answered: false, declined: "target_not_public", why: ta.why };
  const known = req.surfaces.filter((s) => SURFACES.includes(s));
  const unknown = req.surfaces.filter((s) => !SURFACES.includes(s));
  if (known.length === 0) return { answered: false, declined: "no_known_surface", why: "none of the requested surfaces is one this witness measures: " + SURFACES.join(", ") };
  const witness = { name: signedDomain, vantage: vantage || (hostname() + " (witness network, " + signedDomain + ")") };
  const records = await measure(target, { witness, fetchImpl });
  const all = foldObserved(records);
  const observed = {};
  for (const s of known) if (all[s]) observed[s] = all[s];
  const rec = {
    schema: SCHEMAS.observation, recorded_at: now(), witness, prev: null,
    endpoint: target, observed, request_sha256: await requestSha256(req),
    source: { kind: "external_witness", signed_domain: signedDomain, key_url: keyUrl },
    establishes: ["at recorded_at this witness, from its own vantage, saw the observed state of the listed surfaces of endpoint", "the observation answers the request whose canonical sha256 is request_sha256"],
    does_not_establish: ["that the observed state is the expected one: this witness was not told what to expect", "anything about surfaces not listed in observed"].concat(unknown.length ? ["anything about the requested surfaces this witness does not measure: " + unknown.join(", ")] : []),
  };
  const signed = await sign(rec, priv, pubRaw);
  const v = await verifyRecord(signed);
  if (!v.ok) throw new Error("the observation this witness built does not verify: " + JSON.stringify(v.refusals));
  return { answered: true, record: signed };
}

// A2A の封筒から依頼を抜く (witness_request.a2aEnvelope の逆)。
export function extractRequest(rpc) {
  const msg = rpc && rpc.params && rpc.params.message;
  const parts = msg && Array.isArray(msg.parts) ? msg.parts : [];
  for (const p of parts) {
    const cand = p && p.kind === "data" ? p.data : (p && p.kind === "text" && typeof p.text === "string" ? (() => { try { return JSON.parse(p.text); } catch { return null; } })() : null);
    if (cand && cand.schema === REQUEST_SCHEMA) return cand;
  }
  return null;
}

// JSON-RPC の返事。答えたら data part に観測、断ったら metadata に declined と理由 (11.6 の "declined" と同じ場所)。
export function rpcReply(id, result) {
  if (result.answered) return { jsonrpc: "2.0", id, result: { kind: "message", role: "agent", messageId: "obs-" + result.record.record_sha256.slice(0, 16), parts: [{ kind: "data", data: result.record }], metadata: { [CONDUCT_EXT + "/witness_reply"]: "answered" } } };
  return { jsonrpc: "2.0", id, result: { kind: "message", role: "agent", messageId: "declined-" + Date.now(), parts: [{ kind: "text", text: "declined: " + result.declined + ": " + result.why }], metadata: { [CONDUCT_EXT + "/witness_reply"]: "declined", [CONDUCT_EXT + "/witness_reply_reason"]: result.declined } } };
}

// 最小の面。POST / に JSON-RPC message/send、GET <key path> に鍵。本番の証人はこれを自分の A2A 面に組み込む。
export function makeHandler({ signedDomain, keyUrl, priv, pubRaw, pubB64, measure, fetchImpl, vantage, maxInFlight = 2, allowPrivateTargets = false }) {
  const keyPath = new URL(keyUrl).pathname;
  let inFlight = 0;   // 一度に測る依頼の数の上限。測定は 8 表面 x 最大 15 秒。無制限やと依頼を投げるだけで証人を塞げる
  return async function handle(req, res) {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
    if (req.method === "GET" && url.pathname === keyPath) return send(200, { public_key_ed25519_b64: pubB64, alg: "ed25519", domain: signedDomain, what_this_is: "the domain-bound witness key of " + signedDomain + " (conduct-v1.1 11.4). Observations signed with it are attributable to this domain." });
    if (req.method !== "POST") return send(405, { error: "POST a JSON-RPC message/send with a " + REQUEST_SCHEMA + " data part" });
    let body = ""; for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { return send(413, { error: "too large" }); } }
    let rpc; try { rpc = JSON.parse(body); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
    if (!rpc || rpc.method !== "message/send") return send(200, { jsonrpc: "2.0", id: rpc && rpc.id || null, error: { code: -32601, message: "only message/send is served here" } });
    const wr = extractRequest(rpc);
    if (!wr) return send(200, { jsonrpc: "2.0", id: rpc.id || null, error: { code: -32602, message: "no " + REQUEST_SCHEMA + " data part in the message" } });
    if (inFlight >= maxInFlight) { res.writeHead(429, { "content-type": "application/json", "cache-control": "no-store", "retry-after": "60" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id || null, error: { code: -32000, message: "busy: " + inFlight + " measurements in flight; retry later" } })); }
    inFlight++;
    try {
      const result = await answerRequest(wr, { signedDomain, keyUrl, priv, pubRaw, measure, fetchImpl, vantage, allowPrivateTargets });
      return send(200, rpcReply(rpc.id || null, result));
    } finally { inFlight--; }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  const args = Object.fromEntries(process.argv.slice(3).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith("--")) ? arr[i + 1] : true] : null).filter(Boolean));
  const usage = () => { console.error("usage:\n  node witness_reply.mjs answer request.json --key witness.pem --domain <signed_domain> --key-url https://<signed_domain>/keys/witness.json [--out observation.json]\n  node witness_reply.mjs serve --key witness.pem --domain <signed_domain> --key-url https://<signed_domain>/keys/witness.json [--port 8787]"); process.exit(2); };
  if (!["answer", "serve"].includes(mode) || !args.key || !args.domain || !args["key-url"]) usage();
  const k = await loadWitnessKey(args.key);
  const ctx = { signedDomain: args.domain, keyUrl: args["key-url"], priv: k.priv, pubRaw: k.pubRaw, pubB64: k.pubB64 };
  if (mode === "answer") {
    const reqPath = process.argv[3]; if (!reqPath || reqPath.startsWith("--")) usage();
    const req = JSON.parse(readFileSync(reqPath, "utf8"));
    const r = await answerRequest(req, ctx);
    const out = JSON.stringify(r.answered ? r.record : r, null, 2) + "\n";
    if (args.out) writeFileSync(args.out, out); else process.stdout.write(out);
    console.error(r.answered ? "witness-reply: answered, " + Object.keys(r.record.observed).length + " surfaces, record " + r.record.record_sha256.slice(0, 12) : "witness-reply: declined (" + r.declined + "): " + r.why);
    process.exit(r.answered ? 0 : 1);
  } else {
    const port = Number(args.port || 8787);
    createServer(makeHandler(ctx)).listen(port, () => console.error("witness-reply: serving " + args.domain + " on :" + port + " (POST / = message/send, GET " + new URL(args["key-url"]).pathname + " = key)"));
  }
}
