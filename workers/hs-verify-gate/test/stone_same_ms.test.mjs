// stone_same_ms: two removals of one endpoint in the same millisecond keep both stones (2026-11-23).
// mould_removed_perkey test 7 failed once on 2026-11-22: the second removal of an endpoint, made in the same
// millisecond as the first, got the same removed_at, and the public list (which tells stones apart by endpoint and
// removed_at) dropped it as a duplicate. This test stops the clock, so the case happens every run, not by chance.
// Offline: *.redteam.invalid never resolves, every outside fetch answers 404.
// Run: node test/stone_same_ms.test.mjs   (in workers/hs-verify-gate)
const RealDate = Date;
const FIXED = RealDate.parse("2026-11-23T00:00:00.000Z");
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};
globalThis.fetch = async () => new Response("", { status: 404 });
const { default: worker } = await import("../src/worker.js");

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const TOKEN = "test-token";
const O = "https://gate.horizonshield.dev";
const A = "https://a.redteam.invalid/mcp";
function kv() {
  const store = new Map(), meta = new Map();
  return {
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return ((type === "json" || (type && type.type === "json")) && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v, opts) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); if (opts && opts.metadata) meta.set(k, structuredClone(opts.metadata)); else meta.delete(k); },
    delete: async (k) => { store.delete(k); meta.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).sort().map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: true }),
  };
}
const req = (env, path, method, body, headers) => worker.fetch(new Request(O + path, { method, headers: { "content-type": "application/json", ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, CTX);
const asJson = async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) });
const AUTH = { "x-sweep-token": TOKEN };
let pass = 0, fail = 0;
const t = (name, ok, detail = "") => { if (ok) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  NG   " + name + "  " + String(detail).slice(0, 240)); } };

const store = kv();
const env = { HS_VERIFY_KV: store, SWEEP_TOKEN: TOKEN, GATE_COMMIT: "same-ms-local" };
store.store.set("watch:registry", JSON.stringify({ [A]: { tier: "free", webhook: null, added_at: "2026-10-01T00:00:00Z", requested_by: "anonymous", owner_file_at_request: "absent" } }));
t("the clock is stopped", new Date().toISOString() === "2026-11-23T00:00:00.000Z" && Date.now() === FIXED);
const r1 = await asJson(await req(env, "/watch", "DELETE", { endpoint: A, reason: "first removal, clock stopped" }, AUTH));
const re = await asJson(await req(env, "/watch", "POST", { endpoint: A }));
const r2 = await asJson(await req(env, "/watch", "DELETE", { endpoint: A, reason: "second removal, same millisecond" }, AUTH));
t("both removals answered ok, the re-registration in between too", r1.status === 200 && re.status === 200 && r2.status === 200, JSON.stringify([r1.status, re.status, r2.status, r2.j.error]));
const w = await asJson(await req(env, "/watchlist", "GET"));
const mine = (w.j.removed || []).filter((s) => s.endpoint === A);
t("the public list keeps both stones of the endpoint", mine.length === 2, JSON.stringify(mine.map((s) => [s.reason, s.removed_at])));
t("the second stone is one millisecond after the first, in removal order", mine.length === 2 && mine[0].reason === "first removal, clock stopped" && mine[1].reason === "second removal, same millisecond" && RealDate.parse(mine[1].removed_at) - RealDate.parse(mine[0].removed_at) === 1, JSON.stringify(mine.map((s) => s.removed_at)));
t("the first stone keeps the clock's time", mine.length >= 1 && mine[0].removed_at === "2026-11-23T00:00:00.000Z", JSON.stringify(mine.map((s) => s.removed_at)));
const r3 = await asJson(await req(env, "/watch", "POST", { endpoint: A }));
const r4 = await asJson(await req(env, "/watch", "DELETE", { endpoint: A, reason: "third removal, same millisecond" }, AUTH));
const w2 = await asJson(await req(env, "/watchlist", "GET"));
const mine2 = (w2.j.removed || []).filter((s) => s.endpoint === A);
t("a third removal in the same millisecond keeps all three, each one millisecond later", r3.status === 200 && r4.status === 200 && mine2.length === 3 && mine2[2].removed_at === "2026-11-23T00:00:00.002Z", JSON.stringify(mine2.map((s) => s.removed_at)));
console.log(`\n=== ${pass} / ${pass + fail} 合格 (stones of one endpoint in the same millisecond, 2026-11-23) ===`);
process.exit(fail ? 1 : 0);
