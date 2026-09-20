// test/agreement.test.mjs
// Drives the LIVE worker (src/worker.js) through its new /agreement routes, with
// the real AgreementDedupeDO behind a mock Durable Object namespace, a mock KV,
// and a stubbed global fetch that serves the party keys. This proves the wiring:
// the import chain resolves, the routes dispatch, the DO deduplicates, and an
// unreachable key server is a 503 and not a verdict.
//
// Run: node test/agreement.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { loadWorker, mockKV } from "./load.mjs";
import { canonicalUtf8 } from "../nenrin/agreement-v0/agreement_canonical.mjs";
import { signingBytes } from "../nenrin/agreement-v0/agreement_verify.mjs";
import { AgreementDedupeDO } from "../nenrin/agreement-v0/agreement_intake.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://ledger.horizonshield.dev";
const worker = await loadWorker("src/worker.js");

let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + detail : "")); } };

// ---- keys + fixtures ----
function kp(byte) {
  const seed = Buffer.alloc(32, byte);
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const priv = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(priv);
  return { priv, pubB64: Buffer.from(pub.export({ format: "jwk" }).x, "base64url").toString("base64") };
}
const A = kp(0x11), B = kp(0x22);
const URL_A = "https://party-a.example/keys/agreement.json", URL_B = "https://party-b.example/keys/agreement.json";
const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function p11(dom, role, pub, shaC, other) {
  return { domain: dom, key_url: `https://${dom}/keys/agreement.json`, public_key_ed25519_b64: pub,
    agent_card: `https://${dom}/.well-known/agent-card.json`, agent_card_sha256: crypto.createHash("sha256").update(dom).digest("hex"),
    conduct_record: { sha256: shaC, url: `https://gate.example/record/${shaC}`, subject_domain: other, measured_by_domain: "gate.example" }, role };
}
function v11(mut) {
  const rec = { schema: "a2a-agreement-v1.1", agreement_id: "00112233445566778899aabbccddeeff", agreed_at: "2026-09-10T00:00:00Z",
    parties: [p11("party-a.example", "payer", A.pubB64, "a".repeat(64), "party-b.example"), p11("party-b.example", "payee", B.pubB64, "b".repeat(64), "party-a.example")],
    terms: { what: "one audit of one estimate", consideration: "money", who_pays_whom: { from: "party-a.example", to: "party-b.example" },
             amount_minor_units: 10000n, minor_unit_scale: 0n, currency: "JPY", disclosure_url: "https://party-b.example/pricing" },
    recorder: { domain: "recorder.example", is_a_party: false, fee: { basis: "per_record", amount_minor_units: 0n, currency: "JPY" } },
    record_paid_by: "both",
    establishes: ["that both parties signed these bytes at the stated time", "that each party named the counterparty conduct record by sha256 at that moment"],
    does_not_establish: ["that either party performed", "that this record is a contract", "that money moved", "that the conduct record each side pinned is accurate", "that the terms are lawful or complete"],
    signatures: [] };
  if (mut) mut(rec);
  const msg = signingBytes(rec, "a2a-agreement-v1.1");
  rec.signatures = [{ domain: "party-a.example", alg: "ed25519", signature: crypto.sign(null, Buffer.from(msg), A.priv).toString("base64") },
                    { domain: "party-b.example", alg: "ed25519", signature: crypto.sign(null, Buffer.from(msg), B.priv).toString("base64") }];
  return canonicalUtf8(rec);
}

// ---- mock Durable Object namespace backed by the REAL class ----
function fakeState() {
  const map = new Map(); let chain = Promise.resolve();
  return { storage: { get: async (k) => (map.has(k) ? map.get(k) : undefined), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } },
           blockConcurrencyWhile: (fn) => { const r = chain.then(() => fn()); chain = r.catch(() => {}); return r; } };
}
function mockDO() {
  const insts = new Map();
  return { idFromName: (name) => name, get: (id) => { if (!insts.has(id)) insts.set(id, new AgreementDedupeDO(fakeState())); const d = insts.get(id); return { fetch: (u, init) => d.fetch(new Request(u, init)) }; } };
}

// ---- global fetch stub: serve the party keys ----
let SERVE = true;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (!SERVE) throw new Error("connection refused");
  const KEYS = { [URL_A]: A.pubB64, [URL_B]: B.pubB64 };
  if (u in KEYS) return new Response(JSON.stringify({ public_key_ed25519_b64: KEYS[u] }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
};

let kv, env;
function reset() { kv = mockKV([["seq", "40"]]); env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64), AGREEMENT_DEDUPE_DO: mockDO() }; SERVE = true; }
const post = async (rc) => { const r = await worker.fetch(new Request(ORIGIN + "/agreement", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ record_canonical: rc }) }), env); return { status: r.status, j: await r.json() }; };
const getSha = async (sha) => { const r = await worker.fetch(new Request(ORIGIN + "/agreement/" + sha, { method: "GET" }), env); return { status: r.status, j: await r.json() }; };
const pendingList = async () => { const r = await worker.fetch(new Request(ORIGIN + "/agreement/pending", { method: "GET" }), env); return { status: r.status, j: await r.json() }; };
const anchorNow = async () => { const r = await worker.fetch(new Request(ORIGIN + "/agreement/anchor", { method: "POST", headers: { "x-ledger-key": "t".repeat(64) } }), env); return { status: r.status, j: await r.json() }; };

