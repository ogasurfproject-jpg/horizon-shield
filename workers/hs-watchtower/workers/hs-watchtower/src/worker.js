/**
 * hs-watchtower — external-vantage self-probe for the HORIZON SHIELD / JIDEC billboards.
 *
 * WHY THIS EXISTS
 *   The daily 番人 (guardian) runs in an unattended cloud session where WebFetch is
 *   gated (PROVENANCE_REQUIRED), cloud-side curl to *.workers.dev is 403'd, and no Mac
 *   bridge is attached. That left points 8/10/14/16 permanently "未確認 (unconfirmed)".
 *   This worker moves the measurement onto Cloudflare's own edge — where a GET to the
 *   public billboards just works — on a Cron Trigger, and persists the result to D1.
 *   The guardian then reads the latest verdict with the Cloudflare MCP `d1_database_query`,
 *   a channel that is alive in scheduled sessions even when WebFetch and Apify are not.
 *
 * LAWS IT KEEPS (番人 constitution)
 *   T0/read-only: every probe is a GET; the worker only ever writes its own D1.
 *   No secret leaves the worker: OUTREACH_ADMIN_TOKEN is a Worker secret, used only to
 *     call /status; only the non-secret numbers (paused, dry_run, sentTotal, sent_today,
 *     cap_today) are stored. Every public body is scanned to assert the token never
 *     appears in it (掟: 看板に秘密が出たら事故).
 *   Honest instrument (第二の掟): each probe records the raw http_status and the exact
 *     facts checked, plus measured_at, so the reader re-derives the verdict and can reject
 *     stale data. An unreachable target is recorded UNREACHABLE, never silently green.
 *   Cache-busted (第三の掟): internal fetches use no-store + cf.cacheTtl:0 + a cb param so
 *     a CDN/edge cache cannot hand back an old body.
 */

const CANARY_HASH = "C025E288675EE898";
const SECURITY_TXT_EXPIRES_ISO = "2027-07-26T00:00:00.000Z";

// Public billboards (GET-only). Custom domains are primary; workers.dev also lives.
const TARGETS = [
  { name: "ledger_health", url: "https://ledger.horizonshield.dev/health", core: true },
  { name: "api_catalog", url: "https://ledger.horizonshield.dev/.well-known/api-catalog?format=json", core: true },
  { name: "agent_card", url: "https://ledger.horizonshield.dev/.well-known/agent-card.json", core: true },
  { name: "security_txt", url: "https://ledger.horizonshield.dev/.well-known/security.txt", core: true },
  { name: "llms_txt", url: "https://ledger.horizonshield.dev/llms.txt", core: true },
  { name: "verify_7", url: "https://ledger.horizonshield.dev/verify/7", core: true },
  { name: "verify_19", url: "https://ledger.horizonshield.dev/verify/19", core: true },
];

const OUTREACH_STATUS_URL = "https://hs-outreach.oga-surf-project.workers.dev/status";

async function fetchNoCache(url, extraHeaders) {
  const cb = Date.now().toString();
  const u = url + (url.includes("?") ? "&" : "?") + "cb=" + cb;
  const res = await fetch(u, {
    method: "GET",
    headers: Object.assign(
      { "user-agent": "hs-watchtower/1.0 (+billboard self-probe)" },
      extraHeaders || {}
    ),
    cf: { cacheTtl: 0, cacheEverything: false },
    redirect: "follow",
  });
  const body = await res.text();
  return { status: res.status, body };
}

function tryJson(body) {
  try { return JSON.parse(body); } catch { return null; }
}

