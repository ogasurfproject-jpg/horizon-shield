// lease_table.mjs  掃引の単走の lease(hs-verify-gate/src/sweep_lease.js の SweepLeaseDO)と同じ答えを、Durable Object の
// 代わりに Table Storage の 1 entity と ETag で返す。worker 側は env.SWEEP_LEASE_DO.idFromName(name) と
// .get(id).fetch(url, init) しか呼ばないので、その形で渡す。答えの JSON の形は SweepLeaseDO と同じ(acquire / release / peek)。
//
// 一度に 1 本だけを守る仕組み(DO の blockConcurrencyWhile の代わり):
//   無い時     createEntity。2 本が同時に来たら片方は 409 で負け、busy と答える
//   期限切れ   updateEntity(Replace、If-Match = 読んだ時の ETag)。間に誰かが書いたら 412 で負け、busy と答える
//   解放       deleteEntity(If-Match)。token が違えば消さない。間に取り直されたら 412 で、消さない
// token は 16 byte を crypto.getRandomValues から取る(SweepLeaseDO の randomToken と同じ量と形)。

const TTL_MS = 15 * 60 * 1000;   // SWEEP_LEASE_TTL_MS と同じ
const PK = "lease";

function token16() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function res(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
}
const iso = (ms) => new Date(ms).toISOString();

export function makeLeaseNamespace({ table, partition = PK }) {
  async function read(rk) {
    try { return await table.getEntity(partition, rk); }
    catch (e) { if (e && e.statusCode === 404) return null; throw e; }
  }
  const busy = (cur) => res({ ok: false, busy: true, holder: (cur && cur.holder) || null, started_at: (cur && cur.started_at) || null, expires_at: cur ? iso(cur.expires_at) : null });

  async function handle(rk, request) {
    const u = new URL(request.url);
    if (request.method !== "POST") return res({ error: "not_found" }, 404);
    let body;
    try { body = await request.json(); } catch (_e) { return res({ error: "bad_json" }, 400); }
    const now = Number.isFinite(body && body.now) ? Number(body.now) : Date.now();

    if (u.pathname === "/acquire") {
      const ttl = Number.isFinite(body && body.ttl_ms) && body.ttl_ms > 0 ? Math.min(Number(body.ttl_ms), TTL_MS * 4) : TTL_MS;
      const holder = typeof (body && body.holder) === "string" ? body.holder.slice(0, 80) : "unknown";
      const cur = await read(rk);
      if (cur && typeof cur.expires_at === "number" && cur.expires_at > now) return busy(cur);
      const lease = { token: token16(), holder, started_at: iso(now), expires_at: now + ttl };
      try {
        if (cur) await table.updateEntity({ partitionKey: partition, rowKey: rk, ...lease }, "Replace", { etag: cur.etag });
        else await table.createEntity({ partitionKey: partition, rowKey: rk, ...lease });
      } catch (e) {
        if (e && (e.statusCode === 409 || e.statusCode === 412 || e.statusCode === 404)) return busy(await read(rk));
        return res({ error: String((e && e.message) || e).slice(0, 200) }, 500);
      }
      return res({ ok: true, token: lease.token, holder, started_at: lease.started_at, expires_at: iso(lease.expires_at),
        ...(cur ? { replaced_expired: { holder: cur.holder || null, started_at: cur.started_at || null } } : {}) });
    }

    if (u.pathname === "/release") {
      const token = typeof (body && body.token) === "string" ? body.token : null;
      if (!token) return res({ error: "token_required" }, 400);
      const cur = await read(rk);
      if (!cur || cur.token !== token) return res({ ok: true, released: false, reason: cur ? "held by another token" : "no lease" });
      try { await table.deleteEntity(partition, rk, { etag: cur.etag }); }
      catch (e) {
        if (e && e.statusCode === 412) return res({ ok: true, released: false, reason: "held by another token" });
        if (e && e.statusCode === 404) return res({ ok: true, released: false, reason: "no lease" });
        throw e;
      }
      return res({ ok: true, released: true });
    }

    if (u.pathname === "/peek") {
      const cur = await read(rk);
      return res({ lease: cur ? { holder: cur.holder || null, started_at: cur.started_at || null, expires_at: iso(cur.expires_at), expired: !(cur.expires_at > now) } : null });
    }

    return res({ error: "not_found" }, 404);
  }

  return {
    idFromName: (name) => String(name),
    get: (id) => ({ fetch: (input, init) => handle(String(id), new Request(input, init)) }),
  };
}
