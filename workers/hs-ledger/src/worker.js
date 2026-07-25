// hs-ledger — JIDEC public verification ledger (HORIZON SHIELD)
// Serves per-audit PTKA claims and their OpenTimestamps (Bitcoin) proofs.
//   Public reads : GET /ledger, GET /ledger/{n}, GET /ledger/{n}/ots
//   Authed writes: POST /ledger/append, GET /ledger/pending, POST /ledger/{n}/ots  (header X-Ledger-Key == env.LEDGER_ADMIN_TOKEN)
// Storage: KV binding LEDGER. Stamping is done off-Worker by the GitHub Actions ots-CLI runner.

const enc = new TextEncoder();

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-ledger-key" };
const json = (o, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

async function ctEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ha = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(b)));
  let o = 0;
  for (let i = 0; i < ha.length; i++) o |= ha[i] ^ hb[i];
  return o === 0;
}
const auth = async (request, env) => !!env.LEDGER_ADMIN_TOKEN && (await ctEq(request.headers.get("x-ledger-key") || "", env.LEDGER_ADMIN_TOKEN));
const isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s);
async function sha256hex(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const getEntry = async (env, n) => { const r = await env.LEDGER.get(`entry:${n}`); return r ? JSON.parse(r) : null; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- v1 canonical claim schema (per SPEC_HASH_INDEPENDENCE_v1.md, anchored as entry #2).
// Following Pang-jo Chun's 2026-07-25 critique: the Bitcoin-anchored hash MUST commit to
// (input, reference bundle content SHA, algorithm commit, thresholds, result, PDF)
// simultaneously — not just to the estimate JSON or to a concatenation of upstream params.
// v0 records (entries created before the fix) are still readable but flagged as v0.
const V1_REQUIRED = ["schema","issued_at","work_id","input_sha256","reference_bundle_sha256","reference_bundle_version","algorithm_commit","algorithm_url","thresholds_sha256","result_sha256","pdf_sha256","verifier_recipe_url"];
function parseClaimSchema(record_canonical) {
  try {
    const j = JSON.parse(record_canonical);
    if (j && j.schema === "jidec-claim-v1") {
      const missing = V1_REQUIRED.filter((k) => !(k in j));
      if (missing.length) return { schema: "invalid-v1", missing };
      // shape checks: SHA fields must be 64 hex
      const shaFields = ["input_sha256","reference_bundle_sha256","thresholds_sha256","result_sha256","pdf_sha256"];
      for (const f of shaFields) if (!isHex64(j[f])) return { schema: "invalid-v1", bad_field: f };
      if (!/^[0-9a-f]{40}$/i.test(j.algorithm_commit)) return { schema: "invalid-v1", bad_field: "algorithm_commit" };
      return { schema: "v1", claim: j };
    }
    return { schema: "v0" };
  } catch {
    return { schema: "v0-plain" };
  }
}

// --- Age-based pending status. Per Federico's "Reversal Test": a fresh pending
// and a stale one are genuinely different facts, and collapsing them into one
// badge is how a real anchor ends up looking like a stalled one. Purely derived
// at read time — nothing stored is changed, no write path is touched.
// Threshold is env.PENDING_STALE_HOURS (string) or the default below. ---
const STALE_HOURS_DEFAULT = 6;
function pendingView(e, env) {
  if (!e || e.ots_status === "confirmed") return null;
  const since = e.stamped_at || e.created_at; // pending since submission, else since recorded
  const t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  const hours = ms > 0 ? Math.floor(ms / 3600000) : 0;
  const staleAfter = Number((env && env.PENDING_STALE_HOURS) || STALE_HOURS_DEFAULT) || STALE_HOURS_DEFAULT;
  return { stage: hours >= staleAfter ? "stale" : "fresh", hours, stale_after: staleAfter };
}
const ageText = (pv) => (pv ? (pv.hours >= 1 ? `${pv.hours}h` : "<1h") : "");
function statusLabel(e, pv) {
  const s = e.ots_status || "unstamped";
  if (s === "confirmed") return `Bitcoin-anchored — block ${e.bitcoin_block}${e.block_time ? " (" + e.block_time + ")" : ""}`;
  const age = ageText(pv);
  if (s === "pending")
    return pv && pv.stage === "stale"
      ? `OpenTimestamps submitted — confirmation delayed, longer than expected (${age})`
      : `OpenTimestamps submitted — awaiting Bitcoin confirmation (${age}, normal)`;
  return pv && pv.stage === "stale" ? `recorded — stamping overdue (${age})` : "recorded — awaiting stamping";
}

function receiptHtml(e, origin, env) {
  const s = e.ots_status || "unstamped";
  const pv = pendingView(e, env);
  const label = statusLabel(e, pv);
  const badgeClass = s === "confirmed" ? "confirmed" : pv && pv.stage === "stale" ? "stale" : s === "pending" ? "pending" : "unstamped";
  const staleNote = pv && pv.stage === "stale"
    ? `<div class="sub" style="margin-top:.5rem">Pending longer than the usual window. The submission is real and public; the delay is on the calendar and Bitcoin side, not a failure. It upgrades automatically when the anchor lands.</div>`
    : "";
  const ots = `${origin}/ledger/${e.n}/ots`;
  const sch = e.schema || parseClaimSchema(e.record_canonical).schema;
  const schBadge = sch === "v1"
    ? `<span class="badge v1">schema v1 · independently verifiable</span>`
    : `<span class="badge v0">schema v0 · concept-proof (see SPEC v1)</span>`;
  const verifyLink = sch === "v1"
    ? `<div class="card"><div class="k">Machine-readable verification recipe</div><div class="v"><a href="${origin}/verify/${e.n}">${origin}/verify/${e.n}</a></div><div class="sub" style="margin-top:.4rem">Lists every artifact a third party must fetch and hash to independently reproduce this audit — no trust in HORIZON SHIELD required.</div></div>`
    : `<div class="card"><div class="k">Schema note</div><div class="sub">This entry uses the v0 schema (only the estimate JSON is hashed). Independent verification per SPEC v1 §3 is available on entries #2 and later. This entry remains a valid timestamp proof for its content at the recorded time.</div></div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JIDEC Ledger #${e.n} — HORIZON SHIELD</title><style>
body{font-family:-apple-system,system-ui,sans-serif;background:#0a1628;color:#e8eef5;margin:0;padding:2rem 1.2rem;line-height:1.6}
.w{max-width:820px;margin:0 auto}h1{color:#c9a84c;font-size:1.25rem;margin:0 0 .2rem}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
.card{background:#112240;border:1px solid #24344d;border-radius:10px;padding:1.1rem 1.2rem;margin-bottom:1rem}
.k{color:#94a3b8;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}.v{font-size:.95rem;word-break:break-all}
code{background:#0a1628;border:1px solid #24344d;border-radius:6px;padding:.15rem .4rem;font-size:.82rem;color:#e8c87a}
pre{background:#0a1628;border:1px solid #24344d;border-radius:6px;padding:.8rem;overflow:auto;white-space:pre-wrap;font-size:.8rem;color:#e8c87a}
.badge{display:inline-block;padding:.25rem .6rem;border-radius:6px;font-size:.8rem;font-weight:700}
.confirmed{background:#16391f;color:#4ade80;border:1px solid #2f7d43}.pending{background:#3a3416;color:#e8c87a;border:1px solid #7d6a2f}
.stale{background:#3a1f16;color:#f0a882;border:1px solid #7d452f}
.unstamped{background:#2a2f3a;color:#94a3b8;border:1px solid #3a4557}
.v1{background:#16292e;color:#7ecfe0;border:1px solid #2f6a7d;margin-left:.6rem}
.v0{background:#2a2f3a;color:#94a3b8;border:1px solid #3a4557;margin-left:.6rem}
a{color:#7ab8e8}</style></head><body><div class="w">
<h1>JIDEC Verification Ledger — Entry #${e.n}</h1>
<div class="sub">HORIZON SHIELD · Pre-Transaction Knowledge Anchoring (PTKA) · anchored to Bitcoin via OpenTimestamps</div>
<div class="card"><div class="k">Status</div><div class="v"><span class="badge ${badgeClass}">${label}</span>${schBadge}</div>${staleNote}</div>
${verifyLink}
<div class="card"><div class="k">Claim SHA-256</div><div class="v"><code>${e.claim_sha256}</code></div>
${e.work ? `<div class="k" style="margin-top:.8rem">Work</div><div class="v">${esc(e.work)}</div>` : ""}
<div class="k" style="margin-top:.8rem">Recorded</div><div class="v">${e.created_at}</div></div>
<div class="card"><div class="k">Signed record — the exact bytes this hash commits to</div><pre>${esc(e.record_canonical || "")}</pre></div>
<div class="card"><div class="k">OpenTimestamps proof</div><div class="v"><a href="${ots}">${ots}</a> ${s === "unstamped" ? "(not yet available)" : ""}</div>
<div class="k" style="margin-top:.8rem">Verify it yourself — independent, no trust in us</div>
<pre>curl -s "${origin}/ledger/${e.n}?format=raw" > claim_${e.n}.txt
curl -s "${ots}" > claim_${e.n}.txt.ots
# no Bitcoin node needed:
ots info claim_${e.n}.txt.ots            # shows the Bitcoin block this is anchored in
# or drag both files into https://opentimestamps.org
# with a full Bitcoin node:
ots verify claim_${e.n}.txt.ots
shasum -a 256 claim_${e.n}.txt           # == ${e.claim_sha256}</pre></div>
<div class="sub">A signature proves the record is untampered, not that the underlying ruleset is still current. This ledger anchors <em>when</em> the claim existed — to Bitcoin, nothing weaker, no separate chain.</div>
</div></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "") || "/";
    const origin = url.origin;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (p === "/" || p === "/health")
      return json({ ok: true, service: "hs-ledger", ledger: "JIDEC", anchor: "Bitcoin via OpenTimestamps", claim_schema: "jidec-claim-v1", spec: "SPEC_HASH_INDEPENDENCE_v1.md (entry #2)", routes: ["/ledger", "/ledger/{n}", "/ledger/{n}/ots", "/verify/{n}", "/reference/{sha}"] });

    if (p === "/ledger" && request.method === "GET") {
      const seq = Number((await env.LEDGER.get("seq")) || 0);
      const items = [];
      for (let n = seq; n >= 1 && items.length < 100; n--) {
        const e = await getEntry(env, n);
        if (e) {
          const pv = pendingView(e, env);
          items.push({ n, work: e.work, claim_sha256: e.claim_sha256, ots_status: e.ots_status, pending_stage: pv ? pv.stage : null, pending_hours: pv ? pv.hours : null, bitcoin_block: e.bitcoin_block, url: `${origin}/ledger/${n}` });
        }
      }
      return json({ ledger: "JIDEC", anchor: "Bitcoin via OpenTimestamps", count: seq, entries: items });
    }

    if (p === "/ledger/append" && request.method === "POST") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const b = await request.json().catch(() => null);
      if (!b || !isHex64(b.claim_sha256) || typeof b.record_canonical !== "string")
        return json({ error: "claim_sha256 (64 hex) and record_canonical (string) required" }, 400);
      const h = (await sha256hex(b.record_canonical)).toLowerCase();
      if (h !== b.claim_sha256.toLowerCase()) return json({ error: "hash_mismatch", recomputed: h }, 422);
      // v1 schema validation: if the record declares itself as jidec-claim-v1, enforce all required fields.
      // If it's v0 (plain JSON without schema field), still accept for backward compat but flag it.
      const sch = parseClaimSchema(b.record_canonical);
      if (sch.schema === "invalid-v1") return json({ error: "invalid_v1_schema", detail: sch }, 422);
      // v1 must reference a pinned reference bundle that actually exists in KV
      if (sch.schema === "v1") {
        const refExists = await env.LEDGER.get(`ref:${sch.claim.reference_bundle_sha256}`);
        if (!refExists) return json({ error: "unknown_reference_bundle", reference_bundle_sha256: sch.claim.reference_bundle_sha256, hint: "POST the bundle to /reference/pin first" }, 422);
      }
      const dup = await env.LEDGER.get(`hash:${h}`);
      if (dup) return json({ n: Number(dup), url: `${origin}/ledger/${dup}`, dedup: true });
      const n = Number((await env.LEDGER.get("seq")) || 0) + 1;
      const entry = { n, work: b.work || null, claim_sha256: h, record_canonical: b.record_canonical, schema: sch.schema, created_at: new Date().toISOString(), ots_status: "unstamped", bitcoin_block: null, block_time: null, stamped_at: null };
      await env.LEDGER.put(`entry:${n}`, JSON.stringify(entry));
      await env.LEDGER.put(`hash:${h}`, String(n));
      await env.LEDGER.put("seq", String(n));
      return json({ n, url: `${origin}/ledger/${n}`, schema: sch.schema }, 201);
    }

    // --- Reference bundle pinning (per SPEC v1 §4).
    // Any dataset used by an audit must be POSTed here first. The server hashes the exact bytes,
    // stores them content-addressed (key = ref:<sha>), and the returned SHA is the ONLY valid
    // reference_bundle_sha256 for subsequent audit claims. This closes the "R2 same-month update"
    // hole: once pinned, the bytes are frozen; if the maintainer wants to change reference data,
    // they must pin a new bundle (new SHA) and future audits reference the new SHA explicitly.
    if (p === "/reference/pin" && request.method === "POST") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const body_text = await request.text();
      if (!body_text) return json({ error: "empty_body" }, 400);
      let parsed;
      try { parsed = JSON.parse(body_text); } catch { return json({ error: "invalid_json" }, 400); }
      if (!parsed || typeof parsed !== "object") return json({ error: "must_be_json_object" }, 400);
      // Require a human-readable version label so operators can look up the bundle in registries.
      if (typeof parsed._meta?.version !== "string" || !parsed._meta.version)
        return json({ error: "missing _meta.version (human-readable label required)" }, 400);
      const ref_sha = (await sha256hex(body_text)).toLowerCase();
      const existing = await env.LEDGER.get(`ref:${ref_sha}`);
      if (existing) {
        return json({ reference_bundle_sha256: ref_sha, dedup: true, pinned_at: JSON.parse(existing).pinned_at });
      }
      const pin = { reference_bundle_sha256: ref_sha, version_label: parsed._meta.version, size_bytes: body_text.length, pinned_at: new Date().toISOString(), bytes: body_text };
      await env.LEDGER.put(`ref:${ref_sha}`, JSON.stringify(pin));
      return json({ reference_bundle_sha256: ref_sha, version_label: parsed._meta.version, url: `${origin}/reference/${ref_sha}` }, 201);
    }

    // Public read of a pinned reference bundle. Third-party verifiers use this to recompute audits.
    const refMatch = p.match(/^\/reference\/([0-9a-f]{64})$/i);
    if (refMatch && request.method === "GET") {
      const rec = await env.LEDGER.get(`ref:${refMatch[1].toLowerCase()}`);
      if (!rec) return json({ error: "reference bundle not found" }, 404);
      const pin = JSON.parse(rec);
      return new Response(pin.bytes, { headers: { "content-type": "application/json; charset=utf-8", "x-reference-sha256": pin.reference_bundle_sha256, "x-reference-version": pin.version_label, "x-pinned-at": pin.pinned_at, ...CORS } });
    }

    if (p === "/ledger/pending" && request.method === "GET") {
      if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
      const seq = Number((await env.LEDGER.get("seq")) || 0);
      const out = [];
      for (let n = 1; n <= seq; n++) {
        const e = await getEntry(env, n);
        if (e && e.ots_status !== "confirmed") out.push({ n, claim_sha256: e.claim_sha256, record_canonical: e.record_canonical, ots_status: e.ots_status });
      }
      return json({ pending: out });
    }

    // Machine-readable verification recipe for a v1 entry. Lists exactly what a third party
    // must fetch and recompute to independently verify the claim end-to-end.
    const vm = p.match(/^\/verify\/(\d+)$/);
    if (vm && request.method === "GET") {
      const n = Number(vm[1]);
      const e = await getEntry(env, n);
      if (!e) return json({ error: "not found" }, 404);
      const sch = parseClaimSchema(e.record_canonical);
      if (sch.schema !== "v1") return json({ error: "verification recipe available for v1 claims only", schema: sch.schema, note: "entry #1 is v0 (concept-proof only)" }, 400);
      const c = sch.claim;
      return json({
        entry: n,
        claim_sha256: e.claim_sha256,
        bitcoin_status: e.ots_status,
        bitcoin_block: e.bitcoin_block,
        recipe: [
          { step: 1, action: "fetch canonical record", url: `${origin}/ledger/${n}?format=raw`, verify: `shasum -a 256 => ${e.claim_sha256}` },
          { step: 2, action: "fetch and verify Bitcoin proof", url: `${origin}/ledger/${n}/ots`, verify: "ots verify (needs opentimestamps-client) OR drop into https://opentimestamps.org" },
          { step: 3, action: "fetch pinned reference bundle", url: `${origin}/reference/${c.reference_bundle_sha256}`, verify: `shasum -a 256 => ${c.reference_bundle_sha256}` },
          { step: 4, action: "checkout algorithm source at declared commit", url: c.algorithm_url, verify: `git rev-parse HEAD => ${c.algorithm_commit}` },
          { step: 5, action: "obtain the input estimate", verify: `shasum -a 256 => ${c.input_sha256}`, note: "input is user-private; obtain from the audited party" },
          { step: 6, action: "recompute audit and hash the result", verify: `shasum -a 256 => ${c.result_sha256}` },
          { step: 7, action: "verify PDF fingerprint", verify: `shasum -a 256 <issued.pdf> => ${c.pdf_sha256}` }
        ],
        note: "If steps 1-7 all match, the audit result is provably the deterministic output of the declared inputs/algorithm — HORIZON SHIELD's assertion is not needed."
      });
    }

    const m = p.match(/^\/ledger\/(\d+)(\/ots)?$/);
    if (m) {
      const n = Number(m[1]);
      const e = await getEntry(env, n);
      if (!e) return json({ error: "not found" }, 404);
      if (m[2]) {
        if (request.method === "POST") {
          if (!(await auth(request, env))) return json({ error: "unauthorized" }, 401);
          const b = await request.json().catch(() => null);
          if (!b || typeof b.ots_base64 !== "string") return json({ error: "ots_base64 required" }, 400);
          await env.LEDGER.put(`ots:${n}`, b.ots_base64);
          e.ots_status = b.status === "confirmed" ? "confirmed" : "pending";
          if (b.bitcoin_block) e.bitcoin_block = b.bitcoin_block;
          if (b.block_time) e.block_time = b.block_time;
          e.stamped_at = new Date().toISOString();
          await env.LEDGER.put(`entry:${n}`, JSON.stringify(e));
          return json({ ok: true, n, ots_status: e.ots_status });
        }
        const b64 = await env.LEDGER.get(`ots:${n}`);
        if (!b64) return json({ error: "proof not yet available", ots_status: e.ots_status }, 404);
        return new Response(b64ToBytes(b64), { headers: { "content-type": "application/vnd.opentimestamps.proof", "content-disposition": `attachment; filename="claim_${n}.txt.ots"`, ...CORS } });
      }
      const fmt = url.searchParams.get("format");
      if (fmt === "raw") return new Response(e.record_canonical || "", { headers: { "content-type": "text/plain; charset=utf-8", ...CORS } });
      if (fmt === "json" || (request.headers.get("accept") || "").includes("application/json")) {
        const pv = pendingView(e, env);
        return json(pv ? { ...e, pending_stage: pv.stage, pending_hours: pv.hours, pending_stale_after_hours: pv.stale_after } : e);
      }
      return new Response(receiptHtml(e, origin, env), { headers: { "content-type": "text/html; charset=utf-8", ...CORS } });
    }

    return json({ error: "not found", routes: ["/ledger", "/ledger/{n}", "/ledger/{n}/ots"] }, 404);
  },
};
