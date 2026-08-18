// hs-verify-gate
// Yakumo 検証の扉 / Verification Gate  (v0 適合性チェッカー)
//
// 目的:
//   申請された MCP エンドポイントを実測し、5条件への適合を決定論的に判定する。
//   人の裁量を入れない。だから無料で開放できる。
//
// 設計の芯:
//   - 実測のみ。自己申告は判定材料にしない(エンドポイントを実際に叩く)。
//   - fail-closed。判定できない項目は "unknown" ではなく不適合として扱う。
//   - 申請者が事前に自分で走らせられる(公開エンドポイント)。落ちる理由が自分で分かる。
//   - 判定結果に SHA-256 を付す。扉自身が扉の基準を満たす。
//   - 称号名・条件の重みは CONFIG で差し替え可能(仕様確定前でも動く)。
//
// 口:
//   POST /check   { "endpoint": "https://..." }   適合性チェックを実行
//   GET  /spec                                    条件の仕様(機械可読)
//   GET  /health                                  死活

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

// 公開・読み取り専用のチェッカーなので、誰でもブラウザから叩けるよう CORS を開く。
// これが無いと shield ドメインの検証ディレクトリから /self・/check を実測取得できない。
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

// 仕様確定までの暫定値。名称や閾値はここだけ直せば全体に効く。
const CONFIG = {
  version: "0.2.1",
  tier_pass: "verified",        // 通過時の称号(暫定)
  tier_fail: "pending",         // 未通過(不合格とは呼ばない)
  tier_held: "held",            // 到達できず測れなかった。不適合とは別の状態
  unreachable_streak: 3,        // 連続これだけ到達不能が続くまで通知しない
  timeout_ms: 10000,
  determinism_runs: 2           // 決定論性の確認に何回叩くか
};

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), { status: status || 200, headers: { ...JSON_HEADERS, ...CORS_HEADERS } });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 定数時間比較: 両者を SHA-256(64桁hex) 化して XOR 集約。長さ差でも分岐しない。
async function ctEqual(a, b) {
  const ha = await sha256hex(String(a == null ? "" : a));
  const hb = await sha256hex(String(b == null ? "" : b));
  let out = 0;
  for (let i = 0; i < ha.length; i++) out |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return out === 0;
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

// ---- 測定経路 (2026-08-15) ----
// 実測: HTTPで呼ばれたこのWorkerから自ゾーンへの subrequest は 522 になる。
// cron起動なら通る。外部ゾーンへは通る。最初に外から見つけたのは Federico。
// 対象が自ゾーンのときだけ、別ゾーンの hs-verify-relay を経由して公開エッジで測る。
// service binding は使わない。公開経路を測らない私道になるからだ。
const PROBE_UA = "HORIZON-SHIELD-verify-gate/0.2 (+https://gate.horizonshield.dev/spec; conformance probe; read-only)";
const OWN_ZONE = "horizonshield.dev";
let GATE_ENV = null;       // 入口で env を差す。値は毎回同一なので競合しない
let GATE_CONTEXT = "none"; // "http" | "cron"。★中継は http 文脈のみ。cron→workers.dev は塞がっている(実測)

function isOwnZone(u) {
  try {
    const h = new URL(u).hostname;
    return h === OWN_ZONE || h.endsWith("." + OWN_ZONE);
  } catch (_e) { return false; }
}

function relayConfigured() {
  return GATE_CONTEXT === "http" && !!(GATE_ENV && GATE_ENV.RELAY_URL && GATE_ENV.RELAY_TOKEN);
}

function probeVia(endpoint) {
  return (isOwnZone(endpoint) && relayConfigured())
    ? "relay (hs-verify-relay, a separate worker outside this zone path; the whole probe traverses the public edge, because a Worker invoked over HTTP cannot reach its own zone directly \u2014 measured 2026-08-14/15)"
    : "direct from the gate worker (" + GATE_CONTEXT + " context)";
}

// デプロイ時に deploy_gate.sh が --var GATE_COMMIT:<sha> で注入する。
// 注入なしでデプロイされたら、判定には "unpinned" が載る。空白ではなく名指しで。
// コミットSHAは内容アドレスであり、この値が record_sha256 の中を旅することで
// 「どのバイト列のコードがこの判定を出したか」が判定自身に固定される。
function gateCommit() {
  return (GATE_ENV && GATE_ENV.GATE_COMMIT)
    ? String(GATE_ENV.GATE_COMMIT)
    : "unpinned: this deployment did not inject a commit (deploy_gate.sh not used)";
}

async function probeFetch(url, init) {
  const opts = init ? { ...init } : {};
  opts.headers = { ...(opts.headers || {}), "user-agent": PROBE_UA };
  if (!(isOwnZone(url) && relayConfigured())) {
    return await fetch(url, opts);
  }
  const res = await fetch(GATE_ENV.RELAY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-relay-token": GATE_ENV.RELAY_TOKEN },
    body: JSON.stringify({
      url: url,
      method: opts.method === "POST" ? "POST" : "GET",
      headers: opts.headers,
      body: typeof opts.body === "string" ? opts.body : null
    })
  });
  let wrapped = null;
  try { wrapped = await res.json(); } catch (_e) { wrapped = null; }
  if (res.status === 502 && wrapped && wrapped.error === "target_fetch_failed") {
    // 中継までは届いたが、中継から相手に届かなかった = 公開エッジ経由の相手側到達性の事実
    throw new Error("unreachable via public-edge relay: " + String(wrapped.message || "fetch failed"));
  }
  if (!res.ok || !wrapped || wrapped.relayed !== true) {
    // 中継そのものに届かない/設定不良 = こちら側の故障。相手の記録にしない文言で返す
    throw new Error("relay unavailable (http " + res.status + "): gate-side failure, not a statement about the target");
  }
  return new Response(wrapped.body || "", { status: wrapped.status, headers: wrapped.headers || {} });
}

async function rpcCall(endpoint, method, params) {
  const res = await withTimeout(probeFetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  }), CONFIG.timeout_ms);
  if (!res.ok) throw new Error("http " + res.status);
  return await res.json();
}

// ---- 表面(surface)のハッシュ ----
// JCS風の安定直列化。キーを再帰的にソートするだけの決定論的 stringify。
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

// ハッシュは16hex(64bit)に切る。変更検出用の指紋であって、暗号学的な同一性証明ではない。
// 名前ハッシュだけでは「名前を残して inputSchema を書き換える」変更(統合破壊の第1位)が見えない。
// だからマニフェスト全体と、ツール1本ごとの指紋を持つ。
async function surfaceHashes(tools, initResult, pages, complete) {
  const sorted = tools.slice().sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
  const strip = (t) => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || null });
  const perTool = {};
  for (const t of sorted) {
    perTool[String(t.name)] = (await sha256hex(canonicalJson(strip(t)))).slice(0, 16);
  }
  return {
    complete: complete,
    pages_followed: pages,
    names_hash: (await sha256hex(JSON.stringify(sorted.map((t) => String(t.name))))).slice(0, 16),
    manifest_hash: (await sha256hex(canonicalJson(sorted.map(strip)))).slice(0, 16),
    server_info_hash: initResult ? (await sha256hex(canonicalJson(initResult))).slice(0, 16) : null,
    tool_hashes: perTool
  };
}

// ---- 条件1. 実在する MCP エンドポイント ----
async function checkMcp(endpoint) {
  const detail = {};
  let initResult = null;
  try {
    const init = await rpcCall(endpoint, "initialize", { protocolVersion: "2024-11-05" });
    detail.initialize = !!(init && init.result);
    detail.server_name = (init && init.result && init.result.serverInfo && init.result.serverInfo.name) || null;
    initResult = init && init.result ? { serverInfo: init.result.serverInfo || null, capabilities: init.result.capabilities || null } : null;
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      // 中継の故障。対象のことは何も分かっていない。boolean にもそう言わせる。
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    const hint = /1104|1042|Failed to fetch|fetch failed/i.test(String(e.message))
      ? " (the gate could not reach this host. Cloudflare blocks Worker-to-Worker calls within the " +
        "same account over workers.dev; use a custom domain, or run the check from outside)"
      : "";
    return { pass: false, transport: true, reason: "initialize failed: " + e.message + hint, detail };
  }
  try {
    // カーソルを最後まで辿る(上限3ページ)。辿り切れなければ surface は complete: false。
    // 部分読みから「ツールが消えた」と主張するのが、この測定の最悪の故障だから。
    let tools = [];
    let cursor = null;
    let pages = 0;
    do {
      const list = await rpcCall(endpoint, "tools/list", cursor ? { cursor: cursor } : {});
      const batch = (list && list.result && list.result.tools) || [];
      tools = tools.concat(batch);
      cursor = (list && list.result && list.result.nextCursor) || null;
      pages += 1;
    } while (cursor && pages < 3);
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => t.name).slice(0, 50);
    detail.surface = await surfaceHashes(tools, initResult, pages, !cursor);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail };
    }
    return { pass: false, transport: true, reason: "tools/list failed: " + e.message, detail };
  }
  return { pass: true, reason: "MCP endpoint responds to initialize and tools/list", detail };
}

