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
const NOW = Date.UTC(2026, 8, 5);                 // 掃引の瞬間(salt はこの時刻に作られる)
const T_AFTER = Math.floor(NOW / 1000) + 3600;      // salt の 1 時間後に採掘された block の header time
const T_BEFORE = Math.floor(NOW / 1000) - 3600;     // salt の 1 時間前(0.3.4 までの本番の形)
const blockJson = (h, hash, ts) => JSON.stringify({ id: hash, height: h, timestamp: ts });
// 0.3.5: 両源が同じ tip を返し、基準高さ h の hash が一致し、block の header time が salt より後。
const bothAgree = (h, hash, ts = T_AFTER, tipA = h + 6, tipB = h + 6) => [
  { match: "mempool.space/api/blocks/tip/height", body: String(tipA) },
  { match: "mempool.space/api/block-height/", body: hash },
  { match: "mempool.space/api/block/", body: blockJson(h, hash, ts) },
  { match: "blockstream.info/api/blocks/tip/height", body: String(tipB) },
  { match: "blockstream.info/api/block-height/", body: hash },
  { match: "blockstream.info/api/block/", body: blockJson(h, hash, ts) }
];
// fetch を数える(窓につき 1 回だけ引く、の証拠に使う)
function countingFetch(plan) { const f = mockFetch(plan); const c = { n: 0 }; const g = async (u) => { c.n++; return f(u); }; g.count = c; return g; }

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
const c1 = await n.coordinate(kv, NOW, mockFetch(bothAgree(900000, BLOCK_A)));
t("control", "beacon が採れたら derived:true で種が立つ", c1.derived === true && /^[0-9a-f]{64}$/.test(c1.seed || ""));

const c2 = await n.coordinate(mockKv(), NOW, mockFetch(disagree));
t("misclass", "beacon が無い窓は derived:false、旧規則に落ちたと明記する",
  c2.derived === false && /predict/.test(c2.why || ""), (c2.why || "").slice(0, 60));

const kvJunk = mockKv({ ["nenrin:window:" + n.windowId(NOW)]: "{{{ not json" });
const c3 = await n.coordinate(kvJunk, NOW, mockFetch(bothAgree(900000, BLOCK_A)));
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

// ---- 0.3.5: 一致判定、順序、次の窓、固定、公開 ------------------------------------
// B. tip が 1 本ずれとる瞬間は平常。基準高さは min(tip) - 6 の 1 つ。同じ高さの hash が一致すれば採る。
const bSkew = await n.beacon(mockKv(), WID, null, mockFetch(bothAgree(900000, BLOCK_A, T_AFTER, 900006, 900007)));
t("attack", "0.3.5: 2 源の tip が 1 本ずれとっても、基準高さ min(tip) - 6 の hash が一致すれば beacon を採る(0.3.4 までは落ちとった)",
  bSkew.block_hash === BLOCK_A && bSkew.height === 900000 && bSkew.reference && bSkew.reference.tips["blockstream.info"] === 900007,
  JSON.stringify(bSkew.reference || bSkew.reason));
const bSkewBad = [
  { match: "mempool.space/api/blocks/tip/height", body: "900006" },
  { match: "mempool.space/api/block-height/", body: BLOCK_A },
  { match: "blockstream.info/api/blocks/tip/height", body: "900009" },
  { match: "blockstream.info/api/block-height/", body: BLOCK_B }
];
const b5 = await n.beacon(mockKv(), WID, null, mockFetch(bSkewBad));
t("attack", "0.3.5: 基準高さが 1 つでも、その高さの hash が食い違えば採らん(reason_code hash_disagreement)",
  b5.block_hash === null && b5.reason_code === "hash_disagreement", b5.reason || "");

// C. salt の後に採掘された block でなければ束縛の意味が無い。
const bBefore = await n.beacon(mockKv(), WID, new Date(NOW).toISOString(), mockFetch(bothAgree(900000, BLOCK_A, T_BEFORE)));
t("attack", "0.3.5: block の header time が salt より前なら採らん(0.3.4 までの本番はこの形で束縛しとった)",
  bBefore.block_hash === null && bBefore.reason_code === "block_before_salt", (bBefore.reason || "").slice(0, 90));