(async () => {
  // GET /agreement describes and states caps + no oracle
  {
    reset();
    const r = await worker.fetch(new Request(ORIGIN + "/agreement", { method: "GET" }), env);
    const j = await r.json();
    t("GET /agreement: 200, states caps and no-oracle", r.status === 200 && j.caps && /offline verifier yourself/.test(j.no_oracle), JSON.stringify(j).slice(0, 120));
  }

  // accepted through the live worker
  {
    reset();
    const rc = v11();
    const sha = sha256hex(rc);
    const r = await post(rc);
    t("POST /agreement: 201 accepted", r.status === 201 && r.j.verdict === "accepted", r.status + " " + JSON.stringify(r.j).slice(0, 160));
    t("POST /agreement: canonical_sha256 correct, verifier_version kept", r.j.canonical_sha256 === sha && r.j.verifier_version === "0.2.0");
    const g = await getSha(sha);
    t("GET by sha: serves the exact bytes", g.status === 200 && g.j.record_canonical === rc && sha256hex(g.j.record_canonical) === sha);
    const r2 = await post(rc);
    t("POST again: 200 deduped via the DO", r2.status === 200 && r2.j.dedup === true, r2.status + " " + JSON.stringify(r2.j).slice(0, 120));
  }

  // batch and anchor the accepted pool through the live worker (boundary 2.4)
  {
    reset();
    const rc = v11((r) => { r.agreed_at = "2026-09-10T00:00:09Z"; });
    const sha = sha256hex(rc);
    const a = await post(rc);
    t("anchor: record accepted and queued", a.status === 201 && a.j.status === "pending_anchor");
    const pl = await pendingList();
    t("anchor: GET /agreement/pending lists the queued record", pl.status === 200 && pl.j.count === 1 && pl.j.pending[0].canonical_sha256 === sha, JSON.stringify(pl.j).slice(0, 160));
    const g0 = await getSha(sha);
    t("anchor: before the batch, status pending_anchor", g0.j.status === "pending_anchor" && g0.j.ledger_entry === null);
    const an = await anchorNow();
    t("anchor: POST /agreement/anchor bundles into one ledger entry", an.status === 201 && an.j.anchored === 1 && an.j.n === 41, JSON.stringify(an.j).slice(0, 160));
    const g1 = await getSha(sha);
    t("anchor: after the batch, status anchored with ledger_entry", g1.j.status === "anchored" && g1.j.ledger_entry === 41 && sha256hex(g1.j.record_canonical) === sha);
    const pl2 = await pendingList();
    t("anchor: pool emptied after the batch", pl2.j.count === 0);
    const an2 = await anchorNow();
    t("anchor: a second run on the empty pool anchors nothing", an2.status === 200 && an2.j.anchored === 0);
  }

  // anchor route requires operator auth
  {
    reset();
    const r = await worker.fetch(new Request(ORIGIN + "/agreement/anchor", { method: "POST" }), env);
    t("anchor: unauthenticated POST /agreement/anchor is 401", r.status === 401);
  }

  // unreachable key server: 503, no verdict, nothing stored
  {
    reset(); SERVE = false;
    const rc = v11((r) => { r.agreed_at = "2026-09-10T00:00:01Z"; }); // a different record so no cache
    const r = await post(rc);
    t("key server down: 503 with retry, no verdict", r.status === 503 && r.j.reason_code === "key_url_unreachable" && r.j.verdict === undefined, r.status + " " + JSON.stringify(r.j).slice(0, 120));
    const g = await getSha(sha256hex(rc));
    t("key server down: nothing stored", g.status === 404);
  }

  // one sided: refused, returned, not stored
  {
    reset();
    // build a one sided record: sign then drop one signature, re-canonicalize
    const full = v11((r) => { r.agreed_at = "2026-09-10T00:00:02Z"; });
    const obj = JSON.parse(full);
    obj.signatures = [obj.signatures[0]];
    const rc = JSON.stringify(obj); // non canonical is fine; it will be refused for one_sided regardless
    const r = await post(rc);
    t("one sided: 422 refused, report returned", r.status === 422 && r.j.verdict === "refused" && r.j.report.refusals.some((x) => x.code === "one_sided"), r.status + " " + JSON.stringify(r.j).slice(0, 160));
  }

  // fail closed: DO unbound -> 503, never KV
  {
    reset(); env.AGREEMENT_DEDUPE_DO = undefined;
    const rc = v11((r) => { r.agreed_at = "2026-09-10T00:00:03Z"; });
    const r = await post(rc);
    t("DO unbound: 503 fail closed (never eventually consistent storage)", r.status === 503 && r.j.error === "dedupe_gate_unbound", r.status + " " + JSON.stringify(r.j).slice(0, 120));
  }

  console.log("");
  console.log(fail ? `agreement (worker wiring): ${fail} FAILURES (${pass} passed)` : `agreement (worker wiring): ALL PASS (${pass})`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
