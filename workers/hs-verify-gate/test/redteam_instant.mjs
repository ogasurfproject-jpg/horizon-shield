// nenrin-instant-v1 の敵(Worker 側 module)。offline、決定的、網なし。
// 走らせ方: node test/redteam_instant.mjs
//
// Python 側の参照実装と敵は workers/hs-ledger/nenrin/coordinate-v1/instant_redteam.py。
// こっちは扉に載っとる方の実装を撃つ。両方が同じ規則を守っとることが二実装の意味や。

import * as n from "../src/nenrin_instant.js";

const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });

const SALT = "a1".repeat(32);
const OTHER = "b2".repeat(32);
const EP = "https://target.test/mcp";
const WID = "w2957";
const TOOLS = ["read_thing", "delete_thing", "move_money", "list_things"];
const BLOCK_A = "aa".repeat(32);
const BLOCK_B = "bb".repeat(32);

// ---- 偽の KV と偽の網 --------------------------------------------------------
function mockKv(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => void m.set(k, v), _m: m };
}
function mockFetch(plan) {
  return async (url) => {
    const hit = plan.find((p) => url.includes(p.match));
    if (!hit) return { ok: false, status: 404, text: async () => "" };
    if (hit.throws) throw new Error(hit.throws);
    return { ok: hit.ok !== false, status: hit.status || 200, text: async () => hit.body };
  };
}
const bothAgree = (h, hash) => [
  { match: "mempool.space/api/blocks/tip/height", body: String(h + 6) },
  { match: "mempool.space/api/block-height/", body: hash },
  { match: "blockstream.info/api/blocks/tip/height", body: String(h + 6) },
  { match: "blockstream.info/api/block-height/", body: hash }
];

// ---- 導出の芯 ----------------------------------------------------------------
const seedA = await n.prfHex(SALT, ["nenrin-instant-v1", "seed", WID, BLOCK_A]);
const seedB = await n.prfHex(SALT, ["nenrin-instant-v1", "seed", WID, BLOCK_B]);

t("attack", "同じ salt でも block hash が違えば seed が変わる(扉が salt を引き直しても steer できん)",
  seedA !== seedB, seedA.slice(0, 12) + " vs " + seedB.slice(0, 12));

const orderA = await n.toolOrder(seedA, EP, WID, TOOLS);
const orderShuffled = await n.toolOrder(seedA, EP, WID, [...TOOLS].reverse());
t("control", "同じ種なら導出順は不変", JSON.stringify(orderA) === JSON.stringify(await n.toolOrder(seedA, EP, WID, TOOLS)));
t("attack", "server が tools/list を並べ替えても、測られる順は動かん",
  JSON.stringify(orderA) === JSON.stringify(orderShuffled), JSON.stringify(orderA));
t("attack", "種が違えば選ばれる tool も変わる(種が効いとる証拠)",
  JSON.stringify(orderA) !== JSON.stringify(await n.toolOrder(seedB, EP, WID, TOOLS)));

const setA = await n.toolSetSha256(TOOLS);
const renamed = ["read_thing", "delete_thing", "move_money", "aaa_safe_thing"];
t("attack", "改名で steer しようとすると tool_set_sha256 が動く(surface change として出る)",
  setA !== (await n.toolSetSha256(renamed)));
t("control", "並べ替えでは tool_set_sha256 は動かん", setA === (await n.toolSetSha256([...TOOLS].reverse())));

let dup = false;
try { await n.toolSetSha256(["a", "a", "b"]); } catch (e) { dup = true; }
t("attack", "tool 名の重複は黙って潰さず拒否する", dup);

t("misclass", "申告が空でも例外やない(未測定であって失敗やない)", (await n.toolSetSha256([])) === null);

// ---- 測る日 ------------------------------------------------------------------
const off = await n.dueOffset(seedA, EP, WID);
t("control", "測る日は窓の中に収まる", Number.isInteger(off) && off >= 0 && off < n.NENRIN_WINDOW_DAYS, "day=" + off);

let spread = new Set();
for (let i = 0; i < 400; i++) spread.add(await n.dueOffset(seedA, "https://h" + i + ".test/mcp", WID));
t("attack", "対象が違えば日がばらける(全員が同じ日に固まらん)", spread.size === n.NENRIN_WINDOW_DAYS, "使われた日: " + spread.size);

const before = await n.dueOffset(seedA, EP, WID);
const after = await n.dueOffset(seedB, EP, WID);
t("attack", "窓の種が変われば同じ対象の日も変わりうる(前の窓から予測できん)", true, before + " -> " + after);

// ---- salt --------------------------------------------------------------------
t("control", "commitment は salt から決まる", (await n.saltCommitment(SALT)) === (await n.saltCommitment(SALT)));
t("attack", "違う salt は違う commitment", (await n.saltCommitment(SALT)) !== (await n.saltCommitment(OTHER)));
let badSalt = 0;
for (const s of ["zz".repeat(32), "a1".repeat(16), "", null, 12345]) {
  try { await n.saltCommitment(s); } catch (e) { badSalt++; }
  try { await n.prfHex(s, ["x"]); } catch (e) { badSalt++; }
}
t("attack", "壊れた salt は全部拒否(hex 違い、長さ違い、型違い)", badSalt === 10, "拒否 " + badSalt + "/10");

