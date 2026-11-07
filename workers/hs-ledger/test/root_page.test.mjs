// test/root_page.test.mjs
// GET / for browsers and crawlers (2026-11-07): a request whose Accept header prefers text/html gets the root's JSON as
// a small HTML page with a title; every other request gets the JSON bytes it got before. Both carry Vary: Accept.
// The JSON of / is the same object as /health, which this change does not touch, so /health's bytes are the reference.
// Offline. Run: node test/root_page.test.mjs

import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger root page");
const B = "https://ledger.horizonshield.dev";
const env = { LEDGER: mockKV([]).binding };
const get = async (path, accept, method = "GET") => {
  const headers = accept === undefined ? {} : { accept };
  const r = await worker.fetch(new Request(B + path, { method, headers }), env, { waitUntil() {} });
  return { s: r.status, ct: r.headers.get("content-type") || "", vary: r.headers.get("vary"), cors: r.headers.get("access-control-allow-origin"), body: await r.text() };
};

const ref = await get("/health");
chk("/health answers JSON (the reference bytes)", ref.s === 200 && ref.ct.startsWith("application/json") && JSON.parse(ref.body).service === "hs-ledger", ref.ct);
chk("/health has no Vary (not touched)", ref.vary === null, String(ref.vary));

const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const BINGBOT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const JSON_CASES = [
  ["no Accept", undefined],
  ["*/*", "*/*"],
  ["application/json", "application/json"],
  ["application/json, text/html (json first)", "application/json, text/html"],
  ["application/json;q=0.5, text/html (json first, lower q)", "application/json;q=0.5, text/html"],
  ["text/html;q=0.5, application/json (json higher q)", "text/html;q=0.5, application/json"],
  ["text/html;q=0, */* (html refused)", "text/html;q=0, */*"],
  ["text/html;q=abc (unreadable q)", "text/html;q=abc"],
  ["text/* (wildcard only)", "text/*"],
  ["application/json, */* (MCP and fetch clients)", "application/json, text/event-stream, */*"],
  ["empty Accept", ""],
];
for (const [label, acc] of JSON_CASES) {
  const r = await get("/", acc);
  chk("GET / with " + label + " -> JSON byte for byte as /health", r.s === 200 && r.ct === ref.ct && r.body === ref.body, r.ct + " " + r.body.slice(0, 40));
  chk("GET / with " + label + " -> Vary: Accept", r.vary === "Accept", String(r.vary));
}
const fj = await get("/?format=json", BROWSER);
chk("GET /?format=json with a browser's Accept -> JSON byte for byte", fj.s === 200 && fj.ct === ref.ct && fj.body === ref.body && fj.vary === "Accept", fj.ct);

const HTML_CASES = [
  ["a browser's Accept", BROWSER],
  ["Bingbot's Accept", BINGBOT],
  ["text/html", "text/html"],
  ["text/html, application/json (html first)", "text/html, application/json"],
  ["TEXT/HTML;charset=utf-8, application/json;q=0.9", "TEXT/HTML;charset=utf-8, application/json;q=0.9"],
  ["application/json;q=0, text/html (json refused)", "application/json;q=0, text/html"],
];
for (const [label, acc] of HTML_CASES) {
  const r = await get("/", acc);
  const title = (/<title>([^<]+)<\/title>/.exec(r.body) || [])[1] || "";
  chk("GET / with " + label + " -> 200 text/html with a title", r.s === 200 && r.ct === "text/html; charset=utf-8" && title.length > 10, r.ct + " " + title);
  chk("GET / with " + label + " -> Vary: Accept, CORS kept", r.vary === "Accept" && r.cors === "*", String(r.vary));
}
const page = (await get("/", BROWSER)).body;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
chk("the page shows the JSON itself", page.includes("<pre>" + esc(ref.body) + "</pre>"));
chk("the page links to the JSON", page.includes('href="/?format=json"') && page.includes('rel="alternate" type="application/json"'));
chk("the page is not noindex", !/noindex/i.test(page));
const head = await get("/", BROWSER, "HEAD");
chk("HEAD / with a browser's Accept -> 200 text/html, no body", head.s === 200 && head.ct.startsWith("text/html") && head.body === "" && head.vary === "Accept", head.ct);
const post = await worker.fetch(new Request(B + "/", { method: "POST", headers: { accept: BROWSER } }), env, { waitUntil() {} });
chk("POST / is not turned into a page", (post.headers.get("content-type") || "").startsWith("application/json") && post.headers.get("vary") === null, post.headers.get("content-type"));
const other = await get("/ledger/head", BROWSER);
chk("another path is not touched by the root page", !/<title>hs-ledger: JIDEC public ledger/.test(other.body));

process.exit(chk.done() ? 1 : 0);
