// RUN_ALL: library  v2 籤の fixture を code から焼く。採点は witness_kuji_test.mjs (file と byte 一致を見る)
//
// 今週の事故 (recovery_fixture_20260920.json の 7 記録) の再検証を、籤で引いた証人 3 人に頼んだ形にする。
// 証人 5 人 + 自分の host 1 つの池。自分は引く前に外れる。3 人引いて、2 人が署名付きで答え、1 人は答えん (no_answer)。
// 鍵は決定的 (seed から) やから、file は何度焼いても同じ bytes。それが「fixture が code とズレてへん」の判定になる。
// 正直に書く: beacon は Bitcoin のブロックやない (kind: fixture_not_bitcoin)、証人は本物のエージェントやない。
// 記録の does_not_establish がそう言う。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { buildFixture } from "./recovery_fixture_build.mjs";
import { seal, sign, sha256Hex } from "./recovery_verify.mjs";
import { SCHEMAS } from "./recovery_schema.mjs";
import { draw, drawField, poolSha256, commitmentClaimText } from "./witness_draw.mjs";
import { buildRequest, requestSha256 } from "./witness_request.mjs";

export const WITNESS_FIXTURE_FILE = "witness_fixture_20260920.json";
export const ORIGIN = "https://gate.horizonshield.dev";
export const OWN_HOST = "gate.horizonshield.dev";
export const WITNESS_DOMAINS = ["witness-a.example", "witness-b.example", "witness-c.example", "witness-d.example", "witness-e.example"];
export const Q = 2;

// 決定的な Ed25519 鍵: seed 32 bytes を PKCS8 に包む (prefix は RFC 8410 の固定 bytes)。試験と fixture 専用。本番の鍵はこう作らん。
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
export async function fixtureKey(label) {
  const seed = Buffer.from(await sha256Hex("tsugi fixture key " + label), "hex");
  const der = Buffer.concat([PKCS8_PREFIX, seed]);
  const privNode = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const spki = createPublicKey(privNode).export({ format: "der", type: "spki" });
  const pubRaw = new Uint8Array(spki.subarray(spki.length - 32));
  const privKey = await globalThis.crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  return { privKey, pubRaw, pubB64: Buffer.from(pubRaw).toString("base64") };
}

export async function buildPool() {
  const entries = [];
  for (const d of WITNESS_DOMAINS) {
    const k = await fixtureKey(d);
    entries.push({ signed_domain: d, key_url: "https://" + d + "/.well-known/hs-witness-key.json", public_key_ed25519_b64: k.pubB64, a2a_url: "https://" + d + "/a2a" });
  }
  const own = await fixtureKey(OWN_HOST);
  entries.push({ signed_domain: OWN_HOST, key_url: "https://" + OWN_HOST + "/keys/witness.json", public_key_ed25519_b64: own.pubB64, a2a_url: ORIGIN + "/a2a" });
  return { schema: "nenrin-witness-pool-v1", generated_at: "2026-09-20T08:03:00Z", note: "fixture pool: five reserved .example domains with deterministic keys, plus the endpoint's own host to show it is excluded from the draw", entries };
}

export async function buildBeacon() {
  // v2.2 の形: anchor (subject を錨打ちしたブロック) が height 0、beacon はその次 height 1。値は全部 fixture (Bitcoin やない)。
  return { kind: "fixture_not_bitcoin", height: "1", hash: await sha256Hex("tsugi fixture beacon 2026-09-20") };
}
export async function buildCommitment(subjectSha256) {
  return { subject_sha256: subjectSha256, ledger_entry: "0", ledger_url: "https://ledger.horizonshield.dev/ledger/0", claim_sha256: await sha256Hex(commitmentClaimText(subjectSha256)), anchor: { kind: "fixture_not_bitcoin", height: "0", hash: await sha256Hex("tsugi fixture anchor 2026-09-20") } };
}

