// 0.3.5: 掃引を丸ごと回して、時刻座標の導出が「判定の中」だけやなく「履歴、掃引の記録、公開の窓」に残ることを確かめる。
// 発見(2026-09-06、論文チャット): 0.3.0〜0.3.4 は judgement に coordinate_derivation を載せながら summarise() が落としとった。
// Offline。globalThis.fetch を差し替える。*.redteam.invalid は実在せん(RFC 2606)。explorer 2 源は偽物。
// 走らせ方: node test/sweep_coordinate.test.mjs   (workers/hs-verify-gate で)   1 つでも落ちたら exit 1。
import worker from "../src/worker.js";
import * as nenrin from "../src/nenrin_instant.js";

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
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}

// 偽の explorer。tips と、基準高さの hash と、block の header time を差し替えられる。
const HASH_A = "aa".repeat(32), HASH_B = "bb".repeat(32);
const EXPLORER = { tips: { "mempool.space": 900006, "blockstream.info": 900007 }, hashAt: { 900000: { "mempool.space": HASH_A, "blockstream.info": HASH_A } }, blockTime: {}, calls: 0 };
function explorerAnswer(u) {
  EXPLORER.calls++;
  const src = u.hostname;
  if (u.pathname === "/api/blocks/tip/height") { const t = EXPLORER.tips[src]; return t == null ? new Response("down", { status: 503 }) : new Response(String(t)); }
  let m = /^\/api\/block-height\/(\d+)$/.exec(u.pathname);
  if (m) { const h = EXPLORER.hashAt[m[1]] && EXPLORER.hashAt[m[1]][src]; return h ? new Response(h) : new Response("", { status: 404 }); }
  m = /^\/api\/block\/([0-9a-f]{64})$/.exec(u.pathname);
  if (m) { const ts = EXPLORER.blockTime[m[1]]; return ts == null ? new Response("", { status: 404 }) : jres({ id: m[1], height: 900000, timestamp: ts }); }
  return new Response("", { status: 404 });
}
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info") return explorerAnswer(u);
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });
  if (u.pathname === "/.well-known/mcp-conduct.json") return jres({ allow_tool_call: true });
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

async function freshEnv() {
  const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "redteam-sweep-token", GATE_COMMIT: "redteam-local" };
  const call = (path, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + path, init), env, CTX);
  const post = (path, body, headers) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  await post("/watch", { endpoint: EP });
  // 最初の掃引は自前 8 行で MAX_PER_SWEEP を使い切り、新入りの行は溢れる(0.3.1 の順序規則)。2 回目で測られる。
  // その最初の掃引が「窓の最初の掃引」なので、規則の固定と salt の作成はここで起きる。
  const first = await post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" }).then((r) => r.json());
  return { env, call, post, first };
}
const sweep = (post) => post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" }).then((r) => r.json());
const hist = (call) => call("/history?endpoint=" + encodeURIComponent(EP)).then((r) => r.json());