// ---- 条件2. A2A エージェントカード ----
async function checkAgentCard(endpoint) {
  const origin = new URL(endpoint).origin;
  const url = origin + "/.well-known/agent-card.json";
  try {
    const res = await withTimeout(probeFetch(url), CONFIG.timeout_ms);
    if (!res.ok) {
      // An HTTP status IS an answer from the far side. 404 means "reached,
      // and no card is published there": a failed condition, not
      // unreachability, and it must not flip the whole record to held.
      // Only gateway-shaped statuses (502-504 and Cloudflare's 52x edge
      // codes) mean the origin behind the URL did not actually answer.
      const gatewayish = (res.status >= 502 && res.status <= 504) || (res.status >= 520 && res.status <= 530);
      if (gatewayish) return { pass: false, transport: true, reason: "agent-card not reachable (http " + res.status + ")", detail: { url } };
      return { pass: false, reason: "agent-card not published (http " + res.status + ": the server answered; no card lives at this path)", detail: { url } };
    }
    const card = await res.json();
    const missing = ["name", "description"].filter((k) => !card[k]);
    if (missing.length) {
      return { pass: false, reason: "agent-card missing fields: " + missing.join(", "), detail: { url } };
    }
    return {
      pass: true,
      reason: "agent-card published and well-formed",
      detail: { url, name: card.name, skills: (card.skills || []).length },
      card: card
    };
  } catch (e) {
    if (/gate-side failure/.test(String(e && e.message))) {
      return { pass: false, gate_side: true, measured: false, reason: "not measured: " + e.message, detail: { url } };
    }
    return { pass: false, transport: true, reason: "agent-card fetch failed: " + e.message, detail: { url } };
  }
}

// ---- 条件3. 報酬構造の開示 ----
// 内容は審査しない。開示していないという選択肢だけを消す。
const PAID_BY = ["buyer", "seller", "referral", "advertising", "subscription", "public", "other"];

function checkCompensation(card) {
  if (!card) return { pass: false, reason: "no agent-card, cannot read compensation", detail: {} };
  const c = card.compensation;
  if (!c || typeof c !== "object") {
    return {
      pass: false,
      reason: "compensation block not declared in agent-card",
      detail: { expected_shape: { paid_by: PAID_BY, referral_fee: "boolean", listing_fee: "boolean", success_fee_pct: "number", disclosure_url: "string" } }
    };
  }
  if (!PAID_BY.includes(c.paid_by)) {
    return { pass: false, reason: "compensation.paid_by must be one of: " + PAID_BY.join(", "), detail: { got: c.paid_by } };
  }
  if (typeof c.referral_fee !== "boolean" || typeof c.listing_fee !== "boolean") {
    return { pass: false, reason: "compensation.referral_fee and listing_fee must be boolean", detail: {} };
  }
  return {
    pass: true,
    reason: "compensation structure declared",
    detail: {
      paid_by: c.paid_by,
      referral_fee: c.referral_fee,
      listing_fee: c.listing_fee,
      success_fee_pct: typeof c.success_fee_pct === "number" ? c.success_fee_pct : null,
      disclosure_url: c.disclosure_url || null
    }
  };
}

// ---- 条件4. 数値主張の再計算可能性(決定論性) ----
// 同じ入力を複数回投げ、返る内容が一致するかを実測する。
async function checkDeterminism(endpoint, toolName, allowToolCall) {
  // 既定ではツールを呼ばない。決定論性を測るには相手のツールを実行する必要があり、
  // 先頭のツールが破壊的な操作である可能性がある。所有者の明示的な同意なしには触らない。
  if (!allowToolCall) {
    return {
      pass: false,
      measured: false,
      reason:
        "not measured: measuring determinism requires calling one of your tools, and this gate " +
        "does not call tools on a server without the owner's consent. The first tool listed may " +
        "be destructive. To have this condition measured, re-run with allow_tool_call set to true " +
        "from a request you control.",
      detail: {
        consent_required: true,
        how_to_measure: 'POST /check {"endpoint":"https://your-server/mcp","allow_tool_call":true}',
        tool_that_would_be_called: toolName || null
      }
    };
  }
  if (!toolName) return { pass: false, reason: "no tool available to test", detail: {} };
  const outs = [];
  for (let i = 0; i < CONFIG.determinism_runs; i++) {
    try {
      const r = await rpcCall(endpoint, "tools/call", { name: toolName, arguments: {} });
      const txt = JSON.stringify((r && r.result && r.result.content) || r);
      outs.push(txt);
    } catch (e) {
      return { pass: false, reason: "tools/call failed: " + e.message, detail: { tool: toolName } };
    }
  }
  const same = outs.every((o) => o === outs[0]);
  return {
    pass: same,
    reason: same
      ? "identical input returned identical output across " + CONFIG.determinism_runs + " runs"
      : "output changed between identical runs (not usable as a fixed reference)",
    detail: { tool: toolName, runs: CONFIG.determinism_runs, identical: same }
  };
}

// ---- 判定の組み立て ----
async function runCheck(endpoint, allowToolCall) {
  const started = new Date().toISOString();
  const results = {};

  results.mcp_endpoint = await checkMcp(endpoint);
  const cardRes = await checkAgentCard(endpoint);
  results.agent_card = { pass: cardRes.pass, transport: cardRes.transport === true, ...(cardRes.gate_side === true ? { gate_side: true, measured: false } : {}), reason: cardRes.reason, detail: cardRes.detail };
  // カードが「取れなかった」のが中継故障なら、開示の有無も分かっていない。落ちた顔をさせない。
  results.compensation_disclosure = cardRes.gate_side === true
    ? { pass: false, gate_side: true, measured: false, reason: "not measured: the agent card could not be fetched because the gate's relay path was unavailable, so whether compensation is disclosed is unknown" }
    : checkCompensation(cardRes.card);

  const firstTool = results.mcp_endpoint.detail && results.mcp_endpoint.detail.tools
    ? results.mcp_endpoint.detail.tools[0] : null;
  results.determinism = await checkDeterminism(endpoint, firstTool, allowToolCall === true);

  const passed = Object.values(results).every((r) => r.pass);
  // gate-side = こちらの測定装置の故障。unreachable(相手に届かない)と混ぜない。
  const gateSide = Object.values(results).some((r) => r && r.gate_side === true);
  // 「届かなかった」と「届いた上で条件を満たさない」は別の事実。
  // fail-closed は変えない。緑にはしない。ただし理由の書き分けはする。
  const unreachable = Object.values(results).some((r) => r && r.transport === true);

  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    endpoint: endpoint,
    checked_at: started,
    reachable: gateSide ? null : !unreachable,
    status: passed ? CONFIG.tier_pass : ((unreachable || gateSide) ? CONFIG.tier_held : CONFIG.tier_fail),
    scope_note:
      "This gate verifies conformance and disclosure only. It does NOT verify that any price " +
      "or figure returned by the server is correct. Price validation is a separate, paid tier " +
      "and is currently available for Japanese construction only. By default this gate calls no " +
      "tools on the server being checked, so determinism is reported as not measured rather than " +
      "guessed. Send allow_tool_call true to have it measured on a server you control.",
    tools_called: allowToolCall === true ? "one tool, twice, with empty arguments, by consent" : "none",
    probed_via: probeVia(endpoint),
    ...(gateSide ? {
      measurement_note:
        "This measurement did not happen. The gate's own relay path was unavailable, so nothing in " +
        "this record says anything about the target. reachable is null rather than false for exactly " +
        "that reason: an instrument failure is not a statement about the thing it failed to measure."
    } : {}),
    checks: results
  };

  // 条件5. 判定自体が再計算可能であること
  const canonical = JSON.stringify(record);
  record.record_sha256 = await sha256hex(canonical);
  record.recompute_note =
    "Remove the record_sha256 and recompute_note fields, JSON.stringify the remainder in this key " +
    "order, and take the SHA-256. It must equal record_sha256. This gate holds itself to the same " +
    "standard it applies to applicants.";

  return record;
}

