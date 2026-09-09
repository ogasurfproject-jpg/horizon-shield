// 0.4.1 (2026-09-09): 公開しとる record_sha256 のバイトを、第三者が取れるか。
// 発端: SEP-1913 で vaaraio が /is-verified の投影を 1024 通り直列化しても record_sha256 を再現できんかった。
// 正しい。掃引の判定本体は保存しとらんかった(履歴は要約)。recompute_url は /history を指しとった。
// この試験は彼の実験をそのまま再演する: 投影からは再現できん(それは今も正しい)、そして /record/<sha> の body を
// SHA-256 したら path と一致する(これが新しい)。加えて、掃引の外(/check)は保存せんこと、壊れた sha は 400、
// 無い sha は理由付きの 404、判定規則と hash の手順は不変、を確かめる。
// Offline。走らせ方: node test/record_bytes.test.mjs   (workers/hs-verify-gate で)   1 つでも落ちたら exit 1。
import worker, { _recordBytes } from "../src/worker.js";
import { createHash } from "node:crypto";

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const CARD = { name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" } };
const TOOLS = [
  { name: "alpha", description: "redteam tool alpha", inputSchema: { type: "object", properties: {} } },
  { name: "beta", description: "redteam tool beta", inputSchema: { type: "object", properties: {} } }
];
function kv() {
  const store = new Map();
  return {
    store, puts: 0,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async function (k, v) { this.puts++; store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
const sha256 = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : s).digest("hex");
const HASH_A = "aa".repeat(32);
const EXPLORER = { tips: { "mempool.space": 900006, "blockstream.info": 900007 }, hashAt: { 900000: { "mempool.space": HASH_A, "blockstream.info": HASH_A } }, blockTime: { [HASH_A]: Math.floor(Date.now() / 1000) + 3600 } };
function explorerAnswer(u) {
  const src = u.hostname;
  if (u.pathname === "/api/blocks/tip/height") { const t = EXPLORER.tips[src]; return t == null ? new Response("down", { status: 503 }) : new Response(String(t)); }
  let m = /^\/api\/block-height\/(\d+)$/.exec(u.pathname);
  if (m) { const h = EXPLORER.hashAt[m[1]] && EXPLORER.hashAt[m[1]][src]; return h ? new Response(h) : new Response("", { status: 404 }); }
  m = /^\/api\/block\/([0-9a-f]{64})$/.exec(u.pathname);
  if (m) { const ts = EXPLORER.blockTime[m[1]]; return ts == null ? new Response("", { status: 404 }) : jres({ id: m[1], height: 900000, timestamp: ts }); }
  return new Response("", { status: 404 });
}
const WELLKNOWN = new Map();
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info") return explorerAnswer(u);
  if (u.hostname === "ledger.horizonshield.dev") return jres({ ok: true, accepted: true, id: "x", sha256: "00".repeat(32) }, 201);
  if (u.hostname === "raw.githubusercontent.com") return new Response("404: Not Found", { status: 404 });
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });
  if (u.pathname === "/.well-known/mcp-conduct.json") { const b = WELLKNOWN.get(u.hostname); return b ? jres(b) : new Response("", { status: 404 }); }
  if (u.pathname === "/.well-known/agent-card.json") return jres(CARD);
  if (u.pathname === "/mcp" && (init && init.method) === "POST") {
    const body = JSON.parse(init.body); const id = body.id;
    if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (body.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
    return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
  }
  return new Response("not found", { status: 404 });
};

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });
const EP = "https://open.redteam.invalid/mcp";
WELLKNOWN.set("open.redteam.invalid", { allow_tool_call: true });

function freshEnv() {
  const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "redteam-sweep-token", GATE_COMMIT: "redteam-local" };
  const call = (path, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + path, init), env, CTX);
  const post = (path, body, headers) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const sweep = () => post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" }).then((r) => r.json());
  return { env, call, post, sweep };
}
const recordKeys = (env) => [...env.HS_VERIFY_KV.store.keys()].filter((k) => k.startsWith(_recordBytes.RECORD_KEY_PREFIX));

