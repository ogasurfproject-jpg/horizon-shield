// NENRIN 時刻座標 (nenrin-instant-v1)
//
// 時刻は座標や。Ring は instants_sampled を数える。誰が instant を選ぶかが Ring の中身を決める。
// 0.2.x までの選び方は bucket = sha256(endpoint)[:4] % 7。入力が全部公開されとるから対象が自分の
// 測定日を計算できた。7 日に 1 回だけ起きる shim が、満点の年輪を 1/7 の費用で買えた。
//
// 追補: workers/hs-ledger/nenrin/coordinate-v1/NENRIN_COORDINATE_v1_ADDENDUM_instants_v1.md
//   sha256 c4929b29b6e9f8f2877cc58e3c2e225542a7fe9a1bf805a02374b96750cf4c9f
// 参照実装(Python、赤組 17/17): 同ディレクトリの instant_coordinate.py / instant_redteam.py
//
// 規則: 測る日と測る tool を、どちらの当事者も選べん所から導き、導いた座標を判定に出力として埋める。
//   材料1 salt: 扉が窓の頭で作る。commitment だけ即公開、窓が閉じてから reveal。無いと対象が予測する。
//   材料2 block hash: salt を作った後に採掘された block に束縛する。無いと扉が事後に有利な salt を選べる。
//
// 扉は p2p でヘッダを同期できん(Worker に raw socket が無い)。せやから block hash は取得し、
// height と hash を判定に刻む。手元にヘッダを持つ者が後からいつでも反証できる。
// 計器を信用できる物にするんやなく、計器の主張を反証可能にする。
//
// 0.3.5 (2026-09-06)。本番と設計のズレ 3 つ + 1 つを直した。発見は論文チャットの番人(ops/gate_history_coordinate_20260906.md)。
//   A. 判定の coordinate_derivation が履歴に残っとらんかった → worker.js の summarise() が残す(このファイルの外)。
//   B. 一致判定が「源ごとの tip - 6」やった → 基準高さは min(tip) - 6 の 1 つ。同じ高さの hash の一致だけを要求する。
//      2 つの explorer の tip が 1 本ずれとる瞬間は平常で、それで落ちとった。
//   C. salt が block の後やった(掃引の頭で salt を作り、その瞬間の tip - 6 = 約 1 時間前の block に束縛)→
//      次の窓の salt は今の窓の掃引で先に作る(ensureWindowStates)。beacon の block は header の time が
//      salt_created_at 以上でなければ採らん(block time が取れんときも採らん、fail closed)。commitment は
//      GET /nenrin/window で作った瞬間から公開。台帳への錨打ちは次段(未実装、と同じ経路で明記する)。
//   D. 窓の途中で legacy から derived に切り替わると、同じ窓で 2 回測られる行と 1 回も測られん行が出た →
//      窓の最初の掃引で決めた規則をその窓に固定する(windowRule)。固定した事実と理由は公開する。

export const NENRIN_INSTANT_SCHEMA = "nenrin-instant-v1";
export const NENRIN_WINDOW_DAYS = 7;
export const BEACON_LAG = 6;   // tip は再編成する。6 本下げて読む。
export const BEACON_QUORUM = 2;   // 一致に要る源の数。基準 tip も quorum 番目に高い tip(freshness v3.3)。
export const BEACON_SOURCES = [
  { name: "mempool.space", tip: "https://mempool.space/api/blocks/tip/height", at: (h) => "https://mempool.space/api/block-height/" + h, block: (hash) => "https://mempool.space/api/block/" + hash },
  { name: "blockstream.info", tip: "https://blockstream.info/api/blocks/tip/height", at: (h) => "https://blockstream.info/api/block-height/" + h, block: (hash) => "https://blockstream.info/api/block/" + hash },
  // 0.3.5: 3 源目。運営者は別(emzy)やが mempool.space と同じ mempool codebase なので、そこは残る軸(Federico の verifier が名指しした residual と同じ)。
  // 一致は「2 源以上」のまま。源が増えるのは可用性のためで、規則は変えん。
  { name: "mempool.emzy.de", tip: "https://mempool.emzy.de/api/blocks/tip/height", at: (h) => "https://mempool.emzy.de/api/block-height/" + h, block: (hash) => "https://mempool.emzy.de/api/block/" + hash }
];
const UA = { headers: { "user-agent": "hs-verify-gate/nenrin-instant-v1" } };
const KV_TTL = 60 * 60 * 24 * 120;
const DAY_MS = 86400000;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export function randomSaltHex() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return hex(b.buffer);
}
export async function prfHex(keyHex, parts) {
  if (!/^[0-9a-f]{64}$/.test(String(keyHex || ""))) throw new TypeError("salt must be 64 hex characters");
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(parts.join(" "))));
}
export async function saltCommitment(saltHex) {
  if (!/^[0-9a-f]{64}$/.test(String(saltHex || ""))) throw new TypeError("salt must be 64 hex characters");
  return await sha256Hex("nenrin-instant-salt-v1:" + saltHex);
}

