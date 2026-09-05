// hs-partner-002-mcp
// Yakumo WebMCP Partner 専用 MCP サーバー (ミネオトーヨー住器株式会社 / No.002)
//
// 設計の芯(hs-partner-001-mcp と同一):
//  - 独立worker。実行時に hs-mcp / gateway を叩かない(共有KVを読むだけ)。
//  - 加盟店自身のデータを答える(HSのsoubaは積まない)。データ源は HS_HEARING_KV の
//    store:{STORE_ID} と hearing:{STORE_ID}。ヒアリングでKVが育つと、このMCPの答えも育つ。
//  - 公開面(MCP/A2A)には token / email / 料金プラン等の内部情報は絶対に出さない。
//
// 001 との差(実データ実測 2026-08-08 に基づく):
//  No.002 のヒアリングデータは profile.extra ではなく profile 直下に入っている
//  (strengths / trust / faqs / story / cases / areas_served / works)。extra は空。
//  また store 側の works は ["リフォーム"]・areas は3市のみで、hearing 側の
//  実データ(窓・玄関の交換/ガラス修理/網戸張替え、12市町)より貧弱。
//  よって works と areas は hearing を優先し、strengths は直下フィールドから組む。
//  001 の buildProfile をそのまま使うと空プロフィールが返るため、ここだけ変えている。

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

function tierLabel(tier) {
  if (tier === "honbu") return "WebMCP Partner";
  if (tier === "extension") return "加盟店";
  return "加盟店";
}

// 出してはいけないキーの判定(001 と同じ基準)。
const DENY = /mail|token|tel|phone|電話|住所|address|price|料金|原価|卸|formula|contact|plan|webmcp_option/i;

