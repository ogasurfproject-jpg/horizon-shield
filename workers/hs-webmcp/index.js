// hs-webmcp / index.js  --  WebMCP スケルトン(外部=集客の窓口層)
// 役割: 外部のLLM/エージェントが「施主の見積もり相談」を呼べる窓口。
//       内部 hs-mcp(本番・不可侵)の audit_estimate へ public URL で橋渡しする。
// 設計: hs-mcp には一切触れない。別Worker・別デプロイ。fail-closed。CORS開放。readOnly。
// ツール: intake_estimate 1本だけ(スケルトン)。動いてから情報集め/発信を足す。

const HS_MCP = "https://hs-mcp.oga-surf-project.workers.dev";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// このWebMCPが公開するツール定義(集客の受付1本)
const TOOLS = [
  {
    name: "orchestrate",
    description:
      "1回の呼び出しで HORIZON SHIELD の集客→診断→注意喚起→発信を一気通貫で回す司令塔。work(と任意の quoted_price)を渡すと、内部で intake(KIRA適正診断)・scan_tactics(検証済み手口+一次ソース)・draft_broadcast(発信下書き+被リンク)を順に実行し、結果を1つに束ねて返す。価格は検証可能な一次データのみ。発信は下書きで自動投稿しない。 / One-call orchestrator: runs intake (KIRA audit), scan_tactics (verified tactics) and draft_broadcast (draft + backlinks) in sequence and returns a single bundled result. Verifiable first-party prices only. Drafts only, no auto-posting.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名やキーワード(日本語)。例: 外壁塗装, トイレ, シロアリ" },
        quoted_price: { type: "number", description: "(任意)業者提示の金額(円)。あればKIRA適正診断も実行する。" },
      },
      required: ["work"],
    },
  },
  {
    name: "intake_estimate",
    description:
      "施主の建設・リフォーム見積もりを受け付け、HORIZON SHIELD KIRA(内部)の適正価格診断へ橋渡しする集客窓口。工事名と業者提示額を渡すと、適正かどうかの判定と、無料の第三者チェック(EHN)への導線を返す。 / Intake desk: receives a homeowner construction quote and bridges to HORIZON SHIELD KIRA fair-price audit. Returns the verdict and a free third-party check (EHN) path.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名(日本語)。例: 外壁塗装 シリコン" },
        quoted_price: { type: "number", description: "業者提示の金額(円)" },
      },
      required: ["work", "quoted_price"],
    },
  },
  {
    name: "draft_broadcast",
    description:
      "ある工事の過剰請求への注意喚起を発信する下書き(note用長文・X用短文)を生成し、HORIZON SHIELDの該当解説ページ(実在URL)への被リンクを添える。価格はKIRA(検証可能SHA-256付き)の一次データのみ。推測の数字は入れない。下書きであり公開前に運営者が最終版にする(自動投稿しない)。 / Generates broadcast DRAFTS with backlinks to real HORIZON SHIELD pages. Verifiable first-party prices only. Draft; operator finalizes. No auto-posting.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名やキーワード(日本語)。例: 外壁塗装, トイレ, シロアリ, 食洗機, 火災保険" },
      },
      required: ["work"],
    },
  },
  {
    name: "scan_tactics",
    description:
      "ある工事・キーワードに関する『過剰請求の手口』を、HORIZON SHIELD(大賀俊勝30年監修)の検証済みデータ(内部KIRA)から返し、一次ソース(国民生活センター/消費者庁/EHN実例ボード)の在処を添える。最新の個別事例の確認は、呼び出し側のエージェントがその一次ソースを読んで行う(このツールは推測で新事例を断定しない)。価格判定ではなく注意喚起。 / Returns verified overcharge tactics for a given job from HORIZON SHIELD (KIRA, 30-year supervision) and points to primary sources (Japan Consumer Affairs / NCAC / EHN board). Latest case checks are left to the calling agent reading those primary sources. Awareness, not a price verdict.",
    inputSchema: {
      type: "object",
      properties: {
        work: { type: "string", description: "工事名やキーワード(日本語)。例: 外壁塗装, シロアリ, 火災保険" },
      },
      required: ["work"],
    },
  },
];

