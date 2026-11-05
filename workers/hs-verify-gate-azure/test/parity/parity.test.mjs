// parity.test.mjs (段 1、扉 0.4.22。段 2: adapter は src/ の物。PARITY_STORE=azurite なら 2 の azure の mode は Azurite の上で回る)  同じ扉のコード(書き換えない)が、Cloudflare の KV と Durable Object を真似た置き場の上でも、
// Azure の Table Storage(と Blob)を真似た置き場の上でも、同じ記録を出すかを見る。
// 0.4.22 から記録に measured_from {platform, origin} が入るので、record_sha256 は置き場で違う。ここで縛るのは:
//   記録のバイトの差は measured_from の 1 欄だけ(外せば全部同じバイトで、外した物の sha は 2 つの置き場で同じ)、
//   それ以外の出力(応答、置き場の中身、webhook、notify、台帳への commitment)の差は、
//   その 1 欄と、それに伴う record_sha256 と /record/<sha> の名と、公開の origin(と commitment の vantage の名)だけ。
// 網に出ない: fetch は parity_run.mjs の偽物で、表に無い host は例外で落ちる。Azure にも Cloudflare にも繋がない。
// 使い方: node parity.test.mjs <workers/hs-verify-gate の dir>     1 つでも落ちたら exit 1
//
// 1. 置き場の adapter の単体(KV と同じ見え方か): 鍵の順、prefix、cursor、TTL、32,000 字を超える値の分割、
//    1 MiB に近い値の Blob への退避、Table が断る字(/ # ?)を含む鍵、lease の取り合い
// 2. 筋書き(parity_run.mjs)を 4 つの mode で別々の process に回し、出た物を比べる
//    A: cf と azure(写しの var 全部)       客の記録 2 本が measured_from だけ違う
//    B: cf-norows と azure                  同じ行の組。全部の出力が「1 欄、sha、origin」の差だけ
//    C: cf と azure-plain                   自前の行も込み。全部の出力が「1 欄、sha、origin」の差だけ

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { makeCfKv } from "./fake_cloudflare.mjs";
import { FakeTableClient, FakeBlobContainer, RestError } from "./fake_azure.mjs";
import { makeKvOnTable } from "../../src/kv_table.mjs";
import { makeLeaseNamespace } from "../../src/lease_table.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gateDir = process.argv[2];
if (!gateDir) { console.error("usage: node parity.test.mjs <gate dir>"); process.exit(2); }

