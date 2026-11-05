// parity_run.mjs (段 1、扉 0.4.22。段 2 で adapter を src/ の本物の SDK の形に替え、PARITY_STORE=azurite で Azurite に置く)  扉(hs-verify-gate)を書き換えずに、1 つの置き場と 1 組の var の上で決まった筋書きを回し、見えた物を JSON で出す。
// 使い方: node parity_run.mjs <workers/hs-verify-gate の dir> <mode>
//   mode  置き場                       var
//   cf           Cloudflare の偽物(KV、DO)   無し(扉の既定: cloudflare、https://gate.horizonshield.dev、自前の行あり、全部の口)
//   cf-norows    Cloudflare の偽物            OWN_ROWS=off だけ(写しと同じ行の組で比べるため)
//   azure-plain  Azure の偽物(Table、Blob)   GATE_PLATFORM=azure、GATE_PUBLIC_ORIGIN=https://gate-az.horizonshield.dev だけ
//   azure        Azure の偽物                 写しの var 全部(上の 2 つと OWN_ROWS=off、GATE_PATHS=replica)
// parity.test.mjs が mode ごとに別の process で回し(モジュールの状態を持ち越さないため)、出力のバイトを比べる。
// 前の parity/(37/37)からの差: mode と var、客の origin の well-known に notify を足した(知らせの本文の URL の差を見るため)、
// 台帳への POST の本文(窓の塩の commitment)と notify の本文を書き出す。
//
// 決めて固定する物:
//   時計     Date を差し替え、new Date() と Date.now() は NOW を返す(18:00Z の掃引、翌日の cron)
//   乱数     crypto.getRandomValues と crypto.randomUUID を種の決まった xorshift に替える。NENRIN の窓の塩、
//            網の数の塩、lease の token がここから出るので「固定の塩」になる
//   外の世界 globalThis.fetch を偽物に替える。下の表に無い host は例外で落とす(網に出ない)
// 筋書き:
//   1. Marketplace の客の endpoint を paid と webhook で登録(POST /watch、運営の token)
//   2. 1 日目 18:00Z: POST /sweep {force:true}(運営の掃引)。客の endpoint は全条件 pass
//   3. 2 日目 18:00Z: 客の card から compensation が消える。cron(worker.scheduled)が測り、条件が反転し、
//      客の webhook に conformance_change が飛ぶ
//   4. /history、/record/<sha>、/register/lookup を読み、置き場の中身を全部書き出す

import { pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { makeCfKv, makeCfDoNamespace } from "./fake_cloudflare.mjs";
import { FakeTableClient, FakeBlobContainer } from "./fake_azure.mjs";
import { makeKvOnTable } from "../../src/kv_table.mjs";
import { makeLeaseNamespace } from "../../src/lease_table.mjs";
import { makeBlobText } from "../../src/blob_text.mjs";
import { newTable, newContainer } from "../azurite.mjs";   // 段 2: PARITY_STORE=azurite の時、azure の置き場を Azurite にする

const [gateDir, mode] = process.argv.slice(2);
const MODES = {
  "cf":          { store: "cf",    vars: {} },
  "cf-norows":   { store: "cf",    vars: { OWN_ROWS: "off" } },
  "azure-plain": { store: "azure", vars: { GATE_PLATFORM: "azure", GATE_PUBLIC_ORIGIN: "https://gate-az.horizonshield.dev" } },
  "azure":       { store: "azure", vars: { GATE_PLATFORM: "azure", GATE_PUBLIC_ORIGIN: "https://gate-az.horizonshield.dev", OWN_ROWS: "off", GATE_PATHS: "replica" } },
};
if (!gateDir || !MODES[mode]) { console.error("usage: node parity_run.mjs <gate dir> <" + Object.keys(MODES).join("|") + ">"); process.exit(2); }
const which = MODES[mode].store;
const ORIGIN = MODES[mode].vars.GATE_PUBLIC_ORIGIN || "https://gate.horizonshield.dev";

// ---- 時計 ----
const RealDate = Date;
const NOW = { v: RealDate.parse("2026-11-05T18:00:00.000Z") };
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW.v); else super(...a); }
  static now() { return NOW.v; }
}
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
globalThis.Date = FixedDate;