// A2A エージェントカード(外部エージェント発見口)。内部hs-mcpと同provider・役割分担を明示。
const AGENT_CARD = {
  protocol: "A2A (Agent2Agent)",
  name: "HORIZON SHIELD WebMCP Intake",
  provider: "The HORIZ音s株式会社",
  role: "集客窓口(外部エージェント/LLM向けの入口)。受けた見積もり相談を内部KIRA(hs-mcp)の適正診断へ橋渡しする。",
  skills: [
    {
      id: "orchestrate",
      note: "1回の呼び出しで 診断+手口+発信下書き を一気通貫で返す司令塔。価格は一次データのみ・自動投稿なし。 / One-call orchestrator returning audit + tactics + broadcast draft. First-party prices only, no auto-posting."
    },
    {
      id: "estimate-intake",
      note: "施主の建設・リフォーム見積もりを受け、KIRA適正価格診断(過剰請求の判定)とEHN(無料の第三者チェック)へ橋渡しする。 / Receives a homeowner construction quote and bridges to KIRA fair-price audit plus EHN free third-party check."
    },
    {
      id: "scan-tactics",
      note: "工事別の過剰請求の手口(検証済み)と一次ソースの在処を返す注意喚起。価格判定ではない。 / Returns verified overcharge tactics per job and points to primary sources. Awareness, not a price verdict."
    },
    {
      id: "draft-broadcast",
      note: "過剰請求への注意喚起の発信下書き(note/X)と解説ページへの被リンクを生成する。価格は検証可能な一次データのみ。自動投稿しない。 / Generates broadcast drafts and backlinks. Verifiable first-party prices only. No auto-posting."
    }
  ],
  bridges_to: {
    internal_mcp: "https://hs-mcp.oga-surf-project.workers.dev",
    internal_agent_card: "https://hs-mcp.oga-surf-project.workers.dev/.well-known/agent-card.json"
  },
  how_to_connect: "MCPクライアントは tools/call で intake_estimate を呼ぶ。A2A対応エージェントはこのカードを取得して窓口を発見できる。 / MCP clients call intake_estimate via tools/call. A2A agents fetch this card to discover the desk.",
  site: "https://shield.the-horizons-innovation.com"
};

