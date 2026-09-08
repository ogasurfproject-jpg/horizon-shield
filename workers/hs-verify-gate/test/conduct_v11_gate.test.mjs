// 0.4.0 (conduct-v1.1、2026-09-07): 扉の側の 4 つを丸ごと回して確かめる。
//   1. 判定と /self と /history に establishes / does_not_establish が入り、hash の中にある(抜いた引用は recompute せん)。
//   2. 掃引が塩の commitment を台帳の witness intake に commitment 型で出す。窓ごとに 1 回。**本物の台帳の worker** が受ける。
//   3. GET /register/lookup: verified / pending / declined / unknown、先月の輪の数、24 時間 cache、証明せん物。
//   4. well-known の notify: 掃引後に 1 回 POST、1 時間に 1 回、/check からは飛ばさん、IP 直書きや扉自身は断る。
// Offline。globalThis.fetch を差し替える。*.redteam.invalid は実在せん(RFC 2606)。explorer 2 源は偽物。
// 台帳は ../../hs-ledger/src/worker.js をそのまま読む(写しを持たん。写しを持った瞬間に台帳とズレて嘘をつく)。
// 走らせ方: node test/conduct_v11_gate.test.mjs   (workers/hs-verify-gate で)   1 つでも落ちたら exit 1。
import worker from "../src/worker.js";
import ledger from "../../hs-ledger/src/worker.js";
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
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    puts: 0,
    put: async function (k, v) { this.puts++; store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// 偽の explorer。salt より後の block を返す(derived になる)。
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

// 本物の台帳。KV は偽物。扉が https://ledger.horizonshield.dev/witness に出した POST はここに届く。
const LEDGER_ENV = { LEDGER: kv(), LEDGER_ADMIN_TOKEN: "redteam-ledger-admin" };
const LEDGER_LOG = [];
// 台帳の address lane は 1 日 5 本(conduct-v1.1)。試験の節ごとに送信元を変える(本番では窓ごとに 2 本なので届かん)。
let LEDGER_IP = "203.0.113.7";
async function ledgerAnswer(url, init) {
  const req = new Request(url, { method: (init && init.method) || "GET", headers: { ...((init && init.headers) || {}), "cf-connecting-ip": LEDGER_IP }, body: init && init.body });
  const res = await ledger.fetch(req, LEDGER_ENV, CTX);
  const body = await res.clone().json().catch(() => null);
  LEDGER_LOG.push({ url: String(url), method: req.method, status: res.status, body, record: init && init.body ? JSON.parse(init.body) : null });
  return res;
}

// 輪。先月の輪を 1 本だけ持つ endpoint と、輪の無い endpoint。
const RING_STORE = new Map();
const RAW_LOG = [];
const rawHitsTotal = () => RAW_LOG.length;
const kvPutsFor = (env) => env.HS_VERIFY_KV.puts;
const NOTIFY_LOG = [];
const WELLKNOWN = new Map();   // hostname → well-known body

globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info") return explorerAnswer(u);
  if (u.hostname === "ledger.horizonshield.dev") return ledgerAnswer(url, init);
  if (u.hostname === "raw.githubusercontent.com") { RAW_LOG.push({ url: String(url), cf: init && init.cf }); const r = RING_STORE.get(u.pathname); return r ? jres(r) : new Response("404: Not Found", { status: 404 }); }
  if (u.hostname === "hooks.redteam.invalid") { NOTIFY_LOG.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers }); return new Response(null, { status: 204 }); }
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
const EP_NOTIFY = "https://notify.redteam.invalid/mcp";
const EP_BADNOTIFY = "https://badnotify.redteam.invalid/mcp";
const EP_DECLINE = "https://decline.redteam.invalid/mcp";
WELLKNOWN.set("open.redteam.invalid", { allow_tool_call: true });
WELLKNOWN.set("notify.redteam.invalid", { allow_tool_call: true, notify: "https://hooks.redteam.invalid/measured", identity: "https://notify.redteam.invalid/about", witness_policy: { reciprocal: true } });
WELLKNOWN.set("badnotify.redteam.invalid", { allow_tool_call: true, notify: "https://203.0.113.9/hook" });
WELLKNOWN.set("decline.redteam.invalid", { allow_tool_call: true, listing: "decline" });