// Each checker returns { ok, detail } from { status, body }.
const CHECKERS = {
  ledger_health({ status, body }) {
    const j = tryJson(body);
    const routes = j && Array.isArray(j.routes) ? j.routes : null;
    const discovery = !!(j && j.discovery);
    const transparency = !!(j && j.transparency);
    const privacy = !!(j && j.privacy);
    const scitt = !!(j && j.transparency && String(j.transparency.conformance || "").includes("NOT a conformant SCITT"));
    const ok = status === 200 && !!routes && routes.length === 12 && discovery && transparency && privacy && scitt;
    return { ok, detail: { status, routes: routes ? routes.length : null, discovery, transparency, privacy, scitt } };
  },
  api_catalog({ status, body }) {
    const j = tryJson(body);
    const linkset = !!(j && Array.isArray(j.linkset) && j.linkset.length > 0);
    return { ok: status === 200 && linkset, detail: { status, linkset } };
  },
  agent_card({ status, body }) {
    const j = tryJson(body);
    const skills = !!(j && Array.isArray(j.skills) && j.skills.length > 0);
    const iface = j && Array.isArray(j.supportedInterfaces) && j.supportedInterfaces[0];
    const proto = iface ? (iface.protocolVersion || null) : null;
    return { ok: status === 200 && skills && !!proto, detail: { status, skills: skills ? j.skills.length : 0, protocolVersion: proto } };
  },
  security_txt({ status, body }) {
    const hasContact = /(^|\n)Contact:/i.test(body);
    const m = body.match(/Expires:\s*(\S+)/i);
    let notExpired = false, expires = null;
    if (m) { expires = m[1]; const t = Date.parse(expires); if (!isNaN(t)) notExpired = t > Date.now(); }
    return { ok: status === 200 && hasContact && notExpired, detail: { status, hasContact, expires, notExpired } };
  },
  llms_txt({ status, body }) {
    return { ok: status === 200 && body.length > 0, detail: { status, bytes: body.length } };
  },
  verify_7({ status, body }) {
    const j = tryJson(body);
    const recipe = !!(j && Array.isArray(j.recipe) && j.recipe.length > 0);
    return { ok: status === 200 && recipe, detail: { status, recipe, entry: j ? j.entry : null } };
  },
  verify_19({ status, body }) {
    const j = tryJson(body);
    const recipe = !!(j && Array.isArray(j.recipe) && j.recipe.length > 0);
    return { ok: status === 200 && recipe, detail: { status, recipe, entry: j ? j.entry : null } };
  },
  pdf_canary({ status, body }) {
    const j = tryJson(body);
    const match = !!(j && j.match === true);
    const hashOk = !!(j && j.live_computed_hash === CANARY_HASH && j.canary_expect_hash === CANARY_HASH);
    return { ok: status === 200 && match && hashOk, detail: { status, match, hashOk } };
  },
};

async function probeTarget(t, adminToken) {
  try {
    const r = await fetchNoCache(t.url);
    const checker = CHECKERS[t.name];
    const { ok, detail } = checker ? checker(r) : { ok: r.status === 200, detail: { status: r.status } };
    // Secret-leak guard: no public body may contain the admin token.
    if (adminToken && r.body.includes(adminToken)) {
      return { ok: false, http_status: r.status, detail: Object.assign({}, detail, { SECRET_LEAK: true }) };
    }
    return { ok, http_status: r.status, detail };
  } catch (e) {
    return { ok: false, http_status: 0, detail: { error: String(e && e.message || e), verdict: "UNREACHABLE" } };
  }
}

async function probeOutreach(adminToken) {
  if (!adminToken) {
    return { ok: null, http_status: null, detail: { skipped: "OUTREACH_ADMIN_TOKEN not configured on hs-watchtower" } };
  }
  try {
    // token passed as a query param to /status (never stored, never echoed).
    const r = await fetchNoCache(OUTREACH_STATUS_URL + "?token=" + encodeURIComponent(adminToken));
    const j = tryJson(r.body);
    if (r.status !== 200 || !j) {
      return { ok: false, http_status: r.status, detail: { status: r.status, note: "status not 200 or not JSON" } };
    }
    // Store ONLY non-secret operational numbers.
    const detail = {
      status: r.status,
      paused: j.paused === true,
      dry_run: (j.dry_run === true) || (String(j.dry_run) === "true"),
      sentTotal: typeof j.sentTotal === "number" ? j.sentTotal : null,
      sent_today: typeof j.sent_today === "number" ? j.sent_today : null,
      cap_today: typeof j.cap_today === "number" ? j.cap_today : null,
      bounces: typeof j.bounces === "number" ? j.bounces : null,
    };
    // Health = /status answered. go-live (dry_run=false) is TOshi's call, not a fault.
    return { ok: true, http_status: r.status, detail };
  } catch (e) {
    return { ok: false, http_status: 0, detail: { error: String(e && e.message || e), verdict: "UNREACHABLE" } };
  }
}