// ---- 乱数(固定の種)----
let seed = 0x5a17c0de;
function next32() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; }
let randomBytesDrawn = 0;
crypto.getRandomValues = (arr) => {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let i = 0; i < u8.length; i++) u8[i] = next32() & 255;
  randomBytesDrawn += u8.length;
  return arr;
};
// 段 2: Azure の SDK は要求ごとに crypto.randomUUID で x-ms-client-request-id を作る。その引きを固定の種から取ると、
// worker の塩の並びがずれる。SDK(node_modules の中)からの呼びだけは本物の乱数に回す。試験の道具だけの扱い。
const realRandomUUID = crypto.randomUUID.bind(crypto);
crypto.randomUUID = () => {
  if (/[\\/]node_modules[\\/]/.test(new Error().stack || "")) return realRandomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
};

// ---- 外の世界 ----
const EP = "https://mcp.customer-a.invalid/mcp";
const HOOK = "https://hooks.customer-a.invalid/hs";
const NOTIFY = "https://hooks.customer-a.invalid/notify";
const NOTIFY_BODIES = [];
const LEDGER_BODIES = [];
let PHASE = 1;
const HOOK_BODIES = [];
const FETCH_LOG = [];
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const TOOLS = [
  { name: "alpha", description: "tool alpha", inputSchema: { type: "object", properties: {} } },
  { name: "beta", description: "tool beta", inputSchema: { type: "object", properties: {} } },
];
const card = () => PHASE === 1
  ? { name: "Customer A Agent", description: "a customer endpoint", url: "",
      compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://customer-a.invalid/disclosure" } }
  : { name: "Customer A Agent", description: "a customer endpoint", url: "" };
const HASH_A = "ab".repeat(32);
function explorer(u) {
  const tip = { "mempool.space": 900006, "blockstream.info": 900007, "mempool.emzy.de": 900006 }[u.hostname];
  if (u.pathname === "/api/blocks/tip/height") return new Response(String(tip));
  if (/^\/api\/block-height\/900000$/.test(u.pathname)) return new Response(HASH_A);
  if (u.pathname === "/api/block/" + HASH_A) return jres({ id: HASH_A, height: 900000, timestamp: Math.floor(RealDate.parse("2026-11-05T18:30:00Z") / 1000) });   // salt(18:00Z)より後の block
  return new Response("", { status: 404 });
}
globalThis.fetch = async (url, init) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  FETCH_LOG.push(u.hostname + u.pathname);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info" || u.hostname === "mempool.emzy.de") return explorer(u);
  if (u.hostname === "ledger.horizonshield.dev") { if (init && typeof init.body === "string") LEDGER_BODIES.push(init.body); return jres({ ok: true, accepted: true, id: "parity", sha256: "00".repeat(32) }, 201); }
  if (u.hostname === "raw.githubusercontent.com") return new Response("404: Not Found", { status: 404 });
  if (/\.horizonshield\.dev$/.test(u.hostname)) return new Response("not found", { status: 404 });   // 自前の 9 行: 決まった失敗
  if (u.origin + u.pathname === NOTIFY) { NOTIFY_BODIES.push(typeof init.body === "string" ? init.body : String(init.body)); return new Response("ok", { status: 200 }); }
  if (u.origin + u.pathname === HOOK) { HOOK_BODIES.push(typeof init.body === "string" ? init.body : String(init.body)); return new Response("ok", { status: 200 }); }
  if (u.hostname === "mcp.customer-a.invalid") {
    if (u.pathname === "/.well-known/mcp-conduct.json") return jres({ allow_tool_call: true, notify: NOTIFY });
    if (u.pathname === "/.well-known/agent-card.json") return jres(card());
    if (u.pathname === "/mcp" && init && init.method === "POST") {
      const b = JSON.parse(init.body); const id = b.id;
      if (b.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "cust", version: "1" }, capabilities: { tools: {} } } });
      if (b.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      if (b.method === "tools/call") return jres({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "constant answer" }] } });
      return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
    }
    return new Response("not found", { status: 404 });
  }
  throw new Error("parity: network blocked for " + u.hostname);
};

// ---- worker(書き換えない)----
const mod = await import(pathToFileURL(path.join(path.resolve(gateDir), "src", "worker.js")).href);
const worker = mod.default;
const SweepLeaseDO = mod.SweepLeaseDO;