// 窓は epoch 日を 7 で割った商。epoch 日 0 は木曜なので、窓は木曜 00:00 UTC に開く。
export function windowId(nowMs) {
  return "w" + Math.floor(Math.floor(nowMs / DAY_MS) / NENRIN_WINDOW_DAYS);
}
export function windowIndex(wid) {
  const m = /^w(\d+)$/.exec(String(wid || ""));
  return m ? parseInt(m[1], 10) : null;
}
export function nextWindowId(nowMs) {
  return "w" + (windowIndex(windowId(nowMs)) + 1);
}
export function windowBounds(wid) {
  const i = windowIndex(wid);
  if (i === null) return null;
  const open = i * NENRIN_WINDOW_DAYS * DAY_MS;
  return { opens_at: new Date(open).toISOString(), closes_at: new Date(open + NENRIN_WINDOW_DAYS * DAY_MS).toISOString() };
}
export function dayInWindow(nowMs) {
  const d = Math.floor(nowMs / DAY_MS);
  return d - Math.floor(d / NENRIN_WINDOW_DAYS) * NENRIN_WINDOW_DAYS;
}

export async function dueOffset(seedHex, endpoint, wid) {
  const h = await prfHex(seedHex, [NENRIN_INSTANT_SCHEMA, "day", endpoint, wid]);
  return parseInt(h.slice(0, 8), 16) % NENRIN_WINDOW_DAYS;
}

// 申告された tool 名を辞書順に並べ、そこから導いた順に測る。
// tools/list を並べ替えても選ばれる物は変わらん。改名すると tool_set_sha256 が動く。
export async function toolOrder(seedHex, endpoint, wid, names) {
  const sorted = [...(names || [])].filter((n) => typeof n === "string" && n).sort();
  const scored = [];
  for (const n of sorted) scored.push({ n, k: await prfHex(seedHex, [NENRIN_INSTANT_SCHEMA, "tool", endpoint, wid, n]) });
  scored.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return scored.map((x) => x.n);
}
export async function toolSetSha256(names) {
  const sorted = [...(names || [])].filter((n) => typeof n === "string" && n).sort();
  if (new Set(sorted).size !== sorted.length) throw new Error("duplicate tool names: the declared surface is malformed");
  return sorted.length ? await sha256Hex(sorted.join(" ")) : null;
}

// ---- 窓ごとの salt ----------------------------------------------------------------
// 作った時刻を残す。beacon はそれより後の block でなければならん。
async function readJson(kv, k) {
  try { return JSON.parse((await kv.get(k)) || "null"); } catch (e) { return null; }
}
async function putJson(kv, k, v) {
  try { await kv.put(k, JSON.stringify(v), { expirationTtl: KV_TTL }); } catch (e) {}
}
export async function windowStateFor(kv, wid, nowMs) {
  const k = "nenrin:window:" + wid;
  let st = await readJson(kv, k);
  if (st && st.salt && st.commitment) return st;
  const salt = randomSaltHex();
  st = { window_id: wid, salt, commitment: await saltCommitment(salt), salt_created_at: new Date(nowMs).toISOString() };
  await putJson(kv, k, st);
  return st;
}
export async function windowState(kv, nowMs) {
  return await windowStateFor(kv, windowId(nowMs), nowMs);
}
// 0.3.5. 今の窓と次の窓の salt を揃える。次の窓の salt は、その窓が開く前(遅くとも前の窓の最初の掃引)に
// できるので、commitment は block より先に公開される。作った物の一覧を返す(掃引の記録に書く)。
export async function ensureWindowStates(kv, nowMs) {
  const cur = windowId(nowMs), nxt = nextWindowId(nowMs);
  const created = [];
  const hadCur = !!(await readJson(kv, "nenrin:window:" + cur));
  const current = await windowStateFor(kv, cur, nowMs);
  if (!hadCur) created.push(cur);
  const hadNxt = !!(await readJson(kv, "nenrin:window:" + nxt));
  const next = await windowStateFor(kv, nxt, nowMs);
  if (!hadNxt) created.push(nxt);
  return { current, next, created };
}