function freshEnv() {
  const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "redteam-sweep-token", GATE_COMMIT: "redteam-local" };
  const call = (path, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + path, init), env, CTX);
  const post = (path, body, headers) => call(path, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
  const sweep = () => post("/sweep", { force: true }, { "x-sweep-token": "redteam-sweep-token" }).then((r) => r.json());
  return { env, call, post, sweep };
}
const strList = (x) => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string" && s.length > 0);

// ---- 1. 判定の中の establishes / does_not_establish ------------------------------------------------------
{
  const { call, post } = freshEnv();
  const v = await (await post("/check", { endpoint: EP })).json();
  t("control", "a /check verdict carries establishes and does_not_establish as non-empty string lists",
    strList(v.establishes) && strList(v.does_not_establish), JSON.stringify([v.establishes && v.establishes.length, v.does_not_establish && v.does_not_establish.length]));
  t("control", "does_not_establish names correctness of answers, truth of compensation, other vantages and unmeasured conditions",
    /correct/i.test(v.does_not_establish.join(" ")) && /compensation/i.test(v.does_not_establish.join(" ")) && /vantage/i.test(v.does_not_establish.join(" ")) && /not measured|unmeasured/i.test(v.does_not_establish.join(" ")),
    v.does_not_establish.join(" | ").slice(0, 300));
  t("control", "establishes names the instant, the gate commit and the conditions that passed on this run",
    /checked_at|at /i.test(v.establishes.join(" ")) && /commit/i.test(v.establishes.join(" ")) && /passed|pass/i.test(v.establishes.join(" ")),
    v.establishes.join(" | ").slice(0, 300));
  // hash の中にあるか: verify_verdict と同じ手で recompute する(record_sha256 と recompute_note を抜いて JSON.stringify して sha256)。
  const recompute = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.record_sha256; delete c.recompute_note; return sha256(JSON.stringify(c)); };
  const stripped = JSON.parse(JSON.stringify(v)); delete stripped.establishes; delete stripped.does_not_establish;
  t("attack", "the arrays are inside the hashed bytes: the full record recomputes to record_sha256, a quote with the arrays removed does not",
    recompute(v) === v.record_sha256 && recompute(stripped) !== v.record_sha256, JSON.stringify([recompute(v).slice(0, 12), v.record_sha256.slice(0, 12), recompute(stripped).slice(0, 12)]));
  const mcp = await (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "verify_verdict", arguments: { record: stripped } } })).json();
  const vv = mcp && mcp.result && mcp.result.structuredContent ? mcp.result.structuredContent : (mcp && mcp.result && mcp.result.content && mcp.result.content[0] && JSON.parse(mcp.result.content[0].text));
  t("attack", "verify_verdict over MCP rejects the quote without the arrays", vv && vv.verified === false, JSON.stringify(vv).slice(0, 160));
  const self = await (await call("/self")).json();
  const sr = self.record || self;
  t("control", "the gate's own /self record carries both arrays too (the gate is a subject of its own rule)",
    strList(sr.establishes) && strList(sr.does_not_establish), JSON.stringify(Object.keys(self)).slice(0, 200));
  t("control", "the /self record's own record_sha256 covers the arrays", sr.record_sha256 && recompute(sr) === sr.record_sha256, JSON.stringify([sr.record_sha256 && sr.record_sha256.slice(0, 12), recompute(sr).slice(0, 12)]));
}