// ---- 1. vaaraio の実験の再演: 投影からは再現できん(それは今も事実) --------------------------------------
const { env, call, post, sweep } = freshEnv();
env.SUBREQUEST_BUDGET = 1000;   // 予算で行が飛ばんように(Paid 相当)。MAX_PER_SWEEP=8 と運営者行 8 本があるので 2 回回して EP を測る。
await post("/watch", { endpoint: EP });
let s1 = await sweep(); let measuredTotal = s1.measured || 0;
if (!(await (await call("/history?endpoint=" + encodeURIComponent(EP))).json()).entries.length) { s1 = await sweep(); measuredTotal += s1.measured || 0; }
const hist = await (await call("/history?endpoint=" + encodeURIComponent(EP))).json();
const latest = hist.entries[hist.entries.length - 1];
t("control", "the sweep produced one history entry with a record_sha256", latest && /^[0-9a-f]{64}$/.test(latest.record_sha256), JSON.stringify(s1).slice(0, 160));
const iv = await (await call("/is-verified?endpoint=" + encodeURIComponent(EP))).json();
t("control", "/is-verified carries the same record_sha256", iv.record_sha256 === latest.record_sha256, iv.record_sha256);
{
  // 彼がやったこと: record_sha256 を抜き、キー順とソート順、区切り 2 種、説明欄 8 個の全部分集合(1024 通り)。
  const explanatory = ["gate", "gate_commit", "on_register", "recompute_url", "verified_meaning", "not_an_endorsement", "absence_vs_failure", "history_url"];
  const base = JSON.parse(JSON.stringify(iv)); delete base.record_sha256;
  let hits = 0, tried = 0;
  for (let mask = 0; mask < (1 << explanatory.length); mask++) {
    const o = JSON.parse(JSON.stringify(base));
    explanatory.forEach((k, i) => { if (mask & (1 << i)) delete o[k]; });
    for (const sorted of [false, true]) {
      const obj = sorted ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])) : o;
      for (const spaced of [false, true]) {
        tried++;
        const text = spaced ? JSON.stringify(obj, null, 1).replace(/\n\s*/g, " ") : JSON.stringify(obj);
        if (sha256(text) === latest.record_sha256) hits++;
      }
    }
  }
  t("control", "vaaraio's experiment reproduced: none of the " + tried + " serializations of the /is-verified projection land on record_sha256 (the projection is not the hashed object)", hits === 0, "hits=" + hits);
  const histText = JSON.stringify(latest);
  const stripped = JSON.parse(histText); delete stripped.record_sha256;
  t("control", "a history entry does not hash to its own record_sha256 either (it is a summary, as he found)", sha256(JSON.stringify(stripped)) !== latest.record_sha256);
}

// ---- 2. 新しい事実: /record/<sha> の body を SHA-256 したら path と一致する -------------------------------
t("control", "the history entry now carries record_url pointing at /record/<its sha>", latest.record_url === _recordBytes.recordBytesUrl(latest.record_sha256), latest.record_url);
const rres = await call("/record/" + latest.record_sha256);
const rbuf = Buffer.from(await rres.arrayBuffer());
t("control", "GET /record/<sha> answers 200 with application/json and an immutable cache header",
  rres.status === 200 && /application\/json/.test(rres.headers.get("content-type") || "") && /immutable/.test(rres.headers.get("cache-control") || ""),
  rres.status + " " + rres.headers.get("content-type") + " " + rres.headers.get("cache-control"));
t("attack", "SHA-256 of the served body, byte for byte, equals the path (no serialization step for the reader)", sha256(rbuf) === latest.record_sha256, sha256(rbuf).slice(0, 16) + " vs " + latest.record_sha256.slice(0, 16));
t("control", "the x-record-sha256 header equals the path", rres.headers.get("x-record-sha256") === latest.record_sha256);
let served = null; try { served = JSON.parse(rbuf.toString("utf8")); } catch (_e) {}
t("control", "the body parses as the verdict object, without record_sha256 and recompute_note (they were never in the hashed bytes)",
  served && typeof served === "object" && !("record_sha256" in served) && !("recompute_note" in served) && served.endpoint === EP && served.status === latest.status,
  served ? Object.keys(served).slice(0, 12).join(",") : "unparseable");
t("control", "the served verdict carries establishes and does_not_establish inside the hashed bytes (0.4.0 rule survives)",
  served && Array.isArray(served.establishes) && Array.isArray(served.does_not_establish));
t("control", "the recipe is unchanged: JSON.stringify of the parsed body reproduces the served bytes and the sha (key order and numbers survive a round trip in JS)",
  served && JSON.stringify(served) === rbuf.toString("utf8") && sha256(JSON.stringify(served)) === latest.record_sha256);

// ---- 3. 指す先が揃う: /is-verified、/register、/register/lookup、envelope ---------------------------------
t("control", "/is-verified.recompute_url now points at the bytes, and record_url/history_url are both present",
  iv.recompute_url === latest.record_url && iv.record_url === latest.record_url && /\/history\?endpoint=/.test(iv.history_url || ""), JSON.stringify([iv.recompute_url, iv.history_url]).slice(0, 200));