// ---- 1. explorer が答え、block が salt より後: derived が履歴に残る ------------------------------
// salt は掃引の頭で作られる(初回)。block time はその後でなければ採られん。掃引時刻より 1 時間後の time を返す偽 block。
EXPLORER.blockTime[HASH_A] = Math.floor(Date.now() / 1000) + 3600;
{
  const { env, call, post, first } = await freshEnv();
  const sw = await sweep(post);
  t("control", "sweep record carries coordinate.derived true, the pinned rule and the beacon (0.3.5)",
    sw.coordinate && sw.coordinate.derived === true && sw.coordinate.rule && sw.coordinate.rule.rule === "derived" && sw.coordinate.beacon && sw.coordinate.beacon.block_hash === HASH_A && sw.coordinate.beacon.height === 900000,
    JSON.stringify(sw.coordinate).slice(0, 200));
  t("attack", "tips one block apart (900006 vs 900007) still derive: one reference height min(tip) - 6 (until 0.3.4 this fell back)",
    sw.coordinate && sw.coordinate.beacon && sw.coordinate.beacon.reference && sw.coordinate.beacon.reference.tips["blockstream.info"] === 900007 && sw.coordinate.derived === true,
    JSON.stringify(sw.coordinate && sw.coordinate.beacon && sw.coordinate.beacon.reference));
  t("control", "the sweep created the salt for the next window too, so its commitment exists before that window opens",
    sw.coordinate && sw.coordinate.next_window && /^w\d+$/.test(sw.coordinate.next_window.window_id) && /^[0-9a-f]{64}$/.test(sw.coordinate.next_window.commitment) && first.coordinate.salts_created_now.length === 2 && sw.coordinate.salts_created_now.length === 0,
    JSON.stringify([first.coordinate && first.coordinate.salts_created_now, sw.coordinate && sw.coordinate.salts_created_now]));
  const h = await hist(call);
  const e = h.entries && h.entries[h.entries.length - 1];
  t("attack", "the /history entry carries coordinate_derivation with derived true, beacon height as an integer and the hash (0.3.0 to 0.3.4 dropped it)",
    e && e.coordinate_derivation && e.coordinate_derivation.derived === true && Number.isInteger(e.coordinate_derivation.beacon.height) && e.coordinate_derivation.beacon.block_hash === HASH_A && /^[0-9a-f]{64}$/.test(e.coordinate_derivation.salt_commitment) && Number.isInteger(e.coordinate_derivation.day_in_window),
    JSON.stringify(e && e.coordinate_derivation).slice(0, 220));
  t("control", "the history entry names the tool set the derivation ran over (tool_set_sha256, tool_count 2)",
    e && e.coordinate_derivation && e.coordinate_derivation.tool_count === 2 && /^[0-9a-f]{64}$/.test(e.coordinate_derivation.tool_set_sha256),
    JSON.stringify(e && e.coordinate_derivation && [e.coordinate_derivation.tool_count, e.coordinate_derivation.tool_set_sha256]));
  t("control", "the history entry does not carry the seed or the salt (only the commitment and the block)",
    e && !("seed" in e.coordinate_derivation) && !("salt" in e.coordinate_derivation));
  const win = await (await call("/nenrin/window")).json();
  t("control", "/nenrin/window shows the current window with its commitment, pinned rule derived, the beacon, and no salt",
    win.current && win.current.status === "current" && win.current.commitment === sw.coordinate.commitment && win.current.rule && win.current.rule.rule === "derived" && win.current.beacon && win.current.beacon.block_hash === HASH_A && win.current.salt === null,
    JSON.stringify(win.current).slice(0, 200));
  t("control", "/nenrin/window shows the next window's commitment already (created at this sweep) and withholds its salt",
    win.next && win.next.status === "next" && win.next.commitment === sw.coordinate.next_window.commitment && win.next.salt === null && win.next.beacon === null,
    JSON.stringify(win.next).slice(0, 160));
  const one = await (await call("/nenrin/window/" + win.current.window_id)).json();
  t("control", "/nenrin/window/{window_id} returns the same window", one.window_id === win.current.window_id && one.commitment === win.current.commitment);
  const none = await call("/nenrin/window/w1");
  t("misclass", "an unknown window is 404, not an invented commitment", none.status === 404);
  const calls0 = EXPLORER.calls;
  await sweep(post);
  t("control", "a second sweep in the same window does not touch the explorers again (beacon cached per window)", EXPLORER.calls === calls0, "calls " + calls0 + " then " + EXPLORER.calls);
  const last = await (await call("/sweep/last")).json();
  t("control", "/sweep/last carries the coordinate block", last.coordinate && last.coordinate.derived === true && last.coordinate.window === "/nenrin/window");
}

// ---- 2. block が salt より前: 落ちる、理由が残る、窓は legacy に固定される -------------------------
EXPLORER.blockTime[HASH_A] = Math.floor(Date.now() / 1000) - 3600;
{
  const { env, call, post, first } = await freshEnv();
  t("attack", "a beacon block whose header time precedes the salt is refused: legacy, reason_code block_before_salt (this was production's shape until 0.3.4)",
    first.coordinate && first.coordinate.derived === false && first.coordinate.reason_code === "block_before_salt", JSON.stringify(first.coordinate && [first.coordinate.reason_code, (first.coordinate.why || "").slice(0, 80)]));
  const sw = await sweep(post);
  const h = await hist(call);
  const e = h.entries && h.entries[h.entries.length - 1];
  t("attack", "the /history entry says derived false with the fallback text and the reason_code (why the sweep fell back is now readable from the export)",
    e && e.coordinate_derivation && e.coordinate_derivation.derived === false && /legacy computable schedule/.test(e.coordinate_derivation.fallback) && e.coordinate_derivation.reason_code === "pinned_legacy" && /block_before_salt|header time/.test(e.coordinate_derivation.why || "") && e.coordinate_derivation.beacon === null,
    JSON.stringify(e && e.coordinate_derivation).slice(0, 220));
  // 翌日、block が salt より後になっても、この窓は legacy のまま(窓につき規則は 1 つ)
  EXPLORER.blockTime[HASH_A] = Math.floor(Date.now() / 1000) + 3600;
  const sw2 = await sweep(post);
  t("attack", "the next sweep of the same window stays legacy even though a valid beacon is now available (one rule per window, pinned at the first sweep)",
    sw2.coordinate && sw2.coordinate.derived === false && sw2.coordinate.reason_code === "pinned_legacy" && sw2.coordinate.rule && sw2.coordinate.rule.rule === "legacy" && sw2.coordinate.rule.reason_code === "block_before_salt",
    JSON.stringify(sw2.coordinate && [sw2.coordinate.reason_code, sw2.coordinate.rule]).slice(0, 200));
  const win = await (await call("/nenrin/window")).json();
  t("control", "/nenrin/window shows the pinned legacy rule with the original reason, and still no salt",
    win.current && win.current.rule && win.current.rule.rule === "legacy" && win.current.rule.reason_code === "block_before_salt" && win.current.salt === null && win.current.beacon === null,
    JSON.stringify(win.current && win.current.rule));
}

