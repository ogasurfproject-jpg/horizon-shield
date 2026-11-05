// fake_cloudflare.mjs  手元だけの偽物。Cloudflare の KV namespace と Durable Object namespace の、worker が使う面だけ。
// KV: get(text/json)、put(expirationTtl)、list(prefix, cursor, limit。鍵は UTF-8 の byte の順)、delete。
// DO: idFromName / get(id).fetch。中身は本物の SweepLeaseDO(src/sweep_lease.js)に、偽の state(storage と
//     blockConcurrencyWhile)を渡して動かす。

const enc = new TextEncoder();
function cmpUtf8(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function typeOf(t) { return t && typeof t === "object" ? t.type : t; }

export function makeCfKv({ now = () => Date.now() } = {}) {
  const store = new Map();   // key -> { v, exp }
  const ops = { get: 0, put: 0, list: 0, delete: 0 };
  const alive = (r) => r && !(typeof r.exp === "number" && r.exp <= now());
  return {
    store, ops,
    async get(key, type) {
      ops.get++;
      const r = store.get(String(key));
      if (!alive(r)) return null;
      const t = typeOf(type) || "text";
      if (t === "json") return JSON.parse(r.v);
      return r.v;
    },
    async put(key, value, opts) {
      ops.put++;
      const ttl = opts && opts.expirationTtl;
      store.set(String(key), { v: typeof value === "string" ? value : String(value), exp: ttl ? now() + Number(ttl) * 1000 : null });
    },
    async delete(key) { ops.delete++; store.delete(String(key)); },
    async list(o = {}) {
      ops.list++;
      const prefix = o.prefix || "";
      const limit = Math.min(Number(o.limit) || 1000, 1000);
      const names = [...store.keys()].filter((k) => k.startsWith(prefix) && alive(store.get(k))).sort(cmpUtf8);
      const start = o.cursor ? Number(o.cursor) : 0;
      const page = names.slice(start, start + limit);
      const more = start + limit < names.length;
      return { keys: page.map((name) => ({ name })), list_complete: !more, cursor: more ? String(start + limit) : undefined };
    },
  };
}

export function makeCfDoNamespace(DOClass, env) {
  const instances = new Map();
  function state() {
    const mem = new Map();
    let chain = Promise.resolve();
    return {
      storage: {
        async get(k) { return mem.has(k) ? structuredClone(mem.get(k)) : undefined; },
        async put(k, v) { mem.set(k, structuredClone(v)); },
        async delete(k) { return mem.delete(k); },
      },
      blockConcurrencyWhile(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; },
    };
  }
  return {
    idFromName: (name) => "do:" + String(name),
    get(id) {
      if (!instances.has(id)) instances.set(id, new DOClass(state(), env));
      const obj = instances.get(id);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    },
  };
}
