// gcp/kv_firestore.test.mjs
// 採点: (1) Firestore KV adapter が Cloudflare KV と同じ意味論を返すか(偽 Firestore、実 DB 無し)
//       (2) HTTP ブリッジ経由で無改変の worker.js が Node で 200/204 を返すか(実 http server、network 無し)
// 緑の意味: adapter の get/put/list/ttl/prefix/pagination が KV と一致し、shim が worker を素通しできる、それだけ。
import http from "node:http";
import { makeKv } from "./kv_firestore.mjs";
import { makeNodeHandler } from "./http_bridge.mjs";
import worker from "../src/worker.js";

let pass = 0, fail = 0; const out = [];
function t(name, ok, detail) { (ok ? pass++ : fail++); out.push((ok ? "  ok   " : "  FAIL ") + name + (ok || detail == null ? "" : "  <- " + String(detail).slice(0, 200))); }

// ---- 偽 Firestore(adapter が使う面だけ。key フィールドで整列する range クエリ)----
class FakeCol {
  constructor() { this.map = new Map(); }
  doc(id) { const self = this; return {
    async get() { const d = self.map.get(id); return { exists: d !== undefined, id, data: () => (d ? { ...d } : undefined) }; },
    async set(obj) { self.map.set(id, { ...obj }); },
    async delete() { self.map.delete(id); },
  }; }
  orderBy(field) { return new FakeQuery(this, field, {}); }
}
class FakeQuery {
  constructor(col, field, o) { this.col = col; this.field = field; this.o = { ...o }; }
  startAt(v) { return new FakeQuery(this.col, this.field, { ...this.o, startAt: v }); }
  startAfter(v) { return new FakeQuery(this.col, this.field, { ...this.o, startAfter: v }); }
  endAt(v) { return new FakeQuery(this.col, this.field, { ...this.o, endAt: v }); }
  limit(n) { return new FakeQuery(this.col, this.field, { ...this.o, limit: n }); }
  async get() {
    let rows = [...this.col.map.entries()].map(([id, d]) => ({ id, d }));
    const f = this.field;
    rows.sort((a, b) => (a.d[f] < b.d[f] ? -1 : a.d[f] > b.d[f] ? 1 : 0));
    const o = this.o;
    if (o.startAt !== undefined) rows = rows.filter((r) => r.d[f] >= o.startAt);
    if (o.startAfter !== undefined) rows = rows.filter((r) => r.d[f] > o.startAfter);
    if (o.endAt !== undefined) rows = rows.filter((r) => r.d[f] <= o.endAt);
    if (o.limit !== undefined) rows = rows.slice(0, o.limit);
    return { docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r.d }) })) };
  }
}
class FakeFirestore { constructor() { this.cols = new Map(); } collection(n) { if (!this.cols.has(n)) this.cols.set(n, new FakeCol()); return this.cols.get(n); } }

