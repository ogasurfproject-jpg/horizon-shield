// RUN_ALL: library  recovery-v0 v2 籤 (kuji): 見知らぬ証人を、再計算できる乱数で引く。採点は witness_draw_test.mjs
//
// 「ランダムに選んだ」は自分で言うても誰も確かめられん (設計書 14.3)。せやから:
//   seed = sha256(beacon_hash | pool_sha256 | subject_sha256)
//     beacon_hash   自分の外の乱数。Bitcoin の、対象記録より後に最初に採掘されたブロックの hash。
//     pool_sha256   池 (witness_pool.json) の正規化 canonical の sha256。池を入れ替えたら変わる。
//     subject_sha256 籤が仕える記録の record_sha256 (再検証なら execution)。事故ごとに違う = 使い回せん。
//   池を public_key_ed25519_b64 の code point 順に並べ、seed から決定的な部分 Fisher-Yates で k 人引く。
// 誰でも同じ 3 入力から同じ k 人を出せる。出せんかったら Shield が選り好みした (verifier: draw_mismatch)。
//
// 数は文字列 (v0 の約束)。sha256 は WebCrypto (Worker と node で同じ)。python の双子は recovery_verify.py の draw()。
// 自分の host は引く前に外す (self_witness、conduct-v1.1 11.4)。
import { canonicalUtf8 } from "../agreement-v0/agreement_canonical.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const POOL_SCHEMA = "nenrin-witness-pool-v1";
export const DRAW_VERSION = "0.1.0";
const enc = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;

