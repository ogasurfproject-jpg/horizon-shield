// swap.mjs  worker の fetch / scheduled に渡る env の KV と DO を、Azurite の Table の adapter(src/kv_table.mjs、src/lease_table.mjs)に替える。
// KV: 試験の偽物(元)はそのまま残す。worker の読み(get、list)は、先に元を同じ引数で呼び(偽物が仕込んだ故障の throw と
//     待ち合わせをそのまま worker に届けるため。元の答えは捨てる)、その後 Table から読んだ値を返す。元と Table の答えが
//     違えば数える(kv_get_mismatch、kv_list_mismatch)。書き(put、delete)は元に先に書き(元が投げたら Table には書かない)、
//     その後 Table へ。試験が元の Map に直に置いた値は、worker を呼ぶたびに元の list と get で読んで Table に写す(同期)。
//     元の list が最初から投げる(「KV が落ちた」を試す偽物)時は替えずに元を渡す。
// DO: lease の要求を元の DO と Table の lease の両方に送る。元が投げるか JSON でない答えなら(故障を試す偽物)元の答えを
//     返し、それ以外は Table の答えを返す。token は Table の物を worker に渡し、元へは元の token に読み替えて送る。
//     元と Table で ok と busy が食い違えば数える(do_mismatch)。
// 数は process の終わりに 1 行で出す(SWAP_STATS)。
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { makeKvOnTable } from "../../src/kv_table.mjs";
import { makeLeaseNamespace } from "../../src/lease_table.mjs";
import { makeBlobText } from "../../src/blob_text.mjs";
import { newTable, newContainer } from "../azurite.mjs";

const stats = { kv_swapped: 0, kv_kept: 0, do_swapped: 0, calls: 0, synced_puts: 0, synced_deletes: 0, sync_skipped_keys: 0, write_through: 0,
  table_reads: 0, kv_get_mismatch: 0, kv_list_mismatch: 0, do_calls: 0, do_from_orig: 0, do_mismatch: 0, mismatch_examples: [] };
const note = (what) => { if (stats.mismatch_examples.length < 5) stats.mismatch_examples.push(String(what).slice(0, 200)); };
process.on("exit", () => {
  try { process.stderr.write("SWAP_STATS " + JSON.stringify(stats) + "\n"); } catch (_e) {}
  try { if (process.env.SWAP_STATS_FILE) appendFileSync(process.env.SWAP_STATS_FILE, JSON.stringify({ suite: basename(process.argv[1] || ""), ...stats }) + "\n"); } catch (_e) {}
});

let storeP = null;
const store = () => (storeP ||= (async () => ({ table: await newTable("sw"), blobs: makeBlobText(await newContainer("sw")), leaseTable: await newTable("swl") }))());
let partN = 0;
const kvMemo = new WeakMap();
const doMemo = new WeakMap();
const isKv = (v) => v && typeof v === "object" && typeof v.get === "function" && typeof v.put === "function" && typeof v.list === "function" && typeof v.idFromName !== "function";
const isDo = (v) => v && typeof v === "object" && typeof v.idFromName === "function" && typeof v.get === "function";

function makeSwappedKv(orig, tkv) {
  const shadow = new Map();   // Table に写した値
  let chain = Promise.resolve();
  async function syncOnce() {
    const seen = new Map();
    let cursor, guard = 0;
    do {
      let r;
      try { r = await orig.list({ prefix: "", cursor, limit: 1000 }); } catch (_e) { return; }   // 偽物が list に故障を仕込んだ時は、この回は写さない
      for (const k of (r && r.keys) || []) seen.set(k.name, k.metadata);
      cursor = r && !r.list_complete ? r.cursor : undefined;
    } while (cursor && ++guard < 100);
    // 偽物が Map の store を見せている時は、そこから読む(get の回数を数える試験の数を、写しの読みで増やさない)。
    const direct = orig.store instanceof Map ? orig.store : null;
    for (const [name, md] of seen) {
      let v;
      if (direct) v = direct.has(name) ? direct.get(name) : null;
      else { try { v = await orig.get(name); } catch (_e) { stats.sync_skipped_keys++; continue; } }   // 偽物が故障を仕込んだ鍵は写さない
      if (v === null || v === undefined) continue;
      const s = typeof v === "string" ? v : JSON.stringify(v);
      if (shadow.get(name) === s) continue;
      try { await tkv.put(name, s, md !== undefined && md !== null ? { metadata: md } : undefined); shadow.set(name, s); stats.synced_puts++; }
      catch (_e) { stats.sync_skipped_keys++; }
    }
    for (const name of [...shadow.keys()]) if (!seen.has(name)) { await tkv.delete(name); shadow.delete(name); stats.synced_deletes++; }
  }
  const sync = () => (chain = chain.then(syncOnce, syncOnce));
  const kv = {
    async get(k, t) {
      const ov = await orig.get(k, t);
      const tv = await tkv.get(k, t);
      stats.table_reads++;
      if (JSON.stringify(ov === undefined ? null : ov) !== JSON.stringify(tv)) { stats.kv_get_mismatch++; note("get " + k); }
      return tv;
    },
    async list(o) {
      const ol = await orig.list(o);
      const tl = await tkv.list(o);
      stats.table_reads++;
      if (ol && ol.list_complete && tl.list_complete && !(o && o.cursor)) {
        const a = JSON.stringify((ol.keys || []).map((x) => x.name).sort()), b = JSON.stringify(tl.keys.map((x) => x.name).sort());
        if (a !== b) { stats.kv_list_mismatch++; note("list " + JSON.stringify(o) + " " + a.slice(0, 80) + " vs " + b.slice(0, 80)); }
      }
      return tl;
    },
    async put(k, v, o) {
      const r = await orig.put(k, v, o);
      await tkv.put(k, v, o);
      shadow.set(String(k), v);
      stats.write_through++;
      return r;
    },
    async delete(k) {
      const r = orig.delete ? await orig.delete(k) : undefined;
      await tkv.delete(k);
      shadow.delete(String(k));
      stats.write_through++;
      return r;
    },
  };
  return { kv, sync };
}

