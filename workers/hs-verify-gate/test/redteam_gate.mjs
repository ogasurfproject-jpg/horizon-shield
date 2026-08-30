// 検証の扉 (conduct register / 5条件) レッドチーム ・ 扉を敵として攻める(自己検証 harness)
//
// 目的:
//   扉(src/worker.js の runCheck)が「見た目だけ整えた不誠実な MCP サーバー」に verified を出さないこと、
//   そして「届いた上で不適合」と「届かなかった」を取り違えないことを、扉自身への攻撃で継続的に証明する。
//   攻撃が1つでもすり抜けたら exit 1。扉を弱めた変更はここで赤く止まる。
//
// 方法:
//   globalThis.fetch を差し替え、*.redteam.invalid の敵サーバー(モック)を返す。ネットワークは使わない。
//   .invalid は RFC 2606 の予約 TLD なので、差し替えが外れても本物へは絶対に飛ばない。
//   扉のコードは一切改造せず、公開の入口 (POST /check) からだけ叩く。誰でも再実行できる。
//
// これは pagecheck の redteam.py と同じ規律を扉に向けたもの:
//   - 落ちたものを隠さない(THROUGH-LIST)を検証器自身に適用する
//   - fail-closed(1つでも漏れたら不合格)
//   - 決定論的(同じ入力 -> 同じ結果)
//
// 使い方:  node test/redteam_gate.mjs            (workers/hs-verify-gate で)
//          node test/redteam_gate.mjs --list
//          node test/redteam_gate.mjs --only NAME
//          node test/redteam_gate.mjs --all      (版の下限を無視して全手を当てる。旧版の穴の数を測るとき)
import worker from "../src/worker.js";

const HOST = (n) => "https://" + n + ".redteam.invalid";
const ENV = { RELAY_URL: "https://relay.redteam.invalid", GATE_COMMIT: "redteam-local" }; // RELAY_TOKEN 無し = 中継不使用(直叩き)
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };

// ---------------------------------------------------------------------------
// 敵サーバーの部品
const jres = (obj, status, headers) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json", ...(headers || {}) } });
const tres = (text, status, headers) => new Response(text, { status: status || 200, headers: { "content-type": "text/html", ...(headers || {}) } });

const TOOL = (name, extra) => ({ name, description: "redteam tool " + name, inputSchema: { type: "object", properties: {} }, ...(extra || {}) });
const CARD = (extra) => ({
  name: "Redteam Agent", description: "an adversarial mock", url: "",
  compensation: { paid_by: "public", referral_fee: false, listing_fee: false, success_fee_pct: 0, disclosure_url: "https://example.invalid/disclosure" },
  ...(extra || {})
});
const CONST_OUT = { content: [{ type: "text", text: "constant answer" }] };

// cfg: { init, tools, call(name, args, nth), card, cardStatus, cardRedirect, mcpRedirect, mcpStatus, mcpText, pages }
function mkServer(cfg) {
  const calls = { n: 0 };
  return async (url, init) => {
    const u = new URL(url);
    const method = (init && init.method) || "GET";
    if (u.pathname === "/.well-known/agent-card.json") {
      if (cfg.cardRedirect) return new Response("", { status: 302, headers: { location: cfg.cardRedirect } });
      if (cfg.cardStatus) return tres("no", cfg.cardStatus);
      if (cfg.cardText !== undefined) return tres(cfg.cardText, 200);
      return jres(cfg.card === undefined ? CARD() : cfg.card);
    }
    if (u.pathname === "/mcp" && method === "POST") {
      if (cfg.mcpRedirect) return new Response("", { status: 307, headers: { location: cfg.mcpRedirect } });
      if (cfg.mcpStatus) return tres("<html>nope</html>", cfg.mcpStatus);
      if (cfg.mcpText !== undefined) return tres(cfg.mcpText, 200);
      const body = JSON.parse(init.body);
      const id = body.id;
      if (body.method === "initialize") {
        if (cfg.initError) return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "initialize not supported" } });
        if (cfg.initNull) return jres({ jsonrpc: "2.0", id, result: null });
        return jres({ jsonrpc: "2.0", id, result: cfg.init || { protocolVersion: "2024-11-05", serverInfo: { name: "redteam", version: "0" }, capabilities: { tools: {} } } });
      }
      if (body.method === "tools/list") {
        if (cfg.toolsRaw !== undefined) return jres({ jsonrpc: "2.0", id, result: { tools: cfg.toolsRaw } });
        if (cfg.toolsText !== undefined) return new Response(cfg.toolsText, { status: 200, headers: { "content-type": "application/json" } });
        const pages = cfg.pages || [cfg.tools || [TOOL("alpha")]];
        const cur = (body.params && body.params.cursor) || null;
        const idx = cfg.cursorLoop ? 0 : (cur ? Number(cur) : 0);
        const next = cfg.cursorLoop ? "again" : (idx + 1 < pages.length ? String(idx + 1) : undefined);
        return jres({ jsonrpc: "2.0", id, result: { tools: pages[idx] || [], ...(next ? { nextCursor: next } : {}) } });
      }
      if (body.method === "tools/call") {
        calls.n += 1;
        const name = body.params && body.params.name;
        const args = (body.params && body.params.arguments) || {};
        const r = cfg.call ? cfg.call(name, args, calls.n) : CONST_OUT;
        if (r && r.__error) return jres({ jsonrpc: "2.0", id, error: r.__error });
        return jres({ jsonrpc: "2.0", id, result: r });
      }
      return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
    }
    return tres("not found", 404);
  };
}

