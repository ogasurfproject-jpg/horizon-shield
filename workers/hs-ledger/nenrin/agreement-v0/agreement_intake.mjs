// agreement_intake.mjs
// The agreement intake, v0. Built 2026-09-16 to ops/AGREEMENT_INTAKE_v0_BOUNDARY.md
// and ops/AGREEMENT_INTAKE_v0_DECISIONS.md. The verifier is not touched.
//
// The seam (boundary 1): the verifier gathers nothing. It opens no socket, has
// no clock, fetches no key. This intake gathers the two things the verifier is
// forbidden to gather (the served keys, and the instant), hands the record and
// the exact input text straight through, and publishes what comes back without
// altering a byte of it. Every rule about verdicts lives in agreement_verify.mjs
// and is not reimplemented here. Everything here is what that file refuses to do.
//
// Dependency injection, on purpose. handleAgreementIntake takes its verifier,
// its key fetcher, its atomic store, its clock and its rate limiter as inputs,
// so the code the test drives is the code that runs, and the rules that need a
// Durable Object runtime to exercise are not the rules that decide a verdict.
// AgreementDedupeDO and doStore below are the production wiring; the test hands
// in an in memory atomic store with the same contract.
//
// What is NOT here on purpose:
//   - no editorial step: the terms are never judged (boundary 3.1)
//   - no custody, no matching, no escrow (boundary 3.3)
//   - no fee that varies with the deal, and no paid fast lane (boundary 3.4, 4.4)
//   - no re canonicalisation and no record fixing: the bytes received are the
//     bytes stored (boundary 3.5, 3.6)
//   - no verdict while a key is unreachable: that is a 503 and a retry, never an
//     answer (boundary 2.2, 3.7)
//   - no oracle: no endpoint verifies arbitrary bytes for a caller (decision 4.5)

import { parseStrict, CanonicalError } from "./agreement_canonical.mjs";
import { verify as defaultVerify, VERIFIER_VERSION, SCHEMAS } from "./agreement_verify.mjs";

export const INTAKE_VERSION = "0.1.0";

// A transport cap read before the record is parsed. The verifier applies its own
// per schema canonical size cap (too_large) after; this only stops a body too big
// to be worth parsing.
export const AGREEMENT_MAX_BYTES = 65536;

export const RETRY_AFTER_SECONDS = 30;

// Caps are a spam control, stated in the open, never lifted by payment (decision 4.4).
export const DAILY_GLOBAL = 500;
export const DAILY_PER_NETWORK = 50;

// -------------------------------------------------------------------------------------------------
// The atomic deduplication (boundary 2.3).
//
// Two submissions of the same record are one record. This MUST be closed on
// strongly consistent storage, not a read then a write on eventually consistent
// storage, because the window there belongs to the storage and not to the code.
// The house already learned this the hard way; see hs-hearing/src/dispatch_do.js.
// The idempotency key is the record's canonical_sha256.
//
// decideDedupe is the whole decision, pulled out as a pure function so it can be
// tested without a DO runtime. The DO wraps it in blockConcurrencyWhile so that,
// for one canonical_sha256, read then decide then write is one indivisible act.
// -------------------------------------------------------------------------------------------------

export function decideDedupe(prev, payload) {
  if (prev && typeof prev === "object") return { duplicate: true, stored: prev };
  return { duplicate: false, stored: payload };
}

export class AgreementDedupeDO {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return doJson({ error: "not_found" }, 404);
    let body;
    try { body = await request.json(); } catch { return doJson({ error: "bad_json" }, 400); }

    if (url.pathname === "/claim") {
      const sha = typeof body.sha === "string" ? body.sha : null;
      if (!sha) return doJson({ error: "no_sha" }, 400);
      const payload = body.payload;
      // read, decide, write, as one block. This DO takes no other request meanwhile.
      return doJson(await this.state.blockConcurrencyWhile(async () => {
        const prev = await this.state.storage.get("record");
        const d = decideDedupe(prev === undefined ? null : prev, payload);
        if (!d.duplicate) await this.state.storage.put("record", payload);
        return d;
      }));
    }

    if (url.pathname === "/get") {
      const rec = await this.state.storage.get("record");
      return doJson({ stored: rec === undefined ? null : rec });
    }

    return doJson({ error: "not_found" }, 404);
  }
}