// ---- 2. 掃引が commitment を台帳に出す(本物の台帳が受ける) ---------------------------------------------
{
  const { env, call, post, sweep } = freshEnv();
  await post("/watch", { endpoint: EP });
  LEDGER_LOG.length = 0;
  const s1 = await sweep();
  const posts = LEDGER_LOG.filter((l) => l.method === "POST" && /\/witness$/.test(l.url));
  t("control", "the first sweep of a window files two commitment records to the ledger witness intake (current window and next window)",
    posts.length === 2 && posts.every((p) => p.status === 201), JSON.stringify(posts.map((p) => [p.status, p.body && (p.body.error || p.body.reason_code || p.body.mode)])));
  const recs = posts.map((p) => JSON.parse(p.record.record_canonical));
  t("control", "each record is conduct-v1.1 mode commitment with a 64-hex commitment, establishes and does_not_establish, and the real ledger's validator accepted it (mode commitment, stored pending)",
    recs.every((r) => r.mode === "commitment" && /^[0-9a-f]{64}$/.test(r.commitment) && strList(r.establishes) && strList(r.does_not_establish) && r.schema === "jidec-path-v1") && posts.every((p) => p.body && p.body.mode === "commitment" && p.body.status === "pending"),
    JSON.stringify(posts.map((p) => p.body)).slice(0, 300));
  t("attack", "the record's base is the window page on the gate, not an MCP endpoint, so a ring builder never counts the gate's own commitment as a witness of any endpoint",
    recs.every((r) => /^https:\/\/gate\.horizonshield\.dev\/nenrin\/window\/w\d+$/.test(r.base) && /^nenrin-instant-commitment-v1: w\d+$/.test(r.purpose)),
    JSON.stringify(recs.map((r) => [r.base, r.purpose])));
  t("control", "the commitment in the record equals the commitment the sweep published for that window",
    recs.some((r) => r.commitment === s1.coordinate.commitment) && recs.some((r) => r.commitment === s1.coordinate.next_window.commitment),
    JSON.stringify([s1.coordinate.commitment, s1.coordinate.next_window.commitment, recs.map((r) => r.commitment)]));
  const nextRec = recs.find((r) => r.commitment === s1.coordinate.next_window.commitment);
  t("control", "the next window's record says it was filed before the window opens (before_open), the current window's says after",
    nextRec && /before the window opens/.test(nextRec.establishes.join(" ")) && s1.coordinate.commitments_filed.some((c) => c.before_open === true) && s1.coordinate.commitments_filed.some((c) => c.before_open === false),
    JSON.stringify(s1.coordinate.commitments_filed.map((c) => [c.window_id, c.before_open, c.http, c.sha && c.sha.slice(0, 8)])));
  t("control", "/sweep/last carries coordinate.commitments_filed with the ledger sha and url for each window",
    s1.coordinate.commitments_filed.length === 2 && s1.coordinate.commitments_filed.every((c) => /^[0-9a-f]{64}$/.test(c.sha) && /^https:\/\/ledger\.horizonshield\.dev\/witness\/[0-9a-f]{64}$/.test(c.url) && c.error === null),
    JSON.stringify(s1.coordinate.commitments_filed).slice(0, 300));
  const n1 = LEDGER_LOG.length;
  const s2 = await sweep();
  const posts2 = LEDGER_LOG.slice(n1).filter((l) => l.method === "POST");
  t("attack", "a second sweep in the same window files nothing again (once per window; the KV record is reused), yet still reports the filed commitments",
    posts2.length === 0 && s2.coordinate.commitments_filed.length === 2 && s2.coordinate.commitments_filed[0].sha === s1.coordinate.commitments_filed[0].sha,
    JSON.stringify([posts2.length, s2.coordinate.commitments_filed.map((c) => c.sha && c.sha.slice(0, 8))]));
  const win = await (await call("/nenrin/window")).json();
  t("control", "/nenrin/window shows commitment_filed on the current and next window: sha, ledger url, before_open, no error",
    win.current && win.current.commitment_filed && win.current.commitment_filed.sha && win.current.commitment_filed.before_open === false && win.next && win.next.commitment_filed && win.next.commitment_filed.before_open === true && win.next.commitment_filed.error === null,
    JSON.stringify([win.current && win.current.commitment_filed, win.next && win.next.commitment_filed]).slice(0, 300));
  t("control", "/nenrin/window's anchoring text says the commitment is filed to the witness intake and what a null commitment_filed means",
    win.rules && /witness intake/.test(win.rules.anchoring || "") && /commitment_filed/.test(win.rules.anchoring || ""), JSON.stringify(win.rules && Object.keys(win.rules)));
  // 台帳の側: pending に載り、counted:true(名前 lane、初回)、mode commitment。
  const pend = await (await ledger.fetch(new Request("https://ledger.horizonshield.dev/witness/pending"), LEDGER_ENV, CTX)).json();
  t("control", "the real ledger lists both records as pending with mode commitment",
    pend && Array.isArray(pend.pending) && pend.pending.filter((r) => r.mode === "commitment").length === 2 && pend.counted === 2, JSON.stringify(pend).slice(0, 200));
  // 履歴にも disclaimers が残る(summarise)。
  const h = await (await call("/history?endpoint=" + encodeURIComponent(EP))).json();
  const e = h.entries && h.entries[h.entries.length - 1];
  t("control", "the /history entry carries establishes and does_not_establish (summarise keeps them, so the export is not silent on them)",
    e && strList(e.establishes) && strList(e.does_not_establish), JSON.stringify(e && Object.keys(e)).slice(0, 200));
  // 台帳が死んどっても掃引は止まらん、結果は error として残る。
  const { post: post3, sweep: sweep3 } = freshEnv();
  await post3("/watch", { endpoint: EP });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (new URL(url).hostname === "ledger.horizonshield.dev") throw new Error("connect timeout"); return realFetch(url, init); };
  const s3 = await sweep3();
  globalThis.fetch = realFetch;
  t("attack", "when the ledger is unreachable the sweep still runs and records the failure honestly (http 0, error, sha null); it does not pretend to have anchored",
    s3.ran === true && s3.coordinate.commitments_filed.length === 2 && s3.coordinate.commitments_filed.every((c) => c.http === 0 && c.sha === null && /unreachable|timeout/.test(c.error || "")),
    JSON.stringify(s3.coordinate.commitments_filed).slice(0, 200));
  void env;
}