// ---- beacon -----------------------------------------------------------------------
// 0.3.5. 基準高さは 1 つ: min(tip) - BEACON_LAG。全源からその高さの hash を取り、2 源以上の一致を要求する。
// 一致した block の header time が salt_created_at 以上でなければ採らん(block time が読めん時も採らん)。
// 窓につき 1 回だけ引いて固定する。1 源しか答えん日は beacon 無しとして扱う。単独の explorer は根拠にならん。
async function fetchText(f, url) {
  const r = await f(url, UA);
  if (!r.ok) return { error: "http " + r.status };
  return { text: (await r.text()).trim() };
}
export async function beacon(kv, wid, saltCreatedAt, fetchImpl) {
  const f = fetchImpl || fetch;
  const k = "nenrin:beacon:" + wid;
  const cached = await readJson(kv, k);
  if (cached && cached.block_hash) return cached;
  const seen = [];
  const fail = (reason_code, reason) => ({ height: null, block_hash: null, block_time: null, sources: seen, reason_code, reason });
  // 1. tip を全源から
  for (const src of BEACON_SOURCES) {
    const row = { source: src.name };
    seen.push(row);
    try {
      const t = await fetchText(f, src.tip);
      if (t.error) { row.error = t.error + " (tip)"; continue; }
      const tip = parseInt(t.text, 10);
      if (!Number.isFinite(tip)) { row.error = "tip is not a number"; continue; }
      row.tip = tip;
    } catch (e) { row.error = String((e && e.message) || e).slice(0, 80); }
  }
  const tips = seen.filter((x) => Number.isFinite(x.tip)).map((x) => x.tip);
  if (tips.length < BEACON_QUORUM) return fail("tips_unavailable", "fewer than " + BEACON_QUORUM + " independent sources answered a tip height");
  // 2. 基準高さは 1 つ。freshness v3.3 と同じ「quorum 番目に高い tip」(quorum 2)。2 源なら min(tip)、3 源なら 1 本だけ
  //    遅れとる源に引きずられん(遅れた源は拒否権を持たん、が、1 源だけ進んどる tip も採らん)。
  const sortedTips = [...tips].sort((a, b) => b - a);
  const height = sortedTips[BEACON_QUORUM - 1] - BEACON_LAG;
  for (const src of BEACON_SOURCES) {
    const row = seen.find((x) => x.source === src.name);
    if (!row || !Number.isFinite(row.tip)) continue;
    try {
      const b = await fetchText(f, src.at(height));
      if (b.error) { row.error = b.error + " at height " + height; continue; }
      if (!/^[0-9a-f]{64}$/.test(b.text)) { row.error = "hash is not 64 hex"; continue; }
      row.height = height;
      row.block_hash = b.text;
    } catch (e) { row.error = String((e && e.message) || e).slice(0, 80); }
  }
  const good = seen.filter((x) => x.block_hash);
  if (good.length < BEACON_QUORUM) return fail("hash_unavailable", "fewer than two sources returned a block hash at height " + height);
  const counts = {};
  for (const g of good) counts[g.block_hash] = (counts[g.block_hash] || 0) + 1;
  const agreedHash = Object.keys(counts).find((h) => counts[h] >= BEACON_QUORUM) || null;
  if (!agreedHash) return fail("hash_disagreement", "no two independent sources agreed on the block hash at height " + height);
  // 3. block の header time。salt より後に採掘された block でなければ束縛の意味が無い。
  let blockTime = null, blockTimeSource = null;
  for (const src of BEACON_SOURCES) {
    try {
      const r = await f(src.block(agreedHash), UA);
      if (!r.ok) continue;
      const j = JSON.parse(await r.text());
      const ts = j && Number.isFinite(Number(j.timestamp)) ? Number(j.timestamp) : null;
      if (ts !== null) { blockTime = ts; blockTimeSource = src.name; break; }
    } catch (e) { /* 次の源 */ }
  }
  if (saltCreatedAt) {
    const saltUnix = Math.floor(Date.parse(saltCreatedAt) / 1000);
    if (blockTime === null) return fail("block_time_unavailable", "no source returned the header time of block " + agreedHash.slice(0, 12) + ", so it cannot be shown to postdate the salt; not used");
    if (!(blockTime >= saltUnix)) return fail("block_before_salt", "block " + agreedHash.slice(0, 12) + " at height " + height + " carries header time " + new Date(blockTime * 1000).toISOString() + ", before the salt was created (" + saltCreatedAt + "); a block mined after the salt is not yet " + BEACON_LAG + " deep, so this sweep runs on the legacy rule");
  }
  const rec = {
    height, block_hash: agreedHash, block_time: blockTime === null ? null : new Date(blockTime * 1000).toISOString(),
    block_time_source: blockTimeSource,
    reference: { rule: "tip ranked " + BEACON_QUORUM + " of " + tips.length + " (highest first) minus " + BEACON_LAG + "; with two sources that is min(tip) - " + BEACON_LAG, quorum: BEACON_QUORUM, tips: Object.fromEntries(seen.filter((x) => Number.isFinite(x.tip)).map((x) => [x.source, x.tip])) },
    sources: seen.map((x) => x.source), agreed_by: good.filter((g) => g.block_hash === agreedHash).map((g) => g.source),
    read_at: new Date().toISOString(), salt_created_at: saltCreatedAt || null,
    falsifiable: "Anyone holding the chain can check that this hash is the block at this height and that its header time is what is recorded here. A wrong beacon here is permanently detectable."
  };
  await putJson(kv, k, rec);
  return rec;
}

