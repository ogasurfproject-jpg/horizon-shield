var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var TOOLS = [
  // ---- 資料生成層 → hs-pdf-gen ----
  {
    name: "generate_vrq",
    description: "VRQ\u5224\u5B9A\u8A3C\u660E\u66F8\u3092\u751F\u6210\u3059\u308B(hs-pdf-gen /generate-vrq)\u3002\u5DE5\u4E8B\u7A2E\u5225\u3068\u696D\u8005\u63D0\u793A\u984D\u304B\u3089\u9069\u6B63\u8A3A\u65ADPDF\u3092\u767A\u884C\u3002",
    inputSchema: {
      type: "object",
      properties: {
        koji_type: { type: "string", description: "\u5DE5\u4E8B\u7A2E\u5225\u30AD\u30FC(\u4F8B gaiheki_30tsubo)" },
        teiji_kingaku: { type: "number", description: "\u696D\u8005\u63D0\u793A\u984D(\u5186)" },
        region: { type: "string", description: "\u5730\u57DF(\u4F8B kanto)" },
        customer_name: { type: "string", description: "\u9867\u5BA2\u540D(\u8A3C\u660E\u66F8\u8A18\u8F09\u7528)" }
      },
      required: ["koji_type", "teiji_kingaku", "region", "customer_name"]
    }
  },
  {
    name: "generate_plan",
    description: "\u9006\u898B\u7A4D\u8A8D\u8A3C(/generate-plan)\u3092\u751F\u6210\u3059\u308B\u3002",
    inputSchema: { type: "object", properties: { payload: { type: "object", description: "hs-pdf-gen /generate-plan \u306Ebody" } }, required: ["payload"] }
  },
  {
    name: "generate_meitsumori",
    description: "\u52A0\u76DF\u5E97\u672C\u898B\u7A4D\u8A8D\u8A3C(3\u6BB5\u968E)\u3092\u751F\u6210\u3059\u308B\u3002\u203B\u672C\u756Ahs-pdf-gen(v12)\u306B\u672A\u5B9F\u88C5\u30FBv13 deploy\u5F8C\u306B\u6709\u52B9\u5316\u3002",
    inputSchema: { type: "object", properties: { payload: { type: "object", description: "hs-pdf-gen /generate-meitsumori \u306Ebody" } }, required: ["payload"] }
  },
  {
    name: "generate_kanryo",
    description: "\u5B8C\u6210\u691C\u67FB\u8A3C(3\u6BB5\u968E)\u3092\u751F\u6210\u3059\u308B\u3002\u203B\u672C\u756Ahs-pdf-gen(v12)\u306B\u672A\u5B9F\u88C5\u30FBv13 deploy\u5F8C\u306B\u6709\u52B9\u5316\u3002",
    inputSchema: { type: "object", properties: { payload: { type: "object", description: "hs-pdf-gen /generate-kanryo \u306Ebody" } }, required: ["payload"] }
  },
  // ---- 加盟店オペ層 → hs-estimate ----
  {
    name: "partner_set_pricing",
    description: "\u52A0\u76DF\u5E97\u3054\u3068\u306E\u5358\u4FA1\u3092\u8A2D\u5B9A\u3059\u308B(hs-estimate /admin/set-pricing)\u3002\u8AF8\u7D4C\u8CBB\u4E0A\u9650\u30FBfloor_grade\u76E3\u8996\u8FBC\u307F\u3002",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "string", description: "\u52A0\u76DF\u5E97ID(hs-estimate\u5B9F\u4ED5\u69D8: subscriptionId)" },
        pricing: { type: "object", description: "\u5358\u4FA1\u30BB\u30C3\u30C8(strict whitelist)" },
        floor_grade: { type: "string", description: "\u30D5\u30ED\u30FC\u30EA\u30F3\u30B0\u30B0\u30EC\u30FC\u30C9\u5E2F(budget/standard/premium)" }
      },
      required: ["subscriptionId", "pricing"]
    }
  },
  {
    name: "partner_approve",
    description: "\u52A0\u76DF\u5E97\u7533\u8ACB\u3092\u627F\u8A8D\u3059\u308B(hs-estimate /admin/approve)\u3002\u51AA\u7B49\u30FBtier\u306Fbody\u512A\u5148(\u81EA\u79F0honbu\u5C01\u3058)\u3002tier=honbu|external\u3002",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "\u7533\u8ACBID(hs-estimate\u5B9F\u4ED5\u69D8: appId)" },
        tier: { type: "string", description: "\u4ED8\u4E0Etier(honbu|external)" },
        parentId: { type: "string", description: "(\u4EFB\u610F)\u89AA\u52A0\u76DF\u5E97ID" }
      },
      required: ["appId", "tier"]
    }
  },
  {
    name: "partner_children",
    description: "\u89AA\u52A0\u76DF\u5E97\u914D\u4E0B\u306E\u5B50\u3092\u53D6\u5F97\u3059\u308B(hs-estimate GET /partner/children)\u3002\u89AA\u81EA\u8EAB\u306EapiKey\u3067\u8A8D\u8A3C\u3057\u3001\u305D\u306E\u89AA\u306E\u914D\u4E0B\u306E\u307F\u8FD4\u3059(\u672C\u756A\u306F\u89AA\u306E\u307F\u30FB\u5B50403\u30FB\u6700\u5C0F\u30D5\u30A3\u30FC\u30EB\u30C9)\u3002\u672C\u90E8\u30C4\u30FC\u30EB\u306F\u5BFE\u8C61\u89AA\u306EapiKey\u3092\u5F15\u6570\u3067\u6E21\u3059\u3002",
    inputSchema: {
      type: "object",
      properties: { partnerApiKey: { type: "string", description: "\u914D\u4E0B\u3092\u898B\u305F\u3044\u89AA\u52A0\u76DF\u5E97\u306EapiKey(X-API-Key)\u3002\u56FA\u5B9Asecret\u3067\u306F\u306A\u304F\u547C\u51FA\u6642\u6307\u5B9A\u3002" } },
      required: ["partnerApiKey"]
    }
  },
  // ---- 業者審査層 → hs-gyosha-check ----
  {
    name: "gyosha_check",
    description: "\u60AA\u5FB3\u696D\u8005\u30EA\u30B9\u30AF\u3092\u8A3A\u65AD\u3059\u308B(hs-gyosha-check /check)\u3002\u56FD\u6C11\u751F\u6D3B\u30BB\u30F3\u30BF\u30FC/\u5EFA\u8A2D\u696D\u8A31\u53EF/\u53E3\u30B3\u30DF/\u793E\u540D\u8A50\u6B3A\u3092\u8ABF\u67FB\u3057\u30EA\u30B9\u30AF\u30EC\u30D9\u30EB\u3092\u8FD4\u3059\u3002\u65AD\u5B9A\u56DE\u907F\u8A2D\u8A08\u3002",
    inputSchema: {
      type: "object",
      properties: { company: { type: "string", description: "\u696D\u8005\u540D\u30FB\u4F1A\u793E\u540D" } },
      required: ["company"]
    }
  },
  // ---- 機密参照層 → hs-genka-ingest(read only) ----
  {
    name: "genka_lookup",
    description: "\u691C\u8A3C\u6E08\u307F\u539F\u4FA1\u3092\u7167\u4F1A\u3059\u308B(hs-genka-ingest /export=GENKA_VERIFIED\u5168\u4EF6)\u3002work\u6307\u5B9A\u3067MCP\u5074\u30D5\u30A3\u30EB\u30BF\u3002x-ingest-secret\u8A8D\u8A3C\u30FBread only\u30FB\u5185\u90E8\u306E\u307F\u3002",
    inputSchema: {
      type: "object",
      properties: { work: { type: "string", description: "(\u4EFB\u610F)\u5DE5\u4E8B\u540D\u30FB\u54C1\u76EE\u3067\u7D5E\u308A\u8FBC\u307F\u3002\u7701\u7565\u6642\u306F\u5168\u4EF6" } }
    }
  },
  // ---- 集客層 → horizon-shield-kira ロジック流用(半自動・実装済) ----
  {
    name: "lead_scout",
    description: "\u898B\u8FBC\u307F\u5BA2\u3092\u767A\u6398\u3059\u308B\u3002Google\u30A2\u30E9\u30FC\u30C8RSS\u2192Claude\u63A1\u70B9(\u95BE\u502470)\u2192\u898B\u8FBC\u307F\u5BA2\u30EA\u30B9\u30C8(\u30B9\u30B3\u30A2\u964D\u9806)\u3002\u534A\u81EA\u52D5: \u3053\u306E\u30C4\u30FC\u30EB\u3092\u53E9\u3044\u305F\u6642\u3060\u3051\u540C\u671F\u5B9F\u884C\u3059\u308B\u3002cron\u5E38\u6642\u56DE\u3057\u306F\u3057\u306A\u3044\u3002",
    inputSchema: {
      type: "object",
      properties: { feed_urls: { type: "string", description: "(\u4EFB\u610F)RSS URL \u30AB\u30F3\u30DE\u533A\u5207\u308A\u3002\u7701\u7565\u6642\u306F env.ALERT_FEED_URLS" } }
    }
  },
  // ---- 事務AI層 → Claude API直叩き(AI社員1 事務部隊) ----
  {
    name: "generate_document",
    description: "\u52A0\u76DF\u5E97\u30FB\u898B\u8FBC\u307F\u5BA2\u5411\u3051\u306E\u55B6\u696D\u6587\u66F8\u306E\u300C\u6587\u9762\u30FB\u69CB\u6210\u30FB\u63D0\u6848\u30ED\u30B8\u30C3\u30AF\u300D\u3092Claude API\u3067\u751F\u6210\u3059\u308B(AI\u793E\u54E11 \u4E8B\u52D9\u90E8\u968A)\u3002\u8FD4\u3059\u306E\u306F\u30C6\u30AD\u30B9\u30C8\u306E\u307F(pptx\u898B\u305F\u76EE\u306F\u4F5C\u3089\u306A\u3044)\u3002\u6599\u91D1\u306F\u4F0F\u305B\u30FB\u4F1A\u793E\u540D\u3068\u7981\u5247\u3092\u53B3\u5B88\u3002",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "\u5B9B\u5148 \u76F8\u624B\u3002\u4F8B \u6749\u6D66\u69D8(\u30C0\u30F3\u30B9\u30B9\u30AF\u30FC\u30EBFC\u672C\u90E8) \uFF0F \u5857\u88C5\u696D\u306E\u898B\u8FBC\u307F\u5BA2" },
        purpose: { type: "string", description: "\u7528\u9014 \u6587\u66F8\u7A2E\u5225\u3002\u4F8B \u55B6\u696D\u63D0\u6848\u66F8 \uFF0F \u52A0\u76DF\u5E97\u52E7\u8A98 \uFF0F \u898B\u7A4D\u9001\u4ED8\u72B6 \uFF0F \u304A\u793C\u72B6 \uFF0F \u5951\u7D04\u6848\u5185" },
        key_points: { type: "array", items: { type: "string" }, description: "\u8F09\u305B\u308B\u9805\u76EE(\u7B87\u6761\u66F8\u304D\u30FB1\u4EF6\u4EE5\u4E0A)" },
        audience_level: { type: "string", enum: ["\u7D20\u4EBA\u5411\u3051", "\u5C02\u9580"], description: "\u8AAD\u307F\u624B\u30EC\u30D9\u30EB\u3002\u65E2\u5B9A \u7D20\u4EBA\u5411\u3051" },
        length: { type: "string", enum: ["\u77ED", "\u4E2D", "\u9577"], description: "\u5206\u91CF\u3002\u65E2\u5B9A \u4E2D" },
        extra: { type: "string", description: "(\u4EFB\u610F)\u8FFD\u52A0\u6307\u793A \u6587\u8108" },
        format: { type: "string", enum: ["text", "slides"], description: "(\u4EFB\u610F)\u51FA\u529B\u5F62\u5F0F\u3002slides\u6307\u5B9A\u6642\u306Fpptx\u7528\u306E\u30B9\u30E9\u30A4\u30C9\u69CB\u9020JSON\u3092\u8FD4\u3059\u3002\u65E2\u5B9A text(\u5F93\u6765\u306E\u81EA\u7136\u6587)" }
      },
      required: ["recipient", "purpose", "key_points"]
    }
  },
  // ---- 保全層 → 全Worker死活監視(AI社員2 保全部隊・検知層a) ----
  {
    name: "monitor_health",
    description: "\u675F\u306D\u3066\u3044\u308B\u5168Worker\u306E\u6B7B\u6D3B\u3092\u4E00\u62EC\u30C1\u30A7\u30C3\u30AF\u3059\u308B(AI\u793E\u54E12 \u4FDD\u5168\u90E8\u968A\u30FB\u691C\u77E5\u5C64a)\u3002service binding\u7D4C\u7531\u3067\u5404Worker\u306E/health\u3092\u5185\u5074\u304B\u3089\u53E9\u304D\u3001\u751F\u6B7B\u3068latency(ms)\u3092\u8FD4\u3059\u3002\u691C\u77E5\u306E\u307F\u30FB\u672C\u756A\u306F\u4E00\u5207\u5909\u66F4\u3057\u306A\u3044(\u539F\u56E0\u8A3A\u65AD\u3084\u4FEE\u5FA9\u306F\u3057\u306A\u3044)\u3002\u5F15\u6570\u306A\u3057\u3002",
    inputSchema: { type: "object", properties: {} }
  }
];
async function callTool(name, args, env) {
  switch (name) {
    // ---- 資料生成層 → hs-pdf-gen (binding: PDF_GEN) ----
    //   本番稼働版(v12)の実EPは /generate-test。memory#11 の v13 EP(/generate-vrq等)は本番未deploy。
    //   他3つ(plan/meitsumori/kanryo)の本番実EPは未確認。通電フェーズで確認して直す。
    case "generate_vrq":
      return bindingPost(env.PDF_GEN, "/generate-test", {
        koji_type: args.koji_type,
        teiji_kingaku: args.teiji_kingaku,
        region: args.region,
        customer_name: args.customer_name
      });
    case "generate_plan":
      return bindingPost(env.PDF_GEN, "/generate-plan", args.payload);
    case "generate_meitsumori":
      return bindingPost(env.PDF_GEN, "/generate-meitsumori", args.payload);
    case "generate_kanryo":
      return bindingPost(env.PDF_GEN, "/generate-kanryo", args.payload);
    // ---- 加盟店オペ層 → hs-estimate (binding: ESTIMATE) ----
    //   管理系は X-Admin-Key、partner系は親APIキー(Bearer)。値は env から付与。
    case "partner_set_pricing":
      return bindingPost(
        env.ESTIMATE,
        "/admin/set-pricing",
        { subscriptionId: args.subscriptionId, pricing: args.pricing, floor_grade: args.floor_grade },
        { "X-Admin-Key": env.ESTIMATE_ADMIN_KEY }
      );
    case "partner_approve":
      return bindingPost(
        env.ESTIMATE,
        "/admin/approve",
        { appId: args.appId, tier: args.tier, parentId: args.parentId },
        { "X-Admin-Key": env.ESTIMATE_ADMIN_KEY }
      );
    case "partner_children":
      if (!args.partnerApiKey) return { ok: false, error: "partnerApiKey \u5FC5\u9808(\u5BFE\u8C61\u89AA\u306EapiKey)" };
      return bindingGet(
        env.ESTIMATE,
        "/partner/children",
        { "X-API-Key": args.partnerApiKey }
      );
    // ---- 業者審査層 → hs-gyosha-check (binding: GYOSHA_CHECK) ----
    case "gyosha_check":
      return bindingPost(env.GYOSHA_CHECK, "/check", { company: args.company });
    // ---- 機密参照層 → hs-genka-ingest (binding: GENKA_INGEST, read only) ----
    //   実態: 単品照会EPは無い。/export が検証済み原価(GENKA_VERIFIED)を全件返す。
    //   認証は x-ingest-secret ヘッダ(Authorization Bearer ではない・ソース41行で確認)。
    //   work でこのMCP側でフィルタして返す。read only(approve/reject/ingestは載せない)。
    case "genka_lookup": {
      const r = await bindingGet(
        env.GENKA_INGEST,
        "/export",
        { "x-ingest-secret": env.INGEST_SECRET }
      );
      if (r.status !== 200 || !r.data) return r;
      const all = r.data.entries || r.data || [];
      const q = (args.work || "").trim();
      const hit = q ? Array.isArray(all) ? all.filter((e) => JSON.stringify(e).includes(q)) : all : all;
      return { status: 200, work: q, count: Array.isArray(hit) ? hit.length : 0, entries: hit };
    }
    // ---- 集客層(半自動・horizon-shield-kira ロジック流用) ----
    case "lead_scout":
      return await leadScout(args.feed_urls, env);
    // ---- 事務AI層(文面/構成/提案ロジック生成・Claude API直叩き) ----
    case "generate_document":
      return await generateDocument(args, env);
    // ---- 保全層(全Worker死活監視・検知のみ・引数なし) ----
    case "monitor_health":
      return await monitorHealth(env);
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
__name(callTool, "callTool");
async function bindingPost(binding, path, body, extraHeaders = {}) {
  const req = new Request(`https://svc${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body || {})
  });
  const res = await binding.fetch(req);
  const text = await res.text();
  return safeParse(text, res.status);
}
__name(bindingPost, "bindingPost");
async function bindingGet(binding, path, extraHeaders = {}) {
  const req = new Request(`https://svc${path}`, { method: "GET", headers: { ...extraHeaders } });
  const res = await binding.fetch(req);
  const text = await res.text();
  return safeParse(text, res.status);
}
__name(bindingGet, "bindingGet");
function safeParse(text, status) {
  try {
    return { status, data: JSON.parse(text) };
  } catch {
    return { status, raw: text };
  }
}
__name(safeParse, "safeParse");
var LEAD_SCORE_THRESHOLD = 70;
var LEAD_MAX_ITEMS = 20;
async function leadScout(feedUrlsArg, env) {
  const urls = (feedUrlsArg || env.ALERT_FEED_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (urls.length === 0) {
    return { ok: false, error: "feed_urls \u672A\u6307\u5B9A\u304B\u3064 env.ALERT_FEED_URLS \u672A\u8A2D\u5B9A" };
  }
  let items = [];
  let fetchDiag = [];
  let _leadDelayDone = false;
  for (const u of urls) {
    if (_leadDelayDone) {
      await new Promise((r) => setTimeout(r, 900));
    }
    _leadDelayDone = true;
    try {
      const res = await fetch(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
          "Accept": "application/rss+xml, application/xml, text/xml, */*"
        }
      });
      const xml = await res.text();
      const got = parseRssItems(xml);
      fetchDiag.push({ url: u.slice(0, 60), status: res.status, bytes: xml.length, items: got.length });
      items = items.concat(got);
    } catch (e) {
      fetchDiag.push({ url: u.slice(0, 60), error: String(e.message || e) });
    }
  }
  if (items.length === 0) return { ok: true, leads: [], note: "RSS item\u30BC\u30ED", diag: fetchDiag };
  const targets = items.slice(0, LEAD_MAX_ITEMS);
  const scored = [];
  for (const it of targets) {
    const text = `${it.title} ${it.description}`.trim();
    const s = await scoreLead(text, env);
    if (s.score >= LEAD_SCORE_THRESHOLD) {
      scored.push({ score: s.score, reason: s.reason, action: s.action, title: it.title, link: it.link });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, threshold: LEAD_SCORE_THRESHOLD, scanned: targets.length, leads: scored };
}
__name(leadScout, "leadScout");
function parseRssItems(xml) {
  const out = [];
  let blocks = xml.split(/<item[\s>]/i).slice(1);
  if (blocks.length === 0) blocks = xml.split(/<entry[\s>]/i).slice(1);
  for (const b of blocks) {
    out.push({
      title: pick(b, "title"),
      description: pick(b, "description") || pick(b, "summary") || pick(b, "content"),
      link: pickLink(b)
    });
  }
  return out;
}
__name(parseRssItems, "parseRssItems");
function pick(block, tag) {
  const m = block.match(new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${tag}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
}
__name(pick, "pick");
function pickLink(block) {
  let m = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (m && m[1].trim()) return m[1].trim();
  m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : "";
}
__name(pickLink, "pickLink");
async function scoreLead(text, env) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `\u4EE5\u4E0B\u306E\u6295\u7A3F\u3092\u5206\u6790\u3057\u3001\u5EFA\u8A2D\u8CBB\u8A3A\u65AD\u30B5\u30FC\u30D3\u30B9(\xA555,000)\u306E\u898B\u8FBC\u307F\u5BA2\u30B9\u30B3\u30A2\u30920-100\u70B9\u3067\u5224\u5B9A\u3002
\u3010\u9AD8\u30B9\u30B3\u30A2\u6761\u4EF6\u3011\u30EA\u30D5\u30A9\u30FC\u30E0\u30FB\u5916\u58C1\u5857\u88C5\u306E\u898B\u7A4D\u3082\u308A\u306B\u4E0D\u6E80\u4E0D\u5B89\u3092\u6301\u3064\u65BD\u4E3B / \u5DE5\u4E8B\u8CBB\u304C\u9AD8\u3044\u3068\u611F\u3058\u308B\u4E00\u822C\u6D88\u8CBB\u8005 / \u696D\u8005\u306B\u9A19\u3055\u308C\u305F\u4E0D\u4FE1\u611F\u304C\u3042\u308B\u4EBA / \u5951\u7D04\u524D\u306B\u7B2C\u4E09\u8005\u78BA\u8A8D\u3057\u305F\u3044\u4EBA
\u3010\u4F4E\u30B9\u30B3\u30A2\u6761\u4EF6\u3011\u696D\u8005\u8077\u4EBA\u5EFA\u8A2D\u4F1A\u793E\u5074\u306E\u6295\u7A3F / \u5358\u306A\u308B\u611A\u75F4\u3067\u884C\u52D5\u610F\u6B32\u306A\u3057 / \u65E2\u306B\u5DE5\u4E8B\u5B8C\u4E86\u6E08\u307F / \u95A2\u4FC2\u306A\u3044\u5185\u5BB9
\u6295\u7A3F:${text.slice(0, 300)}
JSON\u5F62\u5F0F\u306E\u307F\u8FD4\u7B54:{"score":\u6570\u5024,"reason":"\u7406\u753115\u6587\u5B57\u4EE5\u5185","action":"\u30A2\u30D7\u30ED\u30FC\u30C120\u6587\u5B57\u4EE5\u5185"}`
      }]
    })
  });
  try {
    const data = await res.json();
    const raw = data.content?.[0]?.text || "";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return { score: 0, reason: "\u89E3\u6790\u5931\u6557", action: "\u30B9\u30AD\u30C3\u30D7" };
  }
}
__name(scoreLead, "scoreLead");
var DOC_MODEL = "claude-sonnet-4-6";
var DOC_SYSTEM = `\u3042\u306A\u305F\u306F The HORIZ\u97F3s\u682A\u5F0F\u4F1A\u793E \uFF0F HORIZON SHIELD \u306E\u4E8B\u52D9 \u55B6\u696D\u6587\u66F8\u3092\u4F5C\u6210\u3059\u308BAI\u793E\u54E1\u3067\u3059\u3002
\u5EFA\u8A2D\u30EA\u30D5\u30A9\u30FC\u30E0\u696D\u754C\u306E\u60C5\u5831\u306E\u975E\u5BFE\u79F0\u6027\u3092\u306A\u304F\u3059\u4E2D\u7ACB\u7B2C\u4E09\u8005\u3068\u3044\u3046\u4F1A\u793E\u306E\u7ACB\u5834\u3092\u8E0F\u307E\u3048\u3001\u52A0\u76DF\u5E97\u3084\u898B\u8FBC\u307F\u5BA2\u306B\u51FA\u3059\u6587\u66F8\u306E\u300C\u6587\u9762 \u69CB\u6210 \u63D0\u6848\u30ED\u30B8\u30C3\u30AF\u300D\u3092\u751F\u6210\u3057\u307E\u3059\u3002

\u51FA\u529B\u65B9\u91DD:
1. \u7D50\u8AD6\u3092\u5148\u306B\u51FA\u3059\u3002\u56DE\u308A\u304F\u3069\u3044\u524D\u7F6E\u304D\u3092\u3057\u306A\u3044\u3002
2. \u5C02\u9580\u7528\u8A9E(MCP AEO GEO A2A \u7B49)\u306F\u7D20\u4EBA\u306B\u3082\u5206\u304B\u308B\u305F\u3068\u3048\u8A71\u3067\u8A00\u3044\u63DB\u3048\u308B\u3002
3. \u8A87\u5F35\u3084\u62BC\u3057\u58F2\u308A\u3092\u3057\u306A\u3044\u3002\u4E8B\u5B9F\u3068\u30E1\u30EA\u30C3\u30C8\u3092\u6DE1\u3005\u3068\u66F8\u304F\u3002
4. \u5FC5\u305A\u6B21\u306E4\u30D6\u30ED\u30C3\u30AF\u3067\u8FD4\u3059: 1)\u63D0\u6848\u306E\u6838(\u4E00\u6587\u3067\u7D50\u8AD6) 2)\u69CB\u6210\u6848(\u7AE0\u7ACB\u3066 or \u30B9\u30E9\u30A4\u30C9\u5272\u308A) 3)\u5404\u7AE0\u306E\u6587\u9762\u30C9\u30E9\u30D5\u30C8 4)\u6CE8\u610F\u70B9\u3068NG\u3002

\u7D76\u5BFE\u7981\u5247:
- \u4F1A\u793E\u540D\u306F\u5FC5\u305A\u300CThe HORIZ\u97F3s\u682A\u5F0F\u4F1A\u793E\u300D\u3002\u97F3\u3092\u30ED\u30FC\u30DE\u5B57\u5316\u3057\u306A\u3044(\u8AA4 HORIZONs)\u3002
- \u30C0\u30C3\u30B7\u30E5\u8A18\u53F7\u3092\u4E00\u5207\u4F7F\u308F\u306A\u3044\u3002\u533A\u5207\u308A\u306F \u301C \u30FC \uFF0F \u8AAD\u70B9 \u3067\u4EE3\u7528\u3059\u308B\u3002
- \u6599\u91D1 \u91D1\u984D\u306F\u4E00\u5207\u66F8\u304B\u306A\u3044\u3002\u81EA\u793E\u306E\u8CBB\u7528\u3060\u3051\u3067\u306A\u304F\u3001\u305F\u3068\u3048\u8A71\u3084\u4F8B\u793A\u3084\u76F8\u5834\u8AAC\u660E\u306E\u4E2D\u306B\u51FA\u3066\u304F\u308B\u91D1\u984D\u3082\u542B\u3081\u3001\u5177\u4F53\u7684\u306A\u6570\u5B57\u306E\u91D1\u984D\u3092\u672C\u6587\u306B\u4E00\u5207\u51FA\u3055\u306A\u3044\u3002\u8CBB\u7528\u3084\u76F8\u5834\u306B\u89E6\u308C\u308B\u6642\u306F\u5FC5\u305A\u300C\u500B\u5225\u306B\u3054\u6848\u5185\u300D\u3068\u3057\u3001\u9AD8\u3044\u5B89\u3044\u306F\u6570\u5B57\u3092\u4F7F\u308F\u305A\u5B9A\u6027\u7684\u306B\u8868\u73FE\u3059\u308B\u3002
- \u516C\u958B\u9023\u7D61\u5148\u306F TEL 0463-74-5917 \u306E\u307F\u3002\u500B\u4EBA\u643A\u5E2F\u3084080\u756A\u53F7\u3092\u7D76\u5BFE\u306B\u66F8\u304B\u306A\u3044\u3002
- \u898B\u305F\u76EE(pptx\u30B9\u30E9\u30A4\u30C9\u30C7\u30B6\u30A4\u30F3)\u306F\u4F5C\u3089\u306A\u3044\u3002\u6587\u9762 \u69CB\u6210 \u30ED\u30B8\u30C3\u30AF\u306E\u30C6\u30AD\u30B9\u30C8\u3060\u3051\u3092\u8FD4\u3059\u3002`;
var SLIDES_SYSTEM = DOC_SYSTEM + `

\u8FFD\u52A0\u6307\u793A(slides \u51FA\u529B\u30E2\u30FC\u30C9):
\u3053\u308C\u307E\u3067\u306E\u7981\u5247(\u4F1A\u793E\u540D \u30C0\u30C3\u30B7\u30E5\u7981\u6B62 \u91D1\u984D\u5C01\u9396 \u516C\u958B\u9023\u7D61\u5148)\u306F\u5168\u3066\u7DAD\u6301\u3057\u305F\u307E\u307E\u3001\u51FA\u529B\u3092\u4E0B\u8A18JSON\u306E\u307F\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u524D\u7F6E\u304D \u8AAC\u660E\u6587 \u30B3\u30FC\u30C9\u30D6\u30ED\u30C3\u30AF\u8A18\u6CD5\u306F\u4E00\u5207\u4ED8\u3051\u305A\u3001JSON\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u5358\u4F53\u3060\u3051\u3092\u8FD4\u3057\u307E\u3059\u3002
{
  "title": "\u8868\u7D19\u30BF\u30A4\u30C8\u30EB 15\u6587\u5B57\u7A0B\u5EA6",
  "subtitle": "\u8868\u7D19\u306E\u4E00\u8A00\u30B5\u30D6\u30BF\u30A4\u30C8\u30EB \u4EFB\u610F \u77ED\u304F",
  "slides": [
    { "heading": "\u7AE0\u898B\u51FA\u3057", "bullets": ["\u8981\u70B9 1\u884C", "\u8981\u70B9 1\u884C"], "notes": "\u5546\u8AC7\u6642\u306B\u53E3\u982D\u3067\u88DC\u3046\u767A\u8868\u8005\u30CE\u30FC\u30C8 \u4EFB\u610F" }
  ]
}
\u5404\u30B9\u30E9\u30A4\u30C9\u306E bullets \u306F3\u301C5\u9805\u76EE \u54041\u884C\u3002slides \u306F4\u301C7\u679A\u3002\u898B\u305F\u76EE \u8272 \u30EC\u30A4\u30A2\u30A6\u30C8\u306E\u6307\u793A\u306F\u66F8\u304B\u306A\u3044(pptx\u5316\u306F\u5225\u5DE5\u7A0B)\u3002\u91D1\u984D\u306E\u6570\u5B57\u306F title subtitle heading bullets notes \u306E\u3069\u3053\u306B\u3082\u66F8\u304B\u306A\u3044\u3002`;
async function generateSlides(args, env) {
  const recipient = (args.recipient || "").trim();
  const purpose = (args.purpose || "").trim();
  const keyPoints = Array.isArray(args.key_points) ? args.key_points.filter(Boolean) : [];
  if (!recipient || !purpose || keyPoints.length === 0) {
    return { ok: false, error: "recipient / purpose / key_points(1\u4EF6\u4EE5\u4E0A) \u306F\u5FC5\u9808" };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY \u672A\u8A2D\u5B9A" };
  }
  const audienceLevel = args.audience_level === "\u5C02\u9580" ? "\u5C02\u9580" : "\u7D20\u4EBA\u5411\u3051";
  const extra = (args.extra || "").trim();
  const userPrompt = `\u6B21\u306E\u6761\u4EF6\u3067\u55B6\u696D\u6587\u66F8\u306E\u30B9\u30E9\u30A4\u30C9\u69CB\u9020\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002
\u5B9B\u5148 \u76F8\u624B: ${recipient}
\u7528\u9014 \u6587\u66F8\u7A2E\u5225: ${purpose}
\u8AAD\u307F\u624B\u30EC\u30D9\u30EB: ${audienceLevel}
\u8F09\u305B\u308B\u9805\u76EE:
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}
` + (extra ? `\u88DC\u8DB3\u6307\u793A: ${extra}
` : "") + `
\u6307\u5B9A\u306EJSON\u69CB\u9020\u3060\u3051\u3092\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: DOC_MODEL,
        max_tokens: 4e3,
        system: SLIDES_SYSTEM,
        messages: [{ role: "user", content: userPrompt }]
      })
    });
  } catch (e) {
    return { ok: false, error: "anthropic fetch\u5931\u6557: " + String(e.message || e) };
  }
  const status = res.status;
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status, error: "anthropic\u5FDC\u7B54\u304CJSON\u3067\u306A\u3044" };
  }
  if (status !== 200) {
    return { ok: false, status, error: data && data.error && data.error.message || "anthropic\u975E200", detail: data };
  }
  const raw = (Array.isArray(data.content) ? data.content : []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!raw) {
    return { ok: false, status, error: "\u751F\u6210\u30C6\u30AD\u30B9\u30C8\u304C\u7A7A", detail: data };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const jb = raw.indexOf("{");
    const je = raw.lastIndexOf("}");
    if (jb !== -1 && je !== -1 && je > jb) {
      try {
        parsed = JSON.parse(raw.slice(jb, je + 1));
      } catch (_2) {
        parsed = null;
      }
    }
  }
  if (!parsed || !Array.isArray(parsed.slides)) {
    return { ok: false, status, error: "slides JSON parse\u5931\u6557", raw };
  }
  const slides_doc = {
    title: String(parsed.title || purpose).slice(0, 60),
    subtitle: parsed.subtitle ? String(parsed.subtitle).slice(0, 80) : "",
    to: recipient,
    slides: parsed.slides.map((s) => ({
      heading: String(s.heading || "").slice(0, 60),
      bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b)).filter(Boolean) : [],
      notes: s.notes ? String(s.notes) : ""
    }))
  };
  return { ok: true, model: DOC_MODEL, recipient, purpose, audience_level: audienceLevel, format: "slides", slides_doc };
}
__name(generateSlides, "generateSlides");
async function generateDocument(args, env) {
  if (args && args.format === "slides") return generateSlides(args, env);
  const recipient = (args.recipient || "").trim();
  const purpose = (args.purpose || "").trim();
  const keyPoints = Array.isArray(args.key_points) ? args.key_points.filter(Boolean) : [];
  if (!recipient || !purpose || keyPoints.length === 0) {
    return { ok: false, error: "recipient / purpose / key_points(1\u4EF6\u4EE5\u4E0A) \u306F\u5FC5\u9808" };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY \u672A\u8A2D\u5B9A" };
  }
  const audienceLevel = args.audience_level === "\u5C02\u9580" ? "\u5C02\u9580" : "\u7D20\u4EBA\u5411\u3051";
  const lengthMap = { "\u77ED": "A4\u534A\u30DA\u30FC\u30B8\u7A0B\u5EA6\u306B\u7C21\u6F54\u306B", "\u4E2D": "A4 1\u301C2\u30DA\u30FC\u30B8\u76F8\u5F53", "\u9577": "A4 3\u30DA\u30FC\u30B8\u4EE5\u4E0A\u306E\u8A73\u7D30\u7248" };
  const tokenMap = { "\u77ED": 1500, "\u4E2D": 4e3, "\u9577": 8e3 };
  const lengthHint = lengthMap[args.length] || lengthMap["\u4E2D"];
  const maxTokens = tokenMap[args.length] || 4e3;
  const extra = (args.extra || "").trim();
  const userPrompt = `\u6B21\u306E\u6761\u4EF6\u3067\u55B6\u696D\u6587\u66F8\u306E\u300C\u6587\u9762 \u69CB\u6210 \u63D0\u6848\u30ED\u30B8\u30C3\u30AF\u300D\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002
\u5B9B\u5148 \u76F8\u624B: ${recipient}
\u7528\u9014 \u6587\u66F8\u7A2E\u5225: ${purpose}
\u8AAD\u307F\u624B\u30EC\u30D9\u30EB: ${audienceLevel}
\u5206\u91CF\u306E\u76EE\u5B89: ${lengthHint}
\u8F09\u305B\u308B\u9805\u76EE:
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}
` + (extra ? `\u88DC\u8DB3\u6307\u793A: ${extra}
` : "") + `
\u6307\u5B9A\u306E4\u30D6\u30ED\u30C3\u30AF\u69CB\u6210\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002`;
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: DOC_MODEL,
        max_tokens: maxTokens,
        system: DOC_SYSTEM,
        messages: [{ role: "user", content: userPrompt }]
      })
    });
  } catch (e) {
    return { ok: false, error: "anthropic fetch\u5931\u6557: " + String(e.message || e) };
  }
  const status = res.status;
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status, error: "anthropic\u5FDC\u7B54\u304CJSON\u3067\u306A\u3044" };
  }
  if (status !== 200) {
    return { ok: false, status, error: data && data.error && data.error.message || "anthropic\u975E200", detail: data };
  }
  const document = (Array.isArray(data.content) ? data.content : []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!document) {
    return { ok: false, status, error: "\u751F\u6210\u30C6\u30AD\u30B9\u30C8\u304C\u7A7A", detail: data };
  }
  return {
    ok: true,
    model: DOC_MODEL,
    recipient,
    purpose,
    audience_level: audienceLevel,
    document,
    note: "\u3053\u308C\u306F\u6587\u9762 \u69CB\u6210 \u30ED\u30B8\u30C3\u30AF\u306E\u30C6\u30AD\u30B9\u30C8\u3002pptx\u898B\u305F\u76EE\u306F\u5225\u9014\u4ED5\u4E0A\u3052\u308B\u3002"
  };
}
__name(generateDocument, "generateDocument");
var MONITOR_TARGETS = [
  { name: "hs-pdf-gen", binding: "PDF_GEN" },
  { name: "hs-estimate", binding: "ESTIMATE" },
  { name: "hs-gyosha-check", binding: "GYOSHA_CHECK" },
  { name: "hs-genka-ingest", binding: "GENKA_INGEST" }
];
async function pingBinding(binding, name, bindingName) {
  const t0 = Date.now();
  try {
    const res = await binding.fetch(new Request("https://svc/health", { method: "GET" }));
    const ms = Date.now() - t0;
    return { name, binding: bindingName, status: res.status, ms, up: res.status >= 200 && res.status < 400 };
  } catch (e) {
    return { name, binding: bindingName, status: 0, ms: Date.now() - t0, up: false, error: String(e.message || e) };
  }
}
__name(pingBinding, "pingBinding");
async function monitorHealth(env) {
  const checks = await Promise.all(
    MONITOR_TARGETS.map((t) => {
      const b = env[t.binding];
      if (!b) return Promise.resolve({ name: t.name, binding: t.binding, status: 0, ms: 0, up: false, error: "binding\u672A\u8A2D\u5B9A" });
      return pingBinding(b, t.name, t.binding);
    })
  );
  const self = { name: "hs-internal-mcp", self: true, up: true };
  const workers = checks.concat([self]);
  const up = workers.filter((w) => w.up).length;
  const down = workers.length - up;
  const alerts = workers.filter((w) => !w.up).map((w) => w.name);
  return {
    ok: true,
    checked_at: (/* @__PURE__ */ new Date()).toISOString(),
    summary: { total: workers.length, up, down },
    workers,
    alerts
  };
}
__name(monitorHealth, "monitorHealth");
async function sendLineAlert(env, text) {
  const token = env.LINE_CHANNEL_TOKEN;
  const to = env.ALERT_LINE_TO;
  if (!token || !to) {
    return { sent: false, skipped: "LINE_CHANNEL_TOKEN \u307E\u305F\u306F ALERT_LINE_TO \u672A\u8A2D\u5B9A" };
  }
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "text", text: String(text).slice(0, 4900) }] })
    });
    return { sent: res.status === 200, status: res.status };
  } catch (e) {
    return { sent: false, error: String(e.message || e) };
  }
}
__name(sendLineAlert, "sendLineAlert");
var ERROR_KV = {
  "hs-genka-ingest": { kv: "GENKA_VERIFIED", key: "error:hs-genka-ingest" },
  "hs-estimate": { kv: "HS_ESTIMATE_KV", key: "error:hs-estimate" },
  "hs-pdf-gen": { kv: "ORDERS", key: "error:hs-pdf-gen" }
};
async function readCause(env, name) {
  const m = ERROR_KV[name];
  if (!m || !env[m.kv]) return null;
  try {
    const raw = await env[m.kv].get(m.key);
    if (!raw) return null;
    const e = JSON.parse(raw);
    return (e.path || "?") + " \u3067 " + (e.message || "?");
  } catch (_) {
    return null;
  }
}
__name(readCause, "readCause");
function suggestFix(cause) {
  if (!cause) return null;
  const s = String(cause).toLowerCase();
  if (/is undefined|is not defined|cannot read/.test(s)) {
    return "env\u5909\u6570/binding\u672A\u8A2D\u5B9A\u3092\u7591\u3048\u3002wrangler.jsonc \u306E binding \u304B wrangler secret put \u3092\u78BA\u8A8D";
  }
  if (/timeout|timed out|etimedout/.test(s)) {
    return "\u4E0A\u6D41Worker/\u5916\u90E8API\u306E\u5FDC\u7B54\u9045\u5EF6\u3092\u7591\u3048\u3002service binding\u5148\u306E\u6B7B\u6D3B\u3068\u30ED\u30B0(wrangler tail)\u3092\u78BA\u8A8D";
  }
  if (/5xx|\b5\d\d\b/.test(s)) {
    return "\u8A72\u5F53endpoint\u304C5xx\u3092\u8FD4\u3057\u3066\u3044\u308B\u3002\u8A72\u5F53Worker\u306E\u30ED\u30B0(wrangler tail)\u3092\u78BA\u8A8D";
  }
  return "\u8A72\u5F53path\u306E\u76F4\u8FD1\u5909\u66F4(deploy/secret/binding)\u3092\u78BA\u8A8D";
}
__name(suggestFix, "suggestFix");
async function notifyMonitorDiff(env, result) {
  if (!env.HS_DESIGN_KV) return { sent: false, skipped: "KV\u672A\u8A2D\u5B9A" };
  const curr = (result.alerts || []).slice().sort();
  let prev = [];
  try {
    const raw = await env.HS_DESIGN_KV.get("monitor:notified");
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) prev = p.slice().sort();
    }
  } catch (e) {
    prev = [];
  }
  if (JSON.stringify(curr) === JSON.stringify(prev)) {
    return { sent: false, skipped: "\u5909\u5316\u306A\u3057", down: curr };
  }
  const newlyDown = curr.filter((n) => !prev.includes(n));
  const recovered = prev.filter((n) => !curr.includes(n));
  const lines = [];
  if (newlyDown.length) {
    lines.push("DOWN\u691C\u77E5: " + newlyDown.join(", "));
    for (const n of newlyDown) {
      const cause = await readCause(env, n);
      if (cause) lines.push("  \u2514 \u6B7B\u56E0(" + n + "): " + cause);
      if (cause) {
        const fix = suggestFix(cause);
        if (fix) lines.push("  \u2514 \u5BFE\u51E6\u6848(" + n + "): " + fix);
      }
    }
  }
  if (recovered.length) lines.push("\u5FA9\u65E7: " + recovered.join(", "));
  lines.push(curr.length ? "\u73FE\u5728down\u4E2D: " + curr.join(", ") : "\u73FE\u5728 \u5168Worker\u5065\u5168");
  lines.push("\u6642\u523B: " + result.checked_at);
  const text = "[HORIZON SHIELD \u4FDD\u5168]\n" + lines.join("\n");
  const r = await sendLineAlert(env, text);
  if (r.sent) {
    try {
      await env.HS_DESIGN_KV.put("monitor:notified", JSON.stringify(curr));
    } catch (e) {
      r.notified_write_error = String(e.message || e);
    }
  }
  return { sent: r.sent, status: r.status, skipped: r.skipped, error: r.error, newlyDown, recovered, down: curr };
}
__name(notifyMonitorDiff, "notifyMonitorDiff");
async function runScheduledMonitor(env, source) {
  const result = await monitorHealth(env);
  result.source = source;
  result.cron = true;
  try {
    if (env.HS_DESIGN_KV) {
      await env.HS_DESIGN_KV.put("monitor:latest", JSON.stringify(result));
      if (result.summary && result.summary.down > 0) {
        await env.HS_DESIGN_KV.put("monitor:lastdown", JSON.stringify(result));
      }
      result.kv_written = true;
    } else {
      result.kv_written = false;
      result.kv_error = "HS_DESIGN_KV binding \u672A\u8A2D\u5B9A";
    }
  } catch (e) {
    result.kv_written = false;
    result.kv_error = String(e.message || e);
  }
  try {
    result.notify = await notifyMonitorDiff(env, result);
  } catch (e2) {
    result.notify = { sent: false, error: String(e2.message || e2) };
  }
  return result;
}
__name(runScheduledMonitor, "runScheduledMonitor");
function wantsSSE(req) {
  return (req.headers.get("Accept") || "").includes("text/event-stream");
}
__name(wantsSSE, "wantsSSE");
function rpcSend(req, id, payload) {
  const msg = { jsonrpc: "2.0", id, ...payload };
  if (wantsSSE(req)) {
    const body = `event: message
