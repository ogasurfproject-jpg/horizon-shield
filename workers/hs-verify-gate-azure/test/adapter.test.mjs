// adapter.test.mjs  kv_table.mjs と lease_table.mjs を、手元の Azurite の上で本物の @azure/data-tables と @azure/storage-blob で回す。
// 比べる相手は Cloudflare の KV と Durable Object の偽物(test/parity/fake_cloudflare.mjs。DO は本物の SweepLeaseDO を動かす)。
// 網に出ない: 繋ぐのは 127.0.0.1 の Azurite だけ。
// 使い方: node test/adapter.test.mjs     1 つでも落ちたら exit 1

import { createHash } from "node:crypto";
import { makeCfKv, makeCfDoNamespace } from "./parity/fake_cloudflare.mjs";
import { newTable, newContainer } from "./azurite.mjs";
import { makeKvOnTable, cleanupExpired, hexOf, chunksOf } from "../src/kv_table.mjs";
import { makeLeaseNamespace } from "../src/lease_table.mjs";
import { makeBlobText } from "../src/blob_text.mjs";
import { SweepLeaseDO } from "../../hs-verify-gate/src/sweep_lease.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || detail == null ? "" : "  <- " + String(detail).slice(0, 400))); };
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const thrown = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

let clock = Date.parse("2026-11-05T18:00:00Z");
const now = () => clock;
const table = await newTable("ad");
const container = await newContainer("ad");
const blobs = makeBlobText(container);
const cf = makeCfKv({ now });
const az = makeKvOnTable({ table, blobs, now });
const same = async (name, fn) => { const a = await fn(cf), b = await fn(az); t(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b])); };

// ---- 鍵の順、prefix、get の形 ----
const keys = ["hist:00ff", "hist:0a", "rec:ab", "rec:a", "usage:2026-11-05", "a/b#c?d", "back\\slash", "é:x", "\u{1F600}:emoji", ":pua", "z", "watch:reg:" + "f".repeat(64)];
for (const k of keys) { await cf.put(k, "v:" + k); await az.put(k, "v:" + k); }
await same("kv list without prefix: same keys, same order (UTF-8 byte order; U+1F600 after U+E000)", async (kv) => (await kv.list({})).keys.map((x) => x.name));
await same("kv list prefix 'rec:'", async (kv) => (await kv.list({ prefix: "rec:" })).keys.map((x) => x.name));
await same("kv list prefix 'hist:0' (prefix inside a key segment)", async (kv) => (await kv.list({ prefix: "hist:0" })).keys.map((x) => x.name));
await same("kv list prefix with no match", async (kv) => (await kv.list({ prefix: "nothing:" })));
await same("kv get of keys Table refuses as RowKey ('/', '#', '?', '\\')", async (kv) => [await kv.get("a/b#c?d"), await kv.get("back\\slash")]);
await same("kv get missing -> null (text and json)", async (kv) => [await kv.get("nope"), await kv.get("nope", "json"), await kv.get("nope", { type: "json" })]);
await cf.put("j", JSON.stringify({ a: [1, 2], s: "日本" })); await az.put("j", JSON.stringify({ a: [1, 2], s: "日本" }));
await same("kv get json, {type:'json'}, text", async (kv) => [await kv.get("j", "json"), await kv.get("j", { type: "json" }), await kv.get("j", "text"), await kv.get("j")]);
await same("kv put of the empty string reads back as the empty string", async (kv) => { await kv.put("empty", ""); return kv.get("empty"); });
const ent = await table.getEntity("kv", hexOf("a/b#c?d"));
t("kv RowKey is the lower case hex of the UTF-8 key, the raw key rides in k", ent.rowKey === Buffer.from("a/b#c?d").toString("hex") && ent.k === "a/b#c?d", JSON.stringify(ent));

// ---- cursor ----
const walk = async (kv, limit) => { const seen = []; let cursor, pages = 0; do { const p = await kv.list({ limit, cursor }); pages++; for (const k of p.keys) seen.push(k.name); cursor = p.list_complete ? undefined : p.cursor; } while (cursor && pages < 50); return seen; };
await same("kv cursor with limit 3 walks every key once, in order", (kv) => walk(kv, 3));
await same("kv cursor with limit 1", (kv) => walk(kv, 1));
{
  // 1,000 を超える鍵(Table の 1 頁は 1,000 件まで)。既定の limit で 2 回の list に分かれ、全部が 1 回ずつ出る。
  const big = makeKvOnTable({ table, blobs, now, partition: "many" });
  for (let i = 0; i < 1005; i += 1) await big.put("m:" + String(i).padStart(4, "0"), "x");
  const p1 = await big.list({ prefix: "m:" });
  const p2 = await big.list({ prefix: "m:", cursor: p1.cursor });
  t("kv 1,005 keys: first list gives 1,000 and a cursor, the second the last 5 and list_complete",
    p1.keys.length === 1000 && p1.list_complete === false && p2.keys.length === 5 && p2.list_complete === true && p2.keys[4].name === "m:1004",
    JSON.stringify([p1.keys.length, p1.list_complete, p2.keys.length, p2.list_complete]));
  t("kv partitions do not see each other (the 1,005 keys are not in the 'kv' partition)", (await az.list({ prefix: "m:" })).keys.length === 0, "");
}