// Worker side glue. Fails closed: if the gate is not bound, claimAccepted does NOT
// fall back to eventually consistent storage. A missing gate is a stop, not a
// silent hole. The DO is the atomic dedupe authority (boundary 2.3). The KV pool
// markers (agr:pending / agr:anchored) are only the anchor queue and its result
// (boundary 2.4); they are eventually consistent, which is fine because the DO,
// not the marker, is what decides whether a record is already recorded.
export function doStore(env) {
  const bound = env && env.AGREEMENT_DEDUPE_DO;
  const stubFor = (sha) => env.AGREEMENT_DEDUPE_DO.get(env.AGREEMENT_DEDUPE_DO.idFromName("agreement:" + sha));
  return {
    async claimAccepted(sha, payload) {
      if (!bound) return { unbound: true };
      const r = await stubFor(sha).fetch("https://agreement-dedupe/claim", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha, payload }),
      });
      return await r.json();
    },
    // Queue a freshly accepted record for the daily batch and anchor (boundary 2.4).
    // Best effort: a served record that missed the queue is unanchored, not lost.
    async queueForAnchor(sha, payload) {
      try { await env.LEDGER.put("agr:pending:" + sha, JSON.stringify(payload)); return { ok: true }; }
      catch (_e) { return { ok: false }; }
    },
    // The anchor result for a sha, or null while it is still pending.
    async anchorState(sha) {
      try {
        const raw = await env.LEDGER.get("agr:anchored:" + sha);
        if (!raw) return null;
        const a = JSON.parse(raw);
        return { anchored: true, ledger_entry: a.n };
      } catch (_e) { return null; }
    },
    async getAccepted(sha) {
      if (bound) {
        const r = await stubFor(sha).fetch("https://agreement-dedupe/get", {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}",
        });
        const j = await r.json();
        if (j.stored) return j.stored;
      }
      // Fallback to the KV markers so the bytes survive even if the DO was pruned:
      // anchored first (boundary 2.5), then the pending queue.
      try {
        const anch = await env.LEDGER.get("agr:anchored:" + sha);
        if (anch) { const a = JSON.parse(anch); if (a && a.stored) return a.stored; }
        const pend = await env.LEDGER.get("agr:pending:" + sha);
        if (pend) return JSON.parse(pend);
      } catch (_e) { /* fall through to null */ }
      return null;
    },
  };
}

// The daily batch object, pulled out as a pure function so its bytes are testable.
// Compact by design: it anchors each accepted record's canonical_sha256, schema,
// verdict and verifier_version. The full bytes stay served by GET /agreement/{sha}
// and in the agr:anchored marker; the batch only fixes existence time.
export function buildAgreementBatch(items, anchoredAt) {
  const sorted = items.slice().sort((a, b) => (a.canonical_sha256 < b.canonical_sha256 ? -1 : 1));
  return {
    schema: "nenrin-agreement-batch-v1",
    anchored_at: anchoredAt,
    count: sorted.length,
    records: sorted.map((s) => ({
      canonical_sha256: s.canonical_sha256,
      record_schema: (s.report && s.report.record_schema) || null,
      verdict: (s.report && s.report.verdict) || "accepted",
      verifier_version: s.verifier_version,
    })),
  };
}

// -------------------------------------------------------------------------------------------------
// The handler.
// -------------------------------------------------------------------------------------------------

