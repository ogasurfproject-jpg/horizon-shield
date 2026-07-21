var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.js
var SOURCE = "HORIZON SHIELD souba-db (\u5927\u8CC0\u4FCA\u52DD \u5B9F\u52D9\u76E3\u4FEE)";
var SUBMIT_URL = "https://shield.the-horizons-innovation.com/hacker/submit/";
var BOARD_URL = "https://shield.the-horizons-innovation.com/ehn/";
var PUBLISHER = "The HORIZ\u97F3s\u682A\u5F0F\u4F1A\u793E";
var SITE = "https://shield.the-horizons-innovation.com";
var CATALOG = [
  { slug: "gaiheki-toso-30tsubo", work: "\u5916\u58C1\u5857\u88C5 30\u576A \u4E00\u5F0F\uFF08\u30B7\u30EA\u30B3\u30F3\uFF09", min: 7e5, avg: 9e5, max: 115e4, danger: 15e5, trend: "up", trendVal: "+1.8%", note: "\u8DB3\u5834\u30FB\u990A\u751F\u30FB3\u56DE\u5857\u308A\u30FB\u4ED8\u5E2F\u5857\u88C5\u8FBC\u307F\u3002" },
  { slug: "unit-bath-1616", work: "\u30E6\u30CB\u30C3\u30C8\u30D0\u30B9\u4EA4\u63DB \u30DF\u30C9\u30EB\uFF081616 1\u576A\uFF09", min: 9e5, avg: 12e5, max: 15e5, danger: 21e5, trend: "up", trendVal: "+2.2%", note: "1616\u30B5\u30A4\u30BA1\u576A\u30BF\u30A4\u30D7\u3002\u65AD\u71B1\u6D74\u69FD\u30FB\u4FDD\u6E29\u5E8A\u30FB\u6D74\u5BA4\u4E7E\u71E5\u6A5F\u8FBC\u307F\u3002" },
  { slug: "yane-cover-galvalume", work: "\u5C4B\u6839\u30AB\u30D0\u30FC\u5DE5\u6CD5 30\u576A\uFF08\u30AC\u30EB\u30D0\u30EA\u30A6\u30E0\uFF09", min: 7e5, avg: 11e5, max: 15e5, danger: 2e6, trend: "up", trendVal: "+3.8%", note: "\u65E2\u5B58\u30B9\u30EC\u30FC\u30C8\u4E0A\u306B\u9AD8\u8010\u5019\u30EB\u30FC\u30D5\u30A3\u30F3\u30B0\u6577\u8A2D+\u30AC\u30EB\u30D0\u91CD\u306D\u847A\u304D\u3002\u5DE5\u671F1\u9031\u9593\u3002" },
  { slug: "kyutoki-24go", work: "\u7D66\u6E6F\u5668\u4EA4\u63DB 24\u53F7", min: 18e4, avg: 27e4, max: 38e4, danger: 55e4, trend: "flat", trendVal: "\xB10%", note: "4\u4EBA\u4EE5\u4E0A\u306E\u5BB6\u5EAD\u5411\u3051\u3002\u672C\u4F5318\u301C38\u4E07+\u5DE5\u4E8B\u8CBB\u8FBC\u307F\u3002" },
  { slug: "cloth-6jo", work: "\u30AF\u30ED\u30B9\u5F35\u308A\u66FF\u3048 6\u7573\uFF08\u5168\u58C1\uFF0B\u5929\u4E95\uFF09", min: 45e3, avg: 6e4, max: 8e4, danger: 13e4, trend: "flat", trendVal: "\xB10%", note: "\u91CF\u7523\u30AF\u30ED\u30B9\u30FB6\u7573=\u7D0440\u33A1\uFF08\u58C1\uFF0B\u5929\u4E95\uFF09\u30021\u65E5\u5DE5\u4E8B\u3002" },
  { slug: "toilet-tankless", work: "\u30C8\u30A4\u30EC\u4EA4\u63DB \u30BF\u30F3\u30AF\u30EC\u30B9", min: 2e5, avg: 28e4, max: 4e5, danger: 6e5, trend: "flat", trendVal: "\xB10%", note: "\u30BF\u30F3\u30AF\u30EC\u30B9\u4FBF\u5668+\u624B\u6D17\u5668\u5225\u8A2D\u7F6E\u3002\u6C34\u5727\u78BA\u8A8D\u5FC5\u9808\u3002" }
];
var PRINCIPLES = [
  "\u898B\u7A4D\u3082\u308A\u304C\u9069\u6B63\u304B\u306F\u3001\u76F8\u898B\u7A4D\u3082\u308A\u306E\u793E\u6570\u3088\u308A\u7DCF\u984D\u306B\u5360\u3081\u308B\u8AF8\u7D4C\u8CBB\uFF08\u73FE\u5834\u7BA1\u7406\u8CBB\u30FB\u4E00\u822C\u7BA1\u7406\u8CBB\uFF09\u306E\u6BD4\u7387\u3092\u898B\u308B\u3002",
  "\u8AF8\u7D4C\u8CBB\u306E\u76EE\u5B89\u306F\u7DCF\u984D\u306E10\u301C16%\u300220%\u3092\u8D85\u3048\u305F\u3089\u5185\u8A33\u306E\u63D0\u51FA\u3092\u6C42\u3081\u308B\u6839\u62E0\u306B\u306A\u308B\u3002",
  "\u300C\u4E00\u5F0F\u300D\u8868\u8A18\u306F\u5185\u8A33\u304C\u4E0D\u660E\u306A\u305F\u3081\u904E\u5270\u304C\u7D1B\u308C\u3084\u3059\u3044\u3002\u3053\u306E\u4E00\u5F0F\u306E\u5185\u8A33\u3092\u51FA\u3057\u3066\u3082\u3089\u3048\u308B\u304B\u3067\u6700\u7D42\u91D1\u984D\u304C\u5909\u308F\u308B\u3002",
  "\u7DCA\u6025\u6027\u3092\u717D\u308B\u55B6\u696D\uFF08\u4ECA\u65E5\u5951\u7D04\u3059\u308C\u3070\u5024\u5F15\u304D\u7B49\uFF09\u306F\u5224\u65AD\u6750\u6599\u3092\u596A\u3046\u5178\u578B\u3002\u5373\u6C7A\u3092\u8FEB\u3089\u308C\u305F\u3089\u4E00\u65E6\u6301\u3061\u5E30\u308B\u3002",
  "\u696D\u8005\u306F\u6280\u8853\u3068\u8AA0\u5B9F\u3055\u3067\u9078\u3076\u3002\u55B6\u696D\u306E\u3046\u307E\u3055\u3067\u9078\u3070\u306A\u3044\u3002"
];
var yen = /* @__PURE__ */ __name((n) => Number(n).toLocaleString("ja-JP"), "yen");
var esc = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), "esc");
function trendStr(t, v) {
  const w = t === "up" ? "\u4E0A\u6607" : t === "down" ? "\u4E0B\u843D" : "\u6A2A\u3070\u3044";
  return w + (v ? " (" + v + ")" : "");
}
__name(trendStr, "trendStr");
function buildPage(item, indexed) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const title = item.work + "\u306E\u76F8\u5834\u306F?\u9069\u6B63\u4FA1\u683C\u3068\u9AD8\u3044\u898B\u7A4D\u3082\u308A\u306E\u898B\u5206\u3051\u65B9";
  const directAnswer = item.work + "\u306E\u9069\u6B63\u76F8\u5834\u306F" + yen(item.min) + "\u5186\u304B\u3089" + yen(item.max) + "\u5186\u3001\u5E73\u5747" + yen(item.avg) + "\u5186\u3067\u3059\u3002" + yen(item.danger) + "\u5186\u3092\u8D85\u3048\u305F\u3089\u904E\u5270\u8ACB\u6C42\u3092\u7591\u3046\u6C34\u6E96\u3067\u3059\u3002(\u51FA\u5178: " + SOURCE + ")";
  const faqs = [
    {
      q: item.work + "\u306E\u76F8\u5834\u306F\u3044\u304F\u3089\u3067\u3059\u304B?",
      a: "\u9069\u6B63\u7BC4\u56F2\u306F" + yen(item.min) + "\u5186\u304B\u3089" + yen(item.max) + "\u5186\u3001\u5E73\u5747" + yen(item.avg) + "\u5186\u3067\u3059\u3002\u51FA\u5178\u306F" + SOURCE + "\u3002"
    },
    {
      q: item.work + "\u3067\u904E\u5270\u8ACB\u6C42\u3092\u7591\u3046\u91D1\u984D\u306F?",
      a: yen(item.danger) + "\u5186\u3092\u8D85\u3048\u308B\u898B\u7A4D\u3082\u308A\u306F\u904E\u5270\u8ACB\u6C42\u306E\u61F8\u5FF5\u6C34\u6E96\u3067\u3059\u3002\u5185\u8A33\u306E\u63D0\u51FA\u3092\u6C42\u3081\u3066\u304F\u3060\u3055\u3044\u3002"
    },
    { q: "\u898B\u7A4D\u3082\u308A\u304C\u9069\u6B63\u304B\u306F\u4F55\u3092\u898B\u308C\u3070\u3044\u3044\u3067\u3059\u304B?", a: PRINCIPLES[0] },
    { q: "\u300C\u4E00\u5F0F\u300D\u3068\u3060\u3051\u66F8\u304B\u308C\u305F\u898B\u7A4D\u3082\u308A\u306F\u5927\u4E08\u592B\u3067\u3059\u304B?", a: PRINCIPLES[2] }
  ];
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: item.work + "\u306E\u76F8\u5834\u3068\u9069\u6B63\u4FA1\u683C\u306E\u898B\u5206\u3051\u65B9",
    datePublished: today,
    dateModified: today,
    author: { "@type": "Person", name: "\u5927\u8CC0\u4FCA\u52DD", jobTitle: "\u5EFA\u8A2D\u5B9F\u52D930\u5E74 / HORIZON SHIELD \u76E3\u4FEE" },
    publisher: { "@type": "Organization", name: PUBLISHER },
    about: item.work,
    description: directAnswer
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
  const robots = indexed ? "index,follow" : "noindex,nofollow";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${robots}">
