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

// ---- 「無かった」と「引けなかった」を分ける ----
// Federico Blanco Sanchez-Llanos, "The Mould, Not the Letter", 2026-08-20:
//   never let "the fetch failed" and "the fetch succeeded and found nothing"
//   collapse into the same downstream value.
//
// 2026-08-20 の実測: この worker はその規則を破っていた。
//   try { store = await KV.get(...) } catch (_e) {}     ← 失敗を握り潰す
//   if (!store) return txt({ note: "プロフィール整備中です。" })
// KVが落ちていても、KVが健全で記録が無くても、施主のAIには同じ一文が返っていた。
// 「この加盟店はまだ整備中」と「こちらが読めなかった」が同じ値になっていた。
// 前者は加盟店についての主張で、後者は自分についての報告。混ぜてはいけない。
//
// 三状態にする。ok / absent は成功として返し、failed は tools/call のエラー
// チャネル(isError)に載せる。読む側は絶対に取り違えられない。
async function kvRead(kv, key) {
  if (!kv) return { lookup: "failed", reason: "KV binding is not configured" };
  try {
    const value = await kv.get(key, "json");
    return value == null
      ? { lookup: "absent", value: null }   // 引けた。無かった。
      : { lookup: "ok", value: value };     // 引けた。有った。
  } catch (e) {
    return { lookup: "failed", reason: String((e && e.message) || e) };  // 引けなかった。
  }
}

// outputSchema を宣言する以上、成功時は structuredContent を必ず返す(MCP 2025-06-18)。
// content 側にも同じJSONを載せる(旧クライアント互換)。
function ok(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj
  };
}
// 引けなかった時。加盟店について何も主張しない。
function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

const PROFILE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    lookup: {
      type: "string",
      enum: ["ok", "absent"],
      description:
        "ok = the record was read and exists. absent = the read SUCCEEDED and there is no " +
        "record yet. A read that FAILED never appears here: it is returned as a tool error " +
        "(isError: true) with no profile, so a consumer can never mistake our own failure " +
        "for a statement about this contractor."
    },
    found: { type: "boolean", description: "true only when a stored record was returned." },
    hearing_lookup: {
      type: "string",
      enum: ["ok", "absent", "failed"],
      description:
        "The secondary read (hearing data, which fills in strengths). If this is 'failed' " +
        "the profile is returned but is incomplete, and says so here rather than looking thin."
    },
    store_id: { type: "string" },
    company: { type: ["string", "null"] },
    verification: { type: "string" },
    note: { type: "string" }
  },
  required: ["lookup", "found"],
  additionalProperties: true
};

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
    source: "Yakumo (The HORIZONs株式会社 構築 / Yakumo 運営)",
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
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: PROFILE_OUTPUT_SCHEMA
  }
  // 目的別ツールはヒアリング後に差し込む(空枠)。
];

// ---- ツール実行 ----
async function callTool(name, args, env) {
  if (name === "get_partner_profile") {
    const sid = env.STORE_ID;
    const storeRead = await kvRead(env.HS_HEARING_KV, "store:" + sid);
    const hearingRead = await kvRead(env.HS_HEARING_KV, "hearing:" + sid);

    // 引けなかった。加盟店について何も言わない。黙って「整備中」と言わない。
    if (storeRead.lookup === "failed") {
      return toolError(
        "The profile lookup failed: " + storeRead.reason + ". " +
        "This is NOT the same as this contractor having no profile yet — no claim is made " +
        "about the contractor either way. Retry, or check the store record directly."
      );
    }
    // 引けた。無かった。これは加盟店についての本当の事実。
    if (storeRead.lookup === "absent") {
      return ok({
        lookup: "absent",
        found: false,
        hearing_lookup: hearingRead.lookup,
        store_id: sid,
        company: env.PARTNER_NAME || null,
        verification: "pending",
        note: "参照は成功しました。この加盟店の記録はまだ作成されていません。"
      });
    }
    // 引けた。有った。
    const hearing = hearingRead.lookup === "ok" ? hearingRead.value : null;
    return ok(Object.assign(
      { lookup: "ok", found: true, hearing_lookup: hearingRead.lookup },
      buildProfile(storeRead.value, hearing, env)
    ));
  }
  return toolError("unknown tool: " + String(name));
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
    // 誰がこのサーバーに金を払っているか。扉(MCP Verification Gate)の条件3。
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