// ---- 窓の規則の固定 (0.3.5 D) ----------------------------------------------------
export async function windowRule(kv, wid) {
  return await readJson(kv, "nenrin:rule:" + wid);
}
async function pinWindowRule(kv, wid, rule, extra) {
  const rec = Object.assign({ window_id: wid, rule, pinned_at: new Date().toISOString(),
    why: "one rule per window: the first sweep of the window decides derived or legacy, so every row is measured exactly once under one rule" }, extra || {});
  await putJson(kv, "nenrin:rule:" + wid, rec);
  return rec;
}

// 掃引の頭で 1 回だけ組む。以後これを下へ通す。
export async function coordinate(kv, nowMs, fetchImpl) {
  const wid = windowId(nowMs);
  let st = null, nxt = null, created = [];
  try { const ws = await ensureWindowStates(kv, nowMs); st = ws.current; nxt = ws.next; created = ws.created; } catch (e) { st = null; }
  const base = { window_id: wid, commitment: st ? st.commitment : null, salt_created_at: st ? st.salt_created_at : null,
    next_window: nxt ? { window_id: nxt.window_id, commitment: nxt.commitment, salt_created_at: nxt.salt_created_at } : null,
    salts_created_now: created };
  const legacy = (why, reason_code, bc, rule) => Object.assign({}, base, { derived: false, beacon: bc || null, why, reason_code: reason_code || null, rule: rule || null });
  if (!st) return legacy("window state unavailable (KV), so the legacy computable schedule is in use and the subject can predict it. Disclosed, not hidden.", "window_state_unavailable", null, null);
  let rule = null;
  try { rule = await windowRule(kv, wid); } catch (e) { rule = null; }
  if (rule && rule.rule === "legacy") {
    return legacy("pinned legacy for this window: the first sweep of the window could not derive (" + (rule.reason || "reason not recorded") + "); one rule per window so every row is measured exactly once. The subject can predict this schedule. Disclosed, not hidden.", "pinned_legacy", rule.beacon || null, rule);
  }
  let bc = null;
  try { bc = await beacon(kv, wid, st.salt_created_at, fetchImpl); } catch (e) { bc = { height: null, block_hash: null, reason_code: "beacon_error", reason: String((e && e.message) || e).slice(0, 120), sources: [] }; }
  if (!bc || !bc.block_hash) {
    if (!rule) { try { rule = await pinWindowRule(kv, wid, "legacy", { reason: bc ? bc.reason : "no beacon", reason_code: bc ? bc.reason_code : null, beacon: bc || null }); } catch (e) { rule = null; } }
    return legacy("no beacon for this window (" + (bc && bc.reason ? bc.reason : "no reason recorded") + "), so the legacy computable schedule is in use and the subject can predict it. Disclosed, not hidden.", bc ? bc.reason_code : "no_beacon", bc || null, rule);
  }
  if (!rule) { try { rule = await pinWindowRule(kv, wid, "derived", { beacon_height: bc.height, block_hash: bc.block_hash }); } catch (e) { rule = null; } }
  // salt を作った後に採掘された block に束縛する。扉が有利な salt を引き直すことができんようになる。
  const seed = await prfHex(st.salt, [NENRIN_INSTANT_SCHEMA, "seed", wid, bc.block_hash]);
  return Object.assign({}, base, { derived: true, seed, beacon: bc, rule });
}

