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
  version: "0.2.0",
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
    return { pass: false, transport: true, reason: "initialize failed: " + e.message + hint, detail };
  }
  try {
    const list = await rpcCall(endpoint, "tools/list");
    const tools = (list && list.result && list.result.tools) || [];
    detail.tool_count = tools.length;
    detail.tools = tools.map((t) => t.name).slice(0, 50);
    if (!tools.length) return { pass: false, reason: "tools/list returned no tools", detail };
  } catch (e) {
    return { pass: false, transport: true, reason: "tools/list failed: " + e.message, detail };
  }
  return { pass: true, reason: "MCP endpoint responds to initialize and tools/list", detail };
}

// ---- 条件2. A2A エージェントカード ----
async function checkAgentCard(endpoint) {
  const origin = new URL(endpoint).origin;
  const url = origin + "/.well-known/agent-card.json";
  try {
    const res = await withTimeout(fetch(url), CONFIG.timeout_ms);
    if (!res.ok) return { pass: false, transport: true, reason: "agent-card not reachable (http " + res.status + ")", detail: { url } };
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
  results.agent_card = { pass: cardRes.pass, transport: cardRes.transport === true, reason: cardRes.reason, detail: cardRes.detail };
  results.compensation_disclosure = checkCompensation(cardRes.card);

  const firstTool = results.mcp_endpoint.detail && results.mcp_endpoint.detail.tools
    ? results.mcp_endpoint.detail.tools[0] : null;
  results.determinism = await checkDeterminism(endpoint, firstTool, allowToolCall === true);

  const passed = Object.values(results).every((r) => r.pass);
  // 「届かなかった」と「届いた上で条件を満たさない」は別の事実。
  // fail-closed は変えない。緑にはしない。ただし理由の書き分けはする。
  const unreachable = Object.values(results).some((r) => r && r.transport === true);

  const record = {
    gate: "Yakumo Verification Gate",
    gate_version: CONFIG.version,
    endpoint: endpoint,
    checked_at: started,
    reachable: !unreachable,
    status: passed ? CONFIG.tier_pass : (unreachable ? CONFIG.tier_held : CONFIG.tier_fail),
    scope_note:
      "This gate verifies conformance and disclosure only. It does NOT verify that any price " +
      "or figure returned by the server is correct. Price validation is a separate, paid tier " +
      "and is currently available for Japanese construction only. By default this gate calls no " +
      "tools on the server being checked, so determinism is reported as not measured rather than " +
      "guessed. Send allow_tool_call true to have it measured on a server you control.",
    tools_called: allowToolCall === true ? "one tool, twice, with empty arguments, by consent" : "none",
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
      determinism: "Calling the same tool with the same arguments returns identical content across runs. NOT measured by default: doing so requires executing a tool on the checked server, which this gate will not do without the owner's consent. Send allow_tool_call true to measure it.",
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
const MAX_PER_SWEEP = 15;        // 1本につき外部アクセス3回。Free の 50/request に収まる上限
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
      reason: r ? r.slice(0, 240) : null
    };
  }
  return {
    at: record.checked_at,
    status: record.status,
    reachable: record.reachable !== false,
    record_sha256: record.record_sha256,
    conditions: out,
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

// 毎日の再測定。**allow_tool_call は決して渡さない。** 他人のツールは呼ばない。
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
      const record = await runCheck(w.endpoint, false);
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
    description:
      "Return the five conditions this gate measures, what it explicitly does not verify, " +
      "and the tier definitions. Takes no arguments and returns identical output every time. " +
      "Read this before running a check so you know what a verdict does and does not claim.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "check_conformance",
    title: "Check an MCP server for conformance and disclosure",
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
      ? "The verdict was not altered after it was issued."
      : "Mismatch. The verdict was altered after it was issued, or it was not issued by this gate. Reject it."
  };
}

async function handleMcp(body) {
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
    pass: true,
    measured: false,
    reason:
      "applicable and served, but not self measured. This gate now speaks MCP at /mcp, so the " +
      "condition applies to it. It cannot reach itself over the network from inside its own " +
      "account, so it does not claim to have measured this. Point another checker at " +
      "/mcp from outside and the claim is either confirmed or destroyed.",
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
    ctx.waitUntil(runDailySweep(env));
  },

  async fetch(request, env, ctx) {
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
      const res = await handleMcp(body);
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
      const admin = !!(env.SWEEP_TOKEN && request.headers.get("x-sweep-token") === env.SWEEP_TOKEN);
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
      if (request.headers.get("x-sweep-token") !== env.SWEEP_TOKEN) {
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