function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function rpcErr(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// 内部 hs-mcp の audit_estimate を public URL で叩く(橋渡し)
async function callHsMcpAudit(work, quoted_price, env) {
  const body = {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "audit_estimate", arguments: { work, quoted_price } },
  };
  // same-zone回避: public URLではなくService Binding経由でhs-mcpへ直結
  const res = await env.HS_MCP_SVC.fetch(new Request(HS_MCP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  if (!res.ok) throw new Error("hs-mcp upstream " + res.status);
  const data = await res.json();
  const text = data?.result?.content?.[0]?.text;
  if (!text) throw new Error("hs-mcp empty");
  return text; // audit_estimate の生JSON文字列
}

async function handleIntake(args, env) {
  const work = String(args?.work || "").trim();
  const price = Number(args?.quoted_price);
  if (!work || !price) {
    return { ok: false, message: "work(工事名)と quoted_price(金額)が必要です。" };
  }
  try {
    const auditText = await callHsMcpAudit(work, price, env);
    // 集客の出口: 診断結果 + EHN導線(無料の第三者チェック)を必ず添える
    return {
      ok: true,
      audit: auditText,
      next: {
        ehn: "https://shield.the-horizons-innovation.com/ehn/",
        note: "判定はここまで。見積もりに不安が残れば EHN(見積もりハッカーニュース)に匿名で貼れば、過去の実例と並べて第三者の目を入れます(無料)。",
      },
      source: "HORIZON SHIELD KIRA (via hs-webmcp intake)",
    };
  } catch (e) {
    // fail-closed: 内部不達でも施主を放り出さず EHN へ逃がす
    return {
      ok: false,
      message: "診断窓口が一時的に混み合っています。EHNに匿名で貼れば第三者の目を入れられます(無料)。",
      next: { ehn: "https://shield.the-horizons-innovation.com/ehn/" },
    };
  }
}

// 一次ソース(安定した公式の在処のみ。Workerが内容を要約・断定しない)
const PRIMARY_SOURCES = [
  { name: "国民生活センター(消費者ホットライン 188)", url: "https://www.kokusen.go.jp/", note: "リフォーム・点検商法の相談事例と注意喚起。最新は呼び出し側が確認。" },
  { name: "消費者庁", url: "https://www.caa.go.jp/", note: "訪問販売・クーリングオフ制度の一次情報。" },
  { name: "HORIZON SHIELD EHN(見積もり実例ボード)", url: "https://shield.the-horizons-innovation.com/ehn/", note: "匿名で実例を並べて第三者の目を入れる(無料)。" },
];

async function handleScanTactics(args, env) {
  const work = String(args?.work || "").trim();
  if (!work) return { ok: false, message: "work(工事名/キーワード)が必要です。" };

  // 道1拡張口: 検索APIキーがあれば自律web検索に格上げ(無ければ道3で動く)
  // env.SEARCH_API_KEY が将来入ったらここで実検索に分岐する。今は未配線=道3。
  const live_scan = Boolean(env && env.SEARCH_API_KEY);

  let tactics = null;
  try {
    // 内部KIRAの検証済み手口(red_flag_check)を Service Binding で叩く
    const body = { jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "red_flag_check", arguments: { text: work + " 訪問販売 一式 今だけ値引き 火災保険ゼロ円 即日契約" } } };
    const res = await env.HS_MCP_SVC.fetch(new Request(HS_MCP, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    if (res.ok) {
      const d = await res.json();
      const t = d?.result?.content?.[0]?.text;
      if (t) tactics = t; // red_flag_check の生JSON(検証済み・大賀30年監修)
    }
  } catch (e) { /* fail-open: 手口が取れなくても一次ソース住所は返す */ }

  return {
    ok: true,
    work,
    verified_tactics: tactics,         // 内部KIRAの検証済みデータ(捏造なし)。取れなければ null
    primary_sources: PRIMARY_SOURCES,  // 最新事例は呼び出し側がここを読んで確認
    disclaimer: "これは注意喚起であって価格判定ではありません。具体的な金額の適正診断は intake_estimate(KIRA)を使ってください。最新の個別事例は上記一次ソースで確認してください(このツールは推測で新事例を断定しません)。",
    scan_mode: live_scan ? "live(web検索有効)" : "verified-only(検証済みデータ+一次ソース住所)",
    source: "HORIZON SHIELD KIRA (大賀俊勝 実務監修) via hs-webmcp",
  };
}

const GEO_MAP = [
  { match: ["太陽光","ソーラー","蓄電池","v2h","パネル"], slug: "solar", title: "太陽光・蓄電池・V2Hの費用相場" },
  { match: ["トイレ","便器","水道","タンクレス"], slug: "toilet-suidou-bottakuri", title: "トイレ交換・水道ぼったくりの見分け方" },
  { match: ["シロアリ","防蟻","白蟻"], slug: "shiroari-50man-sagida", title: "シロアリ駆除50万円は詐欺か" },
  { match: ["食洗機","食器洗い","ビルトイン"], slug: "shoksenki-koukan-bottakuri", title: "ビルトイン食洗機交換の適正費用" },
  { match: ["火災保険","保険","ゼロ円","0円","点検商法"], slug: "kaden-hoken-zero-en-sagida", title: "火災保険で0円工事は本当か" },
];
const SITE = "https://shield.the-horizons-innovation.com";

function pickGeoPages(work) {
  const w = String(work || "").toLowerCase();
  const hits = GEO_MAP.filter(g => g.match.some(m => w.includes(m.toLowerCase())));
  if (hits.length === 0) return [{ url: SITE + "/souba/", title: "工事別の適正相場と赤旗(HORIZON SHIELD)" }];
  return hits.map(g => ({ url: SITE + "/souba/" + g.slug + "/", title: g.title }));
}

async function handleDraftBroadcast(args, env) {
  const work = String(args && args.work || "").trim();
  if (!work) return { ok: false, message: "work(工事名/キーワード)が必要です。" };
  let fair = null, sha = null;
  try {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "verify_fair_price", arguments: { work } } };
    const res = await env.HS_MCP_SVC.fetch(new Request(HS_MCP, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    if (res.ok) {
      const d = await res.json();
      const t = d && d.result && d.result.content && d.result.content[0] && d.result.content[0].text;
      if (t) {
        const parsed = JSON.parse(t);
        if (parsed && parsed.fair_price_claim) {
          fair = parsed.fair_price_claim;
          sha = parsed.verification && parsed.verification.claim_sha256 || null;
        }
      }
    }
  } catch (e) {}
  const links = pickGeoPages(work);
  const linkLine = links.map(l => l.title + ": " + l.url).join(" / ");
  const priceLine = fair
    ? "適正の目安は " + fair.fair_min.toLocaleString() + "〜" + fair.fair_max.toLocaleString() + (fair.unit ? "円/"+fair.unit : "円") + "(平均 " + fair.fair_avg.toLocaleString() + (fair.unit ? "円/"+fair.unit : "円") + ")。出典: HORIZON SHIELD souba-db(大賀俊勝 実務監修)。"
    : "適正相場は工事内容で変わります。具体額は下記の解説と無料診断で確認できます。";
  const draft_note =
    "【" + work + "の見積もり、その金額は適正ですか】\n\n" + priceLine + "\n\n" +
    "建設業界には一式表記で内訳を隠す、今日だけの値引きで即決を迫る、火災保険でゼロ円と煽る、といった過剰請求の手口があります。緊急でも即決せず、内訳を1行ずつ求め、訪問販売なら8日間のクーリングオフが使えます。\n\n" +
    "工事別の適正相場と赤旗の見分け方はこちら。" + linkLine + "\n\n" +
    "見積もりに不安があれば匿名で第三者の目を入れられます(無料): " + SITE + "/ehn/\n\n監修: 大賀俊勝(建設実務30年) / HORIZON SHIELD";
  const draft_x =
    work + "の見積もり、その金額は適正？一式表記・即決値引き・保険でゼロ円は要注意。即決せず内訳を求めて。工事別の相場と赤旗→ " + (links[0] && links[0].url || SITE + "/souba/");
  return {
    ok: true, work, is_draft: true,
    notice: "これは下書きです。公開前に運営者(TOshi)が最終版にしてください。自動投稿しません。 / DRAFT. Operator finalizes. No auto-posting.",
    draft_note, draft_x, backlinks: links,
    price_source: fair ? { fair_range: { min: fair.fair_min, avg: fair.fair_avg, max: fair.fair_max, unit: fair.unit || null }, claim_sha256: sha, attribution: "HORIZON SHIELD souba-db (大賀俊勝 実務監修)" } : null,
    post_targets: { note: "note.com(運営アカウントで手動投稿)", x: "x.com(運営アカウントで手動投稿)" },
    source: "HORIZON SHIELD KIRA via hs-webmcp (draft generator, no auto-post)",
  };
}

async function handleOrchestrate(args, env) {
  const work = String(args && args.work || "").trim();
  if (!work) return { ok: false, message: "work(工事名/キーワード)が必要です。" };
  const price = Number(args && args.quoted_price);

  const out = { ok: true, work, flow: "intake -> scan_tactics -> draft_broadcast", steps: {} };

  // ① intake(金額があればKIRA適正診断。無ければスキップを明示)
  if (price) {
    try { out.steps.intake = await handleIntake({ work, quoted_price: price }, env); }
    catch (e) { out.steps.intake = { ok: false, message: "intake失敗(取れた分のみ返す)" }; }
  } else {
    out.steps.intake = { skipped: true, reason: "quoted_price未指定のため適正診断はスキップ。相場確認はscan/draftの被リンク先で。" };
  }
  // ② scan_tactics(検証済み手口+一次ソース)
  try { out.steps.scan_tactics = await handleScanTactics({ work }, env); }
  catch (e) { out.steps.scan_tactics = { ok: false, message: "scan失敗(取れた分のみ返す)" }; }
  // ③ draft_broadcast(発信下書き+被リンク)
  try { out.steps.draft_broadcast = await handleDraftBroadcast({ work }, env); }
  catch (e) { out.steps.draft_broadcast = { ok: false, message: "draft失敗(取れた分のみ返す)" }; }

  out.notice = "3ステップを1フローで実行。価格は検証可能な一次データのみ。発信は下書きで自動投稿しません。 / Orchestrated 3 steps. Verifiable first-party prices only. Drafts only, no auto-posting.";
  out.source = "HORIZON SHIELD KIRA via hs-webmcp (orchestrator)";
  return out;
}

// ---------- store裏識別(Glama仕様は不変・全店同一。名前は出さず store_id で裏個別識別+課金ゲート) ----------
// 真実源(公開JSON)。単一ソースを保ち、hs-webmcp側でミラーを持たない。
const CONTRACTORS_URL = "https://shield.the-horizons-innovation.com/data/yakumo-contractors.json";

// 課金ゲートの芯(純関数): WebMCP有料オプション契約店だけ稼働する。honbuのみは false。
function isProvisioned(c) {
  return !!(c && c.webmcp_option === true && c.webmcp && c.webmcp.enabled === true);
}

async function loadContractors() {
  try {
    const cache = caches.default;
    let res = await cache.match(CONTRACTORS_URL);
    if (!res) {
      res = await fetch(CONTRACTORS_URL, { cf: { cacheTtl: 120, cacheEverything: true } });
      if (res && res.ok) { await cache.put(CONTRACTORS_URL, res.clone()); }
    }
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

// store未指定=従来の共通窓口(後方互換)。指定あり=契約店だけ通す(fail-closed)。
async function verifyStore(storeId) {
  if (!storeId) return { ok: true, store: null };
  const db = await loadContractors();
  if (!db) return { ok: false, code: -32002, message: "store registry unavailable (fail-closed)" };
  const c = (db.contractors || []).find((x) => x.store_id === storeId);
  if (!c) return { ok: false, code: -32001, message: "unknown store: " + storeId };
  if (!isProvisioned(c)) return { ok: false, code: -32001, message: "store not provisioned for WebMCP (paid option required)" };
  return { ok: true, store: c };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // GET = 発見口(/.well-known/agent-card.json) + 生存確認
    if (request.method === "GET") {
      const path = new URL(request.url).pathname;
      if (path === "/.well-known/agent-card.json") {
        return new Response(JSON.stringify(AGENT_CARD, null, 2), {
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      if (path === "/.well-known/glama.json") {
        return new Response(JSON.stringify({
          "$schema": "https://glama.ai/mcp/schemas/connector.json",
          "maintainers": [{ "email": "ogasurfproject@gmail.com" }]
        }, null, 2), {
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return new Response(
        JSON.stringify({
          name: "hs-webmcp",
          role: "HORIZON SHIELD WebMCP 集客窓口(外部エージェント向け)",
          tools: TOOLS.map((t) => t.name),
          bridges_to: HS_MCP,
        }, null, 2),
        { headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: CORS });
    }

    let msg;
    try { msg = await request.json(); }
    catch { return rpcErr(null, -32700, "Parse error"); }

    const { id, method, params } = msg || {};

    if (method === "initialize") {
      return rpc(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hs-webmcp", version: "0.1.0" },
      });
    }
    if (method === "tools/list") return rpc(id, { tools: TOOLS });
    if (method === "ping") return rpc(id, {});
    if (method === "tools/call") {
      // 裏でstoreを検証(表のツール仕様は不変)。未契約storeはここでfail-closed。
      const storeId = new URL(request.url).searchParams.get("store");
      const gate = await verifyStore(storeId);
      if (!gate.ok) return rpcErr(id, gate.code, gate.message);
      const tenant = gate.store ? { store_id: gate.store.store_id, member_no: gate.store.member_no } : null;
      const stamp = (out) => { if (tenant) out._tenant = tenant; return out; };
      const name = params?.name;
      if (name === "orchestrate") {
        const out = stamp(await handleOrchestrate(params?.arguments || {}, env));
        return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      }
      if (name === "intake_estimate") {
        const out = stamp(await handleIntake(params?.arguments || {}, env));
        return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      }
      if (name === "scan_tactics") {
        const out = stamp(await handleScanTactics(params?.arguments || {}, env));
        return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      }
      if (name === "draft_broadcast") {
        const out = stamp(await handleDraftBroadcast(params?.arguments || {}, env));
        return rpc(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      }
      return rpcErr(id, -32601, "Unknown tool: " + name);
    }
    return rpcErr(id, -32601, "Unknown method: " + method);
  },
};