// ---- 置き場 ----
const OP = "parity-operator-token";
let kv, lease, table, blobs, leaseTable;
if (which === "cf") {
  kv = makeCfKv({ now: () => Date.now() });
  lease = makeCfDoNamespace(SweepLeaseDO, {});
} else if (process.env.PARITY_STORE === "azurite") {
  table = await newTable("pkv");
  blobs = makeBlobText(await newContainer("pbl"));
  leaseTable = await newTable("pls");
  kv = makeKvOnTable({ table, blobs, now: () => Date.now() });
  lease = makeLeaseNamespace({ table: leaseTable });
} else {
  table = new FakeTableClient("hsverifykv");
  blobs = new FakeBlobContainer("hs-verify-kv-large");
  leaseTable = new FakeTableClient("hssweeplease");
  kv = makeKvOnTable({ table, blobs, now: () => Date.now() });
  lease = makeLeaseNamespace({ table: leaseTable });
}
const env = { HS_VERIFY_KV: kv, SWEEP_LEASE_DO: lease, SWEEP_TOKEN: OP, SWEEP_ONLY_TOKEN: "parity-sweep-only", GATE_COMMIT: "parity-local", SUBREQUEST_BUDGET: "1000", ...MODES[mode].vars };
const pending = [];
const CTX = { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => null)); }, passThroughOnException() {} };
const drain = async () => { while (pending.length) await pending.shift(); };
const call = async (p, init) => { const r = await worker.fetch(new Request(ORIGIN + p, init), env, CTX); const text = await r.text(); await drain(); return { status: r.status, text }; };
const post = (p, body, headers) => call(p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const out = { mode, which, vars: MODES[mode].vars, steps: {} };

// 1. 登録
out.steps.watch = await post("/watch", { endpoint: EP, tier: "paid", webhook: HOOK }, { "x-sweep-token": OP });

// 2. 1 日目、運営の掃引
out.steps.sweep1 = await post("/sweep", { force: true }, { "x-sweep-token": OP });

// 3. 2 日目、cron
NOW.v = RealDate.parse("2026-11-06T18:00:00.000Z");
PHASE = 2;
await worker.scheduled({ cron: "0 18 * * *", scheduledTime: NOW.v }, env, CTX);
await drain();
out.steps.sweep_last = await call("/sweep/last");

// 4. 読む
const hist = await call("/history?endpoint=" + encodeURIComponent(EP));
out.steps.history = hist;
let entries = [];
try { entries = JSON.parse(hist.text).entries || []; } catch (_e) {}
out.records = [];
for (const e of entries) {
  const sha = e.record_sha256;
  const r = await call("/record/" + sha);
  out.records.push({ at: e.at, status: e.status, record_sha256: sha, http: r.status, body: r.text, body_sha256: sha256(r.text) });
}
out.steps.lookup = await call("/register/lookup?endpoint=" + encodeURIComponent(EP));
out.webhook_bodies = HOOK_BODIES;
out.notify_bodies = NOTIFY_BODIES;
out.ledger_bodies = LEDGER_BODIES;

// 置き場の中身(adapter の list と get だけで読む。KV と同じ見え方かを比べるため)
const dump = [];
let cursor;
let guard = 0;
do {
  const page = await kv.list({ prefix: "", cursor, limit: 1000 });
  for (const k of page.keys) dump.push([k.name, await kv.get(k.name, "text")]);
  cursor = page.list_complete ? undefined : page.cursor;
} while (cursor && ++guard < 100);
out.store = dump;

// 比べない数(置き場ごとに違ってよい物)
let maxLen = 0, maxKey = null;
for (const [k, v] of dump) if (v && v.length > maxLen) { maxLen = v.length; maxKey = k; }
out.meta = {
  fetches: FETCH_LOG.length,
  fetch_hosts: [...new Set(FETCH_LOG.map((x) => x.split("/")[0]))].sort(),
  random_bytes_drawn: randomBytesDrawn,
  keys: dump.length,
  largest_value: { key: maxKey, chars: maxLen },
  store_kind: which === "cf" ? "cf-fake" : (process.env.PARITY_STORE === "azurite" ? "azurite" : "azure-fake"),
  storage_ops: which === "cf" ? kv.ops : (table.ops ? { table: table.ops, blob: blobs.ops, lease_table: leaseTable.ops } : null),
  table_entities: which === "azure" && table.rows ? table.rows.size : null,
  chunked_entities: which === "azure" && table.rows ? [...table.rows.values()].filter((e) => e.n > 1).length : null,
};
process.stdout.write(JSON.stringify(out));