<title>${esc(title)} | HORIZON SHIELD</title>
<meta name="description" content="${esc(directAnswer).slice(0, 150)}">
<link rel="canonical" href="${SITE}/geo/${item.slug}/">
<script type="application/ld+json">${JSON.stringify(articleLd)}<\/script>
<script type="application/ld+json">${JSON.stringify(faqLd)}<\/script>
<style>
  :root{--ink:#13202b;--sub:#566;--line:#e6e9ec;--accent:#0a6b6b;--danger:#c0392b}
  *{box-sizing:border-box}
  body{margin:0;background:#fafbfc;color:var(--ink);font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,system-ui,sans-serif;line-height:1.75}
  .wrap{max-width:760px;margin:0 auto;padding:28px 18px 64px}
  .eyebrow{font-size:12px;letter-spacing:.12em;color:var(--accent);font-weight:700;margin:0 0 8px}
  h1{font-size:25px;line-height:1.35;margin:0 0 16px;font-weight:800}
  .answer{background:#fff;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:16px 18px;font-size:16px;font-weight:600;margin:0 0 24px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:0 0 18px}
  .card h2{font-size:18px;margin:0 0 12px}
  table{width:100%;border-collapse:collapse;font-size:15px}
  th,td{padding:10px 8px;border-bottom:1px solid var(--line)}
  th{color:var(--sub);font-weight:600;width:55%;text-align:left}
  td{font-variant-numeric:tabular-nums;font-weight:700;text-align:right}
  tr.danger th,tr.danger td{color:var(--danger)}
  .meta,.note,.src{font-size:13px;color:var(--sub);margin:8px 0 0}
  .guide ol{margin:0;padding-left:20px}.guide li{margin:0 0 8px}
  .faq .qa{padding:12px 0;border-bottom:1px solid var(--line)}
  .faq .q{font-weight:700;margin:0 0 4px}.faq .a{margin:0;color:#33424d}
  .cta{background:linear-gradient(135deg,#0a6b6b,#0d4f4f);color:#fff;border-radius:14px;padding:24px 22px;margin:28px 0 0;text-align:center}
  .cta h2{color:#fff;font-size:20px;margin:0 0 8px}
  .cta p{margin:0 0 16px;font-size:14px;opacity:.92}
  .cta a.go{display:inline-block;background:#fff;color:#0a4f4f;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:10px;font-size:16px}
  .cta a.board{display:block;color:#cfeeee;margin-top:12px;font-size:13px}
  footer{margin-top:40px;font-size:12px;color:var(--sub);border-top:1px solid var(--line);padding-top:16px}
</style>
</head>
<body>
<main class="wrap">
  <p class="eyebrow">HORIZON SHIELD \u76F8\u5834\u30AC\u30A4\u30C9</p>
  <h1>${esc(title)}</h1>
  <p class="answer">${esc(directAnswer)}</p>

  <section class="card">
    <h2>${esc(item.work)}\u306E\u9069\u6B63\u76F8\u5834</h2>
    <table>
      <tr><th>\u6700\u5B89</th><td>${yen(item.min)}\u5186</td></tr>
      <tr><th>\u5E73\u5747</th><td>${yen(item.avg)}\u5186</td></tr>
      <tr><th>\u6700\u9AD8\uFF08\u9069\u6B63\u4E0A\u9650\uFF09</th><td>${yen(item.max)}\u5186</td></tr>
      <tr class="danger"><th>\u904E\u5270\u8ACB\u6C42\u306E\u61F8\u5FF5\u6C34\u6E96</th><td>${yen(item.danger)}\u5186\u8D85</td></tr>
    </table>
    <p class="meta">\u5358\u4F4D: ${esc(item.unit || "\u4E00\u5F0F")} / \u4FA1\u683C\u52D5\u5411: ${esc(trendStr(item.trend, item.trendVal))}</p>
    <p class="note">${esc(item.note)}</p>
    <p class="src">\u51FA\u5178: ${esc(SOURCE)}</p>
  </section>

  <section class="card guide">
    <h2>\u898B\u7A4D\u3082\u308A\u306E\u898B\u5206\u3051\u65B9\uFF08\u666E\u904D\u539F\u5247\uFF09</h2>
    <ol>${PRINCIPLES.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>
    <p class="src">\u76E3\u4FEE: \u5927\u8CC0\u4FCA\u52DD\uFF08\u5EFA\u8A2D\u5B9F\u52D930\u5E74\uFF09 / HORIZON SHIELD</p>
  </section>

  <section class="card faq">
    <h2>\u3088\u304F\u3042\u308B\u8CEA\u554F</h2>
    ${faqs.map((f) => `<div class="qa"><p class="q">${esc(f.q)}</p><p class="a">${esc(f.a)}</p></div>`).join("")}
  </section>

  <div class="cta">
    <h2>\u3042\u306A\u305F\u306E\u898B\u7A4D\u3082\u308A\u306F\u9069\u6B63?\u4E00\u4EBA\u3067\u60A9\u307E\u306A\u3044</h2>
    <p>\u305D\u306E\u898B\u7A4D\u3082\u308A\u3001EHN\u306B\u8CBC\u308C\u3070KIRA\u304C\u533F\u540D\u3067\u89E3\u6790\u3057\u3001\u904E\u53BB\u306E\u5B9F\u4F8B\u3068\u4E26\u3079\u3066\u7B2C\u4E09\u8005\u306E\u76EE\u304C\u5165\u308A\u307E\u3059\u3002<br>\u696D\u8005\u540D\u30FB\u65BD\u4E3B\u540D\u30FB\u96FB\u8A71\u30FB\u4F4F\u6240\u306F\u63B2\u8F09\u524D\u306B\u904B\u55B6\u304C\u5FC5\u305A\u4F0F\u305B\u307E\u3059\u3002</p>
    <a class="go" href="${SUBMIT_URL}">\u898B\u7A4D\u3082\u308A\u3092\u533F\u540D\u3067\u8CBC\u308B\uFF08\u7121\u6599\uFF09</a>
    <a class="board" href="${BOARD_URL}">\u904E\u53BB\u306E\u5B9F\u4F8B\u3092\u898B\u308B</a>
  </div>

  <footer>
    \u51FA\u5178\u30FB\u76E3\u4FEE: \u5927\u8CC0\u4FCA\u52DD\uFF08\u5EFA\u8A2D\u5B9F\u52D930\u5E74\uFF09 / ${PUBLISHER} HORIZON SHIELD souba-db<br>
    \u6700\u7D42\u66F4\u65B0: ${today} / \u672C\u30DA\u30FC\u30B8\u306E\u76F8\u5834\u306FHORIZON SHIELD KIRA\u306E\u76F8\u5834\u30C7\u30FC\u30BF\u306B\u57FA\u3065\u304D\u307E\u3059\u3002
  </footer>
</main>
</body>
</html>`;
}
__name(buildPage, "buildPage");
async function linePush(env, text) {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) {
    return { ok: false, reason: "LINE_CHANNEL_TOKEN \u307E\u305F\u306F LINE_USER_ID \u672A\u8A2D\u5B9A" };
  }
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.LINE_CHANNEL_TOKEN
      },
      body: JSON.stringify({
        to: env.LINE_USER_ID,
        messages: [{ type: "text", text: text.slice(0, 4900) }]
      })
    });
    return { ok: r.status === 200, status: r.status };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
__name(linePush, "linePush");
async function getIndex(env) {
  const raw = await env.GEO_KV.get("index:list");
  return raw ? JSON.parse(raw) : [];
}
__name(getIndex, "getIndex");
async function putIndex(env, list) {
  await env.GEO_KV.put("index:list", JSON.stringify(list));
}
__name(putIndex, "putIndex");
function adminOk(req, env) {
  if (!env.ADMIN_KEY) return false;
  const k = req.headers.get("X-Admin-Key") || new URL(req.url).searchParams.get("k");
  return k === env.ADMIN_KEY;
}
__name(adminOk, "adminOk");
var json = /* @__PURE__ */ __name((o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { "Content-Type": "application/json; charset=utf-8" }
}), "json");
function controlPanel() {
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>GEO\u55B6\u696D\u30DE\u30F3\u88FD\u9020\u6A5F</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#0e1620;color:#dfe7ee;font-family:"Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,system-ui,sans-serif;line-height:1.6;padding:22px 16px 48px}
  .tag{font-size:11px;letter-spacing:.18em;color:#f2a900;font-weight:700}
  h1{font-size:20px;margin:4px 0 6px}
  .lead{font-size:12px;color:#8aa0b2;margin:0 0 20px}
  .tap{width:100%;background:#f2a900;color:#1a1205;border:none;font-weight:800;font-size:18px;padding:20px;border-radius:14px;cursor:pointer;letter-spacing:.03em}
  .tap:active{transform:scale(.99)}
  .tap:disabled{opacity:.5}
  .msg{margin:16px 0;font-size:14px;padding:12px 14px;border-radius:10px;white-space:pre-wrap}
  .msg.ok{background:#13261c;border:1px solid #1e5e3a;color:#9fe3bf}
  .msg.ng{background:#2a1414;border:1px solid #5e2626;color:#ffb4a8}
  .list{margin-top:22px}
  .row{background:#152230;border:1px solid #24323f;border-radius:10px;padding:12px 14px;margin-bottom:10px}
  .row .w{font-size:14px;font-weight:700}
  .row .u{font-size:12px;color:#8aa0b2;word-break:break-all;margin:4px 0}
  .row .b{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
  .pill{font-size:11px;font-weight:700;padding:2px 9px;border-radius:6px}
  .pill.live{background:#24323f;color:#9fb3c4}
  .pill.idx{background:#1e8449;color:#fff}
  a.open{color:#7fd6d6;font-size:12px;text-decoration:none}
  button.promote{background:transparent;border:1px solid #2a3a48;color:#cfe0ec;font-size:12px;font-weight:700;padding:6px 12px;border-radius:7px;cursor:pointer}
  button.promote:hover{border-color:#f2a900;color:#f2a900}
  .gsc{font-size:11px;color:#f2a900;margin-top:2px}
</style></head><body>
  <span class="tag">HORIZON SHIELD</span>
  <h1>GEO\u55B6\u696D\u30DE\u30F3\u88FD\u9020\u6A5F</h1>
  <p class="lead">1\u30BF\u30C3\u30D7\u3067\u672C\u7269\u30C7\u30FC\u30BF\u306EGEO\u30DA\u30FC\u30B8\u3092\u88FD\u9020\u3057\u3066\u5373\u30E9\u30A4\u30D6(noindex)\u3002LINE\u306BURL\u304C\u5C4A\u304F\u3002\u691C\u7D22(GSC)\u306B\u51FA\u3059\u306E\u306F\u5404\u884C\u306E\u300Cindex\u3059\u308B\u300D\u3060\u3051\u3002</p>
  <button class="tap" id="tap" onclick="publish()">\u88FD\u9020\u3057\u3066\u516C\u958B + LINE\u901A\u77E5</button>
  <div id="msg"></div>
  <div class="list" id="list"></div>
<script>
  function key(){ let k=sessionStorage.getItem('hsk'); if(!k){k=prompt('\u7BA1\u7406\u30AD\u30FC(ADMIN_KEY)'); if(k) sessionStorage.setItem('hsk',k);} return k; }
  function show(t,ok){ const m=document.getElementById('msg'); m.className='msg '+(ok?'ok':'ng'); m.textContent=t; }
  async function publish(){
    const k=key(); if(!k) return;
    const b=document.getElementById('tap'); b.disabled=true; b.textContent='\u88FD\u9020\u4E2D...';
    try{
      const r=await fetch('/publish',{method:'POST',headers:{'X-Admin-Key':k}});
      const d=await r.json();
      if(r.ok){ show('\u516C\u958B\u3057\u305F: '+d.work+'\\n'+location.origin+d.url+'\\nLINE: '+(d.line&&d.line.ok?'\u9001\u4FE1\u6E08':'\u672A\u9001\u4FE1'),true); load(); }
      else show('\u5931\u6557: '+(d.error||r.status),false);
    }catch(e){ show('\u901A\u4FE1\u30A8\u30E9\u30FC: '+e,false); }
    b.disabled=false; b.textContent='\u88FD\u9020\u3057\u3066\u516C\u958B + LINE\u901A\u77E5';
  }
  async function promote(slug){
    const k=key(); if(!k) return;
    if(!confirm('\u3053\u306E\u30DA\u30FC\u30B8\u3092GSC(\u691C\u7D22)\u306B\u51FA\u3057\u307E\u3059\u3002\u524D\u56DE\u306Edoorway\u57CB\u6CA1\u3092\u8E0F\u307E\u306A\u3044\u3088\u3046\u3001\u4E2D\u8EAB\u3092\u78BA\u8A8D\u3057\u305F1\u679A\u3060\u3051\u306B\u3059\u308B\u3053\u3068\u3002\u7D9A\u884C?')) return;
    const r=await fetch('/promote',{method:'POST',headers:{'X-Admin-Key':k,'Content-Type':'application/json'},body:JSON.stringify({slug})});
    const d=await r.json(); if(r.ok){ show('index\u306B\u6607\u683C: '+slug,true); load(); } else show('\u5931\u6557: '+(d.error||r.status),false);
  }
  async function load(){
    const r=await fetch('/list'); const d=await r.json();
    const el=document.getElementById('list');
    el.innerHTML = (d.pages||[]).map(function(p){
      return '<div class="row"><div class="w">'+p.work+'</div>'+
        '<div class="u">'+location.origin+'/p/'+p.slug+'</div>'+
        '<div class="b">'+(p.indexed?'<span class="pill idx">GSC index</span>':'<span class="pill live">\u30E9\u30A4\u30D6(noindex)</span>')+
        ' <a class="open" href="/p/'+p.slug+'" target="_blank">\u958B\u304F</a>'+
        (p.indexed?'':' <button class="promote" onclick="promote(\\''+p.slug+'\\')">index\u3059\u308B</button>')+
        '</div></div>';
    }).join('') || '<div class="lead">\u307E\u3060\u7121\u3057\u3002\u4E0A\u306E\u30DC\u30BF\u30F3\u3067\u88FD\u9020\u3002</div>';
  }
  load();
<\/script></body></html>`;
}
__name(controlPanel, "controlPanel");
var index_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "GET" && (path === "/" || path === "")) {
      return new Response(controlPanel(), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (req.method === "GET" && path.startsWith("/p/")) {
      const slug = decodeURIComponent(path.slice(3).replace(/\/$/, ""));
      const item = CATALOG.find((c) => c.slug === slug);
      if (!item) return new Response("not found", { status: 404 });
      const list = await getIndex(env);
      const rec = list.find((p) => p.slug === slug);
      const indexed = !!(rec && rec.indexed);
      return new Response(buildPage(item, indexed), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
    if (req.method === "GET" && path === "/sitemap.xml") {
      const list = await getIndex(env);
      const items = list.filter((p) => p.indexed);
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
` + items.map(
        (p) => `<url><loc>${url.origin}/p/${p.slug}</loc><lastmod>${(p.createdAt || "").slice(0, 10)}</lastmod></url>`
      ).join("\n") + `
</urlset>`;
      return new Response(body, { headers: { "Content-Type": "application/xml" } });
    }
    if (req.method === "GET" && path === "/robots.txt") {
      return new Response(
        `User-agent: *
Allow: /
Sitemap: ${url.origin}/sitemap.xml
`,
        { headers: { "Content-Type": "text/plain" } }
      );
    }
    if (req.method === "GET" && path === "/list") {
      const list = await getIndex(env);
      const pages = list.slice().reverse().map((p) => ({ slug: p.slug, work: p.work, indexed: !!p.indexed }));
      return json({ pages });
    }
    if (req.method === "POST" && path === "/publish") {
      if (!adminOk(req, env)) return json({ error: "unauthorized" }, 401);
      const list = await getIndex(env);
      const published = new Set(list.map((p) => p.slug));
      const next = CATALOG.find((c) => !published.has(c.slug)) || CATALOG[0];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const existing = list.find((p) => p.slug === next.slug);
      if (existing) {
        existing.createdAt = now;
      } else {
        list.push({ slug: next.slug, work: next.work, indexed: false, createdAt: now });
      }
      await putIndex(env, list);
      const liveUrl = url.origin + "/p/" + next.slug;
      const line = await linePush(
        env,
        "[GEO\u88FD\u9020] " + next.work + "\n\u9069\u6B63 " + yen(next.min) + "\uFF5E" + yen(next.max) + "\u5186 / \u5371\u967A\u7DDA " + yen(next.danger) + "\u5186\u8D85\n\u30E9\u30A4\u30D6(noindex): " + liveUrl + "\n\u4E2D\u8EABOK\u306A\u3089\u64CD\u4F5C\u76E4\u3067index\u306B\u6607\u683C\u3002\nEHN\u6295\u7A3F: " + SUBMIT_URL
      );
      return json({ ok: true, work: next.work, slug: next.slug, url: "/p/" + next.slug, indexed: false, line });
    }
    if (req.method === "POST" && path === "/promote") {
      if (!adminOk(req, env)) return json({ error: "unauthorized" }, 401);
      let body = {};
      try {
        body = await req.json();
      } catch {
      }
      const slug = body.slug;
      const list = await getIndex(env);
      const rec = list.find((p) => p.slug === slug);
      if (!rec) return json({ error: "no such page" }, 404);
      rec.indexed = true;
      await putIndex(env, list);
      return json({ ok: true, slug, indexed: true });
    }
    return new Response("not found", { status: 404 });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