// 証人の観測。observed は expected_after を含み、証人らしい余分 (status など) も持つ。
async function observe(domain, keyUrl, requestHash, expectedAfter, at) {
  const k = await fixtureKey(domain);
  const observed = {};
  for (const [surface, exp] of Object.entries(expectedAfter)) observed[surface] = { status: "200", ...exp, vantage_note: "measured from " + domain };
  const rec = {
    schema: SCHEMAS.observation, recorded_at: at, witness: { name: domain, vantage: "fixture witness with a deterministic key; not a real agent" }, prev: null,
    endpoint: ORIGIN, observed, request_sha256: requestHash,
    source: { kind: "external_witness", signed_domain: domain, key_url: keyUrl },
    establishes: ["at recorded_at this witness saw the observed state of the listed surfaces of endpoint"],
    does_not_establish: ["that this witness is a real independent agent: the key is a fixture seed", "why the surfaces are in this state", "anything about surfaces not listed in observed"],
  };
  return sign(rec, k.privKey, k.pubRaw);
}

export async function buildWitnessFixture() {
  const base = await buildFixture();                 // 今週の事故 7 記録 (v0 fixture と同じ bytes)
  const execution = base[5], verify0 = base[6];
  const pool = await buildPool();
  const beacon = await buildBeacon();
  const pSha = await poolSha256(pool);
  const request = buildRequest({ origin: ORIGIN, subjectSha256: execution.record_sha256, poolSha256: pSha, beacon, requestedAt: "2026-09-20T08:03:30Z" });
  const reqHash = await requestSha256(request);
  const d = await draw({ pool, beaconHash: beacon.hash, subjectSha256: execution.record_sha256, k: 3, excludeHost: OWN_HOST });
  const byDomain = new Map(pool.entries.map((e) => [e.signed_domain, e]));
  const external = [ ...(verify0.external || []) ];   // v0 の Agenstry の行はそのまま残す (数えられん自由形)
  for (let n = 0; n < d.drawn.length; n++) {
    const dom = d.drawn[n];
    if (n === d.drawn.length - 1) { external.push({ signed_domain: dom, answered: false, why: "no_answer" }); continue; }
    external.push({ signed_domain: dom, answered: true, record: await observe(dom, byDomain.get(dom).key_url, reqHash, verify0.expected_after, "2026-09-20T08:04:0" + n + "Z") });
  }
  const { record_sha256: _h, ...body } = verify0;
  const verify = await seal({
    ...body, recorded_at: "2026-09-20T08:05:00Z",
    draw: drawField(d, beacon, execution.record_sha256, reqHash, await buildCommitment(execution.record_sha256)), external,
    establishes: [...verify0.establishes, "of " + d.k + " witnesses drawn from a pool of " + d.pool_size + " (own host excluded), " + String(d.drawn.length - 1) + " answered with signed observations that contain expected_after; 1 did not answer"],
    does_not_establish: [...verify0.does_not_establish, "that the beacon is a Bitcoin block: kind fixture_not_bitcoin, this file is a fixture", "that the commitment is anchored: ledger entry 0 and anchor height 0 are fixture values, the shape is what v2.2 requires (subject anchored, beacon = anchor + 1)", "that the witnesses are independent agents: their keys are fixture seeds", "why one drawn witness did not answer"],
  });
  return { pool, beacon, request, q: String(Q), records: [...base.slice(0, 6), verify] };
}

export function renderWitnessFixture(fx) { return JSON.stringify(fx, null, 2) + "\n"; }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fx = await buildWitnessFixture();
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), WITNESS_FIXTURE_FILE);
  writeFileSync(out, renderWitnessFixture(fx));
  const v = fx.records[6];
  console.log("wrote " + WITNESS_FIXTURE_FILE + ": drawn [" + v.draw.drawn.join(", ") + "] from pool " + v.draw.pool_size + "; verify " + v.record_sha256.slice(0, 12));
}
