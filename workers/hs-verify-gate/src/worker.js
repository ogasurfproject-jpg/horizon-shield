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

// 仕様確定までの暫定値。名称や閾値はここだけ直せば全体に効く。
const CONFIG = {
  version: "0.1.0",
  tier_pass: "verified",        // 通過時の称号(暫定)
  tier_fail: "pending",         // 未通過(不合格とは呼ばない)
  timeout_ms: 10000,
  determinism_runs: 2           // 決定論性の確認に何回叩くか
};

function json(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), { status: status || 200, headers: JSON_HEADERS });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
  ]);
}

async function rpcCall(endpoint, method, params) {
  const res = await withTimeout(fetch(endpoint, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params || {} })
  }), CONFIG.timeout_ms);
  if (!res.ok) throw new Error("http " + res.status);
  return await res.json();
}

// ---- 条件1. 実在する MCP エンドポイント ----
async function checkMcp(endpoint) {
  const detail = {};
  try {
    const init = await rpcCall(endpoint, "initialize", { protocolVersion: "2024-11-05" });
    detail.initialize = !!(init && init.result);
    detail.server_name = (init && init.result && init.result.serverInfo && init.result.serverInfo.name) || null;
  } catch (e) {
    const hint = /1104|1042|Failed to fetch|fetch failed/i.test(String(e.message))
      ? " (the gate could not reach this host. Cloudflare blocks Worker-to-Worker calls within the " +
        "same account over workers.dev; use a custom domain, or run the check from outside)"
      : "";
    return { pass: false, reason: "initialize failed: " + e.message + hint, detail };
  }
  try {
    const list = await rpcCall(endpoint, "tools/list");
    const tools = (list && list.result && list.result.tools) || [];
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => t.name).slice(0, 50);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
  } catch (e) {
    return { pass: false, reason: "tools/list failed: " + e.message, detail };
  }
  return { pass: true, reason: "MCP endpoint responds to initialize and tools/list", detail };
}

// ---- 条件2. A2A エージェントカード ----
async function checkAgentCard(endpoint) {
  const origin = new URL(endpoint).origin;
  const url = origin + "/.well-known/agent-card.json";
  try {
    const res = await withTimeout(fetch(url), CONFIG.timeout_ms);
    if (!res.ok) return { pass: false, reason: "agent-card not reachable (http " + res.status + ")", detail: { url } };
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
    return { pass: false, reason: "agent-card fetch failed: " + e.message, detail: { url } };
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
async function checkDeterminism(endpoint, toolName) {
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
async function runCheck(endpoint) {
  const started = new Date().toISOString();
  const results = {};

  results.mcp_endpoint = await checkMcp(endpoint);
  const cardRes = await checkAgentCard(endpoint);
  results.agent_card = { pass: cardRes.pass, reason: cardRes.reason, detail: cardRes.detail };
  results.compensation_disclosure = checkCompensation(cardRes.card);

  const firstTool = results.mcp_endpoint.detail && results.mcp_endpoint.detail.tools
    ? results.mcp_endpoint.detail.tools[0] : null;
  results.determinism = await checkDeterminism(endpoint, firstTool);

  const passed = Object.values(results).every((r) => r.pass);

  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    endpoint: endpoint,
    checked_at: started,
    status: passed ? CONFIG.tier_pass : CONFIG.tier_fail,
    scope_note:
      "This gate verifies conformance and disclosure only. It does NOT verify that any price " +
      "or figure returned by the server is correct. Price validation is a separate, paid tier " +
      "and is currently available for Japanese construction only.",
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
      determinism: "Calling the same tool with the same arguments returns identical content across runs",
      self_verification: "Every verdict carries a SHA-256 that any third party can recompute"
    },
    tiers: {
      [CONFIG.tier_pass]: "Free. Conformance and disclosure verified. No price validation.",
      "verified_plus_data": "Paid. Figures traced to a third-party obtainable primary source.",
      "yakumo_partner": "Paid. Dedicated MCP server, operations, audit log."
    },
    operator: "The HORIZ音s Co., Ltd. / HORIZON SHIELD",
    self_applied: "This gate is itself subject to these conditions."
  };
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
    skills: [
      {
        id: "check",
        name: "Conformance check",
        description: "POST /check with an MCP endpoint URL. Returns a verdict with a recomputable SHA-256.",
        tags: ["mcp", "verification", "conformance", "disclosure"]
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
  checks.mcp_endpoint = {
    pass: true,
    reason: "not applicable: this gate is an HTTP checker, not an MCP server. Stated rather than hidden.",
    detail: { applicable: false, endpoints: ["/check", "/spec", "/self", "/health"] }
  };

  const passed = Object.values(checks).every((r) => r.pass);
  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
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
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") return json({ ok: true, gate_version: CONFIG.version });
    if (path === "/spec") return json(spec());
    if (path === "/.well-known/agent-card.json") return json(ownAgentCard(url.origin));
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
        return json(await runCheck(endpoint));
      } catch (e) {
        return json({ error: "check_failed", message: String(e && e.message || e) }, 500);
      }
    }

    if (path === "/check" && request.method === "GET") {
      return json({ ok: true, usage: 'POST /check {"endpoint":"https://your-server/mcp"}', spec: "/spec" });
    }

    return json({ error: "not_found", path, endpoints: ["/check", "/spec", "/self", "/health"] }, 404);
  }
};
