// Verification envelope (2026-09-07): the text twin of the badge, on /e/ and at /embed.
// Offline. KV is seeded directly. Run: node test/envelope.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";
import { createHash } from "node:crypto";

const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
function kv() {
  const store = new Map();
  return {
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const FORBIDDEN = /[\u2012\u2013\u2014\u2015\u2212\uFF0D\u2500]/;
const EP = "https://open.redteam.invalid/mcp";
const EP_OLD = "https://old.redteam.invalid/mcp";
const EP_DECL = "https://decl.redteam.invalid/mcp";
const SHA = "ab".repeat(32);
const histKey = (ep) => "hist:" + createHash("sha256").update(ep).digest("hex").slice(0, 16);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");

let fails = 0, n = 0;
const t = (ok, msg, extra) => { n++; console.log((ok ? "ok   " : "FAIL ") + n + ". " + msg + (ok ? "" : ("   " + (extra || "")))); if (!ok) fails++; };

const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "t", GATE_COMMIT: "local" };
await env.HS_VERIFY_KV.put("watch:registry", JSON.stringify({
  [EP]: { tier: "free", requested_by: "test" },
  [EP_OLD]: { tier: "free", requested_by: "test" },
  [EP_DECL]: { tier: "free", requested_by: "test", owner_declined_at: "2026-09-01T00:00:00Z" }
}));
await env.HS_VERIFY_KV.put(histKey(EP), JSON.stringify({ endpoint: EP, entries: [
  { at: "2026-09-06T18:00:00Z", status: "verified", record_sha256: SHA, consent_source: "well_known",
    establishes: ["e one", "e two"], does_not_establish: ["d one", "d two"] }
] }));
await env.HS_VERIFY_KV.put(histKey(EP_OLD), JSON.stringify({ endpoint: EP_OLD, entries: [
  { at: "2026-08-20T18:00:00Z", status: "pending", record_sha256: "cd".repeat(32), consent_source: null }
] }));
const call = (p) => worker.fetch(new Request("https://gate.horizonshield.dev" + p), env, CTX);

// ---- 1. /e/ page carries both twins ------------------------------------------------------------
const r = await call("/e/open.redteam.invalid/mcp");
const html = await r.text();
t(r.status === 200 && /text\/html/.test(r.headers.get("content-type") || ""), "/e/ page answers 200 html", r.status);
const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
t(blocks.length === 2, "two JSON-LD blocks in head (Dataset + envelope)", String(blocks.length));
let envObj = null;
try { envObj = JSON.parse(blocks[1]); } catch (e) { envObj = null; }
t(!!envObj && envObj.additionalType === EXT, "envelope links the conduct-v1 vocabulary", envObj && envObj.additionalType);
t(!!envObj && envObj["@type"] === "CreativeWork", "envelope is a schema.org CreativeWork for crawlers");
t(!!envObj && envObj.identifier && envObj.identifier.propertyID === "sha256" && envObj.identifier.value === SHA, "sha256 rides along as identifier");
t(!!envObj && envObj["conduct:status"] === "verified", "status is the 4-state vocabulary, not the tier word");
t(!!envObj && JSON.stringify(envObj["conduct:does_not_establish"]) === JSON.stringify(["d one", "d two"]), "does_not_establish copied from the latest record");
t(!!envObj && JSON.stringify(envObj["conduct:establishes"]) === JSON.stringify(["e one", "e two"]), "establishes copied from the latest record");
t(!!envObj && /\/spec$/.test(envObj.isBasedOn), "recompute recipe points at /spec");
t(!!envObj && /not a recommendation/.test(envObj.usageInfo), "usageInfo says it is not a recommendation");
const text = strip(html);
t(text.includes(SHA), "visible text carries the sha256 (fetchers that strip script still see it)");
t(/Does not establish/.test(text) && /d one/.test(text) && /d two/.test(text), "visible text carries does_not_establish");
t(/not a score, and not a recommendation/.test(text), "visible text says not a score, not a recommendation");
t(/\/embed\?endpoint=/.test(html), "page links the paste-ready copy at /embed");
t(!FORBIDDEN.test(html), "no forbidden dashes in the page");

// ---- 2. /embed ------------------------------------------------------------------------------------
const e1 = await call("/embed?endpoint=" + encodeURIComponent(EP));
const s1 = await e1.text();
t(e1.status === 200 && /text\/plain/.test(e1.headers.get("content-type") || ""), "/embed answers text/plain", e1.status);
t(/<script type="application\/ld\+json">/.test(s1) && /<section class="env"/.test(s1), "/embed carries both twins");
t(/as of 2026-09-06T18:00:00Z/.test(s1) && /live statement is https:\/\/gate\.horizonshield\.dev\/e\//.test(s1), "/embed names its date and the live page (a copy is a snapshot)");
const e2 = await call("/embed?endpoint=" + encodeURIComponent(EP) + "&format=json");
const j2 = await e2.json();
t(e2.status === 200 && JSON.stringify(j2) === JSON.stringify(envObj), "/embed?format=json equals the block on the page");
const e3 = await call("/embed?endpoint=" + encodeURIComponent("https://nobody.redteam.invalid/mcp"));
t(e3.status === 404, "/embed for an unmeasured endpoint is 404, not an empty envelope", String(e3.status));
t(!FORBIDDEN.test(s1), "no forbidden dashes in the snippet");

// ---- 3. fallback and declined -----------------------------------------------------------------------
const o = await (await call("/embed?endpoint=" + encodeURIComponent(EP_OLD) + "&format=json")).json();
t(Array.isArray(o["conduct:does_not_establish"]) && o["conduct:does_not_establish"].length === 4 && /compensation/.test(o["conduct:does_not_establish"].join(" ")),
  "a pre-0.4.0 entry without arrays still gets a non-empty does_not_establish (fallback), never silence");
t(o["conduct:status"] === "pending" && !("conduct:establishes" in o), "pre-0.4.0 entry: status pending, no invented establishes");
const d = await (await call("/embed?endpoint=" + encodeURIComponent(EP_DECL) + "&format=json")).json();
t(d["conduct:status"] === "declined" && !d.identifier, "owner-declined row: status declined, no sha invented");

// ---- 4. register JSON now exposes the arrays on latest -------------------------------------------------
const reg = await (await call("/register")).json();
const row = (reg.rows || []).find((x) => x.endpoint === EP);
t(!!row && row.latest && JSON.stringify(row.latest.does_not_establish) === JSON.stringify(["d one", "d two"]), "/register row.latest carries does_not_establish (additive field)");

console.log((fails ? "FAILED " + fails + " of " : "passed ") + n);
process.exit(fails ? 1 : 0);