// ---- 仕様(機械可読) ----
function spec() {
  return {
    gate: "Yakumo Verification Gate",
    version: CONFIG.version,
    gate_commit: gateCommit(),
    what_this_verifies: [
      "The server actually exists and speaks MCP",
      "The server publishes an A2A agent card",
      "The server declares who pays it",
      "Identical input returns identical output",
      "This gate's own verdict can be recomputed by anyone"
    ],
    what_this_does_not_verify: [
      "Whether prices or figures returned by the server are correct",
      "Whether the declared compensation structure is truthful (it is published and recorded; false declarations are grounds for revocation)",
      "Quality, competence, or fitness of the underlying business"
    ],
    conditions: {
      mcp_endpoint: "POST /mcp responds to initialize and tools/list with at least one tool",
      agent_card: "GET /.well-known/agent-card.json returns JSON with name and description",
      compensation_disclosure: {
        location: "agent-card, top-level key 'compensation'",
        shape: {
          paid_by: PAID_BY,
          referral_fee: "boolean, required",
          listing_fee: "boolean, required",
          success_fee_pct: "number, optional",
          disclosure_url: "string, optional"
        },
        note: "Content is not judged. Only the absence of disclosure disqualifies."
      },
      determinism: "Calling the same tool with the same arguments returns identical content across runs. NOT measured by default: doing so requires executing a tool on the checked server, which this gate will not do without the owner's consent. Send allow_tool_call true to measure it.",
      self_verification: "Every verdict carries a SHA-256 that any third party can recompute"
    },
    tiers: {
      [CONFIG.tier_pass]: "Free. Conformance and disclosure verified. No price validation.",
      "verified_plus_data": "Paid. Figures traced to a third-party obtainable primary source.",
      "yakumo_partner": "Paid. Dedicated MCP server, operations, audit log."
    },
    operator: "The HORIZONs Co., Ltd. / HORIZON SHIELD",
    self_applied: "This gate is itself subject to these conditions."
  };
}

// ---- 公開履歴と自動再測定 ----
// 「測定が変われば緑ではなくなる」と公開ページに書いた以上、誰かが測り直さねばならない。
// ここがその実装。記録するのは公開判定のみで、申請者の秘密も顧客データも持たない。

// KV が無い環境でも動く。履歴が無効になるだけで、判定機能そのものは影響を受けない。
const HISTORY_MAX = 30;   // 1エンドポイントあたりの保持件数
const CHANGES_MAX = 50;   // 変化ログの保持件数

// ---- 監視レジストリと通知 ----
// 判定は無料と有料で完全に同一。値段が付くのは「測る頻度」と「変化を知らされるか」だけ。
// 判定そのものを売った時点で中立性が死ぬので、そこには決して値段を付けない。
const REGISTRY_KEY = "watch:registry";
const REGISTRY_MAX = 500;
const MAX_PER_SWEEP = 9;         // 1本あたり最悪 1(init)+3(tools/listページ)+1(card)=5。9×5=45 ≤ 50(Free枠)
const FREE_INTERVAL_DAYS = 7;    // 無料層は週1回
const NOTIFY_TIMEOUT_MS = 5000;

async function readRegistry(env) {
  if (!env || !env.HS_VERIFY_KV) return {};
  try { return (await env.HS_VERIFY_KV.get(REGISTRY_KEY, "json")) || {}; }
  catch (_e) { return {}; }
}

async function writeRegistry(env, reg) {
  if (!env || !env.HS_VERIFY_KV) return false;
  try { await env.HS_VERIFY_KV.put(REGISTRY_KEY, JSON.stringify(reg)); return true; }
  catch (_e) { return false; }
}

async function readSweepLast(env) {
  if (!env || !env.HS_VERIFY_KV) {
    return { ran: false, note: "History storage is not bound on this deployment." };
  }
  try {
    const v = await env.HS_VERIFY_KV.get("sweep:last", "json");
    if (v) return v;
  } catch (_e) {}
  return { ran: false, note: "No sweep has completed yet. If the cron is registered, the first run happens at 18:00 UTC." };
}

// 公開の登録簿。watchlist と既存の hist:* を読むだけで、何も測らず、何も保存しない。
// webhook は通知の宛先であって公開情報ではないので、決して出さない。
// 未掲載は不合格ではない。ここで測られたことが無い、それだけを意味する。
// ツール呼び出しの同意。所有者が明示的に依頼したエンドポイントだけをここに入れる。
// determinism は所有者のツールを2回呼ばないと測れず、同意のない呼び出しは絶対にしない。
// だから同意のないサーバーは determinism が not measured のままになり、verified には届かない。
// それは不合格ではなく、測っていないという意味であり、register の応答でもそう説明する。
// 追加は運営者の手作業。所有者からの依頼が無い限り足さない。勝手に足せる経路は用意しない。
const TOOL_CALL_CONSENT = new Set([
  "https://mcp.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp"
]);

// 表示名。運営者が付けた名前であって、測定値ではない。registerの応答でもそう明記する。
// 加盟店の実名は本人の書面同意が取れてから入れる。それまでは掲載準備中。
const OPERATOR_LABELS = {
  "https://mcp.horizonshield.dev/mcp":     { ja: "KIRA\u9069\u6b63\u8a3a\u65ad", en: "KIRA fair price audit (the flagship MCP server)", url: "https://shield.the-horizons-innovation.com" },
  "https://web.horizonshield.dev/mcp":     { ja: "KIRA\u76f8\u8ac7\u7a93\u53e3", en: "KIRA intake desk for renovation questions", url: "https://shield.the-horizons-innovation.com" },
  "https://hearing.horizonshield.dev/mcp": { ja: "YAKUMO\u52a0\u76df\u5e97\u30c7\u30a3\u30ec\u30af\u30c8\u30ea", en: "YAKUMO verified contractor directory", url: "https://shield.the-horizons-innovation.com/yakumo/" },
  "https://gate.horizonshield.dev/mcp":    { ja: "\u691c\u8a3c\u30b2\u30fc\u30c8\uff08\u3053\u306e\u691c\u67fb\u6a5f\u81ea\u8eab\uff09", en: "The verification gate, measuring itself", url: "https://shield.the-horizons-innovation.com/verify-directory/" },
  "https://jidec.horizonshield.dev/mcp":   { ja: "JIDEC \u516c\u958b\u691c\u8a3c\u53f0\u5e33", en: "JIDEC, the Bitcoin anchored public ledger", url: "https://ledger.horizonshield.dev/llms.txt" },
  "https://p001.horizonshield.dev/mcp":    { ja: "\u30ea\u30d5\u30a9\u30fc\u30e0\u8077\u4eba\u682a\u5f0f\u4f1a\u793e\uff08\u52a0\u76dfNo.001\uff09", en: "Reform Shokunin Co., Ltd. (member No.001, Aichi)", url: "https://shield.the-horizons-innovation.com/yakumo/no001/" },
  "https://p002.horizonshield.dev/mcp":    { ja: "\u30df\u30cd\u30aa\u30c8\u30fc\u30e8\u30fc\u4f4f\u5668\u682a\u5f0f\u4f1a\u793e\uff08\u52a0\u76dfNo.002\uff09", en: "Mineo Toyo Juki Co., Ltd. (member No.002)" }
};

const REGISTER_JOIN_MAX = 50;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// --- Badge: an operator may display the current verdict on their own site.
// Deliberate: short cache so a green cannot be pinned, and an unlisted endpoint
// is not an error. The badge shows what the register says right now, or nothing.
function badgeSvg(label, status, color) {
  const L = String(label), S = String(status);
  const lw = 8 + L.length * 6.2, sw = 8 + S.length * 6.2, w = lw + sw;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(0) + '" height="20" role="img" aria-label="' + L + ': ' + S + '">' +
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>' +
    '<rect width="' + w.toFixed(0) + '" height="20" rx="3" fill="#555"/>' +
    '<rect x="' + lw.toFixed(0) + '" width="' + sw.toFixed(0) + '" height="20" rx="3" fill="' + color + '"/>' +
    '<rect x="' + lw.toFixed(0) + '" width="4" height="20" fill="' + color + '"/>' +
    '<rect width="' + w.toFixed(0) + '" height="20" rx="3" fill="url(#s)"/>' +
    '<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">' +
    '<text x="' + (lw / 2).toFixed(0) + '" y="14">' + L + '</text>' +
    '<text x="' + (lw + sw / 2).toFixed(0) + '" y="14">' + S + '</text></g></svg>';
}