const noBlockTime = bothAgree(900000, BLOCK_A).filter((p) => !/api\/block\//.test(p.match));
const bNoTime = await n.beacon(mockKv(), WID, new Date(NOW).toISOString(), mockFetch(noBlockTime));
t("attack", "0.3.5: block の header time が読めん時も採らん(salt より後と示せん物は使わん、fail closed)",
  bNoTime.block_hash === null && bNoTime.reason_code === "block_time_unavailable", bNoTime.reason || "");
const bAfter = await n.beacon(mockKv(), WID, new Date(NOW).toISOString(), mockFetch(bothAgree(900000, BLOCK_A, T_AFTER)));
t("control", "0.3.5: salt より後の block なら採り、header time と基準の tips を記録に残す",
  bAfter.block_hash === BLOCK_A && bAfter.block_time === new Date(T_AFTER * 1000).toISOString() && bAfter.agreed_by.length === 2, JSON.stringify(bAfter.agreed_by));

// C. 次の窓の salt は今の窓の掃引で先に作る。commitment は block より先に公開される。
const kvW = mockKv();
const ws1 = await n.ensureWindowStates(kvW, NOW);
const ws2 = await n.ensureWindowStates(kvW, NOW + 86400000);
t("control", "0.3.5: 掃引は今の窓と次の窓の salt を揃え、2 回目は何も作らん(冪等)",
  ws1.created.length === 2 && ws1.next.window_id === n.nextWindowId(NOW) && ws1.current.commitment !== ws1.next.commitment && ws2.created.length === 0,
  JSON.stringify(ws1.created));
t("control", "0.3.5: 次の窓の salt_created_at は次の窓が開く前", Date.parse(ws1.next.salt_created_at) < Date.parse(n.windowBounds(ws1.next.window_id).opens_at),
  ws1.next.salt_created_at + " < " + n.windowBounds(ws1.next.window_id).opens_at);
const pubCur = await n.publicWindow(kvW, n.windowId(NOW), NOW);
const pubNext = await n.publicWindow(kvW, n.nextWindowId(NOW), NOW);
const pubClosed = await n.publicWindow(kvW, n.windowId(NOW), NOW + 8 * 86400000);
t("attack", "0.3.5: 公開の窓は commitment を出し、salt は窓が閉じるまで出さん(current も next も null)",
  pubCur.salt === null && pubNext.salt === null && pubCur.commitment === ws1.current.commitment && pubNext.status === "next", JSON.stringify([pubCur.status, pubNext.status]));
t("control", "0.3.5: 閉じた窓は salt を reveal し、commitment が再計算で一致する",
  pubClosed.status === "closed" && pubClosed.salt === ws1.current.salt && (await n.saltCommitment(pubClosed.salt)) === pubClosed.commitment);

// D. 窓の最初の掃引で決めた規則をその窓に固定する。
const kvPin = mockKv();
const p1 = await n.coordinate(kvPin, NOW, mockFetch(disagree));
const p2 = await n.coordinate(kvPin, NOW + 86400000, mockFetch(bothAgree(900000, BLOCK_A)));
t("attack", "0.3.5: 最初の掃引が legacy に落ちた窓は、翌日 beacon が取れても legacy のまま(窓につき規則は 1 つ、理由を書く)",
  p1.derived === false && p1.rule && p1.rule.rule === "legacy" && p2.derived === false && p2.reason_code === "pinned_legacy" && /first sweep/.test(p2.why),
  (p2.why || "").slice(0, 80));
const kvPin2 = mockKv();
const cf = countingFetch(bothAgree(900000, BLOCK_A));
const q1 = await n.coordinate(kvPin2, NOW, cf);
const fetchesAfterFirst = cf.count.n;
const q2 = await n.coordinate(kvPin2, NOW + 86400000, cf);
t("control", "0.3.5: 最初の掃引で導出できた窓は derived に固定され、beacon は窓につき 1 回しか引かん(翌日は網に出ん)",
  q1.derived === true && q1.rule && q1.rule.rule === "derived" && q2.derived === true && q2.seed === q1.seed && cf.count.n === fetchesAfterFirst, "fetch calls: " + fetchesAfterFirst + " then " + cf.count.n);
const dSrc = await n.derivationBlock(p2, EP, TOOLS);
t("misclass", "0.3.5: 落ちた判定は reason_code と源ごとの結果を載せる(なぜ落ちたかが履歴から読める)",
  dSrc.derived === false && dSrc.reason_code === "pinned_legacy" && typeof dSrc.why === "string", JSON.stringify(dSrc.reason_code));

// 3 源目(mempool.emzy.de)。1 本だけ遅れとる源は基準を下げん。1 本だけ進んどる源も基準を上げん。
const threeSrc = (tipA, tipB, tipC, h, hash) => [
  { match: "mempool.space/api/blocks/tip/height", body: String(tipA) },
  { match: "mempool.space/api/block-height/", body: hash },
  { match: "mempool.space/api/block/", body: blockJson(h, hash, T_AFTER) },
  { match: "blockstream.info/api/blocks/tip/height", body: String(tipB) },
  { match: "blockstream.info/api/block-height/", body: hash },
  { match: "blockstream.info/api/block/", body: blockJson(h, hash, T_AFTER) },
  { match: "mempool.emzy.de/api/blocks/tip/height", body: String(tipC) },
  { match: "mempool.emzy.de/api/block-height/", body: hash },
  { match: "mempool.emzy.de/api/block/", body: blockJson(h, hash, T_AFTER) }
];
const b3a = await n.beacon(mockKv(), WID, null, mockFetch(threeSrc(900006, 900006, 899990, 900000, BLOCK_A)));
t("attack", "0.3.5: 3 源のうち 1 本が 16 本遅れとっても、基準は 2 番目に高い tip - 6(遅れた源に拒否権は無い)",
  b3a.block_hash === BLOCK_A && b3a.height === 900000, JSON.stringify(b3a.reference || b3a.reason));
const b3b = await n.beacon(mockKv(), WID, null, mockFetch(threeSrc(900020, 900006, 900006, 900000, BLOCK_A)));
t("attack", "0.3.5: 1 本だけ進んどる tip も基準を上げん(2 番目に高い tip を採る)",
  b3b.block_hash === BLOCK_A && b3b.height === 900000 && b3b.reference.tips["mempool.space"] === 900020, JSON.stringify(b3b.reference || b3b.reason));

// ---- 報告 --------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
console.log("--- 種別 ---");
for (const k of ["attack", "control", "misclass", "residual"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
console.log();
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (nenrin-instant-v1、扉 0.3.5) ===");
if (passed === R.length) console.log("測る日も測る tool も、測られる側が選べず、測る側も後から選べん。");
process.exit(passed === R.length ? 0 : 1);