// ---- TTL ----
await cf.put("ttl", "1", { expirationTtl: 60 }); await az.put("ttl", "1", { expirationTtl: 60 });
await same("kv ttl: alive before expiry", async (kv) => kv.get("ttl"));
const lt = await az.list({ prefix: "ttl" });
t("kv ttl: list gives expiration in seconds, like KV", lt.keys.length === 1 && lt.keys[0].expiration === Math.floor((clock + 60000) / 1000), JSON.stringify(lt));
clock += 61_000;
await same("kv ttl: gone after expiry, and not listed", async (kv) => [await kv.get("ttl"), (await kv.list({ prefix: "ttl" })).keys.length]);
await az.put("ttl2", "2", { expiration: Math.floor(clock / 1000) + 120 });
t("kv absolute expiration (seconds) is kept as exp in ms", (await table.getEntity("kv", hexOf("ttl2"))).exp === (Math.floor(clock / 1000) + 120) * 1000, "");

// ---- metadata(扉は mould と登録簿の行を list の metadata で読む)----
await az.put("mould:x1", JSON.stringify({ id: "x1" }), { metadata: { id: "x1", record_sha256: "ab".repeat(32), n: 3 } });
const lm = await az.list({ prefix: "mould:" });
t("kv metadata given to put comes back on list keys[].metadata", lm.keys.length === 1 && lm.keys[0].metadata && lm.keys[0].metadata.id === "x1" && lm.keys[0].metadata.n === 3, JSON.stringify(lm));
t("kv a key put without metadata has no metadata on list", !("metadata" in (await az.list({ prefix: "rec:a" })).keys[0]), "");
t("kv metadata over 1,024 bytes is refused, as KV does", !!(await thrown(() => az.put("mould:x2", "{}", { metadata: { pad: "y".repeat(1100) } }))), "");

// ---- 大きい値: 分割、サロゲート、Blob ----
const mid = "x".repeat(100_000) + "末尾";
await cf.put("hist:big", mid); await az.put("hist:big", mid);
await same("kv a 100,002 char value (over the 32,768 char property limit) reads back whole", async (kv) => sha256(await kv.get("hist:big")));
const eb = await table.getEntity("kv", hexOf("hist:big"));
t("kv ... stored as " + eb.n + " properties of at most 32,000 chars, no blob", eb.n === 4 && !eb.blob && eb.v0.length === 32000, JSON.stringify({ n: eb.n, blob: eb.blob }));
const emo = "a".repeat(31999) + "\u{1F600}" + "b".repeat(40000);   // 32,000 字目でサロゲートの対が割れる位置
await cf.put("surr", emo); await az.put("surr", emo);
await same("kv a surrogate pair across the 32,000 char cut reads back whole", async (kv) => sha256(await kv.get("surr")));
const es = await table.getEntity("kv", hexOf("surr"));
const lone = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
t("kv ... and no stored chunk holds half a pair", [...Array(es.n).keys()].every((i) => !lone(es["v" + i])) && es.v0.length === 31999, JSON.stringify({ n: es.n, v0: es.v0.length }));
t("kv chunksOf keeps every chunk at most 32,000 chars and joins back", chunksOf(emo).every((c) => c.length <= 32000) && chunksOf(emo).join("") === emo, "");
const huge = JSON.stringify({ entries: Array.from({ length: 400 }, (_, i) => ({ at: "2026-11-05T18:00:00.000Z", i, pad: "y".repeat(3000) })) });
await cf.put("hist:huge", huge); await az.put("hist:huge", huge);
await same("kv a " + huge.length + " char value (400 history entries, over the 1 MiB entity limit) reads back whole", async (kv) => sha256(await kv.get("hist:huge")));
const eh = await table.getEntity("kv", hexOf("hist:huge"));
const blobName = eh.blob;
const blobProps = blobName ? await container.getBlockBlobClient(blobName).getProperties() : null;
t("kv ... went to Blob (entity holds only its name; blob metadata rk names the entity)", !!blobName && eh.n === 0 && blobProps && blobProps.metadata.rk === hexOf("hist:huge"), JSON.stringify({ blob: blobName, n: eh.n, md: blobProps && blobProps.metadata }));
t("kv ... the blob holds the UTF-8 bytes (" + (blobProps && blobProps.contentLength) + ")", blobProps && blobProps.contentLength === Buffer.byteLength(huge, "utf8"), "");
await cf.put("hist:huge", "small"); await az.put("hist:huge", "small");
await same("kv overwriting a spilled key with a small value reads the small value", async (kv) => kv.get("hist:huge"));
t("kv ... the old blob stays until the cleanup (not read)", (await container.getBlockBlobClient(blobName).exists()) === true, "");
await cf.put("hist:huge2", huge); await az.put("hist:huge2", huge);
await cf.delete("hist:huge2"); await az.delete("hist:huge2");
await same("kv delete of a spilled key", async (kv) => [await kv.get("hist:huge2"), (await kv.list({ prefix: "hist:huge2" })).keys.length]);
const b2 = "kv/" + createHash("sha256").update("hist:huge2").digest("hex");
t("kv ... delete also removed its blob", (await container.getBlockBlobClient(b2).exists()) === false, "");