// --- Per endpoint permalink. One citable URL per measured server.
// /e/{host}{path} reconstructs the endpoint. Unlisted returns 404 on purpose:
// we do not mint an empty page for an endpoint nobody has measured.
function endpointPage(origin, row) {
  const ep = esc(row.endpoint);
  const st = esc((row.latest && row.latest.status) || "no measurement yet");
  const at = esc((row.latest && row.latest.at) || "");
  const sha = (row.latest && row.latest.record_sha256) || "";
  const self = origin + "/e/" + row.endpoint.replace(/^https?:\/\//, "");
  const label = row.operator_label ? esc(row.operator_label) : "";
  const why = row.why_not_verified ? esc(row.why_not_verified) : "";
  const ld = {
    "@context": "https://schema.org", "@type": "Dataset",
    "@id": self + "#dataset",
    name: "Measured conduct of " + row.endpoint,
    description: "Every scheduled measurement of this MCP endpoint, with the verdict, the time it was taken and the hash of the record. Generated by a script with no editorial input.",
    url: self, license: "https://opensource.org/licenses/MIT", isAccessibleForFree: true,
    isPartOf: { "@id": "https://shield.the-horizons-innovation.com/verify-directory/#dataset" },
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: row.history_url }],
    variableMeasured: ["endpoint reachability", "agent card presence", "payer disclosure", "determinism", "record recomputability"]
  };
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + ep + ' : ' + st + ' | MCP conduct register</title>' +
    '<meta name="description" content="Measured conduct of ' + ep + '. Latest verdict ' + st + '.">' +
    '<link rel="canonical" href="' + self + '">' +
    '<meta name="robots" content="index,follow,max-snippet:-1">' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>' +
    '<style>body{background:#0a0a0a;color:#ddd;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.8;margin:0}' +
    '.w{max-width:760px;margin:0 auto;padding:40px 20px 60px}a{color:#f97316}' +
    'h1{font-size:19px;color:#fff;word-break:break-all;margin:6px 0 18px}' +
    'table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}' +
    'th,td{border:1px solid #2a2a2a;padding:9px 11px;text-align:left;vertical-align:top}' +
    'th{background:#141414;color:#f97316;width:34%;font-weight:600}' +
    'pre{background:#141414;border:1px solid #2a2a2a;border-radius:9px;padding:13px;overflow-x:auto;font-size:13px}' +
    '.n{color:#8a8a8a;font-size:13px}</style></head><body><div class="w">' +
    '<a href="https://shield.the-horizons-innovation.com/verify-directory/">back to the register</a>' +
    '<h1>' + ep + '</h1>' +
    '<img src="' + origin + '/badge?endpoint=' + encodeURIComponent(row.endpoint) + '" alt="MCP conduct: ' + st + '" height="20">' +
    '<table>' +
    (label ? '<tr><th>operator</th><td>' + label + '</td></tr>' : '') +
    '<tr><th>latest verdict</th><td>' + st + '</td></tr>' +
    '<tr><th>measured at</th><td>' + (at || 'not recorded') + '</td></tr>' +
    '<tr><th>measurements</th><td>' + (row.measurements === null ? 'see history' : row.measurements) + '</td></tr>' +
    '<tr><th>first measured</th><td>' + esc(row.first_at || 'not recorded') + '</td></tr>' +
    '<tr><th>cadence</th><td>' + esc(row.cadence || '') + '</td></tr>' +
    '<tr><th>tool call consent</th><td>' + (row.tool_call_consent ? 'given by the operator' : 'not given') + '</td></tr>' +
    '<tr><th>record sha256</th><td style="word-break:break-all">' + esc(sha || 'none yet') + '</td></tr>' +
    '</table>' +
    (why ? '<p class="n">' + why + '</p>' : '') +
    '<p>Recompute this row yourself. Do not take our word for it.</p>' +
    '<pre>curl -s "' + row.history_url + '"</pre>' +
    '<p class="n">A green here means every condition that could be measured was measured and passed. It is not a statement that the server is good, safe or correct. Conditions that were not measured are never counted as passes, including for the operator of this register.</p>' +
    '</div></body></html>';
}

async function publicRegister(env) {
  const list = await watchlist(env);
  const rows = [];
  let joined = 0;
  for (const w of list) {
    const row = {
      endpoint: w.endpoint,
      tier: w.tier,
      cadence: w.tier === "free" ? "weekly" : "daily",
      measurements: null,
      first_at: null,
      latest: null,
      history_url: "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(w.endpoint)
    };
    const lbl = OPERATOR_LABELS[w.endpoint];
    if (lbl) row.operator_label = lbl;
    row.tool_call_consent = TOOL_CALL_CONSENT.has(w.endpoint);
    if (!row.tool_call_consent) {
      row.why_not_verified = "The owner has not asked for tool calls, so determinism is not measured and this row cannot reach verified. That is not a failure, it is an unmeasured condition.";
    }
    if (joined < REGISTER_JOIN_MAX) {
      joined++;
      const hist = await readHistory(env, w.endpoint);
      const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
      row.measurements = entries.length;
      row.first_at = entries.length ? (entries[0].at || null) : null;
      const latest = entries.length ? entries[entries.length - 1] : null;
      if (latest) {
        row.latest = {
          at: latest.at || null,
          status: latest.status || null,
          record_sha256: latest.record_sha256 || null
        };
      }
    } else {
      row.note = "not joined with history in this response: over REGISTER_JOIN_MAX (" + REGISTER_JOIN_MAX + "). The history_url works regardless.";
    }
    rows.push(row);
  }
  return {
    count: rows.length,
    max: REGISTRY_MAX,
    gate_commit: gateCommit(),
    note: "The public register. Rows are scheduled measurements, not endorsements. An endpoint that is absent has simply never been measured here; absence is NOT a negative verdict. Webhooks are never published. Every stored verdict carries a record_sha256 you can recompute yourself. The operator_label field is a display name assigned by the operator, not a measurement.",
    join: 'POST /watch with {"endpoint":"https://your-server/mcp"}',
    rows: rows
  };
}

// 無料層は週1回。エンドポイントごとに測る日をずらし、1日に固まらないようにする。
async function isDueToday(endpoint, tier, now) {
  if (tier !== "free") return true;
  const h = await sha256hex(endpoint);
  const bucket = parseInt(h.slice(0, 4), 16) % FREE_INTERVAL_DAYS;
  return Math.floor(now / 86400000) % FREE_INTERVAL_DAYS === bucket;
}

// 変化したときだけ飛ばす。判定は公開されているので、これは「早く知る」ことの対価。
async function notifyChange(target, payload) {
  if (!target || !/^https:\/\//i.test(target)) return { sent: false, reason: "no https webhook" };
  try {
    const res = await withTimeout(fetch(target, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload)
    }), NOTIFY_TIMEOUT_MS);
    return { sent: true, status: res.status };
  } catch (e) {
    return { sent: false, reason: String((e && e.message) || e) };
  }
}

// 監視対象の既定値。KV の watch:endpoints があればそちらを使う。
// 2026-08-09 workers.dev から独自ドメインへ。
// 同一アカウント内では扉から workers.dev の兄弟 Worker に届かず、
// 全条件が held のまま記録され続けていた。届く道を作ってから測る。
// **扉自身もここに入れる。** 自分に同じ基準を当てられない物差しは、物差しではない。
const DEFAULT_WATCHLIST = [
  "https://mcp.horizonshield.dev/mcp",
  "https://hearing.horizonshield.dev/mcp",
  "https://web.horizonshield.dev/mcp",
  "https://jidec.horizonshield.dev/mcp",
  "https://p001.horizonshield.dev/mcp",
  "https://p002.horizonshield.dev/mcp",
  "https://gate.horizonshield.dev/mcp"
];

// 既定の自社分、旧来の watch:endpoints、新しい watch:registry を束ねて返す。
// 返すのは {endpoint, tier, webhook} の配列。tier は self / free / paid。
async function watchlist(env) {
  const out = [];
  const seen = new Set();
  const push = (ep, tier, webhook) => {
    if (typeof ep !== "string" || seen.has(ep)) return;
    seen.add(ep);
    out.push({ endpoint: ep, tier: tier, webhook: webhook || null });
  };
  for (const ep of DEFAULT_WATCHLIST) push(ep, "self", null);
  if (env && env.HS_VERIFY_KV) {
    try {
      const legacy = await env.HS_VERIFY_KV.get("watch:endpoints", "json");
      if (Array.isArray(legacy)) for (const ep of legacy) push(ep, "self", null);
    } catch (_e) { /* KV が読めなければ既定値で続ける */ }
  }
  const reg = await readRegistry(env);
  for (const ep of Object.keys(reg)) {
    const r = reg[ep] || {};
    push(ep, r.tier === "paid" ? "paid" : "free", r.webhook || null);
  }
  return out;
}

async function histKey(endpoint) {
  return "hist:" + (await sha256hex(endpoint)).slice(0, 16);
}

// 状態の指紋。**record_sha256 を使ってはいけない。**
// あれは checked_at を含むので毎回変わり、毎日「変化した」と誤検知する。
// 変化として意味があるのは status と各条件の合否だけ。
function stateFingerprint(record) {
  const checks = record && record.checks ? record.checks : {};
  const parts = Object.keys(checks).sort().map((k) => k + "=" + (checks[k] && checks[k].pass ? "1" : "0"));
  return (record && record.status ? record.status : "unknown") + "|" + parts.join(",");
}

