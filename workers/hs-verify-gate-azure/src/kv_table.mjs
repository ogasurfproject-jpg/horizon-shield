// kv_table.mjs  Cloudflare KV の面(get / put / list / delete)を Azure Table Storage と Blob Storage で満たす。
// hs-verify-gate の env.HS_VERIFY_KV と hs-ms-marketplace の env.MS_SUBS に、そのまま渡す。worker.js は書き換えない。
// table は @azure/data-tables の TableClient、blobs は blob_text.mjs の makeBlobText(ContainerClient)。どちらも注入。
//
// 写し方(1 つの KV の鍵 = 1 entity):
//   PartitionKey = partition(既定 "kv")。1 つの KV namespace = 1 partition。MS_SUBS は別の partition か別の table
//   RowKey       = 鍵の UTF-8 を小文字の 16 進にした物。Table は RowKey を文字列の順に並べるので、並び順は KV の list と
//                  同じ UTF-8 の byte の順になる。Table が RowKey に断る字("/" "\" "#" "?" と制御文字)も 16 進なら出ない
//   k            = 生の鍵(人が読むため。並びには使わない)
//   n, v0..vN    = 値を CHUNK 字ずつに切った物。Table の文字列 property は 64 KiB(UTF-16 で 32,768 字)まで
//   blob         = 値が spillAt(UTF-16 で数えた byte)を超える時だけ、値を Blob に置いて名前をここに持つ。
//                  Table の entity は 1 MiB まで(Azurite も 2.5 MB の entity を EntityTooLarge で断る)
//   exp          = 期限(ms)。Table に TTL は無い。読む時と list の時に外し、消すのは cleanupExpired
//   md           = put の metadata を JSON にした物(KV と同じく 1,024 byte まで)。list の keys[].metadata に戻す
//
// 鍵の長さ: Azurite は RowKey を 512 字までしか受けない(手元で 512 は通り、513 は 400)。16 進は 1 byte で 2 字なので、
// 鍵は UTF-8 で 256 byte まで(KV は 512 byte まで)。扉と Marketplace の鍵はどれも 100 byte に届かない。超える鍵は put で断る。

const CHUNK = 32000;
const DEFAULT_SPILL_AT = 900 * 1024;
const KEY_MAX_BYTES = 256;
const METADATA_MAX_BYTES = 1024;
const enc = new TextEncoder();

export function hexOf(s) {
  let h = "";
  for (const b of enc.encode(String(s))) h += b.toString(16).padStart(2, "0");
  return h;
}
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function typeOf(t) { return t && typeof t === "object" ? t.type : t; }
function notFound(e) { return !!(e && e.statusCode === 404); }
// OData の文字列の literal。値は 16 進か partition の名なので ' は出ないが、出ても壊れないように 2 つにする。
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

// 値を CHUNK 字ずつに切る。切れ目でサロゲートの対を割らない(割ると片割れが 1 つの property に残る)。
export function chunksOf(v) {
  const out = [];
  let i = 0;
  while (i < v.length) {
    let j = Math.min(i + CHUNK, v.length);
    if (j < v.length) {
      const c = v.charCodeAt(j - 1);
      if (c >= 0xd800 && c <= 0xdbff) j -= 1;
    }
    out.push(v.slice(i, j));
    i = j;
  }
  return out.length ? out : [""];
}

