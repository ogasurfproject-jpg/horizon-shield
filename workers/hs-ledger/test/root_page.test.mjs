// test/root_page.test.mjs
// GET / for browsers and crawlers (2026-11-07): a request whose Accept header prefers text/html gets the root's JSON as
// a small HTML page with a title; every other request gets the JSON bytes it got before.
// 2026-11-13: a request whose Accept names none of text/html, a JSON type or text/event-stream also gets the page when
// its User-Agent is a browser's or a crawler's and it is not a script's fetch (Bing's crawler does not always ask for
// text/html). Both answers carry Vary: Accept, User-Agent, Sec-Fetch-Mode.
// The JSON of / is the same object as /health, which this change does not touch, so /health's bytes are the reference.
// Offline. Run: node test/root_page.test.mjs

import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger root page");
const B = "https://ledger.horizonshield.dev";
const env = { LEDGER: mockKV([]).binding };
const VARY = "Accept, User-Agent, Sec-Fetch-Mode";
const get = async (path, accept, method = "GET", more = {}) => {
  const headers = accept === undefined ? { ...more } : { accept, ...more };
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
  chk("GET / with " + label + " -> Vary: " + VARY, r.vary === VARY, String(r.vary));
}
const fj = await get("/?format=json", BROWSER);
chk("GET /?format=json with a browser's Accept -> JSON byte for byte", fj.s === 200 && fj.ct === ref.ct && fj.body === ref.body && fj.vary === VARY, fj.ct);

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
  chk("GET / with " + label + " -> Vary: " + VARY + ", CORS kept", r.vary === VARY && r.cors === "*", String(r.vary));
}
const page = (await get("/", BROWSER)).body;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
chk("the page shows the JSON itself", page.includes("<pre>" + esc(ref.body) + "</pre>"));
chk("the page links to the JSON", page.includes('href="/?format=json"') && page.includes('rel="alternate" type="application/json"'));
chk("the page is not noindex", !/noindex/i.test(page));
const head = await get("/", BROWSER, "HEAD");
chk("HEAD / with a browser's Accept -> 200 text/html, no body", head.s === 200 && head.ct.startsWith("text/html") && head.body === "" && head.vary === VARY, head.ct);
const post = await worker.fetch(new Request(B + "/", { method: "POST", headers: { accept: BROWSER } }), env, { waitUntil() {} });
chk("POST / is not turned into a page", (post.headers.get("content-type") || "").startsWith("application/json") && post.headers.get("vary") === null, post.headers.get("content-type"));
const other = await get("/ledger/head", BROWSER);
chk("another path is not touched by the root page", !/<title>hs-ledger: JIDEC public ledger/.test(other.body));