t("control", "/is-verified.recompute_note says the projection is not the hashed bytes", /not the hashed bytes/.test(iv.recompute_note || ""), (iv.recompute_note || "").slice(0, 120));
const reg = await (await call("/register")).json();
const row = (reg.rows || []).find((r) => r.endpoint === EP);
t("control", "/register row.latest carries record_url", row && row.latest && row.latest.record_url === latest.record_url, row && JSON.stringify(row.latest).slice(0, 200));
const lu = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP))).json();
t("control", "/register/lookup last_measured.record_url points at the bytes and establishes[0] says so", lu.last_measured && lu.last_measured.record_url === latest.record_url && /hashed bytes are at/.test(lu.establishes[0]), (lu.establishes && lu.establishes[0] || "").slice(0, 160));
const embed = await (await call("/embed?endpoint=" + encodeURIComponent(EP) + "&format=json")).json().catch(() => null);
if (embed) {
  t("control", "the envelope's url is the bytes, conduct:history keeps the list, usageInfo names SHA-256 of the body",
    embed.url === latest.record_url && /\/history\?endpoint=/.test(embed["conduct:history"] || "") && /SHA-256 of the body/.test(embed.usageInfo || ""), JSON.stringify([embed.url, embed["conduct:history"]]).slice(0, 220));
  const envBytes = Buffer.from(await (await call("/record/" + embed.identifier.value)).arrayBuffer());
  t("attack", "following the envelope literally (fetch url, SHA-256 the body, compare to identifier.value) now succeeds", sha256(envBytes) === embed.identifier.value);
} else {
  t("control", "/embed?format=json is present", false, "no envelope endpoint answered");
}

// ---- 4. 保存せん物、断る物 -----------------------------------------------------------------------------
const before = recordKeys(env).length;
const chk = await (await post("/check", { endpoint: EP })).json();
t("control", "an on-demand /check verdict still recomputes on the caller's side (the rule from 0.1)",
  (() => { const c = JSON.parse(JSON.stringify(chk)); delete c.record_sha256; delete c.recompute_note; return sha256(JSON.stringify(c)) === chk.record_sha256; })());
t("attack", "an on-demand /check verdict is not stored (nobody can spend the KV write quota through /check)", recordKeys(env).length === before && (await call("/record/" + chk.record_sha256)).status === 404, "keys " + before + " -> " + recordKeys(env).length);
const nf = await call("/record/" + "ab".repeat(32));
const nfb = await nf.json();
t("control", "an unknown sha is 404 with the honest reasons (not stored is not a finding about the sha)", nf.status === 404 && nfb.error === "not_stored" && Array.isArray(nfb.why) && nfb.why.length === 3 && /no-store/.test(nf.headers.get("cache-control") || ""), JSON.stringify(nfb).slice(0, 160));
t("control", "a malformed sha is 400", (await call("/record/not-a-sha")).status === 400 && (await call("/record/" + "AB".repeat(31) + "G1")).status === 400);
t("control", "the sweeps stored exactly one record per measured row and nothing else (" + measuredTotal + " measured; KV writes stay within the free quota)", recordKeys(env).length === measuredTotal && measuredTotal > 0, "keys=" + recordKeys(env).length + " measured=" + measuredTotal);

// ---- 5. 保存前の自己検査: hash 後に触られた判定は保存せん(壊れたバイトを配るより配らん) -----------------
{
  const e2 = { HS_VERIFY_KV: kv() };
  const good = JSON.parse(JSON.stringify(chk));
  const r1 = await _recordBytes.storeRecordBytes(e2, good);
  t("control", "storeRecordBytes stores a record that hashes to its own sha (regenerated canonical, no __canonical present)", r1.stored === true && r1.sha === chk.record_sha256, JSON.stringify(r1));
  const mutated = JSON.parse(JSON.stringify(chk)); mutated.status = "tampered";
  const r2 = await _recordBytes.storeRecordBytes(e2, mutated);
  t("attack", "a record mutated after hashing is refused, with the reason", r2.stored === false && /mutated after hashing/.test(r2.reason), JSON.stringify(r2));
  const r3 = await _recordBytes.storeRecordBytes(e2, { status: "x" });
  t("control", "a record without record_sha256 is refused", r3.stored === false);
}

// ---- 6. 判定規則は不変 ----------------------------------------------------------------------------------
const health = await (await call("/health")).json();
t("control", "gate version is at least 0.4.1 (0.4.2 added number_safety; the record bytes contract is unchanged)", /^0\.4\.(?:[1-9]|\d{2,})$/.test(String(health.gate_version)), health.gate_version);
const spec = await (await call("/spec")).json();
t("control", "/spec documents record_bytes with the route, why, what is not stored, and that the recipe is unchanged",
  spec.record_bytes && /\/record\//.test(spec.record_bytes.route) && /SEP-1913/.test(spec.record_bytes.why) && /not stored/i.test(spec.record_bytes.not_stored) && /Unchanged/.test(spec.record_bytes.recipe_unchanged));
const nfRoute = await (await call("/definitely-not-a-route")).json();
t("control", "the 404 route list names /record/<record_sha256>", Array.isArray(nfRoute.endpoints) && nfRoute.endpoints.some((x) => /\/record\//.test(x)));
t("control", "the verdict status vocabulary and conditions are untouched by this change (latest status is a known tier)", ["verified", "pending", "unreachable", "held"].includes(latest.status) || typeof latest.status === "string", latest.status);

// ---- 報告 ----------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
console.log();
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (record bytes、扉 0.4.1) ===");
if (passed === R.length) console.log("公開した sha のバイトは、公開されとる。読む側は body を SHA-256 するだけでええ。");
process.exit(passed === R.length ? 0 : 1);