// ---- 3. GET /register/lookup ---------------------------------------------------------------------------
{
  const { env, call, post, sweep } = freshEnv();
  const lastMonth = (() => { const d = new Date(); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); return m.getUTCFullYear() + "-" + String(m.getUTCMonth() + 1).padStart(2, "0"); })();
  RING_STORE.set("/ogasurfproject-jpg/mcp-conduct-register/main/rings/open-redteam-invalid-mcp/" + lastMonth + ".json", {
    schema: "nenrin-ring-v1", ring: lastMonth, endpoint: EP, witnesses: 3, witnesses_signed: 2, witnesses_unsigned: 1,
    discrepancies: ["x"], discrepancies_signed: [], commitments_unrevealed: 1, walked_as_witness: 2, instants_sampled: 30, instants_reached: 29, instants_derived: 25, surface_changes: [], record_sha256_last: "b".repeat(64), prev_ring_sha256: null
  });
  const bad = await call("/register/lookup");
  t("misclass", "lookup without endpoint is 400 with an example", bad.status === 400);
  const unk = await call("/register/lookup?endpoint=" + encodeURIComponent("https://nobody.redteam.invalid/mcp"));
  const uj = await unk.json();
  t("control", "an endpoint with no row reads status unknown, says unknown is not a finding, and names how to appear",
    unk.status === 200 && uj.status === "unknown" && /not a finding|never a finding/.test(uj.status_meaning + " " + uj.does_not_establish.join(" ")) && uj.how_to_appear && uj.last_measured === null,
    JSON.stringify([uj.status, uj.status_meaning]).slice(0, 200));
  t("control", "lookup is served with a 24 hour public cache header and says so in the body",
    /max-age=86400/.test(unk.headers.get("cache-control") || "") && /86400/.test(uj.cache || ""), unk.headers.get("cache-control"));
  t("attack", "an unknown endpoint's last_ring says present false and that nothing was fetched: a lookup of a random endpoint never makes the gate fetch from the register repo (no row, no ring, no subrequest, no KV write)",
    uj.last_ring && uj.last_ring.present === false && uj.last_ring.slug === "nobody-redteam-invalid-mcp" && uj.last_ring.tried.length === 0 && /Nothing was fetched/.test(uj.last_ring.why) && rawHitsTotal() === 0 && kvPutsFor(env) === 0,
    JSON.stringify([uj.last_ring, rawHitsTotal(), kvPutsFor(env)]).slice(0, 240));
  await post("/watch", { endpoint: EP });
  const w1 = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP))).json();
  t("control", "watched but not yet measured reads pending, with measurements 0 (being watched is not a measurement)",
    w1.status === "pending" && w1.measurements === 0 && w1.last_measured === null && /not a measurement/.test(w1.status_meaning), JSON.stringify([w1.status, w1.status_meaning]));
  t("control", "the last ring's counts are copied as counts (witnesses 3, signed 2, unsigned 1, discrepancies 1, commitments 1, walked_as_witness 2), never as a rate or a score",
    w1.last_ring.present === true && w1.last_ring.witnesses === 3 && w1.last_ring.witnesses_signed === 2 && w1.last_ring.witnesses_unsigned === 1 && w1.last_ring.discrepancies === 1 && w1.last_ring.commitments_unrevealed === 1 && w1.last_ring.walked_as_witness === 2 && !("score" in w1) && !("rate" in w1.last_ring) && /v1\.1/.test(w1.last_ring.columns),
    JSON.stringify(w1.last_ring).slice(0, 300));
  await sweep(); await sweep();
  const w2 = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP))).json();
  t("control", "after a passing sweep the status reads verified with the latest record sha and the coordinate (derived true, window id)",
    w2.status === "verified" && /^[0-9a-f]{64}$/.test(w2.last_measured.record_sha256) && w2.last_measured.coordinate && w2.last_measured.coordinate.derived === true && /^w\d+$/.test(w2.last_measured.coordinate.window_id) && w2.measurements >= 1,
    JSON.stringify([w2.status, w2.last_measured]).slice(0, 300));
  t("control", "does_not_establish on a verified reading still refuses safety, correctness, completeness of witnesses and freshness beyond the cache",
    /safe|correct/.test(w2.does_not_establish.join(" ")) && /complete|representative/.test(w2.does_not_establish.join(" ")) && /cache/.test(w2.does_not_establish.join(" ")), w2.does_not_establish.join(" | ").slice(0, 300));
  t("control", "the reading names the conduct record, the witness intake and the ring path so a reader can go to the bytes",
    /\/history\?endpoint=/.test(w2.conduct_record) && w2.witness_intake === "https://ledger.horizonshield.dev/witness" && w2.rings && w2.rings.slug === "open-redteam-invalid-mcp", JSON.stringify([w2.conduct_record, w2.rings]));
  // declined
  await post("/watch", { endpoint: EP_DECLINE });
  await sweep();
  const wd = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP_DECLINE))).json();
  t("control", "an owner who placed listing: decline reads declined with the date, and the reading says declining is a right, not a finding",
    wd.status === "declined" && wd.owner_declined_at && /right, not a finding/.test(wd.status_meaning), JSON.stringify([wd.status, wd.owner_declined_at]));
  // 輪が別の endpoint の物(slug 衝突)なら無視する
  RING_STORE.set("/ogasurfproject-jpg/mcp-conduct-register/main/rings/collide-redteam-invalid-mcp/" + lastMonth + ".json", { schema: "nenrin-ring-v1", ring: lastMonth, endpoint: "https://other.redteam.invalid/mcp", witnesses: 99 });
  await post("/watch", { endpoint: "https://collide.redteam.invalid/mcp" });
  const wc = await (await call("/register/lookup?endpoint=" + encodeURIComponent("https://collide.redteam.invalid/mcp"))).json();
  t("attack", "a ring file whose endpoint field is a different endpoint (slug collision) is ignored, not copied",
    wc.last_ring.present === false && wc.last_ring.tried.some((x) => /different endpoint/.test(x.why || "")), JSON.stringify(wc.last_ring).slice(0, 200));
  // cache は edge(fetch の cf.cacheTtlByStatus)。KV には書かん(Free 枠の KV 書き込み 1000/日を lookup で食わせん)。
  const putsBefore = kvPutsFor(env);
  const hitsBefore = rawHitsTotal();
  await call("/register/lookup?endpoint=" + encodeURIComponent(EP));
  t("attack", "a lookup writes nothing to KV (the ring is cached at the edge, not in the store the sweep's history depends on)", kvPutsFor(env) === putsBefore, "puts " + putsBefore + " then " + kvPutsFor(env));
  t("control", "the ring fetch carries the edge cache hint (cacheEverything, 24 hours for 200, 1 hour for 404) and tries at most the last two months",
    RAW_LOG.slice(hitsBefore).length <= 2 && RAW_LOG.slice(hitsBefore).every((x) => x.cf && x.cf.cacheEverything === true && x.cf.cacheTtlByStatus["200-299"] === 86400 && x.cf.cacheTtlByStatus["404"] === 3600), JSON.stringify(RAW_LOG.slice(hitsBefore)).slice(0, 200));
  t("control", "the 404 list names /register/lookup", (await (await call("/nope")).json()).endpoints.includes("/register/lookup"));
  const spec = await (await call("/spec")).json();
  t("control", "/spec is 0.4.x and describes lookup, the disclaimers inside the hash, the anchoring of the commitment, and the notify field of the consent file",
    /^0\.4\.\d+$/.test(spec.version) && spec.lookup && /register\/lookup/.test(spec.lookup.route) && spec.establishes_and_does_not_establish && /record_sha256/.test(spec.establishes_and_does_not_establish.what) && spec.instant_coordinate && /witness intake/.test(spec.instant_coordinate.anchoring || "") && spec.well_known_consent && /once per hour/.test(spec.well_known_consent.shape.notify || ""),
    JSON.stringify([spec.version, Object.keys(spec.lookup || {}), Object.keys(spec.well_known_consent && spec.well_known_consent.shape || {})]));
}