// ---- 断る物 ----
t("kv a key over 256 UTF-8 bytes is refused (Azurite takes RowKey up to 512 chars, hex doubles)", !!(await thrown(() => az.put("k".repeat(257), "v"))), "");
t("kv a 256 byte key is taken", !(await thrown(() => az.put("k".repeat(256), "v"))) && (await az.get("k".repeat(256))) === "v", "");
t("kv a non string value is refused (KV refuses numbers too)", (await thrown(() => az.put("n", 5))) instanceof TypeError, "");
await same("kv delete", async (kv) => { await kv.delete("z"); await kv.delete("never-there"); return kv.get("z"); });

// ---- 掃除 ----
{
  const ct = await newTable("cl"), cc = await newContainer("cl"), cb = makeBlobText(cc);
  let c = Date.parse("2026-11-05T18:00:00Z");
  const kv = makeKvOnTable({ table: ct, blobs: cb, now: () => c });
  await kv.put("a", "1", { expirationTtl: 60 });
  await kv.put("b", "2", { expirationTtl: 60 });
  await kv.put("keep", "3");
  await kv.put("bigkeep", huge);
  await kv.put("bigold", huge); await kv.put("bigold", "small");      // 指されていない blob を 1 つ作る
  await kv.put("bigexp", huge, { expirationTtl: 60 });
  c += 120_000;
  await kv.put("b", "again");                                          // 期限が切れた後に put し直した鍵は消さない
  const r = await cleanupExpired({ table: ct, blobs: cb, now: () => c, blobGraceMs: -3600_000 });   // 試験では作ったばかりの blob も古い扱いにする
  const left = (await kv.list({})).keys.map((x) => x.name);
  const blobsLeft = []; for await (const b of cc.listBlobsFlat()) blobsLeft.push(b.name);
  t("cleanup: expired entities removed (a, bigexp), re-put kept (b), and unexpired kept: " + JSON.stringify(r),
    r.expired_deleted === 2 && JSON.stringify(left) === JSON.stringify(["b", "bigkeep", "bigold", "keep"]) && (await kv.get("b")) === "again", JSON.stringify({ r, left }));
  t("cleanup: blobs left are only the one still pointed to (bigkeep)", blobsLeft.length === 1 && blobsLeft[0] === "kv/" + createHash("sha256").update("bigkeep").digest("hex") && r.blobs_deleted === 2 && r.blobs_kept === 1, JSON.stringify({ blobsLeft, r }));
  const r2 = await cleanupExpired({ table: ct, blobs: cb, now: () => c });
  t("cleanup: blobs younger than the grace (1 hour) are not touched", r2.blobs_deleted === 0, JSON.stringify(r2));
  t("cleanup: bigkeep still reads whole after the cleanup", sha256(await kv.get("bigkeep")) === sha256(huge), "");
}

