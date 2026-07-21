var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var SOUBA_REF = {
  "kyutoki_16": { name: "\u7D66\u6E6F\u5668\u4EA4\u63DB 16\u53F7", scope: "\u4E00\u5F0F(\u672C\u4F53+\u5DE5\u4E8B)", avg: 18e4, danger: 4e5 },
  "kyutoki_20": { name: "\u7D66\u6E6F\u5668\u4EA4\u63DB 20\u53F7", scope: "\u4E00\u5F0F(\u672C\u4F53+\u5DE5\u4E8B)", avg: 22e4, danger: 45e4 },
  "kyutoki_24": { name: "\u7D66\u6E6F\u5668\u4EA4\u63DB 24\u53F7", scope: "\u4E00\u5F0F(\u672C\u4F53+\u5DE5\u4E8B)", avg: 27e4, danger: 55e4 },
  "ecojaws_20": { name: "\u30A8\u30B3\u30B8\u30E7\u30FC\u30BA\u4EA4\u63DB 20\u53F7", scope: "\u4E00\u5F0F(\u672C\u4F53+\u5DE5\u4E8B)", avg: 28e4, danger: 55e4 },
  "ecojaws_24": { name: "\u30A8\u30B3\u30B8\u30E7\u30FC\u30BA\u4EA4\u63DB 24\u53F7", scope: "\u4E00\u5F0F(\u672C\u4F53+\u5DE5\u4E8B)", avg: 35e4, danger: 65e4 }
};
var GENKA_ONLY = {
  "ecocute": { name: "\u30A8\u30B3\u30AD\u30E5\u30FC\u30C8(\u672C\u4F53)", scope: "\u672C\u4F53\u306E\u307F\u30FB\u76F8\u5834DB\u5BFE\u8C61\u5916" }
};
var PART_KEYWORDS = ["\u90E8\u6750", "\u90E8\u54C1", "\u5FAA\u74B0\u53E3", "\u6DF7\u5408\u5F01", "\u811A\u90E8", "\u67B6\u53F0", "\u30A2\u30C0\u30D7\u30BF", "\u91D1\u5177", "\u30D1\u30C3\u30AD\u30F3", "\u4EE3\u66FF", "\u9632\u96EA", "\u30EA\u30E2\u30B3\u30F3", "\u914D\u7BA1\u30AB\u30D0\u30FC"];
var BODY_PRICE_FLOOR = 25e3;
var KAKERITSU_MIN = 1.2;
var KAKERITSU_MAX = 6;
var SHOP_COUNT_MIN = 3;
var HIGH_MARKUP_FLAG = 3;
function round2(x) {
  return Math.round(x * 100) / 100;
}
__name(round2, "round2");
__name2(round2, "round2");
function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
__name2(json, "json");
function html(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
__name(html, "html");
__name2(html, "html");
function authorized(request, env) {
  const got = request.headers.get("x-ingest-secret") || "";
  return env.INGEST_SECRET && got === env.INGEST_SECRET;
}
__name(authorized, "authorized");
__name2(authorized, "authorized");
function resolveCategory(name) {
  const n = name || "";
  if (n.indexOf("\u30A8\u30B3\u30AD\u30E5\u30FC\u30C8") >= 0) return "ecocute";
  if (n.indexOf("\u30A8\u30B3\u30B8\u30E7\u30FC\u30BA") >= 0) {
    if (n.indexOf("24\u53F7") >= 0) return "ecojaws_24";
    return "ecojaws_20";
  }
  if (n.indexOf("\u7D66\u6E6F") >= 0 || n.indexOf("\u3075\u308D\u7D66\u6E6F") >= 0) {
    if (n.indexOf("24\u53F7") >= 0) return "kyutoki_24";
    if (n.indexOf("16\u53F7") >= 0) return "kyutoki_16";
    return "kyutoki_20";
  }
  return "uncategorized";
}
__name(resolveCategory, "resolveCategory");
__name2(resolveCategory, "resolveCategory");
function mapKakakuItem(r, idx) {
  const rawPrice = r.lowestPrice;
  const price = typeof rawPrice === "number" ? rawPrice : parseInt(String(rawPrice || "").replace(/[^0-9]/g, ""), 10);
  const url = r.productUrl || "";
  const m = url.match(/item\/([A-Za-z0-9]+)/);
  const code = m ? m[1] : "idx" + idx;
  return {
    id: "kakaku_" + code,
    name: r.productName || "",
    category_id: resolveCategory(r.productName || ""),
    material_price_jpy: isNaN(price) ? null : price,
    shop_count: typeof r.shopCount === "number" ? r.shopCount : null,
    source_site: "kakaku.com",
    source_url: url
  };
}
__name(mapKakakuItem, "mapKakakuItem");
__name2(mapKakakuItem, "mapKakakuItem");
async function fetchAndMapDataset(datasetId, env) {
  console.log("DBG datasetId=" + JSON.stringify(datasetId) + " hasToken=" + (env.APIFY_TOKEN ? "yes" : "no"));
  if (!env.APIFY_TOKEN) return [];
  const url = "https://api.apify.com/v2/datasets/" + datasetId + "/items?clean=true&format=json&token=" + env.APIFY_TOKEN;
  const res = await fetch(url);
  console.log("DBG fetch status=" + res.status);
  if (!res.ok) {
    const body = await res.text();
    console.log("DBG fetch fail body=" + body.slice(0, 300));
    return [];
  }
  const raw = await res.json();
  console.log("DBG raw=" + (Array.isArray(raw) ? "array len " + raw.length : typeof raw));
  if (!Array.isArray(raw)) return [];
  const mapped = raw.map(mapKakakuItem).filter(function(x) {
    return x && x.id;
  });
  console.log("DBG mapped len=" + mapped.length);
  return mapped;
}
__name(fetchAndMapDataset, "fetchAndMapDataset");
__name2(fetchAndMapDataset, "fetchAndMapDataset");
function isLikelyPart(name) {
  const n = name || "";
  for (let i = 0; i < PART_KEYWORDS.length; i++) {
    if (n.indexOf(PART_KEYWORDS[i]) >= 0) return true;
  }
  return false;
}
__name(isLikelyPart, "isLikelyPart");
__name2(isLikelyPart, "isLikelyPart");
function kiraGate(item) {
  const flags = [];
  const catId = item.category_id;
  const ref = SOUBA_REF[catId];
  const genkaOnly = GENKA_ONLY[catId] || null;
  const genka = item.material_price_jpy;
  const validGenka = typeof genka === "number" && !isNaN(genka) && genka > 0;
  if (!validGenka) {
    flags.push("genka_invalid");
  }
  if (isLikelyPart(item.name)) {
    flags.push("likely_part");
  }
  if (validGenka && (ref || genkaOnly) && genka < BODY_PRICE_FLOOR) {
    if (flags.indexOf("likely_part") < 0) flags.push("likely_part");
  }
  if (!ref && !genkaOnly) {
    flags.push("souba_missing");
  }
  let kakeritsu_avg = null;
  let kakeritsu_danger = null;
  if (ref && validGenka) {
    kakeritsu_avg = round2(ref.avg / genka);
    kakeritsu_danger = round2(ref.danger / genka);
    if (genka > ref.avg) {
      flags.push("genka_exceeds_souba");
    }
    if (kakeritsu_avg < KAKERITSU_MIN || kakeritsu_avg > KAKERITSU_MAX) {
      flags.push("kakeritsu_out_of_range");
    }
  }
  const shopCount = typeof item.shop_count === "number" ? item.shop_count : null;
  if (validGenka && shopCount !== null && shopCount < SHOP_COUNT_MIN) {
    flags.push("low_shop_count");
  }
  let high_markup = false;
  if (kakeritsu_danger !== null && kakeritsu_danger >= HIGH_MARKUP_FLAG) {
    high_markup = true;
  }
  return {
    souba_ref: ref || null,
    genka_only: genkaOnly ? true : false,
    scope_note: genkaOnly ? genkaOnly.scope : ref ? ref.scope : "",
    material_price_jpy: genka,
    shop_count: shopCount,
    kakeritsu_avg_over_genka: kakeritsu_avg,
    kakeritsu_danger_over_genka: kakeritsu_danger,
    high_markup,
    flags,
    status: flags.length ? "flagged" : "clean"
  };
}
__name(kiraGate, "kiraGate");
__name2(kiraGate, "kiraGate");
async function handleIngest(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  console.log("DBG payload=" + JSON.stringify(payload).slice(0, 200));
  let items;
  if (payload.datasetId) {
    items = await fetchAndMapDataset(payload.datasetId, env);
  } else {
    items = Array.isArray(payload.items) ? payload.items : [];
  }
  if (!items.length) {
    return json({ ok: false, error: "no items" }, 400);
  }
  let clean = 0;
  let flagged = 0;
  for (const item of items) {
    if (!item.id) continue;
    const gate = kiraGate(item);
    const record = {
      id: item.id,
      name: item.name || "",
      category_id: item.category_id || "",
      shop_count: typeof item.shop_count === "number" ? item.shop_count : null,
      source_site: item.source_site || "",
      source_url: item.source_url || "",
      collected_at: item.collected_at || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      gate
    };
    await env.GENKA_PENDING.put("pending:" + item.id, JSON.stringify(record));
    if (gate.status === "clean") clean++;
    else flagged++;
  }
  return json({ ok: true, received: items.length, clean, flagged });
}
__name(handleIngest, "handleIngest");
__name2(handleIngest, "handleIngest");
async function listPending(env, statusFilter) {
  const out = [];
  let cursor = void 0;
  do {
    const res = await env.GENKA_PENDING.list({ prefix: "pending:", cursor });
    for (const k of res.keys) {
      const v = await env.GENKA_PENDING.get(k.name);
      if (!v) continue;
      const rec = JSON.parse(v);
      if (!statusFilter || rec.gate.status === statusFilter) out.push(rec);
    }
    cursor = res.list_complete ? void 0 : res.cursor;
  } while (cursor);
  return out;
}
__name(listPending, "listPending");
__name2(listPending, "listPending");
async function handleApprove(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  let ids = body.ids;
  if (!ids && body.id) ids = [body.id];
  if (!Array.isArray(ids) || !ids.length) return json({ ok: false, error: "no ids" }, 400);
  let approved = 0;
  for (const id of ids) {
    const v = await env.GENKA_PENDING.get("pending:" + id);
    if (!v) continue;
    const rec = JSON.parse(v);
    rec.verified_by_toshi = true;
    rec.verified_at = (/* @__PURE__ */ new Date()).toISOString();
    await env.GENKA_VERIFIED.put("verified:" + id, JSON.stringify(rec));
    await env.GENKA_PENDING.delete("pending:" + id);
    approved++;
  }
  return json({ ok: true, approved });
}
__name(handleApprove, "handleApprove");
__name2(handleApprove, "handleApprove");
async function handleReject(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  let ids = body.ids;
  if (!ids && body.id) ids = [body.id];
  if (!Array.isArray(ids) || !ids.length) return json({ ok: false, error: "no ids" }, 400);
  let rejected = 0;
  for (const id of ids) {
    await env.GENKA_PENDING.delete("pending:" + id);
    rejected++;
  }
  return json({ ok: true, rejected, reason: body.reason || "" });
}
__name(handleReject, "handleReject");
__name2(handleReject, "handleReject");
async function handleExport(env) {
  const out = [];
  let cursor = void 0;
  do {
    const res = await env.GENKA_VERIFIED.list({ prefix: "verified:", cursor });
    for (const k of res.keys) {
      const v = await env.GENKA_VERIFIED.get(k.name);
      if (!v) continue;
      const rec = JSON.parse(v);
      const ref = rec.gate.souba_ref || {};
      out.push({
        id: rec.id,
        name: rec.name,
        category_id: rec.category_id,
        category_name: ref.name || (rec.gate.genka_only ? GENKA_ONLY[rec.category_id] ? GENKA_ONLY[rec.category_id].name : "" : ""),
        unit: "\u6750\u6599\u306E\u307F",
        genka_only: rec.gate.genka_only || false,
        material_unit_cost_jpy: rec.gate.material_price_jpy,
        material_unit_basis: rec.source_site + " \u5B9F\u58F2\u3001\u8981\u518D\u691C\u8A3C",
        job_example: {
          scope: ref.name ? ref.name + " \u76F8\u5834\u3068\u306E\u6BD4\u8F03" : "",
          material_total_jpy: rec.gate.material_price_jpy,
          souba_avg_jpy: ref.avg || null,
          souba_danger_jpy: ref.danger || null,
          kakeritsu_avg_over_genka: rec.gate.kakeritsu_avg_over_genka,
          kakeritsu_danger_over_genka: rec.gate.kakeritsu_danger_over_genka
        },
        source: rec.source_url,
        collected_at: rec.collected_at,
        verified_by_toshi: true
      });
    }
    cursor = res.list_complete ? void 0 : res.cursor;
  } while (cursor);
  return json({ ok: true, count: out.length, entries: out });
}
__name(handleExport, "handleExport");
__name2(handleExport, "handleExport");
function dashboardPage() {
  return `<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HORIZON SHIELD \u539F\u4FA1\u30EC\u30D3\u30E5\u30FC</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:16px}h1{font-size:18px;margin:0 0 4px}.sub{color:#8a93a2;font-size:12px;margin-bottom:16px}h2{font-size:15px;margin:20px 0 8px;border-left:4px solid #3a7;padding-left:8px}h2.flag{border-left-color:#c84}.bar{margin:8px 0;display:flex;gap:8px;flex-wrap:wrap}button{background:#1e2430;color:#e6e6e6;border:1px solid #344;border-radius:6px;padding:8px 12px;font-size:13px;cursor:pointer}button.go{background:#1f6f4a;border-color:#2a8}button.no{background:#6f2a2a;border-color:#a44}button:disabled{opacity:.4;cursor:default}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:6px 8px;border-bottom:1px solid #222a35;text-align:left;vertical-align:top}th{color:#8a93a2;font-weight:600}.price{font-variant-numeric:tabular-nums}.tag{display:inline-block;background:#2a3140;border-radius:4px;padding:1px 6px;margin:1px;font-size:11px;color:#bcd}.tag.go{background:#173d2a;color:#7fd6a3}.tag.part{background:#3d2e17;color:#d6b27f}.tag.miss{background:#3a2436;color:#d69ac6}.empty{color:#667;font-size:12px;padding:8px}.msg{margin:8px 0;font-size:12px;color:#7fd6a3;min-height:16px}a.src{color:#6aa3ff;text-decoration:none}</style></head><body><h1>HORIZON SHIELD \u539F\u4FA1\u30EC\u30D3\u30E5\u30FC</h1><div class="sub">hs-genka-ingest \u9694\u96E2\u30AD\u30E5\u30FC\u3002clean=\u30EF\u30F3\u30D7\u30C3\u30B7\u30E5\u627F\u8A8D\u3001flagged=\u8981\u78BA\u8A8D\u3002\u627F\u8A8D\u306F GENKA_VERIFIED \u306B\u79FB\u52D5\u3002</div><div class="msg" id="msg"></div><h2>clean(\u627F\u8A8D\u5F85\u3061)</h2><div class="bar"><button class="go" id="approveAllClean">clean\u3092\u5168\u90E8\u627F\u8A8D</button><button class="go" id="approveSelClean">\u9078\u629E\u3092\u627F\u8A8D</button><button id="reload">\u518D\u8AAD\u8FBC</button><button id="exportBtn">genka-db\u5F62\u5F0F\u3067Export</button></div><table id="cleanTbl"><thead><tr><th></th><th>\u540D\u524D</th><th>\u30AB\u30C6\u30B4\u30EA</th><th class="price">\u6750\u6599\u539F\u4FA1</th><th class="price">\u639B\u3051\u7387(avg/\u539F\u4FA1)</th><th>\u5224\u5B9A</th></tr></thead><tbody></tbody></table><h2 class="flag">flagged(\u8981\u78BA\u8A8D)</h2><div class="bar"><button class="go" id="approveSelFlag">\u9078\u629E\u3092\u627F\u8A8D(\u4F8B\u5916\u7684\u306B\u901A\u3059)</button><button class="no" id="rejectSelFlag">\u9078\u629E\u3092\u5374\u4E0B(\u6368\u3066\u308B)</button></div><table id="flagTbl"><thead><tr><th></th><th>\u540D\u524D</th><th>\u30AB\u30C6\u30B4\u30EA</th><th class="price">\u6750\u6599\u539F\u4FA1</th><th class="price">\u639B\u3051\u7387(avg/\u539F\u4FA1)</th><th>\u30D5\u30E9\u30B0</th></tr></thead><tbody></tbody></table><script>var KEY = new URLSearchParams(location.search).get("key")||""; var H = {"x-ingest-secret":KEY,"content-type":"application/json"}; function msg(t){document.getElementById("msg").textContent=t}function yen(n){if(n===null||n===undefined||isNaN(n))return"-";return Number(n).toLocaleString("ja-JP")}function flagTag(f){var c="tag";if(f==="likely_part")c="tag part";else if(f==="souba_missing")c="tag miss";return '<span class="'+c+'">'+f+"</span>"}function rowHtml(rec){var g=rec.gate||{};var cat=rec.category_id||"";if(g.genka_only)cat=cat+' <span class="tag go">genka-only</span>';var ka=(g.kakeritsu_avg_over_genka===null||g.kakeritsu_avg_over_genka===undefined)?"-":g.kakeritsu_avg_over_genka+"\u500D";var flags=(g.flags||[]).map(flagTag).join(" ");if(!flags)flags='<span class="tag go">clean</span>';var nm=rec.name||"";if(rec.source_url)nm='<a class="src" href="'+rec.source_url+'" target="_blank" rel="noopener">'+nm+"</a>";return"<tr><td><input type='checkbox' value='"+rec.id+"'></td><td>"+nm+"</td><td>"+cat+"</td><td class='price'>"+yen(g.material_price_jpy)+"</td><td class='price'>"+ka+"</td><td>"+flags+"</td></tr>"}function fill(tblId,items){var tb=document.querySelector("#"+tblId+" tbody");if(!items||!items.length){tb.innerHTML='<tr><td colspan="6" class="empty">\u306A\u3057</td></tr>';return}tb.innerHTML=items.map(rowHtml).join("")}function selected(tblId){var out=[];document.querySelectorAll("#"+tblId+" tbody input:checked").forEach(function(c){out.push(c.value)});return out}function load(){msg("\u8AAD\u8FBC\u4E2D...");Promise.all([fetch("/clean",{headers:H}).then(function(r){return r.json()}),fetch("/review",{headers:H}).then(function(r){return r.json()})]).then(function(res){if(!res[0].ok||!res[1].ok){msg("\u8A8D\u8A3C\u30A8\u30E9\u30FC\u3002URL\u306E key \u3092\u78BA\u8A8D\u3002");return}fill("cleanTbl",res[0].items);fill("flagTbl",res[1].items);msg("clean "+res[0].items.length+"\u4EF6 / flagged "+res[1].items.length+"\u4EF6")}).catch(function(e){msg("\u901A\u4FE1\u30A8\u30E9\u30FC: "+e)})}function approve(ids){if(!ids.length){msg("\u9078\u629E\u306A\u3057");return}fetch("/approve",{method:"POST",headers:H,body:JSON.stringify({ids:ids})}).then(function(r){return r.json()}).then(function(j){msg(j.ok?j.approved+"\u4EF6 \u627F\u8A8D -> GENKA_VERIFIED":"\u5931\u6557: "+JSON.stringify(j));load()})}function reject(ids){if(!ids.length){msg("\u9078\u629E\u306A\u3057");return}if(!confirm(ids.length+"\u4EF6 \u6368\u3066\u307E\u3059\u3002\u3048\u3048\u304B?"))return;fetch("/reject",{method:"POST",headers:H,body:JSON.stringify({ids:ids})}).then(function(r){return r.json()}).then(function(j){msg(j.ok?j.rejected+"\u4EF6 \u5374\u4E0B":"\u5931\u6557: "+JSON.stringify(j));load()})}document.getElementById("reload").onclick=load;document.getElementById("approveSelClean").onclick=function(){approve(selected("cleanTbl"))};document.getElementById("approveSelFlag").onclick=function(){approve(selected("flagTbl"))};document.getElementById("rejectSelFlag").onclick=function(){reject(selected("flagTbl"))};document.getElementById("approveAllClean").onclick=function(){var ids=[];document.querySelectorAll("#cleanTbl tbody input").forEach(function(c){ids.push(c.value)});approve(ids)};document.getElementById("exportBtn").onclick=function(){fetch("/export",{headers:H}).then(function(r){return r.json()}).then(function(j){var blob=new Blob([JSON.stringify(j.entries,null,2)],{type:"application/json"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="genka-db-export.json";a.click();msg("Export "+j.count+"\u4EF6")})};load()<\/script></body></html>`;
}
__name(dashboardPage, "dashboardPage");
__name2(dashboardPage, "dashboardPage");
function handleDashboard(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!env.INGEST_SECRET || key !== env.INGEST_SECRET) {
    return html("<html><meta charset='utf-8'><body style='font-family:sans-serif;background:#0f1115;color:#e6e6e6;padding:24px'><h3>unauthorized</h3><p>?key=&lt;INGEST_SECRET&gt; \u3092\u4ED8\u3051\u3066\u30A2\u30AF\u30BB\u30B9\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p></body>", 401);
  }
  return html(dashboardPage());
}
__name(handleDashboard, "handleDashboard");
__name2(handleDashboard, "handleDashboard");
var index_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (path === "/" || path === "/health") {
        return json({ ok: true, service: "hs-genka-ingest", note: "isolated. does not touch hs-kira-proxy." });
      }
      if (path === "/dashboard" && request.method === "GET") {
        return handleDashboard(request, env);
      }
      if (!authorized(request, env)) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      if (path === "/ingest" && request.method === "POST") return handleIngest(request, env);
      if (path === "/review" && request.method === "GET") return json({ ok: true, items: await listPending(env, "flagged") });
      if (path === "/clean" && request.method === "GET") return json({ ok: true, items: await listPending(env, "clean") });
      if (path === "/approve" && request.method === "POST") return handleApprove(request, env);
      if (path === "/reject" && request.method === "POST") return handleReject(request, env);
      if (path === "/export" && request.method === "GET") return handleExport(env);
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      try {
        await env.GENKA_VERIFIED.put("error:hs-genka-ingest", JSON.stringify({
          at: (/* @__PURE__ */ new Date()).toISOString(),
          path: new URL(request.url).pathname,
          message: String(e && e.message || e),
          stack: String(e && e.stack || "").slice(0, 200)
        }));
      } catch (_) {
      }
      throw e;
    }
  },
  async scheduled(event, env, ctx) {
    if (!env.APIFY_TOKEN || !env.APIFY_ACTOR_ID) return;
    const endpoint = "https://api.apify.com/v2/acts/" + env.APIFY_ACTOR_ID + "/runs?token=" + env.APIFY_TOKEN;
    ctx.waitUntil(fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }));
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map