// ---- 3b. subrequest 予算 -------------------------------------------------------------------------------------
// Free は 1 回の実行で fetch 50 本。窓の初回は beacon 7 + commitment 2 が先に乗る。溢れる行は測らずに理由を書く。
{
  LEDGER_IP = "203.0.113.8";
  const { env, post, sweep } = freshEnv();
  env.SUBREQUEST_BUDGET = 20;
  await post("/watch", { endpoint: EP });
  const s = await sweep();
  t("attack", "with a budget of 20 the first sweep of a window (beacon 7 + commitments 2 first) stops measuring before the budget can be overrun, records subrequests.used within the budget, and lists every unmeasured row under skipped with the budget reason",
    s.subrequests && s.subrequests.budget === 20 && s.subrequests.used <= 20 && s.measured === s.results.length && s.measured >= 1 && s.skipped.filter((x) => /subrequest budget/.test(x.reason)).length >= 1 && s.skipped.filter((x) => /subrequest budget/.test(x.reason)).every((x) => /goes first next time/.test(x.reason)),
    JSON.stringify([s.subrequests, s.measured, s.skipped.length, s.skipped[0] && s.skipped[0].reason.slice(0, 60)]));
  t("control", "the commitments were still filed on that sweep (they come before the rows, next window first)",
    s.coordinate.commitments_filed.length === 2 && s.coordinate.commitments_filed[0].before_open === true && s.coordinate.commitments_filed.every((c) => c.http === 201), JSON.stringify(s.coordinate.commitments_filed.map((c) => [c.window_id, c.before_open, c.http])));
  const s2 = await sweep();
  t("control", "the next sweep of the same window pays neither the beacon nor the commitments (cached and filed), so it measures more rows on the same budget",
    s2.subrequests.used <= 20 && s2.measured > s.measured, JSON.stringify([s.measured, s2.measured, s2.subrequests]));
  const { post: p3, sweep: sw3 } = freshEnv();
  await p3("/watch", { endpoint: EP });
  const s3 = await sw3();
  t("control", "with the default budget (50) the sweep reports subrequests used and budget, and nothing is skipped for budget",
    s3.subrequests && s3.subrequests.budget === 50 && s3.subrequests.used < 50 && !s3.skipped.some((x) => /subrequest budget/.test(x.reason)), JSON.stringify(s3.subrequests));
  const one = await (await p3("/check", { endpoint: EP })).json();
  t("control", "a /check outside a sweep counts nothing (the budget is sweep-scoped) and still measures", one.status && !("subrequests" in one), JSON.stringify(one.status));
}