// ---------------------------------------------------------------------------
// 攻撃と対照。expect は「扉が返す判定に対して成り立たねばならない述語」。
//   not_verified : status !== "verified"
//   status       : 完全一致
//   reachable    : 完全一致 (true = 届いた, false = 届かなかった, null = 扉側故障)
//   fail         : この条件が pass:false であること
//   pass         : この条件が pass:true であること
//   pred(record) : 任意の述語 (説明つき)
const A = [];
function atk(name, kind, cfg, expect, opts) { A.push({ name, kind, cfg, expect, opts: opts || {} }); }

// ---- 対照(健全・正当) ----
atk("ok_honest_consent", "control", { tools: [TOOL("alpha"), TOOL("beta")] },
  { status: "verified", reachable: true, pass: ["mcp_endpoint", "agent_card", "compensation_disclosure", "determinism"] }, { consent: true });
atk("ok_honest_no_consent", "control", {},
  { status: "pending", reachable: true, pass: ["mcp_endpoint", "agent_card", "compensation_disclosure"], fail: ["determinism"],
    pred: [["determinism measured:false", (r) => r.checks.determinism.measured === false]] });
atk("ok_paginated_tools", "control", { pages: [[TOOL("alpha")], [TOOL("beta")]] },
  { status: "verified", pred: [["surface complete", (r) => r.checks.mcp_endpoint.detail.surface.complete === true], ["2 tools", (r) => r.checks.mcp_endpoint.detail.tool_count === 2]] }, { consent: true });
atk("ok_card_same_origin_redirect", "control", { cardRedirect: HOST("ok-card-same-origin-redirect") + "/card2.json", extraRoutes: { "/card2.json": () => jres(CARD()) } },
  { status: "verified" }, { consent: true, min: "0.2.2" });
atk("ok_first_tool_errors_second_ok", "control", { tools: [TOOL("needs_args"), TOOL("beta")], call: (n) => n === "needs_args" ? { __error: { code: -32602, message: "argument required" } } : CONST_OUT },
  { status: "verified", pred: [["measured on beta", (r) => r.checks.determinism.detail.tool === "beta"], ["tried lists needs_args", (r) => JSON.stringify(r.checks.determinism.detail.tried || []).includes("needs_args")]] }, { consent: true, min: "0.2.2" });
atk("ok_unsafe_integer_disclosed_not_red", "control", { toolsText: '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"alpha","description":"x","inputSchema":{"type":"object","properties":{},"maximum":9007199254740993}}]}}' },
  { status: "verified", pred: [["canonicalization refused but disclosed", (r) => r.canonicalization && r.canonicalization.canonicalizable === false]] }, { consent: true });
atk("ok_record_recomputes", "control", {},
  { status: "pending", pred: [["record_sha256 recomputes", async (r) => (await recompute(r)) === r.record_sha256]] });