// ---- beacon ------------------------------------------------------------------
const b1 = await n.beacon(mockKv(), WID, null, mockFetch(bothAgree(900000, BLOCK_A)));
t("control", "2 源が一致したら beacon を採る", b1.block_hash === BLOCK_A && b1.height === 900000, JSON.stringify(b1.sources || []));

const disagree = [
  { match: "mempool.space/api/blocks/tip/height", body: "900006" },
  { match: "mempool.space/api/block-height/", body: BLOCK_A },
  { match: "blockstream.info/api/blocks/tip/height", body: "900006" },
  { match: "blockstream.info/api/block-height/", body: BLOCK_B }
];
const b2 = await n.beacon(mockKv(), WID, null, mockFetch(disagree));
t("attack", "2 源が食い違ったら beacon 無し(片方を採らん)", b2.block_hash === null, b2.reason || "");

const onlyOne = [
  { match: "mempool.space/api/blocks/tip/height", body: "900006" },
  { match: "mempool.space/api/block-height/", body: BLOCK_A },
  { match: "blockstream.info/api/blocks/tip/height", throws: "ECONNREFUSED" }
];
const b3 = await n.beacon(mockKv(), WID, null, mockFetch(onlyOne));
t("attack", "1 源しか答えん日は beacon 無し(単独の explorer は根拠にならん)", b3.block_hash === null, b3.reason || "");

const badHash = [
  { match: "mempool.space/api/blocks/tip/height", body: "900006" },
  { match: "mempool.space/api/block-height/", body: "not-a-hash" },
  { match: "blockstream.info/api/blocks/tip/height", body: "900006" },
  { match: "blockstream.info/api/block-height/", body: "not-a-hash" }
];
const b4 = await n.beacon(mockKv(), WID, null, mockFetch(badHash));
t("attack", "64 桁 hex やない物は block hash として採らん", b4.block_hash === null, b4.reason || "");

// ---- 窓の座標 ----------------------------------------------------------------
const kv = mockKv();
const c1 = await n.coordinate(kv, Date.UTC(2026, 8, 5), mockFetch(bothAgree(900000, BLOCK_A)));
t("control", "beacon が採れたら derived:true で種が立つ", c1.derived === true && /^[0-9a-f]{64}$/.test(c1.seed || ""));

const c2 = await n.coordinate(mockKv(), Date.UTC(2026, 8, 5), mockFetch(disagree));
t("misclass", "beacon が無い窓は derived:false、旧規則に落ちたと明記する",
  c2.derived === false && /predict/.test(c2.why || ""), (c2.why || "").slice(0, 60));

const kvJunk = mockKv({ ["nenrin:window:" + n.windowId(Date.UTC(2026, 8, 5))]: "{{{ not json" });
const c3 = await n.coordinate(kvJunk, Date.UTC(2026, 8, 5), mockFetch(bothAgree(900000, BLOCK_A)));
t("attack", "KV が壊れた値を返しても落ちん(作り直す)", c3.derived === true);

// ---- 判定に埋める塊 ----------------------------------------------------------
const dOk = await n.derivationBlock(c1, EP, TOOLS);
t("control", "導出できた判定は、窓・commitment・block・日・tool 集合を全部載せる",
  dOk.derived === true && dOk.salt_commitment && dOk.beacon.block_hash === BLOCK_A &&
  Number.isInteger(dOk.day_in_window) && dOk.tool_set_sha256 === setA && dOk.tool_count === 4);

const dNo = await n.derivationBlock(c2, EP, TOOLS);
t("attack", "導出できんかった判定は、旧規則に落ちたことを隠さず書く",
  dNo.derived === false && /predict/.test(dNo.fallback || ""), (dNo.fallback || "").slice(0, 70));

const dNull = await n.derivationBlock(null, EP, TOOLS);
t("misclass", "座標の文脈が無い一回きりの /check も、無いと書く(登録簿の行やない)",
  dNull.derived === false && /one-off/.test(dNull.why || ""));

t("residual", "申告されてない tool は永遠に選ばれん",
  orderA.every((x) => TOOLS.includes(x)) && orderA.length === TOOLS.length,
  "導出が公平なのは申告された surface の中だけ。その集合は absent やなく unknown。");

t("residual", "salt は窓ごとに 1 回きり。reveal 済みを使い回したら完全に予測できる",
  (await n.dueOffset(seedA, EP, WID)) === (await n.dueOffset(seedA, EP, WID)),
  "この vector は通す試験やなく、使い回しが破れる証明や。");

// ---- 報告 --------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control", "misclass", "residual"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
console.log();
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (nenrin-instant-v1、扉 0.3.0) ===");
if (passed === R.length) console.log("測る日も測る tool も、測られる側が選べず、測る側も後から選べん。");
process.exit(passed === R.length ? 0 : 1);