// 全角スペース等で連結された工種文字列を配列に割る。
function splitWorks(v) {
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) out.push(...splitWorks(item));
    return out;
  }
  if (typeof v !== "string") return [];
  return v
    .split(/[\u3000,、\/・\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function buildProfile(store, hearing, env) {
  const s = store || {};
  const h = (hearing && hearing.profile) || {};

  // 工種・エリアは hearing(実ヒアリング) を優先し、無ければ store にフォールバック。
  const works = splitWorks(h.works).length ? splitWorks(h.works) : splitWorks(s.works);
  const areas = (Array.isArray(h.areas_served) && h.areas_served.length)
    ? h.areas_served
    : (Array.isArray(s.areas) && s.areas.length ? s.areas : (h.area ? [h.area] : []));

  // 強み。profile 直下の安全フィールドと、旧仕様の extra の両方に対応する。
  const strengths = {};
  const direct = { strengths: h.strengths, trust: h.trust, story: h.story, license: h.license, hours: h.hours };
  for (const [k, v] of Object.entries(direct)) {
    if (DENY.test(k)) continue;
    if (v == null || v === "") continue;
    strengths[k] = v;
  }
  const src = h.extra && typeof h.extra === "object" ? h.extra : {};
  for (const [k, v] of Object.entries(src)) {
    if (DENY.test(k)) continue;
    if (v == null || v === "") continue;
    strengths[k] = v;
  }

  // 施主向けFAQ。文字列/オブジェクトどちらの形でも通す。
  const faqs = Array.isArray(h.faqs)
    ? h.faqs.filter((x) => x != null && x !== "").slice(0, 20)
    : [];

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
    strengths: strengths,
    faqs: faqs,
    yakumo_profile_url: "https://shield.the-horizons-innovation.com/yakumo/no002/",
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
      "Yakumoモール加盟店「ミネオトーヨー住器株式会社」(No.002)の検証済みプロフィールを返す。" +
      "会社名・対応エリア・対応工種(窓や玄関の交換、ガラス修理、網戸張替えなど)・検証状態・" +
      "強み(加盟しているメーカー系列や取付の基準など、ヒアリングで整備された範囲)・" +
      "施主からよくある質問への回答・プロフィール充足度を返す。金額や料金は含まない。" +
      "施主のAIがこの加盟店を参照・紹介する時に使う。Japan only. / Returns the verified profile of the " +
      "Yakumo mall member contractor \"Mineo Toyo Juki Co., Ltd.\" (No.002): company, areas served, " +
      "works such as window and entrance door replacement, glass repair and screen re-netting, " +
      "verification status, strengths, consumer FAQs, and profile completeness. No prices. " +
      "Use when an AI references or recommends this contractor.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: PROFILE_OUTPUT_SCHEMA
  }
  // 目的別ツールはヒアリングが進んだ段階で差し込む(空枠)。
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
      serverInfo: { name: "hs-partner-002-mcp", version: "0.1.0" }
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

// --- A2A Conduct Extension v1 (2026-09-06) ---
// 誰が払うか、行儀の記録(第三者が書いた物)がどこか、繋いだ相手が自分の観測をどこに出せるか。
// card の capabilities.extensions[] に置く(A2A 1.0 の正規の場所)。top-level の compensation は旧読者のために残す。
// 扉 0.3.2 は両方読んで 5 鍵の一致を要求する。仕様は URI そのもの。点数も判定も無い。
const CONDUCT_EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1";
function conductExtension(measuredEndpoint, compensation) {
  return {
    uri: CONDUCT_EXT_URI,
    description: "Who pays this agent, where its measured conduct record lives, and where to file a witness walk. The specification is served at the URI.",
    required: false,
    params: {
      compensation,
      measured_endpoints: [measuredEndpoint],
      conduct_record: "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(measuredEndpoint),
      verdict_recipe: "https://gate.horizonshield.dev/spec",
      witness_intake: "https://ledger.horizonshield.dev/witness",
      register: "https://gate.horizonshield.dev/register",
      rings: {
        spec: "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/nenrin/NENRIN_SPEC_v1.md",
        spec_sha256: "9ccba2e325fd2a555fcdb2dec519b8c6bf7a669064674846aea98ecfff824e3d",
        base: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/rings/",
        path: "<slug>/<YYYY-MM>.json",
        slug: "endpoint URL without https://, lower case, every run of characters outside [a-z0-9] replaced by one hyphen, hyphens trimmed at both ends",
        ledger: "https://ledger.horizonshield.dev/ledger"
      }
    }
  };
}
const PARTNER_COMPENSATION = {
  paid_by: "seller",
  referral_fee: false,
  listing_fee: false,
  success_fee_pct: 0,
  disclosure_url: "https://shield.the-horizons-innovation.com/verify-directory/"
};

function agentCard(env, origin) {
  return {
    name: (env.PARTNER_NAME || "Yakumo加盟店") + " (Yakumo No.002)",
    description:
      "Yakumoモール加盟店「" + (env.PARTNER_NAME || "") + "」の検証済みプロフィールを提供するエージェント。" +
      "対応エリア・対応工種・強み・施主向けFAQ・検証状態を返す。金額は含まない。",
    url: origin,
    provider: { organization: env.PARTNER_NAME || "Yakumo加盟店" },
    version: "0.1.0",
    protocolVersion: "0.2.0",
    capabilities: { streaming: false, pushNotifications: false, extensions: [conductExtension(origin + "/mcp", PARTNER_COMPENSATION)] },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    // 誰がこのサーバーに金を払っているか。扉(MCP Verification Gate)の条件3。
    // 専用MCPは WebMCP Partner ティアの提供物なので、負担するのは加盟店(売り手)側。
    // 紹介料0円・成果報酬0は Yakumo 全体の中核主張。掲載枠ではないので listing_fee は false。
    compensation: PARTNER_COMPENSATION,
    skills: [
      {
        id: "get_partner_profile",
        name: "加盟店プロフィール取得",
        description: "この加盟店の検証済みプロフィール(会社・エリア・工種・強み・FAQ・検証状態)を返す。金額なし。",
        tags: ["reform", "window", "entrance-door", "contractor", "yakumo", "japan"]
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