// 2026-11-13: the page for a browser or a crawler that does not ask for text/html.
const BING_NEW = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36";
const CRAWLERS = [
  ["bingbot (Chrome form)", BING_NEW],
  ["bingbot (short form)", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
  ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["DuckDuckBot (no Mozilla)", "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)"],
  ["BingPreview", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0 Safari/537.36 BingPreview/1.0b"],
  ["a browser", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"],
  ["MOZILLA in capitals", "MOZILLA/5.0 (compatible; SomeCrawler/1.0)"],
];
const OPEN_ACCEPTS = [["no Accept", undefined], ["an empty Accept", ""], ["*/*", "*/*"], ["text/*", "text/*"], ["image/*, */*;q=0.5", "image/*, */*;q=0.5"]];
let pages = 0, pagesWant = 0;
for (const [, ua] of CRAWLERS) for (const [, acc] of OPEN_ACCEPTS) {
  pagesWant++;
  const r = await get("/", acc, "GET", { "user-agent": ua });
  if (r.s === 200 && r.ct === "text/html; charset=utf-8" && /<title>[^<]{10,}<\/title>/.test(r.body) && r.vary === VARY && r.cors === "*") pages++;
}
chk("a browser's or a crawler's User-Agent with no Accept, an empty one, */*, text/* or image/* -> the page (" + pagesWant + " requests)", pages === pagesWant && pagesWant === 35, pages + "/" + pagesWant);
const MACHINES = [["no User-Agent", undefined], ["an empty User-Agent", ""], ["curl", "curl/8.7.1"], ["python-requests", "python-requests/2.32.3"], ["Python-urllib", "Python-urllib/3.13"], ["node", "node"], ["undici", "undici"], ["Go", "Go-http-client/2.0"], ["axios", "axios/1.7.7"], ["nenrin-verify", "nenrin-verify/0.6.0"], ["nenrin sync", "nenrin-localheaders-sync/1 (+https://ledger.horizonshield.dev)"], ["okhttp", "okhttp/4.12.0"], ["Wget", "Wget/1.21.4"], ["tooshi", "tooshi-daily/1"], ["PowerShell 7", "Mozilla/5.0 (Macintosh; Darwin 25.3.0; en-US) PowerShell/7.4.6"], ["Boto3", "Boto3/1.35.10 md/Botocore#1.35.10 ua/2.0 os/macos#25.3.0 lang/python#3.12.7"], ["UptimeRobot", "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)"], ["robotics in a python-requests UA", "python-requests/2.32.3 robotics-lab"]];
let same = 0, sameWant = 0;
for (const [, ua] of MACHINES) for (const [, acc] of OPEN_ACCEPTS) {
  sameWant++;
  const r = await get("/", acc, "GET", ua === undefined ? {} : { "user-agent": ua });
  if (r.s === 200 && r.ct === ref.ct && r.body === ref.body && r.vary === VARY) same++;
}
chk("a program's User-Agent (curl, Python, Node, Go, our own clients) or none -> the JSON byte for byte (" + sameWant + " requests)", same === sameWant && sameWant === 90, same + "/" + sameWant);
const NAMED = [
  ["application/json", "application/json"],
  ["application/json, text/event-stream, */* (MCP)", "application/json, text/event-stream, */*"],
  ["text/event-stream", "text/event-stream"],
  ["application/ld+json, */*", "application/ld+json, */*"],
  ["APPLICATION/JSON;q=0.1, */*", "APPLICATION/JSON;q=0.1, */*"],
  ["application/json, text/html (json first)", "application/json, text/html"],
  ["text/html;q=0, */* (html refused)", "text/html;q=0, */*"],
  ["text/html;q=abc (unreadable q)", "text/html;q=abc"],
  ["text/html;q=0.5, application/json", "text/html;q=0.5, application/json"],
];
let named = 0;
for (const [, acc] of NAMED) for (const ua of [BING_NEW, CRAWLERS[5][1]]) {
  const r = await get("/", acc, "GET", { "user-agent": ua });
  if (r.s === 200 && r.ct === ref.ct && r.body === ref.body && r.vary === VARY) named++;
}
chk("bingbot or a browser that names JSON, an event stream, or text/html in a way that did not win before -> the JSON, as before (" + NAMED.length * 2 + " requests)", named === NAMED.length * 2, String(named));
let scripts = 0;
for (const mode of ["cors", "same-origin", "no-cors", "websocket", "CORS"]) for (const acc of [undefined, "*/*"]) {
  const r = await get("/", acc, "GET", { "user-agent": CRAWLERS[5][1], "sec-fetch-mode": mode });
  if (r.s === 200 && r.ct === ref.ct && r.body === ref.body && r.vary === VARY) scripts++;
}
chk("a script's fetch in a browser (Sec-Fetch-Mode cors, same-origin, no-cors, websocket) with */* -> the JSON (10 requests)", scripts === 10, String(scripts));
let navs = 0;
for (const mode of ["navigate", "NAVIGATE", " navigate "]) {
  const r = await get("/", "*/*", "GET", { "user-agent": CRAWLERS[5][1], "sec-fetch-mode": mode });
  if (r.s === 200 && r.ct === "text/html; charset=utf-8" && r.vary === VARY) navs++;
}
chk("Sec-Fetch-Mode: navigate with */* -> the page", navs === 3, String(navs));
const corsHtml = await get("/", BROWSER, "GET", { "user-agent": CRAWLERS[5][1], "sec-fetch-mode": "cors" });
chk("an Accept that prefers text/html still wins over Sec-Fetch-Mode: cors (the rule of 2026-11-07 is not narrowed)", corsHtml.ct === "text/html; charset=utf-8");
const fjBot = await get("/?format=json", "*/*", "GET", { "user-agent": BING_NEW });
chk("GET /?format=json from bingbot with */* -> the JSON byte for byte", fjBot.s === 200 && fjBot.ct === ref.ct && fjBot.body === ref.body && fjBot.vary === VARY, fjBot.ct);
const headBot = await get("/", "*/*", "HEAD", { "user-agent": BING_NEW });
chk("HEAD / from bingbot with */* -> 200 text/html, no body", headBot.s === 200 && headBot.ct.startsWith("text/html") && headBot.body === "" && headBot.vary === VARY, headBot.ct);
const postBot = await worker.fetch(new Request(B + "/", { method: "POST", headers: { accept: "*/*", "user-agent": BING_NEW } }), env, { waitUntil() {} });
chk("POST / from bingbot is not turned into a page", (postBot.headers.get("content-type") || "").startsWith("application/json") && postBot.headers.get("vary") === null, postBot.headers.get("content-type"));
const otherBot = await get("/health", "*/*", "GET", { "user-agent": BING_NEW });
chk("/health from bingbot with */* is not touched", otherBot.ct === ref.ct && otherBot.body === ref.body && otherBot.vary === null, String(otherBot.vary));
const botPage = (await get("/", "*/*", "GET", { "user-agent": BING_NEW })).body;
chk("the page bingbot gets is the page a browser gets, byte for byte", botPage === page);
const desc = (/<meta name="description" content="([^"]*)">/.exec(page) || [])[1] || "";
chk("the meta description is 25 to 160 characters (Bing: too long or too short)", desc.length >= 25 && desc.length <= 160, String(desc.length));
// 2026-11-13: Bing counts a title of more than 70 characters as Title too long.
const ttl = (/<title>([^<]*)<\/title>/.exec(page) || [])[1] || "";
chk("the title is 10 to 69 characters and starts with hs-ledger: JIDEC public ledger (Bing: Title too long)", [...ttl].length >= 10 && [...ttl].length <= 69 && ttl.startsWith("hs-ledger: JIDEC public ledger"), String([...ttl].length));
chk("the page has one h1 and a lang", (page.match(/<h1>/g) || []).length === 1 && /<html lang="[a-z]{2}">/.test(page));

process.exit(chk.done() ? 1 : 0);