// ---- 条件1: MCP エンドポイント ----
atk("hollow_tool_no_inputSchema", "attack", { toolsRaw: [{ name: "x" }] }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true, min: "0.2.2" });
atk("tool_empty_name", "attack", { toolsRaw: [{ name: "", inputSchema: { type: "object" } }] }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true, min: "0.2.2" });
atk("tool_name_not_string", "attack", { toolsRaw: [{ name: { $: 1 }, inputSchema: { type: "object" } }] }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true, min: "0.2.2" });
atk("duplicate_tool_names", "attack", { tools: [TOOL("alpha"), TOOL("alpha")] }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true, min: "0.2.2" });
atk("tools_is_object_not_array", "attack", { toolsRaw: { name: "alpha" } }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true });
atk("initialize_jsonrpc_error", "attack", { initError: true }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true, min: "0.2.2" });
atk("initialize_result_null", "attack", { initNull: true }, { not_verified: true, fail: ["mcp_endpoint"] }, { consent: true, min: "0.2.2" });
atk("cursor_loop_same_page", "attack", { tools: [TOOL("alpha")], cursorLoop: true }, { not_verified: true, pred: [["surface incomplete disclosed", (r) => r.checks.mcp_endpoint.detail.surface && r.checks.mcp_endpoint.detail.surface.complete === false]] }, { consent: true, min: "0.2.2" });

// ---- 「届いた上で不適合」と「届かなかった」の取り違え ----
atk("mcp_http_404", "misclass", { mcpStatus: 404 }, { status: "pending", reachable: true, fail: ["mcp_endpoint"] }, { min: "0.2.2" });
atk("mcp_http_200_html", "misclass", { mcpText: "<html>welcome</html>" }, { status: "pending", reachable: true, fail: ["mcp_endpoint"] }, { min: "0.2.2" });
atk("mcp_http_401", "misclass", { mcpStatus: 401 }, { status: "pending", reachable: true, fail: ["mcp_endpoint"] }, { min: "0.2.2" });
atk("mcp_http_503_is_held", "control", { mcpStatus: 503 }, { status: "held", reachable: false });
atk("host_does_not_resolve_is_held", "control", { unreachable: true }, { status: "held", reachable: false });
atk("card_http_404_is_pending", "control", { cardStatus: 404 }, { status: "pending", reachable: true, fail: ["agent_card"] });

// ---- 条件2: agent card ----
atk("mcp_redirect_cross_origin", "attack", { mcpRedirect: HOST("honest-target") + "/mcp" }, { not_verified: true, fail: ["mcp_endpoint"], reachable: true }, { consent: true, min: "0.2.2", honest: "honest-target" });
atk("card_redirect_cross_origin", "attack", { cardRedirect: HOST("honest-target") + "/.well-known/agent-card.json" }, { not_verified: true, fail: ["agent_card"] }, { consent: true, min: "0.2.2", honest: "honest-target" });
atk("card_name_whitespace", "attack", { card: CARD({ name: "   " }) }, { not_verified: true, fail: ["agent_card"] }, { consent: true, min: "0.2.2" });
atk("card_name_boolean", "attack", { card: CARD({ name: true }) }, { not_verified: true, fail: ["agent_card"] }, { consent: true, min: "0.2.2" });
atk("card_description_object", "attack", { card: CARD({ description: { en: "x" } }) }, { not_verified: true, fail: ["agent_card"] }, { consent: true, min: "0.2.2" });
atk("card_is_array", "attack", { card: [CARD()] }, { not_verified: true, fail: ["agent_card"] }, { consent: true, min: "0.2.2" });
atk("card_is_html", "attack", { cardText: "<html>card</html>" }, { not_verified: true, fail: ["agent_card"], reachable: true }, { consent: true, min: "0.2.2" });