// ---- lease: 本物の SweepLeaseDO(偽の state)と同じ答えか ----
{
  const doNs = makeCfDoNamespace(SweepLeaseDO, {});
  const azNs = makeLeaseNamespace({ table: await newTable("ls") });
  const callOn = (ns) => async (p, body, method = "POST") => {
    const st = ns.get(ns.idFromName("sweep"));
    const r = await st.fetch("https://sweep-lease" + p, method === "POST" ? { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) } : { method });
    return { status: r.status, j: await r.json() };
  };
  const d = callOn(doNs), a = callOn(azNs);
  // token は乱数なので、比べる前に token の値だけを "<token>" にする(形は 32 字の 16 進かを別に見る)。
  const norm = (x) => JSON.parse(JSON.stringify(x).replace(/"token":"[0-9a-f]{32}"/g, '"token":"<token>"'));
  const both = async (name, steps) => {
    const outs = [];
    for (const call of [d, a]) { const o = []; let tok = null; for (const s of steps) { const body = typeof s.body === "function" ? s.body(tok) : s.body; const r = await call(s.p, body, s.m); if (r.j && r.j.token) tok = r.j.token; o.push(r); } outs.push(o); }
    t(name, JSON.stringify(norm(outs[0])) === JSON.stringify(norm(outs[1])), JSON.stringify(norm(outs)));
    return outs;
  };
  const T0 = Date.parse("2026-11-05T18:00:00Z");
  const outs = await both("lease: acquire, busy, peek, wrong token, release, release again: same answers as SweepLeaseDO", [
    { p: "/acquire", body: { holder: "cron", ttl_ms: 900000, now: T0 } },
    { p: "/acquire", body: { holder: "operator", ttl_ms: 900000, now: T0 + 1000 } },
    { p: "/peek", body: { now: T0 + 2000 } },
    { p: "/release", body: { token: "0".repeat(32) } },
    { p: "/release", body: (tok) => ({ token: tok }) },
    { p: "/release", body: (tok) => ({ token: tok }) },
    { p: "/peek", body: { now: T0 + 3000 } },
  ]);
  t("lease: the token is 32 hex chars on both", outs.every((o) => /^[0-9a-f]{32}$/.test(o[0].j.token)), "");
  await both("lease: an expired lease is taken over and names the one it replaced", [
    { p: "/acquire", body: { holder: "cron", now: T0 } },
    { p: "/acquire", body: { holder: "late", now: T0 + 16 * 60 * 1000 } },
    { p: "/peek", body: { now: T0 + 16 * 60 * 1000 } },
  ]);
  await both("lease: bad input answers the same (GET 404, bad json 400, no token 400, unknown path 404)", [
    { p: "/acquire", m: "GET" },
    { p: "/acquire", body: "{not json" },
    { p: "/release", body: {} },
    { p: "/nope", body: {} },
  ]);
  // 取り合い: 10 本が同時に取りに来ても 1 本だけ。期限切れの取り直しも 10 本で 1 本だけ。
  const ns2 = makeLeaseNamespace({ table: await newTable("lr") });
  const st = ns2.get(ns2.idFromName("sweep"));
  const acq = async (holder, n) => (await st.fetch("https://sweep-lease/acquire", { method: "POST", body: JSON.stringify({ holder, now: n }) })).json();
  const r10 = await Promise.all(Array.from({ length: 10 }, (_, i) => acq("h" + i, T0)));
  t("lease: 10 acquires at once on an empty table, exactly 1 wins (createEntity 409 for the rest)", r10.filter((x) => x.ok === true).length === 1 && r10.filter((x) => x.busy === true).length === 9, JSON.stringify(r10.map((x) => x.ok ? "won" : x.busy ? "busy" : x)));
  const r10b = await Promise.all(Array.from({ length: 10 }, (_, i) => acq("e" + i, T0 + 16 * 60 * 1000)));
  t("lease: 10 takeovers of an expired lease at once, exactly 1 wins (If-Match 412 for the rest)", r10b.filter((x) => x.ok === true).length === 1 && r10b.filter((x) => x.busy === true).length === 9, JSON.stringify(r10b.map((x) => x.ok ? "won" : x.busy ? "busy" : x)));
  const winner = r10b.find((x) => x.ok);
  const peek = await (await st.fetch("https://sweep-lease/peek", { method: "POST", body: JSON.stringify({ now: T0 + 16 * 60 * 1000 }) })).json();
  t("lease: the stored holder is the winner", peek.lease && peek.lease.holder === winner.holder, JSON.stringify([peek, winner.holder]));
  // 本物の worker 側の glue(sweep_lease.js の acquireSweepLease / releaseSweepLease)を Table の lease で。
  const { acquireSweepLease, releaseSweepLease } = await import("../../hs-verify-gate/src/sweep_lease.js");
  const env = { SWEEP_LEASE_DO: makeLeaseNamespace({ table: await newTable("lg") }) };
  const g1 = await acquireSweepLease(env, "cron", T0), g2 = await acquireSweepLease(env, "operator", T0);
  const rel = await releaseSweepLease(env, g1.token), g3 = await acquireSweepLease(env, "operator", T0);
  t("lease: the gate's own glue sees acquired, busy, released, acquired", g1.mode === "acquired" && g2.mode === "busy" && g2.holder === "cron" && rel === true && g3.mode === "acquired", JSON.stringify([g1.mode, g2.mode, rel, g3.mode]));
}

console.log("=== adapter on Azurite: " + pass + " / " + (pass + fail) + (fail ? "  FAIL" : "  ok") + " ===");
process.exit(fail ? 1 : 0);
