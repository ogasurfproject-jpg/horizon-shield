// RUN_ALL: library  池を育てる口 (設計書 14.2): 条件を満たす card を集めて witness_pool.json を書く。採点は witness_reply_test.mjs (偽 fetch)
//
//   node witness_pool_build.mjs --register                       扉の公開 register (GET /register) の endpoint を候補に
//   node witness_pool_build.mjs --candidates origins.txt         1 行 1 origin を候補に
//   node witness_pool_build.mjs https://a.example https://b.example
//   共通: [--own-host gate.horizonshield.dev] [--min-walked 0] [--gate https://gate.horizonshield.dev] [--out witness_pool.json] [--report report.json]
//
// 入る条件 (新しい規則は作らん。conduct-v1.1 の 11.4 と 11.6 をそのまま読む):
//   1. /.well-known/agent-card.json が conduct-v1 拡張を宣言 (uri は 2 つの正確な文字列のどちらか、12.2)
//   2. /.well-known/mcp-conduct.json の witness_policy.reciprocal が true (11.5、11.6: 呼ばれたら測る、と自分で言うた者)
//   3. 鍵: consent の witness_key_url (https、host が origin と同じ) か、無ければ <origin>/keys/witness.json が {"public_key_ed25519_b64"} を配る (11.4: key_url の host が身元)
//   4. host が自分と違う (self_witness)
//   5. --min-walked N > 0 なら、扉の /register/lookup の last_ring.walked_as_witness が N 以上 (14.6 の Sybil 手当。既定 0 = ADR で決めるまで見ん)
// 運営者は選ばん。条件を満たす card は全部入る。落ちた候補は report に理由付きで残す (池には書かん)。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizePool, poolSha256, POOL_SCHEMA } from "./witness_draw.mjs";
import { targetAllowed } from "./witness_reply.mjs";

export const BUILD_VERSION = "0.1.0";
export const CONDUCT_URIS = ["https://gate.horizonshield.dev/ext/conduct/v1", "https://w3id.org/horizonshield/conduct/v1"];
const UA = { "user-agent": "nenrin-witness-pool-build/" + BUILD_VERSION };
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return ""; } };

async function getJson(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: { ...UA, accept: "application/json" }, signal: AbortSignal.timeout(15000), cache: "no-store", redirect: "manual" });
  if (!r.ok) return { status: r.status, json: null };
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
}

export function declaresConduct(card) {
  const exts = card && card.capabilities && Array.isArray(card.capabilities.extensions) ? card.capabilities.extensions : [];
  return exts.some((e) => e && CONDUCT_URIS.includes(e.uri));
}