// ---- 4. notify --------------------------------------------------------------------------------------------
{
  LEDGER_IP = "203.0.113.9";
  const { call, post, sweep } = freshEnv();
  await post("/watch", { endpoint: EP_NOTIFY });
  await post("/watch", { endpoint: EP_BADNOTIFY });
  NOTIFY_LOG.length = 0;
  await sweep();   // 自前 8 行で枠が埋まる。新入りは 2 回目。
  const s = await sweep();
  const rowN = s.results.find((r) => r.endpoint === EP_NOTIFY);
  const rowB = s.results.find((r) => r.endpoint === EP_BADNOTIFY);
  t("control", "after a scheduled measurement the gate POSTs once to the notify URL the owner placed in the consent file, and the sweep row records notify_status sent with the status code",
    NOTIFY_LOG.length === 1 && rowN && rowN.notify_status && rowN.notify_status.sent === true && rowN.notify_status.status === 204,
    JSON.stringify([NOTIFY_LOG.length, rowN && rowN.notify_status]));
  const nb = NOTIFY_LOG[0] && NOTIFY_LOG[0].body;
  t("control", "the notification carries event measured, the endpoint, the status, the record sha, establishes and does_not_establish, and says why it was sent and how to stop it",
    nb && nb.event === "measured" && nb.endpoint === EP_NOTIFY && /^[0-9a-f]{64}$/.test(nb.record_sha256) && strList(nb.establishes) && strList(nb.does_not_establish) && /Remove the field to stop/.test(nb.note) && /lookup\?endpoint=/.test(nb.lookup),
    JSON.stringify(nb && Object.keys(nb)));
  t("attack", "a notify URL that is an IP literal is refused and the refusal is written in the row (the gate is not a tool for reaching into someone's network)",
    NOTIFY_LOG.every((n) => !/203\.0\.113\.9/.test(n.url)) && rowB && rowB.notify_status && rowB.notify_status.sent === false && /IP literal/.test(rowB.notify_status.reason),
    JSON.stringify(rowB && rowB.notify_status));
  const s3 = await sweep();
  const rowN3 = s3.results.find((r) => r.endpoint === EP_NOTIFY);
  t("attack", "a second measurement within the hour does not notify again: rate limited, one per endpoint per hour, and the row says so",
    NOTIFY_LOG.length === 1 && rowN3 && rowN3.notify_status && rowN3.notify_status.sent === false && /rate limited/.test(rowN3.notify_status.reason), JSON.stringify(rowN3 && rowN3.notify_status));
  await post("/check", { endpoint: EP_NOTIFY });
  await post("/check", { endpoint: EP_NOTIFY, allow_tool_call: true });
  t("attack", "an on-demand /check never notifies (anyone can call /check; it must not be a way to make the gate POST to a third party's URL)", NOTIFY_LOG.length === 1, "notify count " + NOTIFY_LOG.length);
  const rowOpen = s.results.find((r) => r.endpoint === "https://mcp.horizonshield.dev/mcp") || s.results[0];
  t("control", "rows without a notify field carry notify_status null, not an error", rowOpen && rowOpen.notify_status === null, JSON.stringify(rowOpen && rowOpen.notify_status));
  t("control", "identity and witness_policy in the consent file change nothing about the verdict (declared, not verified)",
    rowN && rowN.status === "verified", JSON.stringify(rowN && rowN.status));
  const lk = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP_NOTIFY))).json();
  t("control", "lookup copies identity and witness_policy from the consent file as declared (kind url, reciprocal true, notify_present) and says they are not verified; the notify URL itself is not published",
    lk.declared && lk.declared.identity && lk.declared.identity.kind === "url" && lk.declared.identity.ref === "https://notify.redteam.invalid/about" && lk.declared.witness_policy && lk.declared.witness_policy.reciprocal === true && lk.declared.notify_present === true && /not verified/.test(lk.declared.note) && !JSON.stringify(lk).includes("hooks.redteam.invalid"),
    JSON.stringify(lk.declared));
  const lo = await (await call("/register/lookup?endpoint=" + encodeURIComponent(EP_BADNOTIFY))).json();
  t("control", "a consent file with only a (refused) notify reads declared with notify_present false and no identity", lo.declared && lo.declared.notify_present === false && lo.declared.identity === null, JSON.stringify(lo.declared));
}

// ---- 報告 ----------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control", "misclass"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
console.log();
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (conduct-v1.1 gate side、扉 0.4.0) ===");
if (passed === R.length) console.log("判定は自分が証明せん物を hash の中に持つ。塩の約束は台帳に出る。繋ぐ前に 1 本で読める。知らせは所有者が置いた所へだけ飛ぶ。");
process.exit(passed === R.length ? 0 : 1);