export async function handleAgreementIntake(request, deps) {
  const {
    verify = defaultVerify,
    fetchKey,
    store,
    now = () => new Date().toISOString(),
    recorderDomain = null,
    rateLimit = null,
    origin = "https://ledger.horizonshield.dev",
  } = deps || {};

  // 1. body shape.
  const b = await readJson(request);
  if (!b || typeof b.record_canonical !== "string") {
    return res(400, { error: "record_canonical (string) required", help: origin + "/agreement" });
  }
  if (byteLen(b.record_canonical) > AGREEMENT_MAX_BYTES) {
    return res(413, { error: "too_large", max_bytes: AGREEMENT_MAX_BYTES });
  }

  // 2. rate limit. A spam control only; eventually consistent counting is fine
  //    here (decision 4.4), and it is kept apart from the dedup, which is not.
  if (rateLimit) {
    const rl = await rateLimit();
    if (rl && rl.ok === false) {
      return res(429, {
        error: rl.error || "rate_limited", cap: rl.cap, scope: rl.scope,
        note: "stated at GET /agreement; try later. caps are a spam control and are never lifted by payment.",
      });
    }
  }

  // 3. parse with the SAME reader the verifier uses. A parse failure is a
  //    transport stage refusal, not a verdict; nothing is stored (decision 4.2).
  let record;
  try {
    record = parseStrict(b.record_canonical);
  } catch (e) {
    const code = e instanceof CanonicalError ? e.code : "bad_json";
    const why = e && e.message ? e.message : "the record is not JSON this reader can parse";
    return res(422, {
      error: "unparseable_record", reason_code: code, why, stage: "parse",
      note: "the record could not be read as canonical JSON, so no verifier verdict was produced and nothing was stored",
      help: origin + "/agreement",
    });
  }

  // 4. gather the keys the verifier may not gather (boundary 2.1). For each party
  //    key_url, fetch and read the served public key. If ANY key_url is
  //    unreachable, answer 503 and retry: a fetch problem is never turned into a
  //    verdict (boundary 2.2, 3.7).
  const keyUrls = collectKeyUrls(record);
  const keys = {};
  for (const ku of keyUrls) {
    const got = await fetchKey(ku);
    if (!got || got.ok !== true || typeof got.key !== "string") {
      return res(503, {
        error: "key_url_unreachable", reason_code: "key_url_unreachable", key_url: ku,
        why: (got && got.why) || "the key could not be fetched",
        retry_after_seconds: RETRY_AFTER_SECONDS, stage: "key_fetch",
        note: "a key that cannot be fetched is an unanswered question, not a bad record; retry later",
      }, { "retry-after": String(RETRY_AFTER_SECONDS) });
    }
    keys[ku] = got.key;
  }

  // 5. hand the five things to the verifier, unaltered (boundary 1): the record,
  //    the fetched keys, this operator's own domain, the instant, and the exact
  //    input text.
  const nowVal = typeof now === "function" ? now() : now;
  const report = await verify(record, {
    keys, recorderDomain, now: nowVal, inputText: b.record_canonical,
  });

  const recipe = recomputeRecipe(report.record_schema, origin);

  // 6. publish only what was accepted (decision 4.2). Refused or incomplete: the
  //    verifier's report is returned verbatim (boundary 2.6, 2.7); nothing is
  //    stored, anchored, or served by sha.
  if (report.verdict !== "accepted") {
    return res(422, {
      status: "refused", verdict: report.verdict,
      report,
      verifier_version: report.verifier_version,
      recompute: recipe,
      note: "not accepted, so not stored, not anchored, not served by sha (decision 4.2). fix and re-sign to record.",
      help: origin + "/agreement",
    });
  }

  // 7. accepted. deduplicate atomically on strongly consistent storage, keyed by
  //    canonical_sha256 (boundary 2.3). fail closed if the gate is not bound.
  const canonicalSha = report.canonical_sha256;
  const payload = {
    canonical_sha256: canonicalSha,
    record_canonical: b.record_canonical, // the bytes received, kept as is (boundary 3.5, 3.6)
    report,                               // the report unchanged (boundary 2.6, 2.7)
    verifier_version: report.verifier_version,
    recorder_domain: recorderDomain,
    submitted_at: nowVal,
    status: "pending_anchor",             // pooled for the daily batch and anchor (boundary 2.4)
  };
  const claim = await store.claimAccepted(canonicalSha, payload);
  if (claim && claim.unbound) {
    return res(503, {
      error: "dedupe_gate_unbound", retry_after_seconds: RETRY_AFTER_SECONDS,
      note: "the strongly consistent deduplication gate is not bound; refusing to store on eventually consistent storage (boundary 2.3). fail closed.",
    }, { "retry-after": String(RETRY_AFTER_SECONDS) });
  }
  if (claim && claim.duplicate) {
    const stored = claim.stored || payload;
    return res(200, {
      status: stored.status || "pending_anchor", dedup: true, verdict: "accepted",
      canonical_sha256: canonicalSha, url: origin + "/agreement/" + canonicalSha,
      report: stored.report || report,
      recompute: recipe,
      note: "already recorded; one record per canonical_sha256 (boundary 2.3).",
    });
  }
  // queue the freshly accepted record for the daily batch and anchor (boundary 2.4).
  if (store.queueForAnchor) { try { await store.queueForAnchor(canonicalSha, payload); } catch (_e) { /* served, just not queued */ } }
  return res(201, {
    status: "pending_anchor", verdict: "accepted", canonical_sha256: canonicalSha,
    url: origin + "/agreement/" + canonicalSha,
    report,
    verifier_version: report.verifier_version,
    recompute: recipe,
    anchor_policy: "recorded and served by sha now, and queued for the daily batch that anchors the accepted pool to Bitcoin at 00:30 UTC (boundary 2.4); the anchor bounds agreed_at from above. status is pending_anchor until the batch runs, then anchored with a ledger entry.",
    caps_note: "caps are stated at GET /agreement; a spam control, never lifted by payment (decision 4.4).",
  });
}