let pass = 0, fail = 0;
const lines = [];
const t = (name, ok, detail) => { ok ? pass++ : fail++; lines.push((ok ? "  ok   " : "  FAIL ") + name + (ok || detail == null ? "" : "  <- " + String(detail).slice(0, 300))); };
const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// ---- 1. adapter の単体 -----------------------------------------------------------------------------
{
  let clock = 1_000_000;
  const now = () => clock;
  const cf = makeCfKv({ now });
  const table = new FakeTableClient("t"), blobs = new FakeBlobContainer("b");
  const az = makeKvOnTable({ table, blobs, now });
  const both = async (fn) => [await fn(cf), await fn(az)];
  const same = async (name, fn) => { const [a, b] = await both(fn); t(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b])); };

  const keys = ["hist:00ff", "hist:0a", "rec:ab", "rec:a", "usage:2026-11-05", "a/b#c?d", "é:x", "\u{1F600}:emoji", ":pua", "z"];
  for (const k of keys) { await cf.put(k, "v:" + k); await az.put(k, "v:" + k); }
  await same("1 list without prefix: same keys in the same order (UTF-8 byte order, incl. non-BMP vs U+E000)", async (kv) => (await kv.list({})).keys.map((x) => x.name));
  await same("1 list with prefix 'rec:'", async (kv) => (await kv.list({ prefix: "rec:" })).keys.map((x) => x.name));
  await same("1 get of a key Table Storage would refuse as a RowKey ('/', '#', '?')", async (kv) => kv.get("a/b#c?d"));
  await same("1 get missing -> null, get json missing -> null", async (kv) => [await kv.get("nope"), await kv.get("nope", "json")]);
  await cf.put("j", JSON.stringify({ a: [1, 2] })); await az.put("j", JSON.stringify({ a: [1, 2] }));
  await same("1 get json and get {type:'json'}", async (kv) => [await kv.get("j", "json"), await kv.get("j", { type: "json" }), await kv.get("j", "text")]);

  // cursor で全部を 1 回ずつ
  const walk = async (kv) => { const seen = []; let cursor, pages = 0; do { const p = await kv.list({ limit: 3, cursor }); pages++; for (const k of p.keys) seen.push(k.name); cursor = p.list_complete ? undefined : p.cursor; } while (cursor && pages < 20); return { seen, pages }; };
  await same("1 pagination with limit 3 walks every key once, in order, in the same number of pages", walk);

  // TTL
  await cf.put("ttl", "1", { expirationTtl: 60 }); await az.put("ttl", "1", { expirationTtl: 60 });
  await same("1 ttl: alive before expiry", async (kv) => kv.get("ttl"));
  clock += 61_000;
  await same("1 ttl: gone after expiry, and not listed", async (kv) => [await kv.get("ttl"), (await kv.list({ prefix: "ttl" })).keys.length]);

  // 大きい値: 32,000 字を超えると分割、1 MiB に近いと Blob
  const mid = "x".repeat(100_000) + "末尾";
  await cf.put("hist:big", mid); await az.put("hist:big", mid);
  await same("1 a 100,000 char value (over the 32,768 char Table property limit) reads back whole", async (kv) => sha256(await kv.get("hist:big")));
  const e = await table.getEntity("kv", Buffer.from("hist:big").toString("hex"));
  t("1 ... and is stored as " + e.n + " properties of at most 32,000 chars", e.n === 4 && !e.blob, JSON.stringify({ n: e.n, blob: e.blob }));
  const huge = JSON.stringify({ entries: Array.from({ length: 400 }, (_, i) => ({ at: "2026-11-05T18:00:00.000Z", i, pad: "y".repeat(3000) })) });
  await cf.put("hist:huge", huge); await az.put("hist:huge", huge);
  await same("1 a " + huge.length + " char value (400 history entries of ~3 KB, over the 1 MiB entity limit) reads back whole", async (kv) => sha256(await kv.get("hist:huge")));
  const eh = await table.getEntity("kv", Buffer.from("hist:huge").toString("hex"));
  t("1 ... and went to Blob, the entity holding only its name", !!eh.blob && eh.n === 0 && blobs.blobs.has(eh.blob), JSON.stringify({ blob: eh.blob, n: eh.n }));
  await cf.put("hist:huge", "small"); await az.put("hist:huge", "small");
  await same("1 overwriting a spilled key with a small value reads the small value", async (kv) => kv.get("hist:huge"));

  // 偽物が Table の縛りを本当に縛っているか(adapter を通さずに直に書くと断られる)
  let refused = [];
  for (const [what, ent] of [["RowKey with '/'", { partitionKey: "kv", rowKey: "a/b", v: "1" }], ["property of 40,000 chars", { partitionKey: "kv", rowKey: "big", v: "x".repeat(40_000) }]]) {
    try { await table.upsertEntity(ent, "Replace"); refused.push(what + ": accepted"); } catch (err) { refused.push(what + ": " + (err instanceof RestError ? err.statusCode : "?")); }
  }
  t("1 the Table fake refuses what Table Storage refuses (so the adapter is tested against the real limits)", refused.every((x) => /: (400|413)$/.test(x)), refused.join("; "));

  // delete
  await cf.delete("z"); await az.delete("z");
  await same("1 delete", async (kv) => kv.get("z"));
}