data: ${JSON.stringify(msg)}

`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  }
  return new Response(JSON.stringify(msg), { headers: { "Content-Type": "application/json" } });
}
__name(rpcSend, "rpcSend");
var rpcResult = /* @__PURE__ */ __name((req, id, result) => rpcSend(req, id, { result }), "rpcResult");
var rpcError = /* @__PURE__ */ __name((req, id, code, message) => rpcSend(req, id, { error: { code, message } }), "rpcError");
var SERVER_INFO = {
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  serverInfo: { name: "hs-internal-mcp", version: "0.1.0" }
};
var worker_default = {
  // cron(wrangler.jsonc triggers.crons)で30分毎に自動実行。結果はHS_DESIGN_KVへ。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledMonitor(env, "scheduled"));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const CORS = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (req.method === "OPTIONS" && url.pathname === "/admin-gen") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === "/admin-gen" && req.method === "POST") {
      if (!env.INTERNAL_MCP_KEY || url.searchParams.get("key") !== env.INTERNAL_MCP_KEY) {
        return new Response(JSON.stringify({ ok: false, error: "bad key" }), { status: 401, headers: { "Content-Type": "application/json", ...CORS } });
      }
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "body is not JSON" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      }
      const out = await generateSlides(body || {}, env);
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", ...CORS } });
    }
    const auth = req.headers.get("Authorization") || "";
    const ok = env.INTERNAL_MCP_KEY && auth === `Bearer ${env.INTERNAL_MCP_KEY}`;
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "hs-internal-mcp", tools: TOOLS.length }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/cron-test") {
      if (url.searchParams.get("ping") === "line") {
        const linePing = await sendLineAlert(env, "[HORIZON SHIELD \u4FDD\u5168] LINE\u758E\u901A\u30C6\u30B9\u30C8 " + (/* @__PURE__ */ new Date()).toISOString());
        return new Response(JSON.stringify({ ok: true, line_ping: linePing }), { headers: { "Content-Type": "application/json" } });
      }
      const result = await runScheduledMonitor(env, "cron-test");
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return rpcError(req, null, -32700, "parse error");
      }
      const { id, method, params } = body || {};
      if (method === "initialize") {
        return rpcResult(req, id, SERVER_INFO);
      }
      if (method === "notifications/initialized" || method === "notifications/cancelled") {
        return new Response(null, { status: 202 });
      }
      if (method === "tools/list") {
        return rpcResult(req, id, { tools: TOOLS });
      }
      if (method === "tools/call") {
        const toolName = params?.name;
        const args = params?.arguments || {};
        try {
          const out = await callTool(toolName, args, env);
          return rpcResult(req, id, { content: [{ type: "text", text: JSON.stringify(out) }] });
        } catch (e) {
          return rpcError(req, id, -32e3, String(e.message || e));
        }
      }
      return rpcError(req, id, -32601, `method not found: ${method}`);
    }
    return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