function summarise(record) {
  const checks = (record && record.checks) || {};
  const out = {};
  for (const k of Object.keys(checks)) {
    // **理由を落とさない。** 赤くなった記録に理由が無いと、読み手は誤解しかできない。
    const r = checks[k] && typeof checks[k].reason === "string" ? checks[k].reason : null;
    out[k] = {
      pass: !!checks[k].pass,
      measured: checks[k].measured === false ? false : true,
      transport: checks[k].transport === true,
      reason: r ? r.slice(0, 400) : null
    };
  }
  return {
    at: record.checked_at,
    status: record.status,
    reachable: record.reachable !== false,
    record_sha256: record.record_sha256,
    conditions: out,
    // 表面の指紋。fingerprint には入れない — 表面の変化は条件の flip ではなく、
    // 警報を鳴らさない。MCP 仕様自体が tools/list の変化を正常運用と見なしている。
    surface: (checks.mcp_endpoint && checks.mcp_endpoint.detail && checks.mcp_endpoint.detail.surface) || null,
    fingerprint: stateFingerprint(record)
  };
}

async function recordHistory(env, endpoint, record) {
  if (!env || !env.HS_VERIFY_KV) return null;
  const key = await histKey(endpoint);
  let prev = null;
  try { prev = await env.HS_VERIFY_KV.get(key, "json"); } catch (_e) {}
  const entries = (prev && Array.isArray(prev.entries)) ? prev.entries : [];
  const last = entries.length ? entries[entries.length - 1] : null;
  const entry = summarise(record);

  // 表面が前回と違えば、日付付きの差分をこのエントリ自身に残す。
  // 指標にしない。回数も割合も作らない。何が増え、何が消え、何の définition が変わったか、だけ。
  // 両方 complete のときだけ比較する — 部分読みとの比較から「削除」を出さない。
  const prevSurface = last && last.surface ? last.surface : null;
  if (entry.surface && prevSurface && entry.surface.complete === true && prevSurface.complete === true
      && entry.surface.manifest_hash !== prevSurface.manifest_hash) {
    const prevT = prevSurface.tool_hashes || {};
    const curT = entry.surface.tool_hashes || {};
    entry.surface_change = {
      added: Object.keys(curT).filter((k) => !(k in prevT)),
      removed: Object.keys(prevT).filter((k) => !(k in curT)),
      definition_changed: Object.keys(curT).filter((k) => (k in prevT) && curT[k] !== prevT[k]),
      note: "The tool surface changed between measurements. This is a dated fact, not a defect: the MCP specification treats tool-list changes as normal operation (notifications/tools/list_changed). Recorded for anyone; judged by no one."
    };
  }

  const changed = !last || last.fingerprint !== entry.fingerprint;
  let lastFlips = [];
  entries.push(entry);
  while (entries.length > HISTORY_MAX) entries.shift();

  try {
    await env.HS_VERIFY_KV.put(key, JSON.stringify({ endpoint, entries }));
  } catch (_e) { /* 書けなくても判定は返す */ }

  // 到達できなかった回が連続で何回続いたか。1回の回線の詰まりで赤い通知を飛ばさない。
  // **誤報を1回でも出した監視に、二度目の金は払われない。**
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i] && entries[i].reachable === false) streak++;
    else break;
  }
  const suppressed = entry.reachable === false && streak < CONFIG.unreachable_streak;

  if (changed && last) {
    // 初回は「変化」ではない。前があって違ったときだけ記録する。
    // **何が変わったかを書く。** status だけでは pending -> pending にしかならず、
    // 通知を受け取る側に一番必要な情報が抜ける。
    const flips = [];
    const keys = new Set(Object.keys(last.conditions || {}).concat(Object.keys(entry.conditions || {})));
    for (const k of keys) {
      const before = last.conditions && last.conditions[k] ? last.conditions[k].pass : null;
      const after = entry.conditions && entry.conditions[k] ? entry.conditions[k].pass : null;
      if (before !== after) {
        flips.push({ condition: k, from: before, to: after });
      }
    }
    lastFlips = flips;
    let changes = [];
    try { changes = (await env.HS_VERIFY_KV.get("changes:recent", "json")) || []; } catch (_e) {}
    changes.push({
      at: entry.at,
      endpoint,
      status_from: last.status,
      status_to: entry.status,
      conditions_changed: flips,
      reachable: entry.reachable !== false,
      unreachable_streak: streak,
      alert_suppressed: suppressed,
      summary: flips.length
        ? flips.map((f) => f.condition + " " + (f.from ? "pass" : "fail") + " to " + (f.to ? "pass" : "fail")).join(", ")
        : "status changed with no condition flip"
    });
    while (changes.length > CHANGES_MAX) changes.shift();
    try { await env.HS_VERIFY_KV.put("changes:recent", JSON.stringify(changes)); } catch (_e) {}
  }
  // 3回連続で到達不能になった時点で、ちょうど1回だけ鳴らす。
  // 指紋は2回目以降変わらないので、changed だけを見ていると永久に鳴らない。
  const crossed = entry.reachable === false && streak === CONFIG.unreachable_streak;
  return {
    changed: changed && !!last,
    alertable: (changed && !!last && !suppressed) || crossed,
    unreachable_streak: streak,
    entry,
    flips: lastFlips
  };
}

async function readHistory(env, endpoint) {
  if (!env || !env.HS_VERIFY_KV) {
    return { endpoint, entries: [], note: "History storage is not bound on this deployment, so nothing has been recorded yet." };
  }
  const key = await histKey(endpoint);
  try {
    const v = await env.HS_VERIFY_KV.get(key, "json");
    if (v) return v;
  } catch (_e) {}
  return { endpoint, entries: [], note: "No history recorded for this endpoint yet. It may not be on the watchlist." };
}

async function readChanges(env) {
  if (!env || !env.HS_VERIFY_KV) {
    return { changes: [], note: "History storage is not bound on this deployment." };
  }
  try {
    const v = await env.HS_VERIFY_KV.get("changes:recent", "json");
    return { changes: v || [], note: "State changes recorded by the daily re-measurement. A change means a condition flipped, not merely that a new verdict was issued." };
  } catch (_e) {
    return { changes: [], note: "could not read changes" };
  }
}