// GET /agreement/{canonical_sha256}. Serve the exact stored bytes so anyone can
// recompute the hash and re run the offline verifier themselves (boundary 2.5).
export async function handleAgreementGet(sha, deps) {
  const { store, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const s = (sha || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) {
    return res(400, { error: "bad_sha", note: "canonical_sha256 is 64 lowercase hex characters" });
  }
  const stored = await store.getAccepted(s);
  if (!stored) return res(404, { error: "not_found", canonical_sha256: s });
  let status = stored.status || "pending_anchor";
  let ledgerEntry = null;
  if (store.anchorState) {
    const a = await store.anchorState(s);
    if (a && a.anchored) { status = "anchored"; ledgerEntry = a.ledger_entry; }
  }
  return res(200, {
    canonical_sha256: s,
    record_canonical: stored.record_canonical, // the exact bytes (boundary 2.5, 3.5)
    report: stored.report,
    verifier_version: stored.verifier_version,
    status,
    ledger_entry: ledgerEntry,
    ledger_url: ledgerEntry ? origin + "/ledger/" + ledgerEntry : null,
    recompute: recomputeRecipe(stored.report && stored.report.record_schema, origin),
  });
}

// GET /agreement. States what this is and, plainly, its caps (decision 4.4) and
// its refusal to be an oracle (decision 4.5).
export function agreementSelfDescription(origin) {
  const o = origin || "https://ledger.horizonshield.dev";
  return {
    service: "agreement intake v0",
    intake_version: INTAKE_VERSION,
    what: "records that two agents both signed the same bytes, and nothing more",
    accepts: 'POST /agreement with {"record_canonical":"<exact canonical bytes of a fully signed a2a-agreement-v1 or v1.1 record>"}',
    schemas: SCHEMAS,
    verifier_version: VERIFIER_VERSION,
    only_accepted_is_public: "a refused or incomplete record is returned to you with its full report and is not stored, anchored, or served (decision 4.2)",
    serve_by_sha: o + "/agreement/{canonical_sha256}",
    anchoring: "accepted records are deduplicated, served by sha, and queued for the daily batch that anchors the pool to Bitcoin at 00:30 UTC (boundary 2.4); GET /agreement/{sha} shows status pending_anchor until the batch runs, then anchored with its ledger_entry. the Bitcoin stamp follows on the operator's stamping run.",
    pending_pool: o + "/agreement/pending",
    caps: {
      daily_global: DAILY_GLOBAL, daily_per_network: DAILY_PER_NETWORK,
      note: "a spam control on a salted, per day network mark; the raw IP is never stored; caps are never lifted by payment (decision 4.4)",
    },
    no_oracle: "there is no endpoint that verifies arbitrary bytes for you; run the offline verifier yourself (decision 4.5)",
    boundary: "ops/AGREEMENT_INTAKE_v0_BOUNDARY.md",
    decisions: "ops/AGREEMENT_INTAKE_v0_DECISIONS.md",
  };
}

export function recomputeRecipe(schema, origin) {
  const context = schema === "a2a-agreement-v1.1"
    ? 'the literal bytes "a2a-agreement-v1.1\\n" followed by '
    : "";
  return {
    verifier_version: VERIFIER_VERSION,
    steps: [
      "1. fetch the exact bytes: GET " + (origin || "") + "/agreement/{canonical_sha256}, field record_canonical.",
      "2. recompute the hash: sha256 of those bytes must equal canonical_sha256.",
      "3. reproduce the signing bytes: " + context + "the canonical JSON of the record with its signatures field removed.",
      "4. verify each party's Ed25519 signature over those signing bytes against the public_key_ed25519_b64 pinned inside the record (v1.1), or against the key served at each party's key_url (v1).",
      "5. optionally fetch each party's key_url and confirm it serves the same key; that is attribution to the domain, and its absence is stated in the report.",
    ],
    offline: "run the verifier offline yourself: it opens no socket and has no clock; run agreement_verify.py or agreement_verify.mjs on the bytes and do not take this operator's word.",
    source: "workers/hs-ledger/nenrin/agreement-v0/agreement_verify.{py,mjs}; two implementations agree byte for byte on the frozen cases.",
  };
}

// -------------------------------------------------------------------------------------------------
// small helpers
// -------------------------------------------------------------------------------------------------

function collectKeyUrls(record) {
  const out = [];
  const seen = new Set();
  const add = (u) => {
    if (typeof u === "string" && /^https:\/\//i.test(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  };
  if (record && typeof record === "object" && Array.isArray(record.parties)) {
    for (const p of record.parties) if (p && typeof p === "object") add(p.key_url);
  }
  if (record && typeof record === "object" && Array.isArray(record.signatures)) {
    for (const s of record.signatures) if (s && typeof s === "object") add(s.key_url);
  }
  return out;
}

function res(status, body, headers) {
  return { status, headers: Object.assign({ "content-type": "application/json" }, headers || {}), body };
}

// Turn the plain {status, headers, body} the handler returns into a Response for
// the worker. The handler stays runtime free so the test can read status and body.
export function respond(r) {
  return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
}

function doJson(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/json" } });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}