// 1 候補の審査。ok なら entry。落ちたら refusals。
export async function admit(candidate, { ownHost, fetchImpl = globalThis.fetch, minWalked = 0, gateOrigin = "https://gate.horizonshield.dev", allowPrivateTargets = false } = {}) {
  const origin = String(candidate.origin || candidate).replace(/\/+$/, "");
  const host = hostOf(origin);
  const refusals = [];
  const refuse = (code, why) => refusals.push({ code, why });
  if (!host || !/^https:\/\//.test(origin)) return { ok: false, origin, refusals: [{ code: "bad_origin", why: "not an https origin" }] };
  const ta = targetAllowed(origin);
  if (!ta.ok && !allowPrivateTargets) return { ok: false, origin, refusals: [{ code: "not_public", why: ta.why }] };
  if (ownHost && host === String(ownHost).toLowerCase()) return { ok: false, origin, refusals: [{ code: "self_witness", why: "the operator's own host cannot be its own witness (11.4)" }] };
  const card = await getJson(fetchImpl, origin + "/.well-known/agent-card.json");
  if (!card.json) refuse("no_card", "GET /.well-known/agent-card.json answered " + card.status);
  else if (!declaresConduct(card.json)) refuse("no_conduct_ext", "the card does not declare conduct-v1 (" + CONDUCT_URIS.join(" or ") + ")");
  const consent = await getJson(fetchImpl, origin + "/.well-known/mcp-conduct.json");
  const wp = consent.json && consent.json.witness_policy;
  if (!consent.json) refuse("no_consent_file", "GET /.well-known/mcp-conduct.json answered " + consent.status);
  else if (!(wp && wp.reciprocal === true)) refuse("not_reciprocal", "witness_policy.reciprocal is not true (11.6): the owner has not said it measures when asked");
  let keyUrl = consent.json && typeof consent.json.witness_key_url === "string" ? consent.json.witness_key_url : origin + "/keys/witness.json";
  if (!/^https:\/\//.test(keyUrl) || hostOf(keyUrl) !== host) { refuse("bad_key_url", "witness_key_url must be https on the same host (11.4): " + keyUrl); keyUrl = ""; }
  let pub = "";
  if (keyUrl) {
    const k = await getJson(fetchImpl, keyUrl);
    pub = k.json && typeof k.json.public_key_ed25519_b64 === "string" ? k.json.public_key_ed25519_b64.trim() : "";
    if (!pub) refuse("no_key", "GET " + keyUrl + " did not serve public_key_ed25519_b64 (answered " + k.status + ")");
  }
  let walked = null;
  if (minWalked > 0) {
    const ep = candidate.endpoint || origin;
    const lk = await getJson(fetchImpl, gateOrigin.replace(/\/+$/, "") + "/register/lookup?endpoint=" + encodeURIComponent(ep));
    const ring = lk.json && lk.json.last_ring;
    walked = ring && ring.present !== false && ring.walked_as_witness !== undefined ? Number(ring.walked_as_witness) : 0;
    if (!(walked >= minWalked)) refuse("not_enough_walks", "walked_as_witness " + walked + " < " + minWalked + " (14.6: a domain enters the pool after it has filed walks about others)");
  }
  if (refusals.length) return { ok: false, origin, refusals, walked };
  const a2a = card.json && typeof card.json.url === "string" ? card.json.url : "";
  return { ok: true, origin, walked, entry: { signed_domain: host, key_url: keyUrl, public_key_ed25519_b64: pub, ...(a2a ? { a2a_url: a2a } : {}) } };
}

// 候補の列から池を組む。previous を渡すと固定文 (what_this_is 等) を引き継ぐ。
export async function buildPool(candidates, opts = {}) {
  const seen = new Set(); const entries = []; const rejected = [];
  for (const c of candidates) {
    const origin = String(c.origin || c).replace(/\/+$/, "");
    const host = hostOf(origin);
    if (!host || seen.has(host)) continue; seen.add(host);
    const r = await admit(c, opts);
    if (r.ok) entries.push(r.entry); else rejected.push({ origin, refusals: r.refusals.map((x) => x.code) });
  }
  normalizePool(entries);   // 重複や不正はここで投げる
  const prev = opts.previous || {};
  const pool = {
    schema: POOL_SCHEMA, generated_at: opts.now || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...(prev.what_this_is ? { what_this_is: prev.what_this_is } : {}), ...(prev.what_this_is_not ? { what_this_is_not: prev.what_this_is_not } : {}), ...(prev.admission ? { admission: prev.admission } : {}),
    min_walked: String(opts.minWalked || 0), candidates: String(seen.size), entries,
    note: entries.length ? entries.length + " of " + seen.size + " candidates met the conditions on generated_at" : "empty on generated_at: none of " + seen.size + " candidates met the conditions. An empty pool draws nobody and any quorum falls short (witness_quorum_short). That is the honest state until agents that meet the conditions exist.",
  };
  return { pool, pool_sha256: await poolSha256(pool), rejected };
}

export async function candidatesFromRegister(gateOrigin, fetchImpl = globalThis.fetch) {
  const reg = await getJson(fetchImpl, gateOrigin.replace(/\/+$/, "") + "/register");
  const rows = reg.json && Array.isArray(reg.json.rows) ? reg.json.rows : [];
  const out = []; const seen = new Set();
  for (const w of rows) {
    const ep = w && typeof w.endpoint === "string" ? w.endpoint : ""; if (!ep) continue;
    let origin = ""; try { origin = new URL(ep).origin; } catch { continue; }
    if (seen.has(origin)) continue; seen.add(origin);
    out.push({ origin, endpoint: ep });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const args = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) { const v = argv[i + 1]; if (v && !v.startsWith("--")) { args[a.slice(2)] = v; i++; } else args[a.slice(2)] = true; } else positional.push(a); }
  const gate = args.gate || "https://gate.horizonshield.dev";
  const ownHost = args["own-host"] || "gate.horizonshield.dev";
  let candidates = positional.map((o) => ({ origin: o }));
  if (args.candidates) candidates = candidates.concat(readFileSync(args.candidates, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")).map((o) => ({ origin: o })));
  if (args.register) candidates = candidates.concat(await candidatesFromRegister(gate));
  if (!candidates.length) { console.error("usage: node witness_pool_build.mjs (--register | --candidates origins.txt | <origin>...) [--own-host h] [--min-walked N] [--gate url] [--out witness_pool.json] [--report report.json]"); process.exit(2); }
  const outPath = args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), "witness_pool.json");
  const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  const { pool, pool_sha256, rejected } = await buildPool(candidates, { ownHost, minWalked: Number(args["min-walked"] || 0), gateOrigin: gate, previous });
  writeFileSync(outPath, JSON.stringify(pool, null, 2) + "\n");
  if (args.report) writeFileSync(args.report, JSON.stringify({ generated_at: pool.generated_at, pool_sha256, admitted: pool.entries.map((e) => e.signed_domain), rejected }, null, 2) + "\n");
  console.error("witness-pool-build: " + pool.entries.length + " admitted of " + pool.candidates + " candidates, pool_sha256 " + pool_sha256.slice(0, 12) + "; rejected: " + (rejected.map((r) => r.origin.replace(/^https:\/\//, "") + "(" + r.refusals.join(",") + ")").join(", ") || "none"));
}
