// kv_firestore.mjs  Cloudflare KV の get/put/list/delete を Firestore で満たす adapter。
// 目的: hs-verify-gate/src/worker.js を 1 行も変えずに Cloud Run で動かすため、
//       worker が呼ぶ env.HS_VERIFY_KV.get/put/list をそのまま満たす。
// firestore は注入(依存を持たない。本番は @google-cloud/firestore の Firestore、試験は偽物)。
//
// 対応させた Cloudflare KV の面(worker.js の実使用だけ):
//   get(key)            -> string | null
//   get(key, "json")    -> parsed  | null
//   put(key, value, { expirationTtl })   value は文字列、TTL は秒
//   list({ prefix, cursor, limit })      -> { keys:[{name}], list_complete, cursor }
//   delete(key)         (gate は未使用、ledger 用に用意)
//
// Firestore の 1 doc = { key:<生キー>, value:<文字列>, expiresAt:<ms|null> }。
// doc id は Firestore 安全化した派生値、prefix 走査は key フィールドの範囲クエリ。
// 期限は read 時に判定(Firestore の TTL policy は eventual なので、正しさは read 側で担保)。

const HIGH = ""; // prefix 範囲の番人(Firestore の prefix クエリ定番)

function docId(key) {
  // "/" や "." を含むキー、__x__ 予約形を避ける。base64url は一意で可逆、"/"も"."も出さん。
  return "k_" + Buffer.from(String(key), "utf8").toString("base64url");
}

export function makeKv(firestore, collectionName = "hs_verify_kv") {
  const col = firestore.collection(collectionName);

  async function get(key, type) {
    const snap = await col.doc(docId(key)).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (d && d.expiresAt && d.expiresAt <= Date.now()) return null;
    const v = d ? d.value : null;
    if (v == null) return null;
    return type === "json" ? JSON.parse(v) : v;
  }

  async function put(key, value, opts) {
    const ttl = opts && opts.expirationTtl;
    const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
    await col.doc(docId(key)).set({ key: String(key), value: String(value), expiresAt });
  }

  async function del(key) {
    await col.doc(docId(key)).delete();
  }

  async function list(opts = {}) {
    const prefix = opts.prefix || "";
    const limit = Math.min(opts.limit || 1000, 1000);
    let q = col.orderBy("key");
    if (opts.cursor) q = q.startAfter(opts.cursor);
    else if (prefix) q = q.startAt(prefix);
    if (prefix) q = q.endAt(prefix + HIGH);
    q = q.limit(limit);
    const snap = await q.get();
    const now = Date.now();
    const raw = snap.docs.length;
    const keys = [];
    let lastKey = null;
    for (const doc of snap.docs) {
      const d = doc.data();
      lastKey = d.key;
      if (d.expiresAt && d.expiresAt <= now) continue; // 期限切れは返さん
      keys.push({ name: d.key });
    }
    const list_complete = raw < limit;
    return { keys, list_complete, cursor: list_complete ? undefined : lastKey };
  }

  return { get, put, delete: del, list };
}