async function runProbes(env) {
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const runId = iso.replace(/[:.]/g, "").replace("T", "-").slice(0, 15) + "-" + Math.random().toString(36).slice(2, 8);
  const adminToken = env.OUTREACH_ADMIN_TOKEN || null;

  const rows = [];
  for (const t of TARGETS) {
    const res = await probeTarget(t, adminToken);
    rows.push({ target: t.name, url: t.url, core: t.core, ...res });
  }
  const outreach = await probeOutreach(adminToken);
  rows.push({ target: "outreach_status", url: OUTREACH_STATUS_URL, core: false, ...outreach });

  // Overall verdict: over core targets only. Non-core (outreach) recorded but not fatal.
  const core = rows.filter((r) => r.core);
  const nPass = core.filter((r) => r.ok === true).length;
  const nTotal = core.length;
  const anomalies = rows.filter((r) => r.ok === false).map((r) => ({ target: r.target, http_status: r.http_status, detail: r.detail }));
  let overall = "GREEN";
  if (nPass < nTotal) overall = "RED";
  else if (rows.some((r) => r.core === false && r.ok === false)) overall = "DEGRADED";

  const summary = {
    per_target: rows.reduce((acc, r) => { acc[r.target] = { ok: r.ok, http_status: r.http_status }; return acc; }, {}),
    anomalies,
    outreach: outreach.detail,
  };

  // Persist. Writes are the only mutation and touch only this worker's D1.
  const stmts = [];
  for (const r of rows) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO probes (run_id, measured_at, measured_iso, target, url, http_status, ok, detail) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(runId, now, iso, r.target, r.url, r.http_status, r.ok === true ? 1 : 0, JSON.stringify(r.detail))
    );
  }
  stmts.push(
    env.DB.prepare(
      "INSERT OR REPLACE INTO runs (run_id, measured_at, measured_iso, overall, n_pass, n_total, summary) VALUES (?,?,?,?,?,?,?)"
    ).bind(runId, now, iso, overall, nPass, nTotal, JSON.stringify(summary))
  );
  await env.DB.batch(stmts);

  // Retention: keep last ~30 days of probe rows to bound the DB.
  try {
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    await env.DB.prepare("DELETE FROM probes WHERE measured_at < ?").bind(cutoff).run();
    await env.DB.prepare("DELETE FROM runs WHERE measured_at < ?").bind(cutoff).run();
  } catch (_) { /* retention is best-effort */ }

  return { runId, measured_iso: iso, overall, n_pass: nPass, n_total: nTotal, summary };
}

async function latest(env) {
  const run = await env.DB.prepare(
    "SELECT run_id, measured_at, measured_iso, overall, n_pass, n_total, summary FROM runs ORDER BY measured_at DESC LIMIT 1"
  ).first();
  if (!run) return { ok: false, note: "no runs recorded yet" };
  const ageMs = Date.now() - run.measured_at;
  return {
    ok: true,
    run_id: run.run_id,
    measured_iso: run.measured_iso,
    age_minutes: Math.round(ageMs / 60000),
    stale: ageMs > 90 * 60 * 1000, // guardian should distrust a run older than 90 min
    overall: run.overall,
    n_pass: run.n_pass,
    n_total: run.n_total,
    summary: tryJson(run.summary),
  };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runProbes(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (obj, code) => new Response(JSON.stringify(obj, null, 2), {
      status: code || 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
    if (url.pathname === "/latest") return json(await latest(env));
    if (url.pathname === "/run-now") {
      // Manual trigger for testing. GET-only side effect is writing this worker's own D1.
      if (env.RUN_NOW_TOKEN && url.searchParams.get("token") !== env.RUN_NOW_TOKEN) {
        return json({ ok: false, note: "run-now requires ?token=" }, 403);
      }
      return json(await runProbes(env));
    }
    if (url.pathname === "/health" || url.pathname === "/") {
      return json({ ok: true, service: "hs-watchtower", purpose: "external-vantage billboard self-probe -> D1", read: "/latest" });
    }
    return json({ ok: false, note: "not found", routes: ["/latest", "/health", "/run-now"] }, 404);
  },
};