export function makeKvOnTable({ table, blobs, partition = "kv", spillAt = DEFAULT_SPILL_AT, now = () => Date.now() }) {
  const pk = String(partition);
  const blobPrefix = pk + "/";

  async function readEntity(key) {
    try { return await table.getEntity(pk, hexOf(key)); }
    catch (e) { if (notFound(e)) return null; throw e; }
  }
  const alive = (e, t) => !(typeof e.exp === "number" && e.exp <= t);

  async function valueOf(e) {
    if (e.blob) return await blobs.downloadText(e.blob);
    let s = "";
    for (let i = 0; i < (e.n || 0); i++) s += e["v" + i] || "";
    return s;
  }

  async function get(key, type) {
    const e = await readEntity(key);
    if (!e || !alive(e, now())) return null;
    let v;
    try { v = await valueOf(e); }
    catch (err) { if (notFound(err)) return null; throw err; }   // blob が掃除の後に消えた時は、KV で鍵が無いのと同じに見せる
    const t = typeOf(type) || "text";
    if (t === "json") return JSON.parse(v);
    if (t === "text") return v;
    throw new Error("kv_table: get type " + t + " is not used by the workers and not provided");
  }

  async function put(key, value, opts) {
    const k = String(key);
    if (enc.encode(k).length > KEY_MAX_BYTES) throw new Error("kv_table: key over " + KEY_MAX_BYTES + " bytes (Table RowKey limit after hex)");
    if (typeof value !== "string") throw new TypeError("kv_table: put takes a string value (the workers only put strings)");
    const entity = { partitionKey: pk, rowKey: hexOf(k), k };
    if (opts && opts.expirationTtl) entity.exp = now() + Number(opts.expirationTtl) * 1000;
    else if (opts && opts.expiration) entity.exp = Number(opts.expiration) * 1000;
    if (opts && opts.metadata !== undefined && opts.metadata !== null) {
      const md = JSON.stringify(opts.metadata);
      if (enc.encode(md).length > METADATA_MAX_BYTES) throw new Error("kv_table: metadata over " + METADATA_MAX_BYTES + " bytes (the KV limit, kept the same)");
      entity.md = md;
    }
    if (value.length * 2 > spillAt) {
      // 先に blob を置き、その後で entity が blob を指す。読む人が、無い blob を指す entity を見る時間を作らない。
      const name = blobPrefix + (await sha256hex(k));
      await blobs.uploadText(name, value, { rk: entity.rowKey });
      entity.blob = name;
      entity.n = 0;
    } else {
      const parts = chunksOf(value);
      entity.n = parts.length;
      parts.forEach((p, i) => { entity["v" + i] = p; });
    }
    await table.upsertEntity(entity, "Replace");
    // 前に blob へ退避していた鍵を小さい値で上書きすると、古い blob は誰にも指されずに残る(読まれはしない)。
    // put のたびに消しに行くと 1 回余計な呼びが付くので、cleanupExpired が 1 時間より古い物を消す。
  }

  async function del(key) {
    const k = String(key);
    try { await table.deleteEntity(pk, hexOf(k)); }
    catch (e) { if (!notFound(e)) throw e; }
    await blobs.deleteIfExists(blobPrefix + (await sha256hex(k)));
  }

  // KV の list と同じ答えの形: { keys: [{ name, expiration?, metadata? }], list_complete, cursor }。
  // cursor は最後に見た RowKey(16 進)。Table の continuation token は使わない(1 回の list で頁を足して limit まで詰める)。
  async function list(opts = {}) {
    const prefix = opts.prefix ? String(opts.prefix) : "";
    const limit = Math.max(1, Math.min(Number(opts.limit) || 1000, 1000));
    const lo = hexOf(prefix);
    const conds = ["PartitionKey eq " + lit(pk)];
    if (opts.cursor) conds.push("RowKey gt " + lit(opts.cursor));
    else if (lo) conds.push("RowKey ge " + lit(lo));
    if (lo) conds.push("RowKey lt " + lit(lo + "g"));   // 16 進の字はどれも "g" より前
    const select = ["RowKey", "k", "exp", "md"];
    const pages = table.listEntities({ queryOptions: { filter: conds.join(" and "), select } }).byPage({ maxPageSize: limit });
    const t = now();
    const keys = [];
    let seen = 0, last = null, more = false;
    outer: for await (const page of pages) {
      for (const e of page) {
        if (seen === limit) { more = true; break outer; }
        seen++;
        last = e.rowKey;
        if (!alive(e, t)) continue;   // 期限切れは返さない(KV と同じ見え方)
        const item = { name: e.k };
        if (typeof e.exp === "number") item.expiration = Math.floor(e.exp / 1000);
        if (typeof e.md === "string") { try { item.metadata = JSON.parse(e.md); } catch (_e) { /* 読めない metadata は付けない */ } }
        keys.push(item);
      }
      // 頁は limit より少なく返る事がある(Table は 5 秒や partition の境で頁を切る)。token があれば次の頁を読む。
      if (seen === limit) { more = !!page.continuationToken; break; }
    }
    return more ? { keys, list_complete: false, cursor: last } : { keys, list_complete: true };
  }

  return { get, put, delete: del, list };
}

// 期限の切れた entity と、誰にも指されていない blob を消す(掃除の timer から呼ぶ)。
// entity は読んだ時の ETag で If-Match して消す。間に put し直された鍵は 412 になり、消さない。
// blob は 1 時間より古い物だけ。put は blob を置いてから entity を書くので、その間の blob を消さない。
export async function cleanupExpired({ table, blobs, partition = "kv", now = () => Date.now(), blobGraceMs = 3600 * 1000 }) {
  const pk = String(partition);
  const t = now();
  const out = { expired_deleted: 0, expired_raced: 0, blobs_deleted: 0, blobs_kept: 0 };
  const filter = "PartitionKey eq " + lit(pk) + " and exp le " + t + ".0";
  for await (const e of table.listEntities({ queryOptions: { filter, select: ["RowKey", "exp", "blob"] } })) {
    try { await table.deleteEntity(pk, e.rowKey, { etag: e.etag }); out.expired_deleted++; }
    catch (err) { if (err && (err.statusCode === 412 || err.statusCode === 404)) out.expired_raced++; else throw err; }
  }
  for await (const b of blobs.listOlderThan(pk + "/", t - blobGraceMs)) {
    let keep = false;
    if (b.rk) {
      try { const e = await table.getEntity(pk, b.rk); keep = e.blob === b.name && !(typeof e.exp === "number" && e.exp <= t); }
      catch (err) { if (!notFound(err)) throw err; }
    }
    if (keep) out.blobs_kept++;
    else { await blobs.deleteIfExists(b.name); out.blobs_deleted++; }
  }
  return out;
}
