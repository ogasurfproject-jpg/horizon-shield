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

export const NENRIN_INSTANT_SCHEMA = "nenrin-instant-v1";
export const NENRIN_WINDOW_DAYS = 7;
const BEACON_LAG = 6;   // tip は再編成する。6 本下げて読む。
const BEACON_SOURCES = [
  { name: "mempool.space", tip: "https://mempool.space/api/blocks/tip/height", at: (h) => "https://mempool.space/api/block-height/" + h },
  { name: "blockstream.info", tip: "https://blockstream.info/api/blocks/tip/height", at: (h) => "https://blockstream.info/api/block-height/" + h }
];

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

export function windowId(nowMs) {
  return "w" + Math.floor(Math.floor(nowMs / 86400000) / NENRIN_WINDOW_DAYS);
}
export function dayInWindow(nowMs) {
  const d = Math.floor(nowMs / 86400000);
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

// 窓ごとの salt。作った時刻を残す。beacon はそれより後の block でなければならん。
export async function windowState(kv, nowMs) {
  const wid = windowId(nowMs);
  const k = "nenrin:window:" + wid;
  let st = null;
  try { st = JSON.parse((await kv.get(k)) || "null"); } catch (e) { st = null; }
  if (st && st.salt && st.commitment) return st;
  const salt = randomSaltHex();
  st = { window_id: wid, salt, commitment: await saltCommitment(salt), salt_created_at: new Date(nowMs).toISOString() };
  try { await kv.put(k, JSON.stringify(st), { expirationTtl: 60 * 60 * 24 * 120 }); } catch (e) {}
  return st;
}

// beacon を 2 源から取り、height と hash が一致した時だけ採る。窓につき 1 回だけ引いて固定する。
// 1 源しか答えん日は beacon 無しとして扱う。単独の explorer は根拠にならん。
export async function beacon(kv, wid, saltCreatedAt, fetchImpl) {
  const f = fetchImpl || fetch;
  const k = "nenrin:beacon:" + wid;
  try {
    const cached = JSON.parse((await kv.get(k)) || "null");
    if (cached && cached.block_hash) return cached;
  } catch (e) {}
  const seen = [];
  for (const src of BEACON_SOURCES) {
    try {
      const t = await f(src.tip, { headers: { "user-agent": "hs-verify-gate/nenrin-instant-v1" } });
      if (!t.ok) { seen.push({ source: src.name, error: "http " + t.status }); continue; }
      const tip = parseInt((await t.text()).trim(), 10);
      if (!Number.isFinite(tip)) { seen.push({ source: src.name, error: "tip is not a number" }); continue; }
      const h = tip - BEACON_LAG;
      const b = await f(src.at(h), { headers: { "user-agent": "hs-verify-gate/nenrin-instant-v1" } });
      if (!b.ok) { seen.push({ source: src.name, error: "http " + b.status + " at height " + h }); continue; }
      const bh = (await b.text()).trim();
      if (!/^[0-9a-f]{64}$/.test(bh)) { seen.push({ source: src.name, error: "hash is not 64 hex" }); continue; }
      seen.push({ source: src.name, height: h, block_hash: bh });
    } catch (e) {
      seen.push({ source: src.name, error: String((e && e.message) || e).slice(0, 80) });
    }
  }
  const good = seen.filter((x) => x.block_hash);
  const agreed = good.length >= 2 && good.every((x) => x.height === good[0].height && x.block_hash === good[0].block_hash) ? good[0] : null;
  if (!agreed) {
    return { height: null, block_hash: null, sources: seen, reason: "no two independent sources agreed on a block" };
  }
  const rec = {
    height: agreed.height, block_hash: agreed.block_hash,
    sources: seen.map((x) => x.source), read_at: new Date().toISOString(), salt_created_at: saltCreatedAt || null,
    falsifiable: "Anyone holding the chain can check that this hash is the block at this height. A wrong beacon here is permanently detectable."
  };
  try { await kv.put(k, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 120 }); } catch (e) {}
  return rec;
}

// 掃引の頭で 1 回だけ組む。以後これを下へ通す。
export async function coordinate(kv, nowMs, fetchImpl) {
  const wid = windowId(nowMs);
  let st = null, bc = null;
  try { st = await windowState(kv, nowMs); } catch (e) { st = null; }
  if (st) { try { bc = await beacon(kv, wid, st.salt_created_at, fetchImpl); } catch (e) { bc = null; } }
  if (!st || !bc || !bc.block_hash) {
    return {
      derived: false, window_id: wid, commitment: st ? st.commitment : null, beacon: bc || null,
      why: "no two independent sources agreed on a beacon block for this window, so the legacy computable schedule is in use and the subject can predict it. Disclosed, not hidden."
    };
  }
  // salt を作った後に採掘された block に束縛する。扉が有利な salt を引き直すことができんようになる。
  const seed = await prfHex(st.salt, [NENRIN_INSTANT_SCHEMA, "seed", wid, bc.block_hash]);
  return { derived: true, window_id: wid, seed, commitment: st.commitment, salt_created_at: st.salt_created_at, beacon: bc };
}

// 判定に埋める塊。全部が扉の導いた出力で、対象が渡した入力は 1 つも無い。
export async function derivationBlock(coord, endpoint, names) {
  if (!coord || !coord.derived) {
    return {
      schema: NENRIN_INSTANT_SCHEMA, derived: false,
      window_id: coord ? coord.window_id : null,
      salt_commitment: coord ? coord.commitment : null,
      beacon: coord && coord.beacon ? { height: coord.beacon.height, block_hash: coord.beacon.block_hash } : null,
      fallback: "legacy computable schedule (sha256(endpoint) mod " + NENRIN_WINDOW_DAYS + "): the subject can predict when it is measured",
      why: coord ? coord.why : "no coordinate context for this check; a one-off /check is not a row on the register"
    };
  }
  const list = [...(names || [])].filter((n) => typeof n === "string" && n);
  return {
    schema: NENRIN_INSTANT_SCHEMA, derived: true, window_id: coord.window_id,
    salt_commitment: coord.commitment, salt_created_at: coord.salt_created_at,
    beacon: { height: coord.beacon.height, block_hash: coord.beacon.block_hash, sources: coord.beacon.sources, read_at: coord.beacon.read_at },
    day_in_window: await dueOffset(coord.seed, endpoint, coord.window_id),
    window_days: NENRIN_WINDOW_DAYS,
    tool_set_sha256: list.length ? await toolSetSha256(list) : null,
    tool_count: list.length,
    rule: "the measurement day and the tool order are HMAC-SHA256 derived from a salt the gate committed to at the start of the window, bound to a Bitcoin block mined after that salt existed. The subject cannot predict them; the gate cannot choose them after the fact. The salt is published when the window closes, and anyone can recompute all of this.",
    limits: "Derivation is fair only inside the surface the subject declared. A tool never listed is never picked. That set is unknown, not absent. This measures conduct, not quality."
  };
}