// ---- 1. KV 意味論 ----
{
  const fs = new FakeFirestore();
  const kv = makeKv(fs, "kv");

  await kv.put("a", "hello");
  t("put/get string round trip", (await kv.get("a")) === "hello");
  t("get missing -> null", (await kv.get("nope")) === null);

  await kv.put("j", JSON.stringify({ x: 1, y: [2, 3] }));
  const j = await kv.get("j", "json");
  t("get json parses", j && j.x === 1 && j.y[1] === 3, JSON.stringify(j));
  t("get json missing -> null", (await kv.get("nope", "json")) === null);

  // キーに ":" と "/" が入っても壊れん(base64url doc id)
  await kv.put("mould:index", JSON.stringify([1, 2]));
  await kv.put("end/point:x", "v");
  t("key with colon survives", JSON.stringify(await kv.get("mould:index", "json")) === "[1,2]");
  t("key with slash survives", (await kv.get("end/point:x")) === "v");

  // TTL: 将来期限は生きる、過去期限は死ぬ
  await kv.put("live", "1", { expirationTtl: 3600 });
  t("ttl future is alive", (await kv.get("live")) === "1");
  // 過去期限を直接注入(put では負 TTL を作れんので偽 fs に直接)
  fs.collection("kv").map.set("k_" + Buffer.from("dead").toString("base64url"), { key: "dead", value: "x", expiresAt: Date.now() - 1000 });
  t("ttl past is gone on get", (await kv.get("dead")) === null);

  // delete
  await kv.put("del", "1");
  await kv.delete("del");
  t("delete removes", (await kv.get("del")) === null);

  // list prefix: a: 系だけ、整列
  const fs2 = new FakeFirestore(); const kv2 = makeKv(fs2, "kv");
  for (const k of ["a:3", "a:1", "a:2", "b:1", "aa:9"]) await kv2.put(k, "v");
  const l = await kv2.list({ prefix: "a:" });
  t("list prefix returns only prefix, sorted", JSON.stringify(l.keys.map((x) => x.name)) === JSON.stringify(["a:1", "a:2", "a:3"]), JSON.stringify(l.keys));
  t("list prefix is complete when under limit", l.list_complete === true);

  // list expired skipped
  fs2.collection("kv").map.set("k_" + Buffer.from("a:0").toString("base64url"), { key: "a:0", value: "x", expiresAt: Date.now() - 1 });
  const l2 = await kv2.list({ prefix: "a:" });
  t("list skips expired", !l2.keys.some((x) => x.name === "a:0"), JSON.stringify(l2.keys));

  // pagination via cursor
  const fs3 = new FakeFirestore(); const kv3 = makeKv(fs3, "kv");
  for (const n of ["p:1", "p:2", "p:3", "p:4", "p:5"]) await kv3.put(n, "v");
  const seen = []; let cursor; let guard = 0; let pages = 0;
  do {
    const page = await kv3.list({ prefix: "p:", limit: 2, cursor });
    pages++; for (const k of page.keys) seen.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
    if (++guard > 10) break;
  } while (cursor);
  t("pagination walks all keys once", JSON.stringify(seen) === JSON.stringify(["p:1", "p:2", "p:3", "p:4", "p:5"]), JSON.stringify(seen));
  t("pagination terminates in expected pages (3)", pages === 3, "pages=" + pages);
}

// ---- 2. HTTP ブリッジ経由で無改変 worker が Node で応答するか ----
{
  const fs = new FakeFirestore();
  const env = { ...process.env, HS_VERIFY_KV: makeKv(fs, "kv") };
  const handler = makeNodeHandler({ worker, env, cronToken: "secret-cron" });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    // OPTIONS プリフライト = 依存ゼロで 204(shim の往復を証明)
    const opt = await fetch(base + "/check", { method: "OPTIONS" });
    t("bridge: OPTIONS preflight -> 204", opt.status === 204, "status=" + opt.status);

    // 静的な Agent Card を無改変 worker が Node 上で配れるか
    const card = await fetch(base + "/.well-known/agent-card.json");
    const okCard = card.status === 200;
    let parsed = null; try { parsed = await card.json(); } catch {}
    t("bridge: agent-card.json -> 200 JSON via unmodified worker", okCard && parsed && typeof parsed === "object", "status=" + card.status);
    t("bridge: agent-card has a name/protocolVersion", !!(parsed && (parsed.name || parsed.protocolVersion || parsed.protocol_version)), JSON.stringify(parsed && Object.keys(parsed)).slice(0, 120));

    // cron 口: token 無しは 403、正しい token は 200(scheduled が Node で走る)
    const noTok = await fetch(base + "/__scheduled", { method: "POST" });
    t("bridge: /__scheduled without token -> 403", noTok.status === 403, "status=" + noTok.status);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

console.log(out.join("\n"));
console.log("=== gcp adapter+bridge: " + pass + " / " + (pass + fail) + (fail ? "  FAIL" : "  ok") + " ===");
process.exit(fail ? 1 : 0);