// ---- 条件3: 報酬構造の開示 ----
atk("comp_missing", "attack", { card: CARD({ compensation: undefined }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true });
atk("comp_is_string", "attack", { card: CARD({ compensation: "buyer pays" }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true });
atk("comp_paid_by_case", "attack", { card: CARD({ compensation: { paid_by: "Buyer", referral_fee: false, listing_fee: false } }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true });
atk("comp_referral_fee_string", "attack", { card: CARD({ compensation: { paid_by: "buyer", referral_fee: "no", listing_fee: false } }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true });
atk("comp_success_fee_string", "attack", { card: CARD({ compensation: { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: "see website" } }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true, min: "0.2.2" });
atk("comp_success_fee_out_of_range", "attack", { card: CARD({ compensation: { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: 150 } }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true, min: "0.2.2" });
atk("comp_success_fee_nan", "attack", { card: CARD({ compensation: { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: null } }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true, min: "0.2.2" });
atk("comp_disclosure_url_object", "attack", { card: CARD({ compensation: { paid_by: "buyer", referral_fee: false, listing_fee: false, disclosure_url: { href: "x" } } }) }, { not_verified: true, fail: ["compensation_disclosure"] }, { consent: true, min: "0.2.2" });
atk("comp_referral_contradiction_disclosed", "control", { card: CARD({ compensation: { paid_by: "referral", referral_fee: false, listing_fee: false, success_fee_pct: 0 } }) },
  { status: "verified", pred: [["consistency_note published", (r) => typeof r.checks.compensation_disclosure.detail.consistency_note === "string"]] }, { consent: true, min: "0.2.2" });

// ---- 条件4: 決定論性 ----
atk("determinism_error_echo", "attack", { tools: [TOOL("alpha")], call: () => ({ __error: { code: -32602, message: "argument required" } }) }, { not_verified: true, fail: ["determinism"] }, { consent: true, min: "0.2.2" });
atk("determinism_isError_echo", "attack", { tools: [TOOL("alpha")], call: () => ({ content: [{ type: "text", text: "missing argument" }], isError: true }) }, { not_verified: true, fail: ["determinism"] }, { consent: true, min: "0.2.2" });
atk("determinism_all_tries_error", "attack", { tools: [TOOL("a"), TOOL("b"), TOOL("c"), TOOL("d")], call: () => ({ __error: { code: -32602, message: "argument required" } }) },
  { not_verified: true, fail: ["determinism"], pred: [["tried 3", (r) => (r.checks.determinism.detail.tried || []).length === 3], ["measured:false", (r) => r.checks.determinism.measured === false]] }, { consent: true, min: "0.2.2" });
atk("determinism_random_output", "attack", { tools: [TOOL("alpha")], call: (n, a, nth) => ({ content: [{ type: "text", text: "run " + nth }] }) }, { not_verified: true, fail: ["determinism"] }, { consent: true });
atk("determinism_first_constant_second_random_disclosed", "residual", { tools: [TOOL("ping"), TOOL("quote")], call: (n, a, nth) => n === "ping" ? CONST_OUT : ({ content: [{ type: "text", text: "run " + nth }] }) },
  { status: "verified", pred: [["unmeasured tools disclosed", (r) => r.checks.determinism.detail.tools_unmeasured === 1 && typeof r.checks.determinism.detail.selection === "string"]] }, { consent: true, min: "0.2.2" });
atk("determinism_consent_basis_disclosed", "control", {}, { status: "verified", pred: [["consent_basis on record", (r) => typeof r.consent_basis === "string" && /requester/.test(r.consent_basis)]] }, { consent: true, min: "0.2.2" });

// ---- 入口 ----
atk("endpoint_ip_literal_rejected", "attack", {}, { http: 400 }, { endpoint: "https://203.0.113.5/mcp", min: "0.2.2" });
atk("endpoint_localhost_rejected", "attack", {}, { http: 400 }, { endpoint: "https://localhost/mcp", min: "0.2.2" });
atk("endpoint_http_scheme_rejected", "attack", {}, { http: 400 }, { endpoint: "http://plain.redteam.invalid/mcp" });
atk("endpoint_userinfo_rejected", "attack", {}, { http: 400 }, { endpoint: "https://user:pw@x.redteam.invalid/mcp", min: "0.2.2" });

// ---- 条件5: 判定の再計算 ----
atk("verify_verdict_tampered_detected", "control", {}, { pred: [["tampered -> verified:false", async (r) => {
  const t = JSON.parse(JSON.stringify(r)); t.status = "verified";
  const v = await mcpCall("verify_verdict", { record: t }); return v && v.verified === false;
}], ["untouched -> verified:true", async (r) => { const v = await mcpCall("verify_verdict", { record: r }); return v && v.verified === true; }]] });

// ---------------------------------------------------------------------------
async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function recompute(record) {
  const c = JSON.parse(JSON.stringify(record));
  delete c.record_sha256; delete c.recompute_note;
  return sha256hex(JSON.stringify(c));
}
async function mcpCall(name, args) {
  const res = await worker.fetch(new Request("https://gate.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), ENV, CTX);
  const j = await res.json();
  try { return JSON.parse(j.result.content[0].text); } catch (_e) { return j.result; }
}

const LIVE = process.argv.includes("--live-own");
const ROUTES = new Map();
const realFetch = globalThis.fetch;
if (!LIVE) globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const u = new URL(url);
  if (!u.hostname.endsWith(".redteam.invalid")) throw new Error("fetch failed: redteam harness refuses network (" + u.hostname + ")");
  const srv = ROUTES.get(u.hostname);
  if (!srv) throw new Error("fetch failed: getaddrinfo ENOTFOUND " + u.hostname);
  let res = await srv(url, init || {});
  // 本物の fetch と同じく、redirect:"manual" でなければ Location を辿る(最大5回)
  let hops = 0;
  while (res.status >= 300 && res.status < 400 && res.headers.get("location") && (!init || init.redirect !== "manual") && hops < 5) {
    const loc = new URL(res.headers.get("location"), url).toString();
    const s2 = ROUTES.get(new URL(loc).hostname);
    if (!s2) throw new Error("fetch failed: getaddrinfo ENOTFOUND " + new URL(loc).hostname);
    res = await s2(loc, { ...(init || {}), method: res.status === 307 || res.status === 308 ? (init && init.method) || "GET" : "GET" });
    hops += 1;
  }
  return res;
};

function gateVersion() { return worker && worker.__version ? worker.__version : null; }
function verLt(a, b) { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) < (pb[i] || 0)) return true; if ((pa[i] || 0) > (pb[i] || 0)) return false; } return false; }

async function run(only, listOnly) {
  if (listOnly) { for (const a of A) console.log(a.name); console.log("total:", A.length); return 0; }
  const health = await (await worker.fetch(new Request("https://gate.horizonshield.dev/health"), ENV, CTX)).json();
  const gv = String(health.gate_version || "0");
  console.log("=== 検証の扉 レッドチーム (扉を敵として攻める: 不誠実な MCP サーバー x 5条件) 扉 v" + gv + " ===");
  let passed = 0, skipped = 0; const failures = []; const byKind = {};
  for (const a of A) {
    if (only && !a.name.includes(only)) continue;
    if (a.opts.min && verLt(gv, a.opts.min) && !process.argv.includes("--all")) { skipped += 1; console.log("  skip   ----   %s (門 v%s 未満では対象外)", a.name.padEnd(46), a.opts.min); continue; }
    byKind[a.kind] = byKind[a.kind] || [0, 0]; byKind[a.kind][1] += 1;
    const host = a.name.toLowerCase().replace(/_/g, "-") + ".redteam.invalid"; // URL はホスト名を小文字にする
    ROUTES.clear();
    if (!a.cfg.unreachable) {
      const srv = mkServer(a.cfg);
      ROUTES.set(host, async (url, init) => {
        const p = new URL(url).pathname;
        if (a.cfg.extraRoutes && a.cfg.extraRoutes[p]) return a.cfg.extraRoutes[p](url, init);
        return srv(url, init);
      });
    }
    if (a.opts.honest) ROUTES.set(a.opts.honest + ".redteam.invalid", mkServer({ tools: [TOOL("honest_tool")] }));
    const endpoint = a.opts.endpoint || ("https://" + host + "/mcp");
    const req = new Request("https://gate.horizonshield.dev/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint, allow_tool_call: !!a.opts.consent }) });
    let res, record = null;
    try { res = await worker.fetch(req, ENV, CTX); record = await res.json(); }
    catch (e) { failures.push(a.name + ": 扉が例外で落ちた " + e.message); console.log("  RED    CRASH  %s << %s", a.name.padEnd(46), e.message); continue; }
    const problems = [];
    const ex = a.expect;
    if (ex.http !== undefined) { if (res.status !== ex.http) problems.push("http " + res.status + " != " + ex.http); }
    else {
      if (res.status !== 200) problems.push("http " + res.status + " body=" + JSON.stringify(record).slice(0, 80));
      if (ex.status && record.status !== ex.status) problems.push("status " + record.status + " != " + ex.status);
      if (ex.not_verified && record.status === "verified") problems.push("verified を出した(穴)");
      if (ex.reachable !== undefined && record.reachable !== ex.reachable) problems.push("reachable " + record.reachable + " != " + ex.reachable);
      for (const c of (ex.fail || [])) if (!record.checks || !record.checks[c] || record.checks[c].pass !== false) problems.push(c + " が fail でない");
      for (const c of (ex.pass || [])) if (!record.checks || !record.checks[c] || record.checks[c].pass !== true) problems.push(c + " が pass でない: " + (record.checks && record.checks[c] && record.checks[c].reason));
      for (const [label, fn] of (ex.pred || [])) { let ok = false; try { ok = await fn(record); } catch (e) { ok = false; problems.push(label + " 述語が例外 " + e.message); } if (!ok) problems.push("述語不成立: " + label); }
    }
    if (problems.length) {
      failures.push(a.name + ": " + problems.join(" / "));
      const why = record && record.checks ? Object.entries(record.checks).map(([k, v]) => k + "=" + (v.pass ? "pass" : "FAIL") + (v.reason ? "(" + String(v.reason).slice(0, 50) + ")" : "")).join(" ") : "";
      console.log("  RED    %s %s << %s\n         %s", a.kind === "attack" ? "LEAK  " : "WRONG ", a.name.padEnd(46), problems.join(" / "), why);
    } else {
      passed += 1; byKind[a.kind][0] += 1;
      const tag = a.kind === "attack" ? "BLOCK " : (a.kind === "control" ? "PASS  " : a.kind.toUpperCase().padEnd(6));
      console.log("  green  %s %s (%s%s)", tag, a.name.padEnd(46), record && record.status ? record.status : "http " + res.status, record && record.reachable !== undefined ? ", reachable=" + record.reachable : "");
    }
  }
  console.log("\n--- 種別 ---");
  for (const k of Object.keys(byKind).sort()) console.log("  %s %d / %d", k.padEnd(10), byKind[k][0], byKind[k][1]);
  const total = passed + failures.length;
  console.log("\n=== %d / %d 合格 (扉 v%s、対象外 %d) ===", passed, total, gv, skipped);
  if (failures.length) { console.log("不適格。扉に穴か取り違えがある(fail-closed):"); for (const f of failures) console.log("  - " + f); return 1; }
  console.log("全攻撃に verified を出さず、届いた/届かないを取り違えず、健全な相手は通した。扉は健在。");
  return 0;
}

// --live-own: モックを使わず、自社エンドポイントを「今の src/worker.js」で実測する(デプロイ前の差分確認)。
//   呼ぶのは夜間 cron と同じ read-only 呼び出しだけ(initialize / tools/list / agent-card / 同意済みは tools/call 空引数)。
//   自社の 8本のうち gate 自身は直叩きできない(自己参照は中継が要る)ので除く。
const OWN = [
  ["https://mcp.horizonshield.dev/mcp", true], ["https://hearing.horizonshield.dev/mcp", true],
  ["https://web.horizonshield.dev/mcp", true], ["https://jidec.horizonshield.dev/mcp", true],
  ["https://p001.horizonshield.dev/mcp", false], ["https://p002.horizonshield.dev/mcp", true],
  ["https://femtech.horizonshield.dev/mcp", true],
];
async function liveOwn() {
  const health = await (await worker.fetch(new Request("https://gate.horizonshield.dev/health"), ENV, CTX)).json();
  console.log("=== 自社エンドポイント実測 (扉 v" + health.gate_version + " をローカルで実行、本物の fetch) ===");
  let bad = 0;
  for (const [ep, consent] of OWN) {
    const res = await worker.fetch(new Request("https://gate.horizonshield.dev/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: ep, allow_tool_call: consent }) }), ENV, CTX);
    const r = await res.json();
    const c = r.checks || {};
    const line = (k) => c[k] ? (c[k].pass ? "pass" : "FAIL(" + String(c[k].reason || "").slice(0, 70) + ")") : "?";
    console.log("  %s  %s  reachable=%s", (r.status || "?").padEnd(8), ep, r.reachable);
    console.log("      mcp=%s  card=%s  comp=%s", line("mcp_endpoint"), line("agent_card"), line("compensation_disclosure"));
    console.log("      determinism=%s  tool=%s  tried=%s", line("determinism"), c.determinism && c.determinism.detail && c.determinism.detail.tool, JSON.stringify((c.determinism && c.determinism.detail && c.determinism.detail.tried) || []).slice(0, 160));
    const expected = consent ? "verified" : "pending";
    if (r.status !== expected) { bad += 1; console.log("      << 想定(%s)と違う", expected); }
  }
  console.log(bad ? "\n" + bad + " 本が想定と違う。理由を読んでからデプロイを決めること。" : "\n全本が想定どおり(同意済み=verified / p001=pending)。");
  return bad ? 1 : 0;
}

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
process.exit(LIVE ? await liveOwn() : await run(only, process.argv.includes("--list")));