// 毎日の再測定。**同意のないエンドポイントには allow_tool_call を決して渡さない。**
// 同意済み (TOOL_CALL_CONSENT) だけ determinism まで測る。同意の有無は判定に影響するので、
// 各行の応答に tool_call_consent として開示する。隠れた優遇に見えないようにするためだ。
async function runDailySweep(env, opts) {
  const now = Date.now();
  const force = !!(opts && opts.force);
  const list = await watchlist(env);

  const due = [];
  const skipped = [];
  for (const w of list) {
    if (force || (await isDueToday(w.endpoint, w.tier, now))) due.push(w);
    else skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "not due today (weekly cadence)" });
  }
  // 上限で落ちた分は必ず記録する。黙って切ると「全部測った」ように読める。
  for (const w of due.slice(MAX_PER_SWEEP)) {
    skipped.push({ endpoint: w.endpoint, tier: w.tier, reason: "over MAX_PER_SWEEP for this run" });
  }
  const run = due.slice(0, MAX_PER_SWEEP);

  const results = [];
  for (const w of run) {
    try {
      const record = await runCheck(w.endpoint, TOOL_CALL_CONSENT.has(w.endpoint));
      const r = await recordHistory(env, w.endpoint, record);
      const changed = !!(r && r.changed);
      const alertable = !!(r && r.alertable);
      let notified = null;
      if (alertable && w.webhook) {
        notified = await notifyChange(w.webhook, {
          event: "conformance_change",
          endpoint: w.endpoint,
          at: r.entry.at,
          status: r.entry.status,
          reachable: r.entry.reachable !== false,
          conditions_changed: r.flips || [],
          history: "/history?endpoint=" + encodeURIComponent(w.endpoint),
          note: "The verdict is free and public. What you are paying for is being told, and being measured daily."
        });
      }
      results.push({ endpoint: w.endpoint, tier: w.tier, status: record.status, reachable: record.reachable !== false, changed, alert_suppressed: changed && !alertable, notified });
    } catch (e) {
      results.push({ endpoint: w.endpoint, tier: w.tier, error: String((e && e.message) || e) });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const out = {
    ran: true,
    at: new Date(now).toISOString(),
    watched_total: list.length,
    measured: results.length,
    results,
    skipped
  };
  if (env && env.HS_VERIFY_KV) {
    try { await env.HS_VERIFY_KV.put("sweep:last", JSON.stringify(out)); } catch (_e) {}
  }
  return out;
}

// ---- MCP インターフェース ----
// 扉は HTTP チェッカーであると同時に MCP サーバーでもある。
// MCP クライアントから「このサーバーは適合しているか」を会話中に確かめられる。

const MCP_TOOLS = [
  {
    // **1本目に置くのは意図的。** 引数を取らず、読み取り専用で、毎回同じ結果を返す。
    // 他所の適合チェッカーが1本目を空引数で叩いても、何も壊れず決定論的に応答する。
    name: "get_conditions",
    title: "Get the conformance conditions",
    annotations: { title: "Get the conformance conditions", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Return the five conditions this gate measures, what it explicitly does not verify, " +
      "and the tier definitions. Takes no arguments and returns identical output every time. " +
      "Read this before running a check so you know what a verdict does and does not claim.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "check_conformance",
    title: "Check an MCP server for conformance and disclosure",
    annotations: { title: "Check an MCP server for conformance and disclosure", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description:
      "Measure a public MCP endpoint against five conditions: it speaks MCP, it publishes an A2A " +
      "agent card, it declares who pays it, identical input returns identical output, and the " +
      "verdict itself can be recomputed by anyone. Free, no key. Conformance and disclosure only; " +
      "this says nothing about whether any figure the checked server returns is correct. " +
      "By default no tool on the checked server is called, so determinism comes back as not " +
      "measured rather than guessed. Set allow_tool_call true only for a server you control.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to measure" },
        allow_tool_call: {
          type: "boolean",
          description: "Consent to executing one tool on the checked server, twice, with empty arguments. Only set this for a server you own. Default false."
        }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  },
  {
    name: "verify_verdict",
    title: "Recompute a verdict hash without trusting the issuer",
    annotations: { title: "Recompute a verdict hash without trusting the issuer", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Take a verdict this gate issued and recompute its record_sha256 independently. Removes " +
      "record_sha256 and recompute_note, serialises the remainder in key order, and hashes it. " +
      "Returns whether the verdict was altered after it was issued. You do not have to trust the " +
      "party that issued the verdict, including this one.",
    inputSchema: {
      type: "object",
      properties: {
        record: { type: "object", description: "The full verdict object as returned by check_conformance or GET /self" }
      },
      required: ["record"],
      additionalProperties: false
    }
  },
  {
    // ★2026-08-14 追加。エージェントが加盟者を引けるようにする。
    //   ここが無いと、レジストリは人間が読むページのままで、
    //   「機械が選ぶ時代のための記録」という主張が自分の実装で裏切られる。
    //   新しい保存はしない。既にある watch:registry と hist:* を読むだけ。
    name: "lookup_server",
    title: "Look up an MCP server on this register",
    annotations: { title: "Look up an MCP server on this register", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Look up what this register already holds about an MCP endpoint: whether it is watched, how " +
      "often it is re-measured, how many measurements exist, when the first and latest were taken, " +
      "and the latest verdict with the record_sha256 you can recompute yourself. Reads stored " +
      "measurements only \u2014 it contacts nothing and measures nothing, so use check_conformance " +
      "for a fresh reading. An endpoint that is absent is reported as absent and that is NOT a " +
      "negative verdict: it means nobody has measured it here, not that it failed.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "https URL of the MCP endpoint to look up, exactly as it appears on the register" }
      },
      required: ["endpoint"],
      additionalProperties: false
    }
  }
];

function mcpText(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

async function verifyVerdict(record) {
  if (!record || typeof record !== "object") {
    return { verified: false, reason: "record must be an object" };
  }
  const expected = record.record_sha256;
  if (!expected) {
    return { verified: false, reason: "record has no record_sha256 to check against" };
  }
  const copy = JSON.parse(JSON.stringify(record));
  delete copy.record_sha256;
  delete copy.recompute_note;
  const got = await sha256hex(JSON.stringify(copy));
  return {
    verified: got === expected,
    expected_sha256: expected,
    recomputed_sha256: got,
    method: "Remove record_sha256 and recompute_note, JSON.stringify the remainder in key order, SHA-256.",
    note: got === expected
      ? "record_sha256 matches a recompute of this record. This proves only internal self-consistency (the body hashes to its own stored digest); it is NOT proof of authorship or that this gate issued it — anyone can compute the same hash with the public method above. For issuer authenticity/anchoring, rely on the JIDEC ledger, not this unkeyed checksum."
      : "Mismatch. The verdict was altered after it was issued, or it was not issued by this gate. Reject it."
  };
}

// レジストリ照会。**測らない。既に保存されているものを読むだけ。**
// 未登録を「不合格」として返さないことが、この関数のいちばん大事な仕様である。
const LOOKUP_HISTORY_MAX_RETURN = 20;

async function lookupServer(env, endpoint) {
  const wl = await watchlist(env);
  const watched = wl.find((w) => w && w.endpoint === endpoint) || null;
  const reg = await readRegistry(env);
  const regEntry = reg[endpoint] || null;
  const hist = await readHistory(env, endpoint);
  const entries = (hist && Array.isArray(hist.entries)) ? hist.entries : [];
  const latest = entries.length ? entries[entries.length - 1] : null;

  const historyUrl = "https://gate.horizonshield.dev/history?endpoint=" + encodeURIComponent(endpoint);

  if (!watched && !regEntry && !entries.length) {
    return {
      endpoint: endpoint,
      on_register: false,
      register_size: wl.length,
      means:
        "This register holds no measurements for this endpoint.",
      does_not_mean:
        "This is not a verdict and not a blacklist. An absent row means nobody has measured this " +
        "endpoint here, not that it was measured and failed. Do not treat absence as a negative " +
        "signal about the server or the people who run it.",
      how_to_appear:
        "Anyone can add it, including someone who does not own it, because the check is read-only " +
        "and calls no tool: POST https://gate.horizonshield.dev/watch with " +
        "{\"endpoint\":\"" + endpoint + "\"}. Free, weekly re-measurement, no account and no fee.",
      fresh_reading: "Call check_conformance with this endpoint to measure it right now."
    };
  }

  const tier = watched ? watched.tier : (regEntry && regEntry.tier === "paid" ? "paid" : "free");
  return {
    endpoint: endpoint,
    on_register: true,
    tier: tier,
    cadence: tier === "paid" ? "daily" : (tier === "self" ? "daily" : "weekly"),
    added_at: (regEntry && regEntry.added_at) || null,
    alerted_on_change: !!(watched && watched.webhook) || !!(regEntry && regEntry.webhook),
    measurements: entries.length,
    // 監視対象に入っていることと、測られたことは別である。
    // ここを混ぜた瞬間に「載っている=合格」という読み方が生まれる。
    standing: entries.length
      ? "measured"
      : "watched, not yet measured \u2014 being on the watchlist is not a measurement and this gate does not count it as one",
    first_measured_at: entries.length ? entries[0].at : null,
    last_measured_at: latest ? latest.at : null,
    latest: latest,
    history: entries.slice(-LOOKUP_HISTORY_MAX_RETURN),
    history_truncated: entries.length > LOOKUP_HISTORY_MAX_RETURN,
    full_history_url: historyUrl,
    means:
      "A row is a series of measurements taken at stated times, each carrying a record_sha256 you " +
      "can recompute without trusting this gate. The dates are the point: they cannot be created " +
      "retroactively, so a long row is evidence of duration and nothing else can substitute for it.",
    does_not_mean:
      "Not a certificate, and not a statement that any figure this server returns is correct. This " +
      "measures conduct and disclosure only. A passing row stops passing when the measurement does, " +
      "and a condition recorded as not measured is never counted as a pass \u2014 including for the " +
      "gate itself, whose own verdict currently reads pending."
  };
}

async function handleMcp(body, env) {
  const id = body && body.id;
  const method = body && body.method;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: (body.params && body.params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hs-verify-gate", version: CONFIG.version }
      }
    };
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } };
  }
  if (method === "tools/call") {
    const name = body.params && body.params.name;
    const args = (body.params && body.params.arguments) || {};

    if (name === "get_conditions") {
      return { jsonrpc: "2.0", id, result: mcpText(spec()) };
    }
    if (name === "check_conformance") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpText({ error: "endpoint_required" }) };
      }
      let parsed;
      try { parsed = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpText({ error: "invalid_url" }) }; }
      if (parsed.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpText({ error: "https_required" }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpText(await runCheck(endpoint, args.allow_tool_call === true)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpText({ error: "check_failed", message: String(e && e.message || e) }) };
      }
    }
    if (name === "verify_verdict") {
      return { jsonrpc: "2.0", id, result: mcpText(await verifyVerdict(args.record)) };
    }
    if (name === "lookup_server") {
      const endpoint = args.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return { jsonrpc: "2.0", id, result: mcpText({ error: "endpoint_required" }) };
      }
      let parsedLookup;
      try { parsedLookup = new URL(endpoint); }
      catch (_e) { return { jsonrpc: "2.0", id, result: mcpText({ error: "invalid_url" }) }; }
      if (parsedLookup.protocol !== "https:") {
        return { jsonrpc: "2.0", id, result: mcpText({ error: "https_required" }) };
      }
      if (!env || !env.HS_VERIFY_KV) {
        return { jsonrpc: "2.0", id, result: mcpText({
          endpoint: endpoint,
          error: "storage_unavailable",
          note: "History storage is not bound on this deployment, so this gate cannot say whether the endpoint is on the register. It is not reporting absence, because it does not know."
        }) };
      }
      try {
        return { jsonrpc: "2.0", id, result: mcpText(await lookupServer(env, endpoint)) };
      } catch (e) {
        return { jsonrpc: "2.0", id, result: mcpText({ error: "lookup_failed", message: String(e && e.message || e) }) };
      }
    }
    return { jsonrpc: "2.0", id, result: mcpText({ error: "unknown_tool", name }) };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } };
}

