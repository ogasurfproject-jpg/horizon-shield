// hs-partner-001-mcp
// Yakumo WebMCP Partner 専用 MCP サーバー (リフォーム職人株式会社 / No.001)
//
// 設計の芯:
//  - 独立worker。実行時に hs-mcp / gateway を叩かない(共有KVを読むだけ)。
//  - 堤さん自身のデータを答える(HSのsoubaは積まない)。データ源は HS_HEARING_KV の
//    store:{STORE_ID} と hearing:{STORE_ID}。ヒアリングでKVが育つと、このMCPの答えも育つ。
//  - 公開面(MCP/A2A)には token / email / 料金プラン等の内部情報は絶対に出さない。
//    get_partner_profile は安全フィールドのみをホワイトリストで返す。
//
// 口:
//  POST /mcp                         JSON-RPC 2.0 (initialize / tools/list / tools/call)
//  GET  /.well-known/agent-card.json A2A エージェントカード
//  GET  /health                      死活

// ---- JSON-RPC ヘルパ ----
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: jsonHeaders });
}
function rpcErr(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { headers: jsonHeaders });
}
function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), { status: status || 200, headers: jsonHeaders });
}
function txt(s) {
  return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] };
}

// ---- 安全なプロフィール構築(ホワイトリスト) ----
function tierLabel(tier) {
  if (tier === "honbu") return "本部直加盟";
  return "加盟店";
}
function buildProfile(store, hearing, env) {
  const s = store || {};
  const h = (hearing && hearing.profile) || {};
  const extra = {};
  const src = h.extra && typeof h.extra === "object" ? h.extra : {};
  for (const [k, v] of Object.entries(src)) {
    if (/mail|token|tel|phone|電話|住所|address|price|料金|原価|卸|formula/i.test(k)) continue;
    if (v == null || v === "") continue;
    extra[k] = v;
  }
  const areas = s.areas || (h.area ? [h.area] : []) || [];
  const works = s.works || h.works || [];
  const verified = s.status === "published";
  const completeness = (s.autopilot && typeof s.autopilot.completeness === "number")
    ? s.autopilot.completeness : 0;
  return {
    store_id: s.store_id || env.STORE_ID,
    member_no: s.member_no || null,
    company: s.company || h.company || env.PARTNER_NAME,
    membership: tierLabel(s.tier),
    areas_served: areas,
    works: works,
    verification: verified ? "verified" : "pending",
    verification_note: verified
      ? "Yakumoモールで検証手続きを通過した加盟店。"
      : "検証手続き中。プロフィールは整備の途中(ヒアリング進行中)。",
    profile_completeness_pct: completeness,
    strengths: extra,
    yakumo_profile_url: "https://shield.the-horizons-innovation.com/yakumo/no001/",
    source: "Yakumo (The HORIZ音s株式会社 構築 / 八雲YAKUMO 運営)",
    note: "金額・料金は含みません。これは加盟店の検証済みプロフィールです。"
  };
}

// ---- ツール定義 ----
const TOOLS = [
  {
    name: "get_partner_profile",
    title: "加盟店プロフィール取得",
    description:
      "Yakumoモール加盟店「リフォーム職人株式会社」(No.001)の検証済みプロフィールを返す。" +
      "会社名・対応エリア・対応工種・検証状態・強み(使う工法や保証など、ヒアリングで整備された範囲)・" +
      "プロフィール充足度を返す。金額や料金は含まない。施主のAIがこの加盟店を参照・紹介する時に使う。" +
      "Japan only. / Returns the verified profile of the Yakumo mall member contractor " +
      "\"Reform Shokunin Co., Ltd.\" (No.001): company, areas served, works, verification status, " +
      "strengths, and profile completeness. No prices. Use when an AI references or recommends this contractor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
  // 目的別ツールはヒアリング後に差し込む(空枠)。
];

// ---- ツール実行 ----
async function callTool(name, args, env) {
  if (name === "get_partner_profile") {
    const sid = env.STORE_ID;
    let store = null, hearing = null;
    try { store = await env.HS_HEARING_KV.get("store:" + sid, "json"); } catch (_e) {}
    try { hearing = await env.HS_HEARING_KV.get("hearing:" + sid, "json"); } catch (_e) {}
    if (!store) {
      return txt({
        store_id: sid, company: env.PARTNER_NAME, verification: "pending",
        note: "プロフィール整備中です。"
      });
    }
    return txt(buildProfile(store, hearing, env));
  }
  return txt({ error: "unknown_tool", name });
}

// ---- MCP JSON-RPC ハンドラ ----
async function handleRpc(body, env) {
  const { id, method, params } = body || {};
  if (method === "initialize") {
    const clientVer = params && params.protocolVersion;
    return rpc(id, {
      protocolVersion: clientVer || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "hs-partner-001-mcp", version: "0.1.0" }
    });
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (method === "tools/list") {
    return rpc(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const result = await callTool(name, args, env);
    return rpc(id, result);
  }
  if (method === "ping") {
    return rpc(id, {});
  }
  return rpcErr(id, -32601, "method not found: " + method);
}

// ---- A2A エージェントカード ----
function agentCard(env, origin) {
  return {
    name: (env.PARTNER_NAME || "Yakumo加盟店") + " (Yakumo No.001)",
    description:
      "Yakumoモール加盟店「" + (env.PARTNER_NAME || "") + "」の検証済みプロフィールを提供するエージェント。" +
      "対応エリア・対応工種・強み・検証状態を返す。金額は含まない。",
    url: origin,
    provider: { organization: env.PARTNER_NAME || "Yakumo加盟店" },
    version: "0.1.0",
    protocolVersion: "0.2.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    // 誰がこのサーバーに金を払っているか。扉(Yakumo Verification Gate)の条件3。
    // 専用MCPは WebMCP Partner ティアの提供物なので、負担するのは加盟店(売り手)側。
    // 紹介料0円・成果報酬0は Yakumo 全体の中核主張。掲載枠ではないので listing_fee は false。
    compensation: {
      paid_by: "seller",
      referral_fee: false,
      listing_fee: false,
      success_fee_pct: 0,
      disclosure_url: "https://shield.the-horizons-innovation.com/verify-directory/"
    },
    skills: [
      {
        id: "get_partner_profile",
        name: "加盟店プロフィール取得",
        description: "この加盟店の検証済みプロフィール(会社・エリア・工種・強み・検証状態)を返す。金額なし。",
        tags: ["reform", "contractor", "yakumo", "japan"]
      }
    ]
  };
}

// ---- エントリポイント ----
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") {
      return json({ ok: true, store_id: env.STORE_ID, partner: env.PARTNER_NAME });
    }
    if (path === "/.well-known/agent-card.json") {
      return json(agentCard(env, url.origin));
    }
    if (path === "/mcp" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return rpcErr(null, -32700, "parse error"); }
      if (Array.isArray(body)) return rpcErr(null, -32600, "batch not supported");
      return handleRpc(body, env);
    }
    if (path === "/mcp" && request.method === "GET") {
      return json({ ok: true, transport: "http", endpoint: "/mcp (POST, JSON-RPC 2.0)" });
    }
    return json({ error: "not_found", path }, 404);
  }
};