// 判定に埋める塊。全部が扉の導いた出力で、対象が渡した入力は 1 つも無い。
export async function derivationBlock(coord, endpoint, names) {
  if (!coord || !coord.derived) {
    const bc = coord && coord.beacon ? coord.beacon : null;
    return {
      schema: NENRIN_INSTANT_SCHEMA, derived: false,
      window_id: coord ? coord.window_id : null,
      salt_commitment: coord ? coord.commitment : null,
      salt_created_at: coord ? coord.salt_created_at || null : null,
      beacon: bc ? { height: bc.height, block_hash: bc.block_hash } : null,
      fallback: "legacy computable schedule (sha256(endpoint) mod " + NENRIN_WINDOW_DAYS + "): the subject can predict when it is measured",
      reason_code: coord ? coord.reason_code || null : "no_coordinate_context",
      why: coord ? coord.why : "no coordinate context for this check; a one-off /check is not a row on the register",
      sources: bc && Array.isArray(bc.sources) ? bc.sources : null
    };
  }
  const list = [...(names || [])].filter((n) => typeof n === "string" && n);
  return {
    schema: NENRIN_INSTANT_SCHEMA, derived: true, window_id: coord.window_id,
    salt_commitment: coord.commitment, salt_created_at: coord.salt_created_at,
    beacon: { height: coord.beacon.height, block_hash: coord.beacon.block_hash, block_time: coord.beacon.block_time || null, sources: coord.beacon.sources, agreed_by: coord.beacon.agreed_by || null, reference: coord.beacon.reference || null, read_at: coord.beacon.read_at },
    day_in_window: await dueOffset(coord.seed, endpoint, coord.window_id),
    window_days: NENRIN_WINDOW_DAYS,
    tool_set_sha256: list.length ? await toolSetSha256(list) : null,
    tool_count: list.length,
    rule: "the measurement day and the tool order are HMAC-SHA256 derived from a salt the gate committed to before the window opened, bound to a Bitcoin block whose header time is at or after the salt's creation. The subject cannot predict them; the gate cannot choose them after the fact. The salt is served at /nenrin/window/{window_id} when the window closes, and anyone can recompute all of this.",
    limits: "Derivation is fair only inside the surface the subject declared. A tool never listed is never picked. That set is unknown, not absent. This measures conduct, not quality."
  };
}

// ---- 公開の窓 (0.3.5 C) ------------------------------------------------------------
// commitment は作った瞬間から見える。salt は窓が閉じてから見える。固定した規則と beacon もここ。
export async function publicWindow(kv, wid, nowMs) {
  const idx = windowIndex(wid);
  if (idx === null) return null;
  const cur = windowIndex(windowId(nowMs));
  const st = await readJson(kv, "nenrin:window:" + wid);
  if (!st) return null;
  const status = idx < cur ? "closed" : idx === cur ? "current" : "next";
  const bc = await readJson(kv, "nenrin:beacon:" + wid);
  const rule = await readJson(kv, "nenrin:rule:" + wid);
  const bounds = windowBounds(wid);
  return {
    window_id: wid, status, opens_at: bounds.opens_at, closes_at: bounds.closes_at,
    commitment: st.commitment, salt_created_at: st.salt_created_at,
    salt: status === "closed" ? st.salt : null,
    salt_note: status === "closed" ? "revealed: recompute sha256('nenrin-instant-salt-v1:' + salt) and compare with commitment; seed = HMAC-SHA256(salt, 'nenrin-instant-v1 seed <window_id> <block_hash>'); each row's day = parseInt(HMAC(seed, 'nenrin-instant-v1 day <endpoint> <window_id>')[0:8], 16) mod 7" : "withheld until the window closes",
    rule: rule ? { rule: rule.rule, pinned_at: rule.pinned_at, reason: rule.reason || null, reason_code: rule.reason_code || null } : null,
    beacon: bc && bc.block_hash ? { height: bc.height, block_hash: bc.block_hash, block_time: bc.block_time || null, reference: bc.reference || null, agreed_by: bc.agreed_by || null, read_at: bc.read_at } : null
  };
}