// ---- 3. explorer が 1 源しか答えん: 落ちる、源ごとの結果が残る ----------------------------------------
EXPLORER.tips = { "mempool.space": 900006 };
{
  const { call, post, first } = await freshEnv();
  t("attack", "only one source answers a tip: no beacon, reason_code tips_unavailable, every source named with its failure",
    first.coordinate && first.coordinate.derived === false && first.coordinate.reason_code === "tips_unavailable" && Array.isArray(first.coordinate.sources) && first.coordinate.sources.length === 3 && first.coordinate.sources.some((s) => /503/.test(s.error || "")),
    JSON.stringify(first.coordinate && first.coordinate.sources));
  await sweep(post);
  const h = await hist(call);
  const e = h.entries && h.entries[h.entries.length - 1];
  t("control", "the history entry keeps the reason_code but not the per-source dump (bounded entry)", e && e.coordinate_derivation && e.coordinate_derivation.reason_code === "pinned_legacy" && !("sources" in e.coordinate_derivation) && /tips_unavailable|fewer than/.test(e.coordinate_derivation.why || ""), JSON.stringify(e && e.coordinate_derivation && e.coordinate_derivation.why).slice(0, 160));
}

// ---- 4. 座標が無い一回きりの /check は、無いと書く ----------------------------------------------------
{
  const { post } = await freshEnv();
  const one = await (await post("/check", { endpoint: EP })).json();
  t("misclass", "a one-off /check still says derived false with the one-off reason (a /check is not a row on the register)",
    one.coordinate_derivation && one.coordinate_derivation.derived === false && one.coordinate_derivation.reason_code === "no_coordinate_context" && /one-off/.test(one.coordinate_derivation.why || ""),
    JSON.stringify(one.coordinate_derivation).slice(0, 160));
}

// ---- 4b. /nenrin/probe は書かん、固定せん ------------------------------------------------------------
EXPLORER.tips = { "mempool.space": 900006, "blockstream.info": 900007 };
EXPLORER.blockTime[HASH_A] = Math.floor(Date.now() / 1000) + 3600;
{
  const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "redteam-sweep-token", GATE_COMMIT: "redteam-local" };
  const call = (path, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + path, init), env, CTX);
  const noTok = await call("/nenrin/probe");
  t("attack", "/nenrin/probe without the sweep token is 403 (it makes the gate hit the explorers)", noTok.status === 403);
  const pr = await (await call("/nenrin/probe", { headers: { "x-sweep-token": "redteam-sweep-token" } })).json();
  t("control", "/nenrin/probe reports would_derive with the sources' answers and writes nothing (no window, no pin, no beacon cache)",
    pr.would_derive === true && pr.wrote_nothing === true && pr.block_hash === HASH_A && env.HS_VERIFY_KV.store.size === 0, JSON.stringify(pr).slice(0, 160));
}

// ---- 5. /spec は数と経路を言う ---------------------------------------------------------------------
{
  const { call } = await freshEnv();
  const spec = await (await call("/spec")).json();
  const ic = spec.instant_coordinate || {};
  t("control", "/spec names /nenrin/window, says the history carries the block since 0.3.5, and records the three departures found 2026-09-06",
    /\/nenrin\/window/.test(ic.window || "") && /history entry/.test(ic.in_every_verdict || "") && /2026-09-05T18:00Z/.test(ic.production_departures_found_2026_09_06 || "") && spec.version === "0.3.5",
    spec.version);
}

// ---- 報告 ----------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control", "misclass"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
console.log();
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (sweep coordinate、扉 0.3.5) ===");
if (passed === R.length) console.log("導出は判定の中だけやなく、履歴と掃引の記録と公開の窓に残る。落ちた理由も残る。");
process.exit(passed === R.length ? 0 : 1);
