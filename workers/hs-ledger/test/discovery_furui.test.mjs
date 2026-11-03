// test/discovery_furui.test.mjs
// The ledger's own descriptions name what it serves since 2026-11-02 and 2026-11-03: the admission records, the Résumé's
// admissions[], the content check runner's day record (furui-check-day-v0) and the runner's keys. Checked on the LIVE
// worker (src/worker.js): /health routes, /llms.txt, the api-catalog, the agent card, and the closed route words the
// usage count records (routeLabel, read through a fake Analytics Engine binding). No network.
//
// Run: node test/discovery_furui.test.mjs
import { loadWorker, mockKV } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const ORIGIN = "https://ledger.horizonshield.dev";
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + JSON.stringify(detail).slice(0, 600) : "")); } };
globalThis.fetch = async () => new Response("not found", { status: 404 });

const points = [];
const env = { LEDGER: mockKV([["seq", "0"]]).binding, KANBAN_AE: { writeDataPoint: (d) => points.push(d) } };
async function get(p, headers) {
  const r = await worker.fetch(new Request(ORIGIN + p, { headers: headers || {} }), env, { waitUntil: () => {} });
  return { status: r.status, text: await r.text() };
}

// ---- /health ----
const h = JSON.parse((await get("/health")).text);
for (const r of ["/furui-check-day", "/furui-check-day/{canonical_sha256}", "/.well-known/furui-check-keys.json", "/admission/{canonical_sha256}", "/resume?endpoint={url}"]) {
  t("/health routes name " + r, Array.isArray(h.routes) && h.routes.includes(r), h.routes);
}

// ---- /llms.txt ----
const llms = (await get("/llms.txt")).text;
for (const w of ["furui-check-day-v0", "/.well-known/furui-check-keys.json", "a2a-admission-v0", "admissions[]", "/resume?endpoint=", "furui.horizonshield.dev/furui/day/", "furui-check-day-v0/README.md"]) {
  t("llms.txt names " + w, llms.includes(w));
}
t("llms.txt has no dash characters", !/[\u2012-\u2015]/.test(llms));

// ---- api-catalog ----
const cat = JSON.parse((await get("/.well-known/api-catalog?format=json")).text);
const hrefs = cat.linkset[0].item.map((i) => i.href);
for (const p of ["/resume?endpoint={url}", "/admission/{canonical_sha256}", "/agreement/{canonical_sha256}", "/furui-check-day/{canonical_sha256}", "/.well-known/furui-check-keys.json"]) {
  t("api-catalog links " + p, hrefs.includes(ORIGIN + p), hrefs);
}
t("every api-catalog item keeps href, title and type", cat.linkset[0].item.every((i) => typeof i.href === "string" && typeof i.title === "string" && typeof i.type === "string"));

// ---- agent card ----
const card = JSON.parse((await get("/.well-known/agent-card.json")).text);
t("card version is 1.2.0", card.version === "1.2.0", card.version);
for (const w of ["a2a-admission-v0", "furui-check-day-v0", "admissions[]", "/.well-known/furui-check-keys.json"]) t("card description names " + w, card.description.includes(w));
const ad = card.additionalDiscovery || {};
t("card additionalDiscovery points at the Résumé, the admission, the day record and the keys",
  ad.resume === ORIGIN + "/resume?endpoint={url}" && ad.admission === ORIGIN + "/admission/{canonical_sha256}"
  && ad.furuiCheckDay === ORIGIN + "/furui-check-day/{canonical_sha256}" && ad.furuiCheckKeys === ORIGIN + "/.well-known/furui-check-keys.json", ad);
t("card still has one skill (the /a2a citation skill) and the 8 required fields",
  card.skills.length === 1 && card.skills[0].id === "cite-and-verify"
  && ["name", "description", "version", "capabilities", "supportedInterfaces", "defaultInputModes", "defaultOutputModes", "skills"].every((k) => k in card));

// ---- the closed route words of the usage count ----
const sha = "ab".repeat(32);
const want = [
  ["/furui-check-day", "furui-day"], ["/furui-check-day/" + sha, "furui-day"], ["/.well-known/furui-check-keys.json", "furui-keys"],
  ["/admission", "admission"], ["/admission/" + sha, "admission"], ["/revocation/" + sha, "revocation"],
  ["/agreement", "agreement"], ["/agreement/" + sha, "agreement"],
  ["/furui-check-day/nothex", "other"], ["/agreement/pending", "other"], ["/health", "health"],
];
for (const [p, w] of want) {
  points.length = 0;
  await get(p);
  const got = points.length ? points[0].indexes[0] : null;
  t("route word for " + (p.length > 40 ? p.slice(0, 36) + "..." : p) + " is " + w, got === w, got);
  t("no sha recorded for " + (p.length > 40 ? p.slice(0, 36) + "..." : p), points.every((d) => !JSON.stringify(d).includes(sha)));
}

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (the ledger's descriptions of admissions and the day record)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (the ledger's descriptions of admissions and the day record)");
