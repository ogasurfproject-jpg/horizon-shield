// agreement_intake.test.mjs
// Drives the agreement intake against the REAL verifier (agreement_verify.mjs),
// the REAL Durable Object class (AgreementDedupeDO) wrapped in an in memory
// atomic state, a mock key server, and a mock clock. Real Ed25519 from fixed
// seeds, so two people running this file reach the same bytes.
//
// The point of each test is named against ops/AGREEMENT_INTAKE_v0_BOUNDARY.md
// and ops/AGREEMENT_INTAKE_v0_DECISIONS.md. Green means the seam holds: keys are
// gathered, an unreachable key is a 503 and not a verdict, only accepted records
// are stored, storage is deduplicated atomically on the canonical_sha256, the
// bytes are served back unchanged, and the report is passed through untouched.
//
// Run: node agreement_intake.test.mjs

import crypto from "node:crypto";
import { canonicalUtf8, parseStrict } from "./agreement_canonical.mjs";
import { verify, signingBytes, VERIFIER_VERSION } from "./agreement_verify.mjs";
import {
  handleAgreementIntake, handleAgreementGet, agreementSelfDescription,
  AgreementDedupeDO, decideDedupe, INTAKE_VERSION, buildAgreementBatch,
} from "./agreement_intake.mjs";

// ---- tiny runner ---------------------------------------------------------------------------------
let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + detail : "")); }
};

// ---- fixtures: real Ed25519 from fixed seeds -----------------------------------------------------
function kp(byte) {
  const seed = Buffer.alloc(32, byte);
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const priv = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const pub = crypto.createPublicKey(priv);
  const x = pub.export({ format: "jwk" }).x;
  return { priv, pubB64: Buffer.from(x, "base64url").toString("base64") };
}
const A = kp(0x11), B = kp(0x22);
const URL_A = "https://party-a.example/keys/agreement.json";
const URL_B = "https://party-b.example/keys/agreement.json";
const KEYS = { [URL_A]: A.pubB64, [URL_B]: B.pubB64 };
const RECORDER = "recorder.example";
const NOW = "2099-01-01T00:00:00Z";
const ORIGIN = "https://ledger.horizonshield.dev";
const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function p11(dom, role, pub, shaC, other) {
  return {
    domain: dom, key_url: `https://${dom}/keys/agreement.json`, public_key_ed25519_b64: pub,
    agent_card: `https://${dom}/.well-known/agent-card.json`,
    agent_card_sha256: crypto.createHash("sha256").update(dom).digest("hex"),
    conduct_record: { sha256: shaC, url: `https://gate.example/record/${shaC}`, subject_domain: other, measured_by_domain: "gate.example" },
    role,
  };
}
// A fully valid, fully signed v1.1 record. Money fields are BigInt so the canonical
// bytes carry integers (a JS number would be written as a float and refused).
function v11Record(overrides) {
  const rec = {
    schema: "a2a-agreement-v1.1",
    agreement_id: "00112233445566778899aabbccddeeff",
    agreed_at: "2026-09-10T00:00:00Z",
    parties: [p11("party-a.example", "payer", A.pubB64, "a".repeat(64), "party-b.example"),
              p11("party-b.example", "payee", B.pubB64, "b".repeat(64), "party-a.example")],
    terms: {
      what: "one audit of one estimate", consideration: "money",
      who_pays_whom: { from: "party-a.example", to: "party-b.example" },
      amount_minor_units: 10000n, minor_unit_scale: 0n, currency: "JPY",
      disclosure_url: "https://party-b.example/pricing",
    },
    recorder: { domain: "recorder.example", is_a_party: false, fee: { basis: "per_record", amount_minor_units: 0n, currency: "JPY" } },
    record_paid_by: "both",
    establishes: ["that both parties signed these bytes at the stated time",
                  "that each party named the counterparty conduct record by sha256 at that moment"],
    does_not_establish: ["that either party performed", "that this record is a contract", "that money moved",
                         "that the conduct record each side pinned is accurate", "that the terms are lawful or complete"],
    signatures: [],
  };
  if (overrides) overrides(rec);
  return rec;
}
function signV11(rec) {
  const msg = signingBytes(rec, "a2a-agreement-v1.1");
  rec.signatures = [
    { domain: "party-a.example", alg: "ed25519", signature: crypto.sign(null, Buffer.from(msg), A.priv).toString("base64") },
    { domain: "party-b.example", alg: "ed25519", signature: crypto.sign(null, Buffer.from(msg), B.priv).toString("base64") },
  ];
  return rec;
}
function partyV1(dom, role, shaC) {
  return { domain: dom, key_url: `https://${dom}/keys/agreement.json`, agent_card: `https://${dom}/.well-known/agent-card.json`,
           conduct_record_sha256: shaC, conduct_record_url: `https://gate.example/record/${shaC}`, role };
}
function signV1(rec) {
  const msg = signingBytes(rec, "a2a-agreement-v1");
  rec.signatures = [
    { domain: "party-a.example", alg: "ed25519", signature: crypto.sign(null, Buffer.from(msg), A.priv).toString("base64"), key_url: URL_A },
    { domain: "party-b.example", alg: "ed25519", signature: crypto.sign(null, Buffer.from(msg), B.priv).toString("base64"), key_url: URL_B },
  ];
  return rec;
}
function v1Record() {
  return {
    schema: "a2a-agreement-v1", agreed_at: "2026-09-10T00:00:00Z",
    parties: [partyV1("party-a.example", "payer", "a".repeat(64)), partyV1("party-b.example", "payee", "b".repeat(64))],
    terms: { what: "one audit of one estimate", who_pays_whom: "party-a.example pays party-b.example", amount: 10000n, currency: "JPY", disclosure_url: "https://party-b.example/pricing" },
    record_paid_by: "both", recorder_fee: { basis: "per_record", amount: 0n, currency: "JPY" },
    establishes: ["that both parties signed these bytes at the stated time"],
    does_not_establish: ["that either party performed", "that this record is a contract", "that money moved or that payment was made",
                         "that the conduct record each side pinned is accurate", "that the terms are lawful or complete"],
    signatures: [],
  };
}