// ---- 扉自身のエージェントカード ----
// 標準を提案する側が、その標準を満たしていなければ意味がない。
function ownAgentCard(origin) {
  return {
    name: "Yakumo Verification Gate",
    description:
      "Checks whether an MCP server exists, publishes an agent card, discloses who pays it, " +
      "and returns identical output for identical input. Free. Conformance and disclosure only; " +
      "this gate does not verify that any price returned by a checked server is correct.",
    url: origin,
    provider: { organization: "The HORIZ\u97f3s Co., Ltd." },
    version: CONFIG.version,
    protocolVersion: "0.2.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    // 扉が申請者に要求するのと同じ形式で、扉自身の報酬構造を宣言する。
    compensation: {
      paid_by: "buyer",
      referral_fee: false,
      listing_fee: false,
      success_fee_pct: 0,
      disclosure_url: "https://shield.the-horizons-innovation.com/yakumo/plans/"
    },
    preferredTransport: "JSONRPC",
    skills: [
      {
        id: "check",
        name: "Conformance check",
        description: "POST /check with an MCP endpoint URL, or call the check_conformance tool over MCP at /mcp. Returns a verdict with a recomputable SHA-256.",
        tags: ["mcp", "verification", "conformance", "disclosure"]
      },
      {
        id: "verify",
        name: "Verdict verification",
        description: "Recompute the SHA-256 of a verdict this gate issued, so you do not have to trust the issuer. Available as the verify_verdict tool over MCP.",
        tags: ["verification", "tamper-evident", "recomputable"]
      }
    ]
  };
}

// ---- 自己検証 ----
// ネットワークを経由せず、扉自身の公開物を内部で読んで判定する。
// 同一アカウントのWorker間呼び出しがエッジで遮断される環境でも成立する。
async function selfCheck(origin) {
  const card = ownAgentCard(origin);
  const checks = {};

  checks.agent_card = {
    pass: !!(card.name && card.description),
    reason: card.name && card.description
      ? "agent-card published and well-formed"
      : "agent-card incomplete",
    detail: { url: origin + "/.well-known/agent-card.json", name: card.name }
  };

  checks.compensation_disclosure = checkCompensation(card);

  // 扉は数値を返さないため、価格の決定論性ではなく判定の決定論性を示す。
  const a = await runSpecDigest();
  const b = await runSpecDigest();
  checks.determinism = {
    pass: a === b,
    reason: a === b
      ? "the published spec and verdict format are stable across reads"
      : "spec digest changed between reads",
    detail: { spec_sha256: a }
  };

  // 扉は MCP サーバーではないため、条件1は対象外であることを明示する(隠さない)。
  // この扉は MCP サーバーでもあるので、条件1は該当する。
  // ただし同一アカウント制約で自分自身に到達できないため、自分では測れない。
  // 「対象外」と書くのは嘘になるので、測れないことをそのまま書く。
  checks.mcp_endpoint = {
    // 測っていない条件を pass にはしない。/check が他人に適用しているのと同じ扱い。
    // これ一個で扉の総合判定が verified になっていた。自分にだけ甘い物差しは物差しではない。
    pass: false,
    measured: false,
    reason:
      "not measured: this gate now speaks MCP at /mcp, so the condition applies to it. It cannot " +
      "reach itself over the network from inside its own account, so it has not measured this, " +
      "and it does not count an unmeasured condition as a pass. That is the same rule this gate " +
      "applies to every other server it checks. Point another checker at /mcp from outside and " +
      "the claim is either confirmed or destroyed.",
    detail: {
      applicable: true,
      self_measured: false,
      mcp_endpoint: origin + "/mcp",
      http_endpoints: ["/check", "/spec", "/self", "/health"]
    }
  };

  const passed = Object.values(checks).every((r) => r.pass);
  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    gate_commit: gateCommit(),
    subject: "the gate itself",
    endpoint: origin,
    checked_at: new Date().toISOString(),
    status: passed ? CONFIG.tier_pass : CONFIG.tier_fail,
    scope_note:
      "The gate applies its own conditions to itself. Where a condition does not apply, that is " +
      "stated explicitly rather than skipped silently.",
    checks: checks
  };
  const canonical = JSON.stringify(record);
  record.record_sha256 = await sha256hex(canonical);
  record.recompute_note =
    "Remove record_sha256 and recompute_note, JSON.stringify the remainder in this key order, " +
    "take the SHA-256, and it must equal record_sha256.";
  return record;
}

async function runSpecDigest() {
  return await sha256hex(JSON.stringify(spec()));
}