// 同じ binding に初めて 2 本の呼びが同時に来ても、包みを 2 つ作らない(memo には promise を同期の内に置く)。
function kvFor(v) {
  if (!kvMemo.has(v)) kvMemo.set(v, (async () => {
    try { await v.list({ prefix: "", limit: 1 }); } catch (_e) { stats.kv_kept++; return null; }
    const s = await store();
    stats.kv_swapped++;
    return makeSwappedKv(v, makeKvOnTable({ table: s.table, blobs: s.blobs, partition: "p" + (++partN) }));
  })());
  return kvMemo.get(v);
}
function doFor(v) {
  if (!doMemo.has(v)) doMemo.set(v, (async () => {
    const s = await store();
    stats.do_swapped++;
    return makeDualLease(v, makeLeaseNamespace({ table: s.leaseTable, partition: "l" + (++partN) }));
  })());
  return doMemo.get(v);
}

async function swapEnv(env) {
  if (!env || typeof env !== "object") return { env, syncs: [] };
  const out = { ...env };
  const syncs = [];
  for (const [name, v] of Object.entries(env)) {
    if (isKv(v)) {
      const m = await kvFor(v);
      if (m) { out[name] = m.kv; syncs.push(m.sync); }
    } else if (isDo(v)) {
      out[name] = await doFor(v);
    }
  }
  return { env: out, syncs };
}

function makeDualLease(origNs, tableNs) {
  const tokenMap = new Map();   // Table の token -> 元の token
  return {
    idFromName: (name) => ({ name: String(name), orig: origNs.idFromName(name) }),
    get(id) {
      const os = origNs.get(id.orig), ts = tableNs.get(id.name);
      return {
        async fetch(url, init) {
          stats.do_calls++;
          const p = new URL(typeof url === "string" ? url : url.url).pathname;
          let body = null;
          try { body = init && typeof init.body === "string" ? JSON.parse(init.body) : null; } catch (_e) { body = null; }
          let oinit = init;
          if (p === "/release" && body && typeof body.token === "string" && tokenMap.has(body.token)) oinit = { ...init, body: JSON.stringify({ ...body, token: tokenMap.get(body.token) }) };
          let oj;
          try {
            const or = await os.fetch(url, oinit);
            oj = await or.clone().json().catch(() => undefined);
            if (oj === undefined || (oj && oj.error)) { stats.do_from_orig++; return or; }
          } catch (e) { stats.do_from_orig++; throw e; }
          const tr = await ts.fetch(url, init);
          const tj = await tr.clone().json().catch(() => null);
          if (p === "/acquire" && tj && oj) {
            if (tj.ok && oj.ok && tj.token && oj.token) tokenMap.set(tj.token, oj.token);
            if (!!tj.ok !== !!oj.ok) { stats.do_mismatch++; note("do " + p + " table " + JSON.stringify(tj).slice(0, 60) + " orig " + JSON.stringify(oj).slice(0, 60)); }
          }
          if (p === "/release" && tj && oj && !!tj.released !== !!oj.released) { stats.do_mismatch++; note("do release"); }
          return tr;
        },
      };
    },
  };
}

export function wrapWorker(real) {
  if (!real || typeof real !== "object") return real;
  const w = { ...real };
  if (typeof real.fetch === "function") {
    w.fetch = async function (request, env, ctx, ...rest) {
      stats.calls++;
      const s = await swapEnv(env);
      for (const f of s.syncs) await f();
      return real.fetch.call(this, request, s.env, ctx, ...rest);
    };
  }
  if (typeof real.scheduled === "function") {
    // Workers の scheduled は、同期の内に ctx.waitUntil を呼んで返る。試験はその直後に waitUntil の promise を集めるので、
    // 包みも同期の内に 1 本の waitUntil を出し、その中で置き場を替え、本物の scheduled と、それが出した waitUntil を全部待つ。
    w.scheduled = function (event, env, ctx, ...rest) {
      stats.calls++;
      const inner = [];
      const ctx2 = Object.create(ctx || null);
      ctx2.waitUntil = (q) => { inner.push(Promise.resolve(q)); };
      const p = (async () => {
        const s = await swapEnv(env);
        for (const f of s.syncs) await f();
        await real.scheduled.call(this, event, s.env, ctx2, ...rest);
        while (inner.length) await inner.shift();
      })();
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
      return p;
    };
  }
  return w;
}