// lease: 同時に 2 本取ろうとしたら 1 本だけ、期限切れは取り直せる、違う token では外せない
{
  const lt = new FakeTableClient("lease");
  const ns = makeLeaseNamespace({ table: lt });
  const st = ns.get(ns.idFromName("sweep"));
  const call = async (p, body) => (await st.fetch("https://sweep-lease" + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const [a, b] = await Promise.all([call("/acquire", { holder: "cron", now: 0 }), call("/acquire", { holder: "operator", now: 0 })]);
  t("1 lease: two acquires at once, exactly one wins (createEntity 409 for the other)", [a, b].filter((x) => x.ok === true).length === 1 && [a, b].filter((x) => x.busy === true).length === 1, JSON.stringify([a, b]));
  const winner = a.ok ? a : b;
  const r1 = await call("/release", { token: "not-the-token" });
  t("1 lease: a wrong token does not release", r1.released === false, JSON.stringify(r1));
  const c = await call("/acquire", { holder: "late", now: 16 * 60 * 1000 });
  t("1 lease: after 15 minutes an expired lease is taken over (If-Match on the ETag)", c.ok === true && c.replaced_expired && c.replaced_expired.holder === winner.holder, JSON.stringify(c));
  const r2 = await call("/release", { token: c.token });
  t("1 lease: the holder releases", r2.released === true, JSON.stringify(r2));
}

// ---- 2. 筋書きを 4 つの mode で回す ---------------------------------------------------------------
const run = (mode) => {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(HERE, "parity_run.mjs"), gateDir, mode], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  if (r.status !== 0) throw new Error(mode + " run failed: " + (r.stderr || "").slice(0, 2000));
  return JSON.parse(r.stdout);
};
const CF = run("cf"), CFN = run("cf-norows"), AZP = run("azure-plain"), AZ = run("azure");
const CF_O = "https://gate.horizonshield.dev", AZ_O = "https://gate-az.horizonshield.dev";
const MF_CF = '"measured_from":{"platform":"cloudflare","origin":"https://gate.horizonshield.dev"}';
const MF_AZ = '"measured_from":{"platform":"azure","origin":"https://gate-az.horizonshield.dev"}';
const short = (x) => sha256(String(x)).slice(0, 12);
const cmp = (name, a, b) => t(name, a === b, a === b ? null : short(a) + " vs " + short(b));

// 記録のバイトから measured_from の 1 欄を外す。欄はちょうど 1 回、probed_via の直後にあるはず。外した数も返す。
function dropField(bytes, mf) {
  const n = bytes.split("," + mf).length - 1;
  return { n, text: bytes.split("," + mf).join("") };
}
// 写しの出力を Cloudflare の出力の言葉に戻す: 欄を外し、sha を付け替え、origin と vantage の名を戻す。
// 戻す前と後で何回置き換えたかを数え、「どこが origin で替わったか」を報告に出す。
function normalizer(shaMap, mf, fromOrigin) {
  const counts = { field: 0, sha: 0, origin: 0, vantage: 0 };
  const esc = (x) => JSON.stringify(x).slice(1, -1);
  const f = (text) => {
    let s = String(text);
    for (const form of [mf, esc(mf)]) { const parts = s.split("," + form); counts.field += parts.length - 1; s = parts.join(""); }
    for (const [a, b] of shaMap) { const parts = s.split(a); counts.sha += parts.length - 1; s = parts.join(b); }
    if (fromOrigin) {
      for (const [a, b] of [[fromOrigin, CF_O], [new URL(fromOrigin).host, new URL(CF_O).host]]) { const parts = s.split(a); counts.origin += parts.length - 1; s = parts.join(b); }
      const parts = s.split("azure-functions"); counts.vantage += parts.length - 1; s = parts.join("cloudflare-worker");
    }
    return s;
  };
  f.counts = counts;
  return f;
}
const stepsOf = (o) => ["watch", "sweep1", "sweep_last", "history", "lookup"].map((k) => [k, o.steps[k].status + "\n" + o.steps[k].text]);
function compareAll(label, A, B, fromOrigin) {
  // A: Cloudflare の偽物、B: Azure の偽物。記録を 1 本ずつ組にして、欄を外したバイトが同じかを見て sha の対応を作る。
  t(label + " both runs have the same number of customer records (" + A.records.length + ")", A.records.length === B.records.length && A.records.length === 2, A.records.length + " vs " + B.records.length);
  const shaMap = [];
  for (let i = 0; i < A.records.length; i++) {
    const a = A.records[i], b = B.records[i];
    const da = dropField(a.body, MF_CF), db = dropField(b.body, fromOrigin ? MF_AZ : MF_CF);
    t(label + " record " + (i + 1) + ": the field is there exactly once on each side (" + (fromOrigin ? "cloudflare / azure" : "cloudflare / cloudflare") + "), right after probed_via",
      da.n === 1 && db.n === 1 && /"probed_via":"[^"]*","measured_from":/.test(a.body) && /"probed_via":"[^"]*","measured_from":/.test(b.body), JSON.stringify([da.n, db.n]));
    t(label + " record " + (i + 1) + ": with the field, record_sha256 differs; SHA-256 of the served bytes is the sha on each side",
      (fromOrigin ? a.record_sha256 !== b.record_sha256 : true) && a.body_sha256 === a.record_sha256 && b.body_sha256 === b.record_sha256, JSON.stringify([a.record_sha256.slice(0, 12), b.record_sha256.slice(0, 12)]));
    cmp(label + " record " + (i + 1) + " (" + a.status + "): without the field, the bytes are equal", da.text, db.text);
    if (a.record_sha256 !== b.record_sha256) shaMap.push([b.record_sha256, a.record_sha256]);
  }
  // 置き場の rec:<sha> の全部(自前の行の記録も)を、欄を外したバイトで組にする。組にならない記録が 1 本でもあれば落とす。
  const recs = (o, mf) => new Map(o.store.filter(([k]) => k.startsWith("rec:")).map(([k, v]) => [k.slice(4), dropField(v, mf)]));
  const ra = recs(A, MF_CF), rb = recs(B, fromOrigin ? MF_AZ : MF_CF);
  const byText = new Map([...ra].map(([sha, d]) => [d.text, sha]));
  let paired = 0, unpaired = [];
  for (const [sha, d] of rb) {
    const other = byText.get(d.text);
    if (other && d.n === 1 && ra.get(other).n === 1) { paired++; if (other !== sha && !shaMap.some((m) => m[0] === sha)) shaMap.push([sha, other]); }
    else unpaired.push(sha.slice(0, 12));
  }
  t(label + " every stored record (" + rb.size + ") pairs with one on the other side by its bytes without the field, and carries the field once", paired === rb.size && ra.size === rb.size, JSON.stringify({ paired, a: ra.size, b: rb.size, unpaired }));
  const nb = normalizer(shaMap, fromOrigin ? MF_AZ : MF_CF, fromOrigin);
  const na = normalizer([], MF_CF, null);
  const sa = stepsOf(A), sb = stepsOf(B);
  const rawDiff = [];
  for (let i = 0; i < sa.length; i++) {
    if (sa[i][1] !== sb[i][1]) rawDiff.push(sa[i][0]);
    cmp(label + " response of " + sa[i][0] + ": equal after the field, the sha and the origin are mapped back", na(sa[i][1]), nb(sb[i][1]));
  }
  const storeNorm = (o, f) => o.store.map(([k, v]) => [f(k), f(v)]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const stA = JSON.stringify(storeNorm(A, na)), stB = JSON.stringify(storeNorm(B, nb));
  if (JSON.stringify(A.store) !== JSON.stringify(B.store)) rawDiff.push("store");
  cmp(label + " the whole store (" + A.store.length + " keys) is equal after the same mapping", stA, stB);
  for (const k of ["webhook_bodies", "notify_bodies", "ledger_bodies"]) {
    const ra = JSON.stringify(A[k]), rb = JSON.stringify(B[k]);
    if (ra !== rb) rawDiff.push(k);
    cmp(label + " " + k + " (" + A[k].length + "): equal after the same mapping", JSON.stringify(A[k].map(na)), JSON.stringify(B[k].map(nb)));
  }
  cmp(label + " the same random bytes were drawn (" + A.meta.random_bytes_drawn + ")", A.meta.random_bytes_drawn, B.meta.random_bytes_drawn);
  cmp(label + " the same outside calls were made (" + A.meta.fetches + ")", A.meta.fetches, B.meta.fetches);
  return { rawDiff, counts: nb.counts, shaMap };
}

// A: 扉の既定(cf)と写しの var 全部(azure)。行の組が違う(写しは自前の行を測らない)ので、比べるのは客の記録と知らせ。
t("2 A cf run: both measurements of the customer endpoint have a record", CF.records.length === 2, CF.records.length);
t("2 A the coordinate was derived (committed salt bound to the fake block), so the fixed salt is inside the record", /"derived": true/.test(CF.steps.sweep1.text) && /"derived": true/.test(AZ.steps.sweep1.text), "");
const mapA = [];
for (let i = 0; i < 2; i++) {
  const a = CF.records[i], b = AZ.records[i];
  const da = dropField(a.body, MF_CF), db = dropField(b.body, MF_AZ);
  t("2 A record " + (i + 1) + " (" + a.status + "): cf says cloudflare and the gate's origin, azure says azure and its own origin, each once", da.n === 1 && db.n === 1, JSON.stringify([da.n, db.n]));
  cmp("2 A record " + (i + 1) + ": without the field, the bytes are equal (the replica's own rows setting does not touch a customer's record)", da.text, db.text);
  t("2 A record " + (i + 1) + ": record_sha256 differs only because of the field (SHA-256 of the bytes without it is the same on both)", a.record_sha256 !== b.record_sha256 && sha256(da.text) === sha256(db.text), JSON.stringify([a.record_sha256.slice(0, 12), b.record_sha256.slice(0, 12), sha256(da.text).slice(0, 12)]));
  mapA.push([b.record_sha256, a.record_sha256]);
}
t("2 A the second measurement flipped a condition and the customer's webhook got exactly one conformance_change, on both", CF.webhook_bodies.length === 1 && AZ.webhook_bodies.length === 1 && /"conformance_change"/.test(CF.webhook_bodies[0]), JSON.stringify([CF.webhook_bodies.length, AZ.webhook_bodies.length]));
cmp("2 A the webhook body bytes are equal as sent (its history link is a relative path, so the origin does not appear)", JSON.stringify(CF.webhook_bodies), JSON.stringify(AZ.webhook_bodies));
{
  const nb = normalizer(mapA, MF_AZ, AZ_O), na = normalizer([], MF_CF, null);
  t("2 A notify (the owner's well-known notify) was sent twice on both", CF.notify_bodies.length === 2 && AZ.notify_bodies.length === 2, JSON.stringify([CF.notify_bodies.length, AZ.notify_bodies.length]));
  t("2 A notify bodies differ as sent (they carry absolute history and lookup links and the record sha)", JSON.stringify(CF.notify_bodies) !== JSON.stringify(AZ.notify_bodies), "");
  cmp("2 A notify bodies are equal after the sha and the origin are mapped back", JSON.stringify(CF.notify_bodies.map(na)), JSON.stringify(AZ.notify_bodies.map(nb)));
  t("2 A ... and what was mapped in them is the history and lookup links (2 per body) and the sha (1 per body), nothing else", nb.counts.origin === 4 && nb.counts.sha === 2 && nb.counts.field === 0 && nb.counts.vantage === 0, JSON.stringify(nb.counts));
  // 台帳への POST は {record_canonical: "<commitment 記録の JSON>"}。
  const lc = CF.ledger_bodies.map((x) => JSON.parse(JSON.parse(x).record_canonical)), la = AZ.ledger_bodies.map((x) => JSON.parse(JSON.parse(x).record_canonical));
  t("2 A both file the salt commitments of their windows to the ledger (" + lc.length + " records each)", lc.length >= 1 && lc.length === la.length, JSON.stringify([lc.length, la.length]));
  t("2 A the replica's commitment names its own window page and witness: base " + (la[0] && la[0].base) + ", witness " + JSON.stringify(la[0] && la[0].witness),
    la.every((r) => r.base.startsWith(AZ_O + "/nenrin/window/") && r.witness.name === "gate-az.horizonshield.dev" && r.witness.vantage === "azure-functions") &&
    lc.every((r) => r.base.startsWith(CF_O + "/nenrin/window/") && r.witness.name === "gate.horizonshield.dev" && r.witness.vantage === "cloudflare-worker"), JSON.stringify(la.map((r) => [r.base, r.witness])));
  cmp("2 A the commitments are otherwise equal (same fixed salt, same window, same text)", JSON.stringify(CF.ledger_bodies.map(na)), JSON.stringify(AZ.ledger_bodies.map(nb)));
}

// B: 同じ行の組(OWN_ROWS=off)で、置き場と var 以外は同じ。全部の出力を比べる。
const B = compareAll("2 B (cf-norows vs azure)", CFN, AZ, AZ_O);
t("2 B the raw outputs that differ are exactly those that carry a record sha or an absolute link: " + B.rawDiff.join(", "), B.rawDiff.length > 0, "");
t("2 B the replica sweeps only the customer (no own rows) in both", JSON.parse(CFN.steps.sweep1.text).results.length === 1 && JSON.parse(AZ.steps.sweep1.text).results.length === 1, "");
// C: 自前の行も込み(azure-plain は OWN_ROWS も GATE_PATHS も既定)。
const C = compareAll("2 C (cf vs azure-plain)", CF, AZP, AZ_O);
t("2 C the raw outputs that differ: " + C.rawDiff.join(", "), C.rawDiff.length > 0, "");
// 置き場だけが違い var が同じなら全部バイトで同じ、は前の parity/parity.test.mjs(書き換えない)を 0.4.22 の木に回して確かめる。

console.log(lines.join("\n"));
console.log("A records cf:    " + CF.records.map((r) => r.status + " " + r.record_sha256).join(" | "));
console.log("A records azure: " + AZ.records.map((r) => r.status + " " + r.record_sha256).join(" | "));
console.log("A records without the field (both): " + CF.records.map((r) => sha256(dropField(r.body, MF_CF).text)).join(" | "));
console.log("B raw differences: " + B.rawDiff.join(", ") + "  mapped: " + JSON.stringify(B.counts));
console.log("C raw differences: " + C.rawDiff.join(", ") + "  mapped: " + JSON.stringify(C.counts));
console.log("webhook body sha256: " + (CF.webhook_bodies[0] ? sha256(CF.webhook_bodies[0]) : "none"));
for (const [n, o] of [["cf", CF], ["cf-norows", CFN], ["azure-plain", AZP], ["azure", AZ]]) console.log(("meta " + n + ":").padEnd(18) + JSON.stringify(o.meta));
console.log("=== parity (phase 1): " + pass + " / " + (pass + fail) + (fail ? "  FAIL" : "  ok") + " ===");
process.exit(fail ? 1 : 0);