// ---- in memory atomic store, using the REAL DO class ---------------------------------------------
function fakeState() {
  const map = new Map();
  let chain = Promise.resolve();
  return {
    storage: {
      get: async (k) => (map.has(k) ? map.get(k) : undefined),
      put: async (k, v) => { map.set(k, v); },
      delete: async (k) => { map.delete(k); },
    },
    // serialize critical sections, as a real DO does for one id
    blockConcurrencyWhile: (fn) => { const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; },
  };
}
function doBackedStore() {
  const dos = new Map(); // per canonical_sha256 instance, mirroring idFromName("agreement:"+sha)
  const doFor = (sha) => { if (!dos.has(sha)) dos.set(sha, new AgreementDedupeDO(fakeState())); return dos.get(sha); };
  const pending = new Map(); // agr:pending:{sha}  (the anchor queue, eventually consistent in prod)
  const anchored = new Map(); // agr:anchored:{sha} -> { n, stored }
  return {
    _dos: dos, _pending: pending, _anchored: anchored,
    async claimAccepted(sha, payload) {
      const r = await doFor(sha).fetch(new Request("https://d/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha, payload }) }));
      return await r.json();
    },
    async queueForAnchor(sha, payload) { pending.set(sha, payload); return { ok: true }; },
    async anchorState(sha) { return anchored.has(sha) ? { anchored: true, ledger_entry: anchored.get(sha).n } : null; },
    async getAccepted(sha) {
      const r = await doFor(sha).fetch(new Request("https://d/get", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
      const inDo = (await r.json()).stored || null;
      if (inDo) return inDo;
      if (anchored.has(sha)) return anchored.get(sha).stored;
      if (pending.has(sha)) return pending.get(sha);
      return null;
    },
    // simulate the daily batch: move every pending record to anchored under ledger entry n
    simulateAnchor(n) { for (const [sha, payload] of pending) anchored.set(sha, { n, stored: payload }); pending.clear(); },
  };
}

// ---- mock world ----------------------------------------------------------------------------------
const fetchKeyOK = async (u) => (u in KEYS ? { ok: true, key: KEYS[u] } : { ok: false, why: "key_url answered 404" });
const fetchKeyDown = async () => ({ ok: false, why: "key_url unreachable: connection refused" });
const req = (bodyObj) => ({ json: async () => bodyObj });
const deps = (store, extra) => Object.assign({ verify, fetchKey: fetchKeyOK, store, now: () => NOW, recorderDomain: RECORDER, origin: ORIGIN }, extra || {});

// =================================================================================================
(async () => {

  // pure decideDedupe (the DO's whole decision)
  t("decideDedupe: empty slot is not a duplicate", decideDedupe(null, { a: 1 }).duplicate === false);
  t("decideDedupe: occupied slot is a duplicate and returns what was stored",
    decideDedupe({ a: 1 }, { a: 2 }).duplicate === true && decideDedupe({ a: 1 }, { a: 2 }).stored.a === 1);

  // --- accepted (boundary: the happy path) ---
  {
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    t("accepted: status 201", r.status === 201, "got " + r.status);
    t("accepted: verdict accepted", r.body.verdict === "accepted");
    t("accepted: report.verdict accepted", r.body.report && r.body.report.verdict === "accepted");
    t("accepted: canonical_sha256 is the sha of the submitted bytes", r.body.canonical_sha256 === sha, r.body.canonical_sha256 + " vs " + sha);
    t("accepted: url serves it by sha", r.body.url === ORIGIN + "/agreement/" + sha);
    t("accepted: verifier_version preserved (boundary 2.7)", r.body.verifier_version === VERIFIER_VERSION && r.body.report.verifier_version === VERIFIER_VERSION);
    t("accepted: recompute recipe carries the version and the offline note (decision 4.5)",
      r.body.recompute && r.body.recompute.verifier_version === VERIFIER_VERSION && /offline/.test(r.body.recompute.offline));

    // report unchanged (boundary 2.6): identical to an independent verify() of the same inputs
    const ref = await verify(parseStrict(can), { keys: KEYS, recorderDomain: RECORDER, now: NOW, inputText: can });
    t("accepted: report is passed through byte for byte (boundary 2.6)", JSON.stringify(r.body.report) === JSON.stringify(ref));

    // stored bytes are the received bytes (boundary 3.5), served back unchanged (boundary 2.5)
    const got = await handleAgreementGet(sha, deps(store));
    t("serve by sha: 200", got.status === 200);
    t("serve by sha: bytes are byte identical to what was submitted (boundary 2.5, 3.5)", got.body.record_canonical === can);
    t("serve by sha: sha256 of the served bytes equals canonical_sha256 (a reader can recompute)", sha256hex(got.body.record_canonical) === sha);
  }

  // --- dedupe, sequential (boundary 2.3) ---
  {
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const r1 = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    const r2 = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    t("dedupe: first is 201 created", r1.status === 201);
    t("dedupe: second is 200 with dedup true", r2.status === 200 && r2.body.dedup === true, "got " + r2.status);
    t("dedupe: same canonical_sha256 both times", r1.body.canonical_sha256 === sha && r2.body.canonical_sha256 === sha);
    t("dedupe: exactly one DO instance holds the record", store._dos.size === 1);
  }

  // --- dedupe, concurrent and atomic (boundary 2.3: no read-then-write window) ---
  {
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, () => handleAgreementIntake(req({ record_canonical: can }), deps(store))));
    const created = results.filter((r) => r.status === 201).length;
    const deduped = results.filter((r) => r.status === 200 && r.body.dedup === true).length;
    t("atomic dedupe: exactly one of " + N + " concurrent submits is created", created === 1, "created=" + created);
    t("atomic dedupe: the other " + (N - 1) + " are deduped", deduped === N - 1, "deduped=" + deduped);
    const stored = await store.getAccepted(sha);
    t("atomic dedupe: exactly one record is stored", stored && stored.canonical_sha256 === sha);
  }

  // --- unreachable key: 503, not a verdict (boundary 2.2, 3.7) ---
  {
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store, { fetchKey: fetchKeyDown }));
    t("unreachable key: status 503", r.status === 503, "got " + r.status);
    t("unreachable key: Retry-After header set", r.headers["retry-after"] === String(30));
    t("unreachable key: reason is key_url_unreachable, stage key_fetch", r.body.reason_code === "key_url_unreachable" && r.body.stage === "key_fetch");
    t("unreachable key: NO verdict was produced", r.body.verdict === undefined && r.body.report === undefined);
    t("unreachable key: nothing was stored", (await store.getAccepted(sha)) === null);
  }

  // --- refused is returned but never published (decision 4.2): one sided ---
  {
    const rec = signV11(v11Record());
    rec.signatures = [rec.signatures[0]]; // drop one signature
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    t("one sided: status 422 refused", r.status === 422 && r.body.verdict === "refused", "got " + r.status);
    t("one sided: verifier report returned verbatim (boundary 2.6)", r.body.report && r.body.report.refusals.some((x) => x.code === "one_sided"));
    t("one sided: nothing stored, sha not served (decision 4.2)", (await store.getAccepted(sha)) === null);
    const got = await handleAgreementGet(sha, deps(store));
    t("one sided: GET by sha is 404 (not published)", got.status === 404);
  }

  // --- refused: tampered signature (boundary: signatures must cover the bytes) ---
  {
    const rec = signV11(v11Record());
    const bad = Buffer.from(rec.signatures[0].signature, "base64"); bad[0] ^= 1;
    rec.signatures[0].signature = bad.toString("base64");
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    t("tampered: refused with signatures_disagree", r.status === 422 && r.body.report.refusals.some((x) => x.code === "signatures_disagree"));
    t("tampered: nothing stored (decision 4.2)", (await store.getAccepted(sha)) === null);
  }

  // --- MUST NOT fix a record (boundary 3.6): a fixable defect is refused, not corrected ---
  {
    const rec = signV11(v11Record((r) => { r.agreement_id = "00112233445566778899AABBCCDDEEFF"; })); // uppercase; sign over the bytes as given
    const can = canonicalUtf8(rec);
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    t("must not fix: uppercase agreement_id is refused, not lowercased (boundary 3.6)", r.status === 422 && r.body.report.refusals.some((x) => x.code === "bad_agreement_id"));
    t("must not fix: nothing stored", (await store.getAccepted(r.body.report.canonical_sha256)) === null);
  }

  // --- MUST NOT re-canonicalise (boundary 3.5): a v1 accepted record submitted non canonical ---
  {
    const rec = signV1(v1Record());
    const can = canonicalUtf8(rec);
    const canonicalSha = sha256hex(can);
    const nonCanon = JSON.stringify(parseStrictToPlain(can), null, 2); // valid, same record, not canonical bytes
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: nonCanon }), deps(store));
    t("no re-canon: v1 non canonical input is accepted", r.status === 201 && r.body.verdict === "accepted", "got " + r.status);
    t("no re-canon: report says the input was not canonical", r.body.report.input_is_canonical === false && r.body.report.findings.some((f) => f.code === "not_canonical"));
    t("no re-canon: dedupe key is the canonical_sha256, not the input sha", r.body.canonical_sha256 === canonicalSha && r.body.canonical_sha256 !== sha256hex(nonCanon));
    const got = await handleAgreementGet(canonicalSha, deps(store));
    t("no re-canon: the bytes served are the non canonical bytes received, untouched (boundary 3.5)", got.body.record_canonical === nonCanon);
    t("no re-canon: so sha256(served bytes) is NOT canonical_sha256, and the report shows both", sha256hex(got.body.record_canonical) !== canonicalSha);
  }

  // --- fail closed if the dedupe gate is not bound (boundary 2.3) ---
  {
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const unboundStore = { claimAccepted: async () => ({ unbound: true }), getAccepted: async () => null };
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(unboundStore));
    t("gate unbound: 503, refuses to store on eventually consistent storage", r.status === 503 && r.body.error === "dedupe_gate_unbound");
  }

  // --- rate limit is a spam control, never a fee (decision 4.4) ---
  {
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const capped = async () => ({ ok: false, error: "daily_per_network_cap_reached", cap: 50, scope: "network" });
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store, { rateLimit: capped }));
    t("rate limit: 429 when capped", r.status === 429 && /never lifted by payment/.test(r.body.note));
    t("rate limit: nothing stored when capped", (await store.getAccepted(sha)) === null);
  }

  // --- parse stage refusal: unreadable record is not a verdict, nothing stored (decision 4.2) ---
  {
    const store = doBackedStore();
    const dupKey = '{"schema":"a2a-agreement-v1.1","schema":"x"}'; // duplicate key, refused by parseStrict
    const r = await handleAgreementIntake(req({ record_canonical: dupKey }), deps(store));
    t("parse stage: 422 with a parse reason code and stage parse", r.status === 422 && r.body.stage === "parse" && r.body.reason_code === "duplicate_json_key", JSON.stringify(r.body));
    t("parse stage: no verifier verdict was produced", r.body.verdict === undefined && r.body.report === undefined);
  }

  // --- bad body (transport) ---
  {
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({}), deps(store));
    t("bad body: 400 when record_canonical is missing", r.status === 400);
  }

  // --- batch and anchor the accepted pool (boundary 2.4) ---
  {
    // buildAgreementBatch is deterministic and sorted by canonical_sha256
    const items = [
      { canonical_sha256: "ff".repeat(32), verifier_version: "0.2.0", report: { record_schema: "a2a-agreement-v1.1", verdict: "accepted" } },
      { canonical_sha256: "00".repeat(32), verifier_version: "0.2.0", report: { record_schema: "a2a-agreement-v1", verdict: "accepted" } },
    ];
    const b1 = buildAgreementBatch(items, "2026-09-16T00:30:00Z");
    const b2 = buildAgreementBatch(items.slice().reverse(), "2026-09-16T00:30:00Z");
    t("batch: schema and count", b1.schema === "nenrin-agreement-batch-v1" && b1.count === 2);
    t("batch: sorted by canonical_sha256, order independent", JSON.stringify(b1) === JSON.stringify(b2) && b1.records[0].canonical_sha256 === "00".repeat(32));
    t("batch: carries sha, schema, verdict, version per record", b1.records[0].record_schema === "a2a-agreement-v1" && b1.records[0].verifier_version === "0.2.0" && b1.records[1].verdict === "accepted");
  }
  {
    // accept, confirm queued, simulate the batch, then GET shows anchored + ledger_entry
    const rec = signV11(v11Record());
    const can = canonicalUtf8(rec);
    const sha = sha256hex(can);
    const store = doBackedStore();
    const r = await handleAgreementIntake(req({ record_canonical: can }), deps(store));
    t("anchor queue: accepted record is queued for the batch", r.status === 201 && store._pending.has(sha));
    const g1 = await handleAgreementGet(sha, deps(store));
    t("anchor queue: before the batch, status is pending_anchor, no ledger entry", g1.body.status === "pending_anchor" && g1.body.ledger_entry === null);
    store.simulateAnchor(41);
    const g2 = await handleAgreementGet(sha, deps(store));
    t("anchor: after the batch, status is anchored with its ledger_entry", g2.body.status === "anchored" && g2.body.ledger_entry === 41 && /\/ledger\/41$/.test(g2.body.ledger_url));
    t("anchor: bytes still served byte identical after anchoring (boundary 2.5)", g2.body.record_canonical === can && sha256hex(g2.body.record_canonical) === sha);
    t("anchor: pool emptied after the batch", store._pending.size === 0);
  }

  // --- self description: caps and no-oracle stated openly (decisions 4.4, 4.5) ---
  {
    const d = agreementSelfDescription(ORIGIN);
    t("self desc: states its caps", d.caps && d.caps.daily_global === 500 && d.caps.daily_per_network === 50);
    t("self desc: states it is not an oracle (decision 4.5)", /run the offline verifier yourself/.test(d.no_oracle));
    t("self desc: points at the boundary and the decisions", d.boundary && d.decisions && d.intake_version === INTAKE_VERSION);
  }

  console.log("");
  console.log(fail ? `agreement_intake: ${fail} FAILURES (${pass} passed)` : `agreement_intake: ALL PASS (${pass})`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// parse the canonical text to a plain (JSON.stringify-able) object, so the test can
// re-serialize it non canonically. Uses the host's JSON, which is fine here because
// the v1 fixture holds no integer past 2^53.
function parseStrictToPlain(text) { return JSON.parse(text); }