export default {
  // Cron Trigger。毎日の再測定。
  // 「測定が変われば緑ではなくなる」と公開した以上、測り直す者が要る。
  async scheduled(event, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "cron";
    ctx.waitUntil(runDailySweep(env));
  },

  async fetch(request, env, ctx) {
    GATE_ENV = env;
    GATE_CONTEXT = "http";
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS プリフライト。ブラウザからの POST /check は content-type で preflight が飛ぶ。
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // MCP over Streamable HTTP。扉自身を MCP クライアントから呼べるようにする。
    if (path === "/mcp" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
      }
      if (Array.isArray(body)) {
        return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch not supported" } }, 400);
      }
      const res = await handleMcp(body, env);
      if (res === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
      return json(res);
    }
    if (path === "/mcp" && request.method === "GET") {
      return json({
        ok: true,
        transport: "MCP over Streamable HTTP (JSON-RPC 2.0)",
        usage: "POST JSON-RPC to this URL. methods: initialize, tools/list, tools/call.",
        tools: MCP_TOOLS.map((t) => t.name)
      });
    }

    // 公開履歴。誰でも読める。認証も鍵も要らない。
    if (path === "/history") {
      const ep = url.searchParams.get("endpoint");
      if (!ep) return json({ error: "endpoint_required", usage: "/history?endpoint=https://your-server/mcp" }, 400);
      return json(await readHistory(env, ep));
    }
    if (path === "/changes") return json(await readChanges(env));
    if (path === "/sweep/last") return json(await readSweepLast(env));

    // 公開の登録簿。加盟者の行を、人間もエージェントも一覧で読める。
    if (path === "/register" && request.method === "GET") {
      return json(await publicRegister(env));
    }

    // 通過した行だけ。0件なら0件と返す。空を隠すために基準を緩めることはしない。
    if (path === "/verified.json" && request.method === "GET") {
      const reg = await publicRegister(env);
      const all = Array.isArray(reg.rows) ? reg.rows : [];
      const verified = all.filter((r) => r.latest && r.latest.status === CONFIG.tier_pass);
      return json({
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "MCP servers that passed every measured condition",
        description: "The subset of the public register whose latest scheduled measurement passed all five conditions, including determinism. Passing means the measured conditions passed on that date, from the vantage that measured them. It does not mean the numbers a server returns are correct, that the business behind it is competent, or that it is safe to use.",
        url: "https://shield.the-horizons-innovation.com/verify-directory/",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        updated: new Date().toISOString(),
        gate_commit: gateCommit(),
        verified_count: verified.length,
        register_count: all.length,
        why_the_count_can_be_zero: "Determinism cannot be measured without calling a tool on the server, and this gate never calls a tool without the owner asking for it. A server whose owner has not asked stays unmeasured on that condition and therefore stays short of verified. Unmeasured is not failed.",
        how_to_become_verified: {
          step_1: "Check yourself with consent: POST /check with {\"endpoint\":\"https://your-server/mcp\",\"allow_tool_call\":true}",
          step_2: "If it returns verified, ask the operator to record your consent so the nightly sweep measures the same way.",
          step_3: "The row turns verified on the next sweep, and stays that way only while it keeps passing.",
          note: "Nothing here is bought. The verdict is the measurement."
        },
        badge_for_a_verified_server: {
          where: "your own /.well-known/agent-card.json",
          why: "so an agent reading your card directly learns the record exists without visiting any page we control",
          block: {
            verification: {
              provider: "HORIZON SHIELD verification gate",
              register: "https://gate.horizonshield.dev/register",
              your_history: "https://gate.horizonshield.dev/history?endpoint=<your endpoint>",
              record_sha256: "<the hash of the verdict you are citing>",
              recompute: "Fetch the history, hash the record, compare. No trust in the provider is required."
            }
          },
          honesty_rule: "Publish the block only while the row actually reads verified. If it stops passing, remove it. The register will show the truth either way, so a stale badge only costs you."
        },
        servers: verified.map((r) => ({
          endpoint: r.endpoint,
          name: (r.operator_label && (r.operator_label.en || r.operator_label.ja)) || null,
          status: r.latest.status,
          verified_at: r.latest.at,
          record_sha256: r.latest.record_sha256,
          measurements: r.measurements,
          history_url: r.history_url
        }))
      });
    }

    // 監視の登録。誰でも自分のエンドポイントを載せられる。判定は変わらない。
    if (path === "/watch" && request.method === "GET") {
      const reg = await readRegistry(env);
      const ep = url.searchParams.get("endpoint");
      if (ep) {
        const r = reg[ep];
        if (!r) return json({ endpoint: ep, registered: false });
        return json({
          endpoint: ep, registered: true, tier: r.tier,
          cadence: r.tier === "paid" ? "daily" : "weekly",
          notified: !!r.webhook, added_at: r.added_at || null
        });
      }
      return json({
        count: Object.keys(reg).length,
        max: REGISTRY_MAX,
        usage: 'POST /watch with {"endpoint":"https://your-server/mcp","webhook":"https://your-endpoint-for-alerts"}',
        note: "Registering changes nothing about the verdict. It changes how often we re-measure, and whether you are told when a condition flips."
      });
    }

    if (path === "/watch" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return json({ error: "invalid_json" }, 400); }
      const ep = body && body.endpoint;
      if (typeof ep !== "string" || !/^https:\/\//i.test(ep)) {
        return json({ error: "endpoint_required", note: "endpoint must be an https URL" }, 400);
      }
      const hook = body ? body.webhook : undefined;
      if (hook !== undefined && hook !== null && (typeof hook !== "string" || !/^https:\/\//i.test(hook))) {
        return json({ error: "webhook_must_be_https" }, 400);
      }
      if (!env || !env.HS_VERIFY_KV) return json({ error: "storage_unavailable" }, 503);
      const reg = await readRegistry(env);
      const prev = reg[ep] || null;
      if (!prev && Object.keys(reg).length >= REGISTRY_MAX) {
        return json({ error: "registry_full", max: REGISTRY_MAX }, 429);
      }
      const admin = !!(env.SWEEP_TOKEN && await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN));
      const tier = admin && body.tier === "paid" ? "paid" : ((prev && prev.tier === "paid") ? "paid" : "free");
      reg[ep] = {
        tier: tier,
        webhook: hook === undefined ? ((prev && prev.webhook) || null) : (hook || null),
        added_at: (prev && prev.added_at) || new Date().toISOString()
      };
      const ok = await writeRegistry(env, reg);
      return json({
        ok: ok,
        endpoint: ep,
        tier: tier,
        cadence: tier === "paid" ? "daily" : "weekly",
        notified: !!reg[ep].webhook,
        history: "/history?endpoint=" + encodeURIComponent(ep),
        note: "The verdict is identical for every tier and free to read for anyone. Paying changes the cadence and the alert, never the result."
      });
    }

    // 掃引の手動実行。cron を待たずに測れるようにする。運営のみ。
    if (path === "/sweep" && request.method === "POST") {
      if (!env || !env.SWEEP_TOKEN) {
        return json({ error: "sweep_token_not_configured" }, 503);
      }
      if (!(await ctEqual(request.headers.get("x-sweep-token") || "", env.SWEEP_TOKEN))) {
        return json({ error: "forbidden" }, 403);
      }
      let force = false;
      try { const b = await request.json(); force = !!(b && b.force); } catch (_e) {}
      return json(await runDailySweep(env, { force: force }));
    }
    if (path === "/watchlist") {
      const wl = await watchlist(env);
      return json({
        watched: wl.map((w) => ({
          endpoint: w.endpoint,
          tier: w.tier,
          cadence: w.tier === "free" ? "weekly" : "daily",
          notified: !!w.webhook
        })),
        cadence: "daily for self and paid, weekly for free",
        verdict_is_identical_for_every_tier: true,
        note: "These endpoints are re-measured on a schedule so a verdict on this site does not silently go stale. No tool on any watched server is ever called by the sweep.",
        history: "/history?endpoint=...",
        changes: "/changes"
      });
    }

    if (path === "/badge" && request.method === "GET") {
      const ep = url.searchParams.get("endpoint") || "";
      let status = "not listed", color = "#9f9f9f";
      if (ep) {
        const reg = await publicRegister(env);
        const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
        if (row && row.latest && row.latest.status) {
          status = String(row.latest.status);
          color = status === CONFIG.tier_pass ? "#2f9e44" : "#c9820a";
        }
      }
      return new Response(badgeSvg("MCP conduct", status, color), {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (path.startsWith("/e/") && request.method === "GET") {
      const rest = path.slice(3).replace(/\/+$/, "");
      const ep = "https://" + rest;
      const reg = await publicRegister(env);
      const row = (Array.isArray(reg.rows) ? reg.rows : []).find((r) => r.endpoint === ep);
      if (!row) {
        return json({
          error: "not on the register",
          endpoint: ep,
          note: "No page is minted for an endpoint nobody has measured. Ask for a measurement and this URL starts working.",
          how_to_join: "https://shield.the-horizons-innovation.com/verify-directory/#listed",
          register: "https://gate.horizonshield.dev/register"
        }, 404);
      }
      return new Response(endpointPage("https://gate.horizonshield.dev", row), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    if (path === "/health") return json({ ok: true, gate_version: CONFIG.version, gate_commit: gateCommit() });
    if (path === "/spec") return json(spec());
    if (path === "/.well-known/agent-card.json") return json(ownAgentCard(url.origin));
    if (path === "/.well-known/glama.json") return json({ "$schema": "https://glama.ai/mcp/schemas/connector.json", maintainers: [{ email: "ogasurfproject@gmail.com" }] });
    // A machine that has only the hostname can find the register without being told where
    // to look. Same bytes as /register, plus the statement of what the rows are and are not,
    // shaped so that a crawler which reads nothing else still quotes it correctly.
    if (path === "/.well-known/mcp-register.json" && request.method === "GET") {
      const reg = await publicRegister(env);
      return json({
        "@context": "https://schema.org",
        "@type": "Dataset",
        "@id": "https://github.com/ogasurfproject-jpg/mcp-conduct-register#dataset",
        name: "MCP Conduct Register: measured conduct of Model Context Protocol servers",
        description: "A machine generated record of how MCP servers behaved when measured. Not a curated list, not a ranking, not an endorsement. Rows are produced by a scheduled measurement, not by selection.",
        url: "https://shield.the-horizons-innovation.com/verify-directory/",
        license: "https://opensource.org/licenses/MIT",
        isAccessibleForFree: true,
        creator: {
          "@type": "Organization",
          name: "The HORIZONs Co., Ltd.",
          url: "https://shield.the-horizons-innovation.com/",
          founder: { "@type": "Person", name: "Toshikatsu Oga", identifier: "https://orcid.org/0009-0000-9180-903X" }
        },
        distribution: [
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://gate.horizonshield.dev/register" },
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/register.json" },
          { "@type": "application/atom+xml", encodingFormat: "application/atom+xml", contentUrl: "https://raw.githubusercontent.com/ogasurfproject-jpg/mcp-conduct-register/main/feed.xml" }
        ],
        rows_are_selected_by: "nobody, the schedule decides what is measured and the code copies the result",
        what_this_does_not_claim: "That a listed server returns correct numbers, that the business behind it is competent, or that it is safe to use.",
        disputes: {
          how: "Measure any listed endpoint yourself and submit the observation to the public ledger under your own name and vantage.",
          intake: "https://ledger.horizonshield.dev/witness",
          operator_veto: "none, the code has no route to refuse a schema valid submission"
        },
        count: reg.count,
        gate_commit: reg.gate_commit,
        rows: reg.rows
      });
    }
    if (path === "/self") return json(await selfCheck(url.origin));

    if (path === "/check" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch (_e) { return json({ error: "invalid_json" }, 400); }
      const endpoint = body && body.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return json({ error: "endpoint_required", hint: 'POST {"endpoint":"https://your-server/mcp"}' }, 400);
      }
      let parsed;
      try { parsed = new URL(endpoint); }
      catch (_e) { return json({ error: "invalid_url" }, 400); }
      if (parsed.protocol !== "https:") {
        return json({ error: "https_required" }, 400);
      }
      try {
        return json(await runCheck(endpoint, body && body.allow_tool_call === true));
      } catch (e) {
        return json({ error: "check_failed", message: String(e && e.message || e) }, 500);
      }
    }

    if (path === "/check" && request.method === "GET") {
      return json({
        ok: true,
        usage: 'POST /check {"endpoint":"https://your-server/mcp"}',
        note: "By default no tool on the checked server is called, so determinism comes back as not measured. Add \"allow_tool_call\": true to measure it, and only do that for a server you control.",
        spec: "/spec"
      });
    }

    return json({ error: "not_found", path, endpoints: ["/mcp", "/check", "/spec", "/self", "/history", "/changes", "/watchlist", "/watch", "/sweep", "/sweep/last", "/health"] }, 404);
  }
};