async function drawSha256(s) {   // recovery_verify.sha256Hex と同じ物。export せん (1 file SDK で名前がぶつかる)
  const d = await globalThis.crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const hashedEntry = (e) => ({ signed_domain: e.signed_domain, key_url: e.key_url, public_key_ed25519_b64: e.public_key_ed25519_b64 });

// 池の正規化。file の順は信用せん: 鍵の code point 順に並べる。鍵も domain も重複は拒否 (一 domain 一票、11.4)。
export function normalizePool(pool) {
  const entries = Array.isArray(pool) ? pool : (pool && Array.isArray(pool.entries) ? pool.entries : null);
  if (!entries) throw new Error("pool must be an array of entries or { entries: [...] }");
  const out = entries.map((e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("pool entry is not an object");
    for (const k of ["signed_domain", "key_url", "public_key_ed25519_b64"]) if (typeof e[k] !== "string" || !e[k]) throw new Error("pool entry lacks " + k);
    let host = ""; try { host = new URL(e.key_url).host; } catch { throw new Error("pool entry key_url is not a URL: " + e.key_url); }
    if (host.toLowerCase() !== e.signed_domain.toLowerCase()) throw new Error("pool entry signed_domain " + e.signed_domain + " is not the host of its key_url (11.4)");
    return { ...hashedEntry(e), ...(typeof e.a2a_url === "string" ? { a2a_url: e.a2a_url } : {}) };
  });
  out.sort((a, b) => (a.public_key_ed25519_b64 < b.public_key_ed25519_b64 ? -1 : a.public_key_ed25519_b64 > b.public_key_ed25519_b64 ? 1 : 0));
  const keys = new Set(), domains = new Set();
  for (const e of out) {
    if (keys.has(e.public_key_ed25519_b64)) throw new Error("pool has a duplicate key " + e.public_key_ed25519_b64);
    if (domains.has(e.signed_domain.toLowerCase())) throw new Error("pool has a duplicate domain " + e.signed_domain);
    keys.add(e.public_key_ed25519_b64); domains.add(e.signed_domain.toLowerCase());
  }
  return out;
}

// 池の hash。a2a_url は運搬先で、身元やない。hash に入れん。
export function poolCanonical(pool) { return canonicalUtf8({ schema: POOL_SCHEMA, entries: normalizePool(pool).map(hashedEntry) }); }
export async function poolSha256(pool) { return drawSha256(poolCanonical(pool)); }

// 籤。返す物: pool_sha256, pool_size, k (実際に引けた数), seed_sha256, drawn (signed_domain の列), entries (引いた項)。
export async function draw({ pool, beaconHash, subjectSha256, k, excludeHost }) {
  if (!HEX64.test(String(beaconHash || ""))) throw new Error("beaconHash must be 64 hex (a Bitcoin block hash)");
  if (!HEX64.test(String(subjectSha256 || ""))) throw new Error("subjectSha256 must be 64 hex (the record_sha256 the draw serves)");
  const want = Number(k);
  if (!Number.isInteger(want) || want < 0) throw new Error("k must be a non-negative integer");
  const all = normalizePool(pool);
  const pool_sha256 = await drawSha256(canonicalUtf8({ schema: POOL_SCHEMA, entries: all.map(hashedEntry) }));
  const ex = excludeHost ? String(excludeHost).toLowerCase() : null;
  const eligible = all.filter((e) => !ex || e.signed_domain.toLowerCase() !== ex);
  const n = eligible.length;
  const kk = Math.min(want, n);
  const seed = await drawSha256(beaconHash + "|" + pool_sha256 + "|" + subjectSha256);
  const arr = eligible.slice();
  for (let i = 0; i < kk; i++) {
    const r = await drawSha256(seed + "|" + String(i));
    const j = i + Number(BigInt("0x" + r.slice(0, 16)) % BigInt(n - i));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  const chosen = arr.slice(0, kk);
  return { pool_sha256, pool_size: String(all.length), eligible: String(n), k: String(kk), k_requested: String(want), seed_sha256: seed, drawn: chosen.map((e) => e.signed_domain), entries: chosen };
}

// verify 記録に焼く draw 欄 (recovery_schema の verify.draw)。beacon: { kind, height, hash }。
// commitment (v2.2、任意やが方針で必須にできる): subject を先に台帳に錨打ちした証拠。
//   { subject_sha256, ledger_entry, ledger_url, claim_sha256, anchor: { kind, height, hash } }
//   beacon は anchor の次のブロック (height = anchor.height + 1) でなければならん。検証器が見る。
export function drawField(d, beacon, subjectSha256, requestSha256, commitment) {
  return {
    beacon: { kind: String(beacon.kind), height: String(beacon.height), hash: String(beacon.hash) },
    pool_sha256: d.pool_sha256, pool_size: d.pool_size, k: d.k,
    subject_sha256: subjectSha256, request_sha256: requestSha256, drawn: d.drawn.slice(),
    ...(commitment ? { commitment: {
      subject_sha256: String(commitment.subject_sha256), ledger_entry: String(commitment.ledger_entry), ledger_url: String(commitment.ledger_url), claim_sha256: String(commitment.claim_sha256),
      anchor: { kind: String(commitment.anchor.kind), height: String(commitment.anchor.height), hash: String(commitment.anchor.hash) },
    } } : {}),
  };
}

// ---- v2.2 commit-then-reveal (設計書 14.6 の「籤の穴」の塞ぎ) ----
// 研磨 (grinding): subject は運営者が書く記録の hash やから、beacon が出た後に文面を弄って seal し直せば種が変わる。
// 塞ぎ方: subject を先に公開台帳 (JIDEC) に append し、OTS で Bitcoin のブロック (anchor) に固定する。
// beacon は anchor の次のブロック。anchor が出た時点で subject は動かせん、beacon はまだ誰も知らん。
// 読む側は: (1) 台帳の entry を取り、claim_sha256 が commitmentClaimText(subject) の sha256 と同じか、
//          (2) その entry の .ots を自分で検証して anchor のブロック高さを得、
//          (3) 自分の chain 源から anchor+1 のブロック hash を取り、記録の beacon と同じか、を見る。
export const COMMITMENT_SCHEMA = "tsugi-draw-commitment-v1";
export function commitmentClaimText(subjectSha256) {
  if (!HEX64.test(String(subjectSha256 || ""))) throw new Error("subjectSha256 must be 64 hex");
  // 台帳の record_canonical そのもの。1 バイトも自由度を持たせん (持たせたら研磨の余地になる)。
  return "# " + COMMITMENT_SCHEMA + "\n\nsubject_sha256: " + subjectSha256 + "\n\nThis entry commits the record named by subject_sha256 (a TSUGI execution record) to the ledger before any re-verification witness is drawn. The draw's beacon must be the Bitcoin block after the block this entry is anchored to. Establishes: that subject_sha256 existed no later than the anchor block. Does not establish: anything about the record's content.\n";
}
export async function commitmentSeed(subjectSha256) {
  const record_canonical = commitmentClaimText(subjectSha256);
  return { claim_sha256: await drawSha256(record_canonical), record_canonical, work: "TSUGI draw commitment: fixes the subject of a witness draw on Bitcoin before the beacon block exists, so the operator cannot re-grind the draw by editing the record." };
}

// 高さ h のブロック (mempool.space、予備 blockstream.info)。commit-then-reveal の beacon = anchor.height + 1 を取る。
export async function bitcoinBlockAt(height, { fetchImpl = globalThis.fetch, bases = ["https://mempool.space/api", "https://blockstream.info/api"] } = {}) {
  const h = Number(height);
  if (!Number.isInteger(h) || h < 0) throw new Error("height must be a non-negative integer");
  let lastErr = null;
  for (const base of bases) {
    try {
      const get = async (p) => { const r = await fetchImpl(base + p, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(base + p + " http " + r.status); return r; };
      const hash = (await (await get("/block-height/" + h)).text()).trim();
      if (!HEX64.test(hash)) throw new Error("no block at height " + h + " yet");
      const b = await (await get("/block/" + hash)).json();
      return { kind: "bitcoin_block", height: String(h), hash, timestamp: String(b.timestamp), source: base };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no beacon source answered");
}

// Bitcoin の beacon: 与えた時刻 (ISO) 以後に最初に採掘されたブロック。mempool.space の公開 API、予備に blockstream.info。
// 先端から後ろへ歩く (上限 blocks)。JIDEC が既に Bitcoin にアンカーしとるので、新しい信用先やない。
export async function bitcoinBeaconAfter(isoTime, { fetchImpl = globalThis.fetch, bases = ["https://mempool.space/api", "https://blockstream.info/api"], maxWalk = 300 } = {}) {
  const t = Math.floor(new Date(isoTime).getTime() / 1000);
  if (!Number.isFinite(t)) throw new Error("isoTime is not a date: " + isoTime);
  let lastErr = null;
  for (const base of bases) {
    try {
      const get = async (p) => { const r = await fetchImpl(base + p, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error(base + p + " http " + r.status); return r; };
      const tip = Number(await (await get("/blocks/tip/height")).text());
      let h = tip, candidate = null;
      for (let steps = 0; steps < maxWalk && h >= 0; steps++, h--) {
        const hash = (await (await get("/block-height/" + h)).text()).trim();
        const b = await (await get("/block/" + hash)).json();
        const ts = Number(b.timestamp);
        if (ts >= t) { candidate = { kind: "bitcoin_block", height: String(h), hash, timestamp: String(ts), source: base }; continue; }
        break;
      }
      if (!candidate) throw new Error("no block at or after " + isoTime + " within " + maxWalk + " blocks of the tip");
      return candidate;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no beacon source answered");
}

// @@CLI_BEGIN (the single-file SDK build drops everything from here)
// CLI: node witness_draw.mjs --pool witness_pool.json --subject <64hex> --k 3 (--commit-height H --commit-hash <hash> --ledger-entry n | --beacon <64hex> --height N | --after <ISO>) [--exclude-host host] [--request <64hex>]
//      node witness_draw.mjs --commit-seed <64hex>          subject を台帳に錨打ちする seed (append_witness.sh に渡す) を出す
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith("--")) { args[k] = v; i++; } else args[k] = true; } }
  if (args["commit-seed"]) { console.log(JSON.stringify(await commitmentSeed(args["commit-seed"]), null, 1)); process.exit(0); }
  if (!args.pool || !args.subject || !args.k) { console.error("usage: node witness_draw.mjs --pool witness_pool.json --subject <64hex> --k 3 (--beacon <64hex> --height N | --after <ISO>) [--exclude-host host] [--request <64hex>]"); process.exit(2); }
  const pool = JSON.parse(readFileSync(args.pool, "utf8"));
  let beacon, commitment = null;
  if (args["commit-height"]) {
    // v2.2: subject は台帳に錨打ち済み。beacon は錨のブロックの次。
    const ah = Number(args["commit-height"]);
    if (!args["commit-hash"] || !args["ledger-entry"]) { console.error("--commit-height needs --commit-hash <anchor block hash> and --ledger-entry <n> (from the OTS proof of the ledger entry that carries the subject)"); process.exit(2); }
    beacon = args.beacon ? { kind: "bitcoin_block", height: String(ah + 1), hash: String(args.beacon) } : await bitcoinBlockAt(ah + 1);
    commitment = { subject_sha256: args.subject, ledger_entry: String(args["ledger-entry"]), ledger_url: (args.ledger || "https://ledger.horizonshield.dev") + "/ledger/" + args["ledger-entry"], claim_sha256: await drawSha256(commitmentClaimText(args.subject)), anchor: { kind: "bitcoin_block", height: String(ah), hash: String(args["commit-hash"]) } };
  }
  else if (args.beacon) beacon = { kind: args.kind || "bitcoin_block", height: String(args.height || "0"), hash: String(args.beacon) };
  else if (args.after) beacon = await bitcoinBeaconAfter(args.after);
  else { console.error("give --commit-height H --commit-hash <hash> --ledger-entry n (v2.2, subject anchored first), or --beacon <hash> --height N, or --after <ISO time>"); process.exit(2); }
  const d = await draw({ pool, beaconHash: beacon.hash, subjectSha256: args.subject, k: args.k, excludeHost: args["exclude-host"] });
  const field = drawField(d, beacon, args.subject, args.request || "0".repeat(64), commitment);
  console.log(JSON.stringify({ draw: field, seed_sha256: d.seed_sha256, eligible: d.eligible, entries: d.entries }, null, 2));
  console.error("witness-draw: pool " + d.pool_size + ", eligible " + d.eligible + ", drawn " + d.k + " of " + d.k_requested + ": " + (d.drawn.join(", ") || "(none)"));
}
// @@CLI_END